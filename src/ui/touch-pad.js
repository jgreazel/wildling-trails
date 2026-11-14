/**
 * <touch-pad> — on-screen controls for phones and tablets.
 *
 * Appears on coarse pointers, or after the first touch anywhere. D-pad at the
 * bottom-left (one captured pointer; slide between arms to change direction),
 * A and B at the bottom-right, a small START at the bottom-centre. Everything
 * feeds `input.setVirtual`. Only the controls themselves take pointers, so the
 * canvas stays reachable around them.
 *
 * While shown it sets `data-touch-pad` on <html> so other HUD pieces can keep
 * clear (see --hud-bottom-clearance / --hud-side-clearance in tokens.css).
 */
import { input } from '../core/input.js';
import { Base, BASE_CSS, define, isCoarsePointer } from './shared.js';

/** @typedef {'up'|'down'|'left'|'right'} Dir */

/** Fraction of the d-pad radius treated as "no direction" on first touch. */
const DEAD_ZONE = 0.16;
/** An axis must beat the other by this factor before the pad switches axis (no diagonal flicker). */
const AXIS_STICKINESS = 1.25;
const ROOT_FLAG = 'data-touch-pad';

/**
 * Direction for a pointer offset from the d-pad centre, with hysteresis
 * towards the current direction. Pure — exported for tests.
 * @param {number} dx @param {number} dy offset in px (+y = down)
 * @param {number} radius d-pad radius in px
 * @param {Dir|null} current
 * @returns {Dir|null}
 */
export function padDirection(dx, dy, radius, current = null) {
  const dist = Math.hypot(dx, dy);
  if (dist < radius * DEAD_ZONE) return current;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  let horizontal = ax > ay;
  if (current === 'left' || current === 'right') horizontal = ax * AXIS_STICKINESS >= ay;
  else if (current === 'up' || current === 'down') horizontal = ax > ay * AXIS_STICKINESS;
  if (horizontal) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}

