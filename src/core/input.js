/**
 * Keyboard + virtual (touch) input for Wildling Trails.
 *
 * One singleton (`input`) tracks which *sources* hold each action, so two keys
 * bound to the same action (Z and Space → a) never release each other, and the
 * touch pad is simply one more source ("virtual"). Presses are delivered two
 * ways:
 *   1. push — `onPress(action, fn)` listeners run newest-registered first; a
 *      listener returning `true` consumes the press.
 *   2. poll — unconsumed presses are buffered for `pressed(action)` until
 *      `endFrame()` drops them.
 *
 * No DOM access at module top level: listeners are attached in `init()`.
 */

/** @typedef {'up'|'down'|'left'|'right'} Dir */
/** @typedef {Dir|'a'|'b'|'start'|'run'|'time'} Action */

/** Every action the game understands. */
export const ACTIONS = Object.freeze(['up', 'down', 'left', 'right', 'a', 'b', 'start', 'run', 'time']);

/** Direction actions, in no particular order. */
export const DIRECTIONS = Object.freeze(['up', 'down', 'left', 'right']);

const DIRECTION_SET = new Set(DIRECTIONS);
const ACTION_SET = new Set(ACTIONS);

/**
 * Physical key (`KeyboardEvent.code`) → action. Codes are layout-independent,
 * so WASD sits under the same fingers on AZERTY/QWERTZ keyboards.
 * @type {Readonly<Record<string, Action>>}
 */
export const KEY_BINDINGS = Object.freeze({
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  KeyZ: 'a',
  Space: 'a',
  KeyJ: 'a',
  KeyX: 'b',
  Backspace: 'b',
  KeyK: 'b',
  Enter: 'start',
  NumpadEnter: 'start',
  Escape: 'start',
  ShiftLeft: 'run',
  ShiftRight: 'run',
  KeyT: 'time',
});

/**
 * Fallback for events without a usable `code` (some virtual keyboards, old
 * browsers): lower-cased `KeyboardEvent.key` → action.
 * @type {Readonly<Record<string, Action>>}
 */
const KEY_NAME_BINDINGS = Object.freeze({
  arrowup: 'up',
  up: 'up',
  w: 'up',
  arrowdown: 'down',
  down: 'down',
  s: 'down',
  arrowleft: 'left',
  left: 'left',
  a: 'left',
  arrowright: 'right',
  right: 'right',
  d: 'right',
  z: 'a',
  ' ': 'a',
  spacebar: 'a',
  j: 'a',
  x: 'b',
  backspace: 'b',
  k: 'b',
  enter: 'start',
  escape: 'start',
  esc: 'start',
  shift: 'run',
  t: 'time',
});

/** Keys whose browser default (scrolling, history back, button activation) we suppress. */
const PREVENT_CODES = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'Backspace',
  'Enter',
  'NumpadEnter',
]);
const PREVENT_KEYS = new Set([
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
  'up',
  'down',
  'left',
  'right',
  ' ',
  'spacebar',
  'backspace',
  'enter',
]);

/** Source id used by `setVirtual` (the on-screen touch pad). */
const VIRTUAL = 'virtual';

/** Input types that accept typed text (checkboxes, buttons, … do not). */
const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/**
 * @param {unknown} node
 * @returns {boolean} whether `node` is a text-entry element that should keep its keys
 */
function isTextEntry(node) {
  if (!node || typeof node !== 'object') return false;
  const el = /** @type {any} */ (node);
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = typeof el.type === 'string' ? el.type.toLowerCase() : 'text';
    return !NON_TEXT_INPUTS.has(type);
  }
  return false;
}

/**
 * True while the user is typing into a form control — the event's origin
 * (through shadow roots) or the deepest focused element.
 * @param {Event} event
 */
