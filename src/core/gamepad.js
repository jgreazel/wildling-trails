/**
 * Gamepad support (Xbox, PlayStation, Switch Pro… anything the browser exposes
 * with the "standard" mapping). The Gamepad API has no button events, so
 * `poll()` runs once per frame, before the game reads input, and feeds each
 * button and the left stick into the input tracker as its own source
 * ("pad0:b0", "pad0:stick"), next to keyboard keys and the touch pad.
 *
 * Browsers only list a pad after a button is pressed while the page has focus.
 *
 * No DOM access at module top level.
 */

/** @typedef {import('./input.js').Action} Action */
/** @typedef {import('./input.js').Dir} Dir */

/**
 * Standard-mapping button index → action. Xbox labels in comments.
 * @type {Readonly<Record<number, Action>>}
 */
export const PAD_BUTTONS = Object.freeze({
  0: 'a', // A
  1: 'b', // B
  2: 'run', // X (hold to run)
  3: 'start', // Y (menu)
  4: 'run', // LB
  5: 'run', // RB
  6: 'run', // LT
  7: 'run', // RT
  8: 'time', // View
  9: 'start', // Menu
  12: 'up', // d-pad
  13: 'down',
  14: 'left',
  15: 'right',
});

/** Stick deflection that starts a direction, and the lower one that keeps it (hysteresis). */
export const STICK_ON = 0.5;
export const STICK_OFF = 0.35;
/** Analog trigger travel that counts as pressed. */
const TRIGGER_ON = 0.5;

const DIRECTIONS = new Set(['up', 'down', 'left', 'right']);

/**
 * One direction from a stick, or null inside the dead zone. The dominant axis
 * wins; while a direction is held it survives until the stick drops below
 * STICK_OFF or the other axis clearly takes over, so diagonals don't flicker.
 * @param {number} x -1 (left) … 1 (right)
 * @param {number} y -1 (up) … 1 (down)
 * @param {Dir|null} [current]
 * @returns {Dir|null}
 */
export function stickDirection(x, y, current = null) {
  const ax = Math.abs(x || 0);
  const ay = Math.abs(y || 0);
  const dirOf = (horizontal) => (horizontal ? (x < 0 ? 'left' : 'right') : y < 0 ? 'up' : 'down');
  if (current) {
    const horizontal = current === 'left' || current === 'right';
    const along = horizontal ? ax : ay;
    const across = horizontal ? ay : ax;
    const sameSign = horizontal ? (current === 'left') === x < 0 : (current === 'up') === y < 0;
    if (along >= STICK_OFF && sameSign && across < along * 1.5) return current;
  }
  const mag = Math.max(ax, ay);
  if (mag < STICK_ON) return null;
  return dirOf(ax >= ay);
}

/**
 * @param {GamepadButton|number|undefined} button
 * @param {number} index
 */
function isPressed(button, index) {
  if (button == null) return false;
  if (typeof button === 'number') return button > TRIGGER_ON;
  if (index === 6 || index === 7) return button.pressed || button.value > TRIGGER_ON;
  return !!button.pressed;
}

/**
 * @param {ReturnType<typeof import('./input.js').createInput>} input
 * @param {{ getGamepads?: () => ArrayLike<Gamepad|null> }} [options]
 */
export function createGamepadPoller(input, options = {}) {
  const getGamepads =
    options.getGamepads ??
    (() => {
      const nav = /** @type {any} */ (globalThis).navigator;
      try {
        return typeof nav?.getGamepads === 'function' ? nav.getGamepads() : [];
      } catch {
        return []; // blocked by a permissions policy
      }
    });

  /** @type {Map<string, Action>} source → action it currently holds */
  const active = new Map();
  /** @type {Map<number, Dir|null>} pad index → stick direction */
  const sticks = new Map();
  let connected = 0;

  /** @param {string} source @param {Action} action @param {boolean} down */
  function set(source, action, down) {
    const was = active.get(source);
    if (was && (!down || was !== action)) {
      input.setSource(was, source, false);
      active.delete(source);
    }
    if (!down) return;
    if (was === action) {
      // input.clear() (blur, hidden tab) dropped it while still held: keep walking,
      // but never turn a held button into a fresh A/B/menu press.
      if (!input.isHeldBy(action, source) && DIRECTIONS.has(action)) input.setSource(action, source, true);
      return;
    }
    input.setSource(action, source, true);
    active.set(source, action);
  }

  return {
    /** Read every pad and update the input tracker. Call once per frame, before game logic. */
    poll() {
      const pads = getGamepads() ?? [];
      const seen = new Set();
      let count = 0;
      for (let i = 0; i < pads.length; i++) {
        const pad = pads[i];
        if (!pad || pad.connected === false) continue;
        count += 1;
        const id = `pad${pad.index ?? i}`;
        const buttons = pad.buttons ?? [];
        for (const [indexText, action] of Object.entries(PAD_BUTTONS)) {
          const index = Number(indexText);
          const source = `${id}:b${index}`;
          seen.add(source);
          set(source, action, isPressed(buttons[index], index));
        }
        const axes = pad.axes ?? [];
        const key = pad.index ?? i;
        const dir = stickDirection(axes[0] ?? 0, axes[1] ?? 0, sticks.get(key) ?? null);
        sticks.set(key, dir);
        const stickSource = `${id}:stick`;
        seen.add(stickSource);
        set(stickSource, dir ?? 'up', dir !== null);
      }
      // A pad vanished (disconnect, Bluetooth sleep): release what it held.
      for (const source of [...active.keys()]) if (!seen.has(source)) set(source, active.get(source), false);
      connected = count;
    },

    /** @returns {number} pads seen on the last poll */
    get connected() {
      return connected;
    },

    /** Release everything this poller holds. */
    reset() {
      for (const [source, action] of active) input.setSource(action, source, false);
      active.clear();
      sticks.clear();
    },
  };
}