const TEMPLATE = /* html */ `
<style>
  ${BASE_CSS}
  :host {
    position: absolute;
    inset: 0;
    z-index: var(--z-touch, 30);
    display: none;
    pointer-events: none;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    font-family: var(--font-display);
  }
  :host([active]) { display: block; }

  /* ── D-pad ───────────────────────────────────── */
  .pad {
    position: absolute;
    left: calc(var(--safe-left) + var(--hud-gap));
    bottom: calc(var(--safe-bottom) + var(--hud-gap) + var(--pad-lift));
    width: calc(var(--pad-cell) * 3);
    height: calc(var(--pad-cell) * 3);
    border-radius: 50%;
    background: var(--pad-base);
    box-shadow: inset 0 0 0 2px var(--pad-ring);
    pointer-events: auto;
    touch-action: none;
    opacity: var(--pad-opacity);
  }
  .cross {
    position: absolute;
    inset: 0;
    filter:
      drop-shadow(var(--border-w-thin) 0 0 var(--pad-ink))
      drop-shadow(calc(var(--border-w-thin) * -1) 0 0 var(--pad-ink))
      drop-shadow(0 var(--border-w-thin) 0 var(--pad-ink))
      drop-shadow(0 calc(var(--border-w-thin) * -1) 0 var(--pad-ink))
      drop-shadow(0 3px 0 var(--pad-ink-shadow));
    transition: transform var(--dur-fast) var(--ease-out);
  }
  .bar {
    position: absolute;
    background: var(--pad-face);
    border-radius: var(--radius-sm);
  }
  .bar.v { left: var(--pad-cell); top: 6%; width: var(--pad-cell); height: 88%; }
  .bar.h { top: var(--pad-cell); left: 6%; height: var(--pad-cell); width: 88%; }
  .arrow {
    position: absolute;
    width: calc(var(--pad-cell) * 0.32);
    height: calc(var(--pad-cell) * 0.28);
    background: var(--pad-arrow);
    clip-path: polygon(50% 0, 100% 100%, 0 100%);
    transition: background-color var(--dur-instant) linear;
  }
  .arrow.up { left: 50%; top: calc(var(--pad-cell) * 0.36); transform: translateX(-50%); }
  .arrow.down { left: 50%; bottom: calc(var(--pad-cell) * 0.36); transform: translateX(-50%) rotate(180deg); }
  .arrow.left { top: 50%; left: calc(var(--pad-cell) * 0.34); transform: translateY(-50%) rotate(-90deg); }
  .arrow.right { top: 50%; right: calc(var(--pad-cell) * 0.34); transform: translateY(-50%) rotate(90deg); }
  .hub {
    position: absolute;
    left: 50%;
    top: 50%;
    width: calc(var(--pad-cell) * 0.42);
    height: calc(var(--pad-cell) * 0.42);
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: radial-gradient(circle at 40% 35%, var(--color-paper-2), var(--color-paper-3));
    box-shadow: var(--shadow-inset-soft);
  }
  .pad[data-dir='up'] .arrow.up,
  .pad[data-dir='down'] .arrow.down,
  .pad[data-dir='left'] .arrow.left,
  .pad[data-dir='right'] .arrow.right { background: var(--pad-face-active); }
  .pad[data-dir='up'] .cross { transform: perspective(320px) rotateX(9deg); }
  .pad[data-dir='down'] .cross { transform: perspective(320px) rotateX(-9deg); }
  .pad[data-dir='left'] .cross { transform: perspective(320px) rotateY(-9deg); }
  .pad[data-dir='right'] .cross { transform: perspective(320px) rotateY(9deg); }

  /* ── A / B ───────────────────────────────────── */
  .buttons {
    position: absolute;
    right: calc(var(--safe-right) + var(--hud-gap));
    bottom: calc(var(--safe-bottom) + var(--hud-gap) + var(--pad-lift));
    width: calc(var(--pad-btn) * 1.95);
    height: calc(var(--pad-cell) * 3);
    pointer-events: none;
  }
  .btn {
    position: absolute;
    display: grid;
    place-items: center;
    border-radius: 50%;
    font-weight: var(--fw-display-bold);
    color: var(--color-ink);
    background: radial-gradient(circle at 38% 30%, var(--color-paper-hi), var(--pad-face) 70%);
    border: var(--border-w) solid var(--pad-ink);
    box-shadow: 0 4px 0 var(--pad-ink-shadow);
    opacity: var(--pad-opacity);
    pointer-events: auto;
    touch-action: none;
    transition:
      transform var(--dur-instant) var(--ease-out),
      box-shadow var(--dur-instant) var(--ease-out),
      background var(--dur-instant) linear,
      color var(--dur-instant) linear;
  }
  .btn.a { right: 0; top: 4%; width: var(--pad-btn); height: var(--pad-btn); font-size: calc(var(--pad-btn) * 0.4); }
  .btn.b { left: 0; bottom: 4%; width: var(--pad-btn-sm); height: var(--pad-btn-sm); font-size: calc(var(--pad-btn-sm) * 0.4); }
  .btn[data-down],
  .start[data-down] span {
    transform: translateY(3px);
    box-shadow: 0 1px 0 var(--pad-ink-shadow);
    color: var(--color-accent-ink);
    background: var(--pad-face-active);
  }

  /* ── START ───────────────────────────────────── */
  .start {
    position: absolute;
    left: 50%;
    bottom: calc(var(--safe-bottom) + var(--space-1));
    transform: translateX(-50%);
    display: grid;
    place-items: center;
    min-width: 3.5rem;
    min-height: var(--tap-min);
    pointer-events: auto;
    touch-action: none;
  }
  .start span {
    display: block;
    padding: 0.2rem 0.75rem;
    font-size: var(--fs-2xs);
    font-weight: var(--fw-display-bold);
    letter-spacing: var(--tracking-wider);
    color: var(--color-ink);
    background: var(--pad-face);
    border: var(--border-w-thin) solid var(--pad-ink);
    border-radius: var(--radius-pill);
    box-shadow: 0 3px 0 var(--pad-ink-shadow);
    opacity: var(--pad-opacity);
    transition: transform var(--dur-instant) var(--ease-out), box-shadow var(--dur-instant) var(--ease-out);
  }

  /* Short landscape: the dialog sits between the clusters, so START moves above A/B. */
  @media (orientation: landscape) and (max-height: 540px) {
    .pad, .buttons { bottom: calc(var(--safe-bottom) + var(--hud-gap)); }
    .start {
      left: auto;
      right: calc(var(--safe-right) + var(--hud-gap));
      bottom: calc(var(--safe-bottom) + var(--hud-gap) + var(--pad-cell) * 3 + var(--space-1));
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pad[data-dir] .cross { transform: none; }
  }
</style>
<div class="pad" part="dpad" aria-hidden="true">
  <div class="cross">
    <span class="bar v"></span>
    <span class="bar h"></span>
  </div>
  <span class="arrow up"></span>
  <span class="arrow down"></span>
  <span class="arrow left"></span>
  <span class="arrow right"></span>
  <span class="hub"></span>
</div>
<div class="buttons">
  <button class="btn b" type="button" tabindex="-1" data-action="b" aria-label="B button">B</button>
  <button class="btn a" type="button" tabindex="-1" data-action="a" aria-label="A button">A</button>
</div>
<button class="start" type="button" tabindex="-1" data-action="start" aria-label="Start: open menu"><span>START</span></button>
`;