function isTypingContext(event) {
  let origin = event.target;
  try {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : null;
    if (path && path.length) origin = path[0];
  } catch {
    /* composedPath can throw on detached events in old engines */
  }
  if (isTextEntry(origin)) return true;
  const doc = /** @type {any} */ (globalThis).document;
  let active = doc?.activeElement ?? null;
  // Walk into open shadow roots to the element that really holds focus.
  for (let i = 0; i < 16 && active?.shadowRoot?.activeElement; i++) active = active.shadowRoot.activeElement;
  return isTextEntry(active);
}

/**
 * Map a keyboard event to `{ action, source, prevent }`, or null if unbound.
 * @param {KeyboardEvent} event
 */
function resolveKey(event) {
  const code = typeof event.code === 'string' ? event.code : '';
  if (code && code !== 'Unidentified') {
    const action = KEY_BINDINGS[code];
    return action ? { action, source: code, prevent: PREVENT_CODES.has(code) } : null;
  }
  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
  const action = KEY_NAME_BINDINGS[key];
  return action ? { action, source: `key:${key}`, prevent: PREVENT_KEYS.has(key) } : null;
}

/**
 * Create an independent input tracker. The game uses the `input` singleton;
 * tests create fresh instances.
 */
export function createInput() {
  /** @type {Map<string, Set<string>>} action → sources currently holding it */
  const held = new Map(ACTIONS.map((a) => [a, new Set()]));
  /** @type {Dir[]} held directions, oldest → newest press */
  let dirOrder = [];
  /** @type {Map<string, number>} action → unconsumed presses this frame */
  const buffer = new Map();
  /** @type {Map<string, Function[]>} action → listeners, newest first */
  const listeners = new Map();
  /** @type {EventTarget|null} */
  let target = null;

  /** @param {Dir} dir */
  function bumpDirection(dir) {
    dirOrder = dirOrder.filter((d) => d !== dir);
    dirOrder.push(dir);
  }

  /** @param {string} action */
  function dispatchPress(action) {
    const list = listeners.get(action);
    if (list && list.length) {
      for (const fn of list.slice()) {
        if (!list.includes(fn)) continue; // removed by an earlier listener
        let consumed = false;
        try {
          consumed = fn(action) === true;
        } catch (err) {
          console.error(`[input] "${action}" listener failed`, err);
        }
        if (consumed) return;
      }
    }
    buffer.set(action, (buffer.get(action) ?? 0) + 1);
  }

  /**
   * A source went down.
   * @param {string} action @param {string} source @param {boolean} repeat
   */
  function sourceDown(action, source, repeat) {
    const set = held.get(action);
    if (!set) return;
    const wasDown = set.size > 0;
    const known = set.has(source);
    if (repeat) {
      if (known) return; // OS auto-repeat: never a new press
      // We missed the real keydown (e.g. focus returned mid-hold): treat as held, silently.
      set.add(source);
      if (!wasDown && DIRECTION_SET.has(action)) bumpDirection(/** @type {Dir} */ (action));
      return;
    }
    set.add(source);
    if (DIRECTION_SET.has(action)) bumpDirection(/** @type {Dir} */ (action));
    // Edge on the action going down — or the same key pressed again after a lost keyup.
    if (!wasDown || known) dispatchPress(action);
  }

  /** @param {string} action @param {string} source */
  function sourceUp(action, source) {
    const set = held.get(action);
    if (!set || !set.delete(source)) return;
    if (set.size === 0 && DIRECTION_SET.has(action)) dirOrder = dirOrder.filter((d) => d !== action);
  }

  /** @param {KeyboardEvent} event */
  function onKeyDown(event) {
    if (event.isComposing) return;
    // macOS swallows keyups while ⌘ is held; start clean instead of sticking.
    if (event.key === 'Meta') {
      clear();
      return;
    }
    const hit = resolveKey(event);
    if (!hit) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return; // leave browser shortcuts alone
    if (isTypingContext(event)) return;
    if (hit.prevent) event.preventDefault();
    sourceDown(hit.action, hit.source, !!event.repeat);
  }

  /** @param {KeyboardEvent} event */
  function onKeyUp(event) {
    const hit = resolveKey(event);
    if (hit) sourceUp(hit.action, hit.source);
  }

  function onBlur() {
    clear();
  }

  function detach() {
    if (!target) return;
    target.removeEventListener('keydown', /** @type {EventListener} */ (onKeyDown));
    target.removeEventListener('keyup', /** @type {EventListener} */ (onKeyUp));
    target.removeEventListener('blur', onBlur);
    target = null;
  }

  /** Release everything and forget buffered presses. Listeners are kept. */
  function clear() {
    for (const set of held.values()) set.clear();
    dirOrder = [];
    buffer.clear();
  }

  return {
    /**
     * Attach keyboard + blur listeners. Idempotent for the same target;
     * re-targeting detaches from the previous one and releases all keys.
     * @param {EventTarget} [eventTarget] defaults to `window`
     */
    init(eventTarget = /** @type {any} */ (globalThis).window) {
      if (!eventTarget || typeof eventTarget.addEventListener !== 'function') return;
      if (eventTarget === target) return;
      detach();
      clear();
      target = eventTarget;
      target.addEventListener('keydown', /** @type {EventListener} */ (onKeyDown));
      target.addEventListener('keyup', /** @type {EventListener} */ (onKeyUp));
      target.addEventListener('blur', onBlur);
    },

    /** Detach from the current target and release everything. */
    dispose() {
      detach();
      clear();
    },

    /**
     * @param {Action} action
     * @returns {boolean} whether any source holds the action
     */
    isDown(action) {
      return (held.get(action)?.size ?? 0) > 0;
    },

    /** @returns {Dir|null} the most recently pressed direction that is still held */
    heldDirection() {
      return dirOrder.length ? dirOrder[dirOrder.length - 1] : null;
    },

    /**
     * Polled edge: true once per press that no `onPress` listener consumed
     * (until `endFrame()`).
     * @param {Action} action
     */
    pressed(action) {
      const n = buffer.get(action) ?? 0;
      if (n <= 0) return false;
      if (n === 1) buffer.delete(action);
      else buffer.set(action, n - 1);
      return true;
    },

    /**
     * Subscribe to presses of `action`. Listeners run newest-registered first;
     * returning `true` consumes the press (older listeners and `pressed()`
     * never see it).
     * @param {Action} action
     * @param {(action: Action) => boolean|void} fn
     * @returns {() => void} unsubscribe (safe to call more than once)
     */
    onPress(action, fn) {
      if (typeof fn !== 'function') throw new TypeError('input.onPress: listener must be a function');
      let list = listeners.get(action);
      if (!list) listeners.set(action, (list = []));
      list.unshift(fn);
      return () => {
        const current = listeners.get(action);
        const i = current ? current.indexOf(fn) : -1;
        if (i >= 0) current.splice(i, 1);
      };
    },

    /**
     * Press/release an action from a non-keyboard source (the touch pad).
     * Repeated calls with the same state are ignored.
     * @param {Action} action @param {boolean} down
     */
    setVirtual(action, down) {
      this.setSource(action, VIRTUAL, down);
    },

    /**
     * Press/release an action from a named non-keyboard source (a gamepad
     * button, say "pad0:b0"). Each source holds independently; repeated calls
     * with the same state are ignored.
     * @param {Action} action @param {string} source @param {boolean} down
     */
    setSource(action, source, down) {
      if (!ACTION_SET.has(action) || typeof source !== 'string' || !source) return;
      const isHeld = held.get(action)?.has(source) ?? false;
      if (!!down === isHeld) return;
      if (down) sourceDown(action, source, false);
      else sourceUp(action, source);
    },

    /**
     * @param {Action} action @param {string} source
     * @returns {boolean} whether this specific source holds the action
     */
    isHeldBy(action, source) {
      return held.get(action)?.has(source) ?? false;
    },

    /** Release every action (window blur, tab hidden). Map loads keep held directions. */
    clear,

    /** Drop presses nobody polled this frame. Call once at the end of each frame. */
    endFrame() {
      buffer.clear();
    },
  };
}

/** The game's input singleton. Call `input.init()` once at boot. */
export const input = createInput();