/** On-screen d-pad and buttons. */
export class TouchPad extends Base {
  /** @type {Dir|null} */ #dir = null;
  /** @type {number|null} */ #padPointer = null;
  /** @type {DOMRect|null} */ #padRect = null;
  /** @type {Map<number, { action: string, el: HTMLElement }>} */ #buttonPointers = new Map();
  #listening = false;
  /** @type {MediaQueryList|null} */ #coarseQuery = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = TEMPLATE;
    this.$pad = /** @type {HTMLElement} */ (root.querySelector('.pad'));
    this.$buttons = /** @type {HTMLElement[]} */ ([...root.querySelectorAll('[data-action]')]);

    this.onPadDown = this.onPadDown.bind(this);
    this.onPadMove = this.onPadMove.bind(this);
    this.onPadUp = this.onPadUp.bind(this);
    this.onButtonDown = this.onButtonDown.bind(this);
    this.onButtonUp = this.onButtonUp.bind(this);
    this.onFirstTouch = this.onFirstTouch.bind(this);
    this.onCoarseChange = this.onCoarseChange.bind(this);
    this.releaseAll = this.releaseAll.bind(this);
    this.onVisibility = this.onVisibility.bind(this);
    /** @param {Event} e */
    this.preventDefault = (e) => e.preventDefault();
  }

  connectedCallback() {
    if (this.#listening) return;
    this.#listening = true;

    const pad = this.$pad;
    pad.addEventListener('pointerdown', this.onPadDown);
    pad.addEventListener('pointermove', this.onPadMove);
    pad.addEventListener('pointerup', this.onPadUp);
    pad.addEventListener('pointercancel', this.onPadUp);
    pad.addEventListener('lostpointercapture', this.onPadUp);
    for (const btn of this.$buttons) {
      btn.addEventListener('pointerdown', this.onButtonDown);
      btn.addEventListener('pointerup', this.onButtonUp);
      btn.addEventListener('pointercancel', this.onButtonUp);
      btn.addEventListener('lostpointercapture', this.onButtonUp);
    }
    this.shadowRoot?.addEventListener('contextmenu', this.preventDefault);

    window.addEventListener('blur', this.releaseAll);
    window.addEventListener('pagehide', this.releaseAll);
    document.addEventListener('visibilitychange', this.onVisibility);

    if (isCoarsePointer()) this.activate();
    else window.addEventListener('touchstart', this.onFirstTouch, { passive: true, capture: true });

    try {
      this.#coarseQuery = window.matchMedia('(pointer: coarse)');
      this.#coarseQuery.addEventListener?.('change', this.onCoarseChange);
    } catch {
      this.#coarseQuery = null;
    }
  }

  disconnectedCallback() {
    if (!this.#listening) return;
    this.#listening = false;
    this.releaseAll();

    const pad = this.$pad;
    pad.removeEventListener('pointerdown', this.onPadDown);
    pad.removeEventListener('pointermove', this.onPadMove);
    pad.removeEventListener('pointerup', this.onPadUp);
    pad.removeEventListener('pointercancel', this.onPadUp);
    pad.removeEventListener('lostpointercapture', this.onPadUp);
    for (const btn of this.$buttons) {
      btn.removeEventListener('pointerdown', this.onButtonDown);
      btn.removeEventListener('pointerup', this.onButtonUp);
      btn.removeEventListener('pointercancel', this.onButtonUp);
      btn.removeEventListener('lostpointercapture', this.onButtonUp);
    }
    this.shadowRoot?.removeEventListener('contextmenu', this.preventDefault);

    window.removeEventListener('blur', this.releaseAll);
    window.removeEventListener('pagehide', this.releaseAll);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('touchstart', this.onFirstTouch, { capture: true });
    this.#coarseQuery?.removeEventListener?.('change', this.onCoarseChange);
    this.#coarseQuery = null;
    document.documentElement.removeAttribute(ROOT_FLAG);
  }

  /** @returns {boolean} whether the pad is showing */
  get active() {
    return this.hasAttribute('active');
  }

  /** Show the pad (idempotent). */
  activate() {
    window.removeEventListener('touchstart', this.onFirstTouch, { capture: true });
    if (this.hasAttribute('active')) return;
    this.setAttribute('active', '');
    document.documentElement.setAttribute(ROOT_FLAG, '');
  }

  /** Release every virtual action this pad holds (blur, cancel, hide). */
  releaseAll() {
    if (this.#dir) input.setVirtual(this.#dir, false);
    this.#dir = null;
    this.#padPointer = null;
    this.#padRect = null;
    delete this.$pad.dataset.dir;
    const actions = new Set([...this.#buttonPointers.values()].map((b) => b.action));
    for (const { el } of this.#buttonPointers.values()) delete el.dataset.down;
    this.#buttonPointers.clear();
    for (const action of actions) input.setVirtual(/** @type {any} */ (action), false);
  }

  onFirstTouch() {
    this.activate();
  }

  /** @param {MediaQueryListEvent} e */
  onCoarseChange(e) {
    if (e.matches) this.activate();
  }

  onVisibility() {
    if (document.hidden) this.releaseAll();
  }

  // ── D-pad ─────────────────────────────────────────────────

  /** @param {PointerEvent} e */
  onPadDown(e) {
    if (this.#padPointer !== null) return;
    e.preventDefault();
    this.#padPointer = e.pointerId;
    try {
      this.$pad.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    this.#padRect = this.$pad.getBoundingClientRect();
    this.#updatePad(e);
  }

  /** @param {PointerEvent} e */
  onPadMove(e) {
    if (e.pointerId !== this.#padPointer) return;
    this.#updatePad(e);
  }

  /** @param {PointerEvent} e */
  onPadUp(e) {
    if (e.pointerId !== this.#padPointer) return;
    this.#padPointer = null;
    this.#padRect = null;
    this.#setDir(null);
  }

  /** @param {PointerEvent} e */
  #updatePad(e) {
    const rect = this.#padRect ?? this.$pad.getBoundingClientRect();
    const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    this.#setDir(padDirection(dx, dy, radius, this.#dir));
  }

  /** @param {Dir|null} dir */
  #setDir(dir) {
    if (dir === this.#dir) {
      // input.clear() (window blur, tab hidden) may have dropped it while the thumb stayed down.
      if (dir && !input.isDown(dir)) input.setVirtual(dir, true);
      return;
    }
    if (this.#dir) input.setVirtual(this.#dir, false);
    this.#dir = dir;
    if (dir) {
      input.setVirtual(dir, true);
      this.$pad.dataset.dir = dir;
    } else {
      delete this.$pad.dataset.dir;
    }
  }

  // ── Buttons ───────────────────────────────────────────────

  /** @param {PointerEvent} e */
  onButtonDown(e) {
    const el = /** @type {HTMLElement} */ (e.currentTarget);
    const action = el.dataset.action;
    if (!action || this.#buttonPointers.has(e.pointerId)) return;
    e.preventDefault(); // no focus, no text selection, no emulated mouse
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    this.#buttonPointers.set(e.pointerId, { action, el });
    el.dataset.down = '';
    input.setVirtual(/** @type {any} */ (action), true);
    this.#buzz();
  }

  /** @param {PointerEvent} e */
  onButtonUp(e) {
    const held = this.#buttonPointers.get(e.pointerId);
    if (!held) return;
    this.#buttonPointers.delete(e.pointerId);
    const stillHeld = [...this.#buttonPointers.values()].some((b) => b.action === held.action);
    if (!stillHeld) {
      delete held.el.dataset.down;
      input.setVirtual(/** @type {any} */ (held.action), false);
    }
  }

  /** A tiny haptic tick where supported (only after the page has had a real tap). */
  #buzz() {
    try {
      const nav = /** @type {any} */ (navigator);
      if (nav.userActivation?.hasBeenActive && typeof nav.vibrate === 'function') nav.vibrate(8);
    } catch {
      /* unsupported */
    }
  }
}

define('touch-pad', TouchPad);
