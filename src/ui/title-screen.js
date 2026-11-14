/**
 * <title-screen> — wordmark over a soft scrim, with the 3D village drifting
 * behind it.
 *
 * Attributes: `loading` (shows "Loading…", ignores input), `has-save` (adds
 * Continue, focused by default).
 * Events: `title-wake` (first press/tap — unlock audio here), then
 * `title-start` `{ detail: { mode: 'new' | 'continue' } }`.
 * Methods: hide() / show().
 */
import { input } from '../core/input.js';
import { Base, BASE_CSS, afterTransition, define, emit, emitSfx, h, keepFocusOffButtons } from './shared.js';

/** @typedef {'loading'|'idle'|'menu'} TitleView */

const NAV_ACTIONS = /** @type {const} */ (['a', 'b', 'start', 'up', 'down', 'left', 'right']);
const LEAVE_FALLBACK_MS = 700;

const TRAIL_SVG = /* html */ `
<svg class="trail" viewBox="0 0 320 34" aria-hidden="true" fill="none" stroke-linecap="round">
  <path d="M6 22c34-16 70-16 104-4s70 14 104 0 66-12 100 2" style="stroke: var(--wordmark-trail)" stroke-width="4" stroke-dasharray="0.1 13"/>
  <g style="fill: var(--wordmark-trail)">
    <ellipse cx="300" cy="11" rx="3.2" ry="4.4" transform="rotate(18 300 11)"/>
    <ellipse cx="309" cy="18" rx="3.2" ry="4.4" transform="rotate(18 309 18)"/>
  </g>
</svg>`;

const SPROUT_SVG = /* html */ `
<svg class="sprout" viewBox="0 0 40 40" aria-hidden="true" style="stroke: var(--wordmark-ink)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
  <path d="M20 37V20" fill="none"/>
  <path d="M20 24C11 24 5 18 4 9c9 0 15 6 16 15z" style="fill: var(--color-meadow)"/>
  <path d="M20 20c1-8 7-14 16-15 0 9-7 15-16 15z" style="fill: var(--color-meadow-dark)"/>
</svg>`;

const TEMPLATE = /* html */ `
<style>
  ${BASE_CSS}
  :host {
    position: absolute;
    inset: 0;
    z-index: var(--z-title, 60);
    display: block;
    pointer-events: auto;
    opacity: 1;
    transition: opacity var(--dur-slow) var(--ease-out);
    font-family: var(--font-body);
    color: var(--color-on-dark);
    -webkit-user-select: none;
    user-select: none;
  }
  :host([leaving]) { opacity: 0; pointer-events: none; }

  .scrim { position: absolute; inset: 0; background: var(--title-scrim); }

  .screen {
    position: relative;
    height: 100%;
    display: grid;
    grid-template-rows: 1fr auto auto;
    justify-items: center;
    padding:
      calc(var(--safe-top) + var(--space-6))
      calc(var(--safe-right) + var(--space-4))
      calc(var(--safe-bottom) + var(--space-4))
      calc(var(--safe-left) + var(--space-4));
    text-align: center;
  }

  /* ── Wordmark ─────────────────────────────────────────── */
  .brand {
    align-self: center;
    display: grid;
    justify-items: center;
    gap: var(--space-2);
    padding-bottom: var(--space-6);
  }
  h1 {
    margin: 0;
    display: grid;
    justify-items: center;
    font-family: var(--font-display);
    font-weight: var(--fw-display-bold);
    font-size: var(--fs-hero);
    line-height: 0.92;
    letter-spacing: 0.01em;
    /* Outline + extruded depth built from layered text-shadows (works in every engine). */
    text-shadow:
      var(--wordmark-outline) 0 0 var(--wordmark-ink),
      calc(var(--wordmark-outline) * -1) 0 0 var(--wordmark-ink),
      0 var(--wordmark-outline) 0 var(--wordmark-ink),
      0 calc(var(--wordmark-outline) * -1) 0 var(--wordmark-ink),
      calc(var(--wordmark-outline) * 0.72) calc(var(--wordmark-outline) * 0.72) 0 var(--wordmark-ink),
      calc(var(--wordmark-outline) * -0.72) calc(var(--wordmark-outline) * 0.72) 0 var(--wordmark-ink),
      calc(var(--wordmark-outline) * 0.72) calc(var(--wordmark-outline) * -0.72) 0 var(--wordmark-ink),
      calc(var(--wordmark-outline) * -0.72) calc(var(--wordmark-outline) * -0.72) 0 var(--wordmark-ink),
      0 calc(var(--wordmark-depth) * 0.8) 0 var(--wordmark-ink),
      0 var(--wordmark-depth) 0 var(--wordmark-ink),
      0 calc(var(--wordmark-depth) * 1.8) calc(var(--wordmark-depth) * 2.5) var(--color-shade-strong);
  }
  .w1 { color: var(--wordmark-fill); transform: rotate(var(--wordmark-tilt)); }
  .w2 {
    display: inline-flex;
    align-items: flex-end;
    gap: 0.06em;
    margin-top: -0.04em;
    padding-left: 0.5em;
    font-size: 0.82em;
    color: var(--wordmark-accent);
    transform: rotate(var(--wordmark-tilt));
  }
  .sprout {
    width: 0.62em;
    height: 0.62em;
    margin-bottom: 0.14em;
    filter: drop-shadow(0 0.06em 0 var(--color-shade-strong));
    transform-origin: 50% 100%;
  }
  .trail { width: min(19rem, 72vw); margin-top: calc(var(--space-1) * -1); transform: rotate(var(--wordmark-tilt)); opacity: 0.9; }
  .subtitle {
    margin: var(--space-1) 0 0;
    font-size: var(--fs-sm);
    font-weight: var(--fw-bold);
    letter-spacing: var(--tracking-wide);
    color: var(--color-on-dark-muted);
    text-shadow: var(--shadow-text-dark);
  }

  /* ── Status: loading / prompt / menu ─────────────────── */
  .status {
    min-height: 9.5rem;
    display: grid;
    align-content: center;
    justify-items: center;
    width: 100%;
  }
  .loading, .prompt, .menu { display: none; }
  .screen[data-view='loading'] .loading,
  .screen[data-view='idle'] .prompt { display: grid; }
  .screen[data-view='menu'] .menu { display: grid; }

  .loading {
    gap: var(--space-2);
    justify-items: center;
    font-family: var(--font-display);
    font-weight: var(--fw-display);
    font-size: var(--fs-md);
    letter-spacing: var(--tracking-wide);
    color: var(--color-on-dark-muted);
    text-shadow: var(--shadow-text-dark);
  }
  .leaf-spinner { display: flex; gap: var(--space-2); }
  .leaf-spinner i {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 0 60% 0 60%;
    background: var(--color-meadow);
    border: 2px solid var(--color-ink);
  }

  .prompt {
    gap: var(--space-2);
    justify-items: center;
    padding: var(--space-3) var(--space-5);
    min-height: var(--tap-min);
    font-family: var(--font-display);
    font-weight: var(--fw-display);
    font-size: var(--fs-lg);
    letter-spacing: var(--tracking-wide);
    color: var(--color-on-dark);
    text-shadow: var(--shadow-text-dark);
    cursor: pointer;
  }
  .prompt .touch, .prompt .pad-hint { display: none; }
  :host([pad]) .prompt .hint { display: none; }
  :host([pad]) .prompt .pad-hint { display: inline; }
  .prompt .hint, .prompt .pad-hint {
    font-family: var(--font-body);
    font-size: var(--fs-xs);
    font-weight: var(--fw-bold);
    letter-spacing: 0.04em;
    color: var(--color-on-dark-muted);
  }
  kbd {
    display: inline-block;
    min-width: 1.6em;
    padding: 0.05em 0.45em;
    font: inherit;
    color: var(--color-ink);
    background: var(--color-paper);
    border: 2px solid var(--color-ink);
    border-radius: var(--radius-xs);
    box-shadow: 0 2px 0 var(--color-ink);
    text-shadow: none;
  }

  .menu {
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
    width: min(17rem, 100%);
  }
  .item {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 3.25rem;
    padding: 0 var(--space-6);
    font-family: var(--font-display);
    font-weight: var(--fw-display);
    font-size: var(--fs-lg);
    color: var(--color-ink);
    background: var(--color-paper-glass);
    border: var(--border-w) solid var(--color-ink);
    border-radius: var(--radius-pill);
    box-shadow: var(--shadow-pop);
    transition:
      transform var(--dur-fast) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }
  .item .cursor {
    position: absolute;
    left: var(--space-4);
    font-size: 0.7em;
    color: var(--color-accent);
    opacity: 0;
    transform: translateX(-4px);
    transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
  }
  .item[aria-current='true'] {
    background: var(--color-highlight);
    transform: translateY(-2px) scale(1.03);
    box-shadow: var(--shadow-pop-lift);
  }
  .item[aria-current='true'] .cursor { opacity: 1; transform: none; }
  .item:active { transform: translateY(1px); box-shadow: var(--shadow-pop-pressed); }

  footer {
    padding-top: var(--space-4);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-bold);
    letter-spacing: var(--tracking-wide);
    color: var(--color-on-dark-muted);
    text-shadow: var(--shadow-text-dark);
  }

  @media (pointer: coarse) {
    .prompt .keys, .prompt .hint { display: none; }
    .prompt .touch { display: inline; }
    :host([pad]) .prompt .keys, :host([pad]) .prompt .pad-hint { display: inline; }
    :host([pad]) .prompt .touch { display: none; }
  }
  @media (min-width: 720px) {
    .screen { padding-top: calc(var(--safe-top) + var(--space-7)); }
    .status { min-height: 11rem; }
  }
  @media (orientation: landscape) and (max-height: 540px) {
    .screen { padding-top: calc(var(--safe-top) + var(--space-3)); }
    .brand { padding-bottom: var(--space-2); }
    h1 { font-size: clamp(2.4rem, 13vh, 4.2rem); }
    .status { min-height: 7rem; }
    .menu { gap: var(--space-2); }
    .item { min-height: var(--tap-min); }
  }
  @media (prefers-reduced-motion: no-preference) {
    .prompt { animation: breathe var(--dur-pulse) var(--ease-in-out) infinite; }
    .sprout { animation: sway 3.2s var(--ease-in-out) infinite; }
    .leaf-spinner i { animation: hop 1.1s var(--ease-in-out) infinite; }
    .leaf-spinner i:nth-child(2) { animation-delay: 0.15s; }
    .leaf-spinner i:nth-child(3) { animation-delay: 0.3s; }
    .screen[data-view='menu'] .menu { animation: rise var(--dur-slow) var(--ease-spring); }
  }
  @keyframes breathe {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.55; transform: scale(0.97); }
  }
  @keyframes sway {
    0%, 100% { transform: rotate(-6deg); }
    50% { transform: rotate(6deg); }
  }
  @keyframes hop {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    40% { transform: translateY(-6px) rotate(20deg); }
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: none; }
  }
</style>
<div class="scrim" part="scrim"></div>
<div class="screen" data-view="loading">
  <header class="brand">
    <h1 aria-label="Wildling Trails">
      <span class="w1" aria-hidden="true">Wildling</span>
      <span class="w2" aria-hidden="true">${SPROUT_SVG}<span>Trails</span></span>
    </h1>
    ${TRAIL_SVG}
    <p class="subtitle">A cozy tale of tiny companions</p>
  </header>
  <div class="status" aria-live="polite">
    <p class="loading"><span>Loading…</span><span class="leaf-spinner" aria-hidden="true"><i></i><i></i><i></i></span></p>
    <p class="prompt" role="button">
      <span class="keys">Press Start</span>
      <span class="touch">Tap to begin</span>
      <span class="hint"><kbd>Enter</kbd> or <kbd>Z</kbd></span>
      <span class="pad-hint"><kbd>A</kbd> or <kbd>Menu</kbd></span>
    </p>
    <ul class="menu" role="menu" aria-label="Title menu"></ul>
  </div>
  <footer>An original adventure · v0.1</footer>
</div>
`;

/** Title screen overlay. */
export class TitleScreen extends Base {
  static get observedAttributes() {
    return ['loading', 'has-save'];
  }

  #woke = false;
  #starting = false;
  #cursor = 0;
  /** @type {Array<{ mode: 'new'|'continue', label: string }>} */ #items = [];
  /** @type {Array<() => void>} */ #offs = [];
  /** @type {ReturnType<typeof setTimeout>|0} */ #leaveTimer = 0;
  #leaveToken = 0;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = TEMPLATE;
    this.$screen = /** @type {HTMLElement} */ (root.querySelector('.screen'));
    this.$menu = /** @type {HTMLElement} */ (root.querySelector('.menu'));
    this.onClick = this.onClick.bind(this);
  }

  connectedCallback() {
    this.addEventListener('click', this.onClick);
    this.shadowRoot?.addEventListener('mousedown', keepFocusOffButtons);
    this.#sync();
    if (!this.hidden && !this.hasAttribute('leaving')) this.#subscribe();
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.onClick);
    this.shadowRoot?.removeEventListener('mousedown', keepFocusOffButtons);
    this.#unsubscribe();
    clearTimeout(this.#leaveTimer);
  }

  attributeChangedCallback() {
    this.#sync();
  }

  /** @returns {TitleView} */
  get view() {
    if (this.#woke) return 'menu';
    return this.hasAttribute('loading') ? 'loading' : 'idle';
  }

  /**
   * Fade the title away (resolves once hidden).
   * @returns {Promise<void>}
   */
  hide() {
    this.#unsubscribe();
    const token = ++this.#leaveToken;
    this.setAttribute('leaving', '');
    return afterTransition(this, LEAVE_FALLBACK_MS).then(() => {
      if (token !== this.#leaveToken) return; // show() won the race
      this.hidden = true;
      this.removeAttribute('leaving');
    });
  }

  /** Bring the title back (menu ready if it was already woken). */
  show() {
    this.#leaveToken += 1;
    this.#starting = false;
    this.hidden = false;
    this.removeAttribute('leaving');
    this.#sync(true);
    if (this.isConnected) this.#subscribe();
  }

  /** @param {MouseEvent} event */
  onClick(event) {
    if (this.hidden || this.hasAttribute('leaving') || this.#starting) return;
    const view = this.view;
    if (view === 'idle') {
      this.#wake();
      return;
    }
    if (view !== 'menu') return;
    const path = event.composedPath();
    const button = path.find((n) => n instanceof HTMLElement && n.classList.contains('item'));
    if (!button) return;
    const index = Number(/** @type {HTMLElement} */ (button).dataset.index);
    if (Number.isInteger(index)) {
      this.#cursor = index;
      this.#paintCursor();
      this.#confirm();
    }
  }

  /** @param {boolean} [resetCursor] */
  #sync(resetCursor = false) {
    const view = this.view;
    const hadContinue = this.#items.some((i) => i.mode === 'continue');
    const hasSave = this.hasAttribute('has-save');
    this.#items = hasSave
      ? [
          { mode: 'continue', label: 'Continue' },
          { mode: 'new', label: 'New Game' },
        ]
      : [{ mode: 'new', label: 'New Game' }];
    if (resetCursor || hadContinue !== hasSave || this.#cursor >= this.#items.length) this.#cursor = 0;
    this.$screen.dataset.view = view;
    this.#renderMenu();
  }

  #renderMenu() {
    this.$menu.replaceChildren(
      ...this.#items.map((item, i) =>
        h(
          'li',
          { role: 'none' },
          h(
            'button',
            {
              class: 'item',
              type: 'button',
              role: 'menuitem',
              tabindex: '-1',
              'data-index': i,
              onpointermove: (/** @type {PointerEvent} */ e) => {
                if (e.pointerType === 'mouse' && this.#cursor !== i) {
                  this.#cursor = i;
                  this.#paintCursor();
                }
              },
            },
            h('span', { class: 'cursor', 'aria-hidden': 'true', text: '▶' }),
            h('span', { text: item.label }),
          ),
        ),
      ),
    );
    this.#paintCursor();
  }

  #paintCursor() {
    this.$menu.querySelectorAll('.item').forEach((el, i) => el.setAttribute('aria-current', String(i === this.#cursor)));
  }

  #wake() {
    if (this.#woke || this.hasAttribute('loading')) return;
    this.#woke = true;
    this.#cursor = 0;
    // Dispatch first and synchronously: listeners unlock audio inside this user gesture.
    emit(this, 'title-wake');
    this.#sync(true);
    emitSfx(this, 'menu');
  }

  #confirm() {
    const item = this.#items[this.#cursor];
    if (!item || this.#starting) return;
    this.#starting = true;
    emitSfx(this, 'confirm');
    emit(this, 'title-start', { mode: item.mode });
  }

  /** @param {number} delta */
  #move(delta) {
    const n = this.#items.length;
    if (n < 2) return;
    this.#cursor = (this.#cursor + delta + n) % n;
    emitSfx(this, 'cursor');
    this.#paintCursor();
  }

  /** @param {string} action @returns {boolean} */
  #handle(action) {
    if (this.hidden || this.hasAttribute('leaving')) return false;
    if (this.#starting) return true;
    const view = this.view;
    if (view === 'idle') {
      if (action === 'a' || action === 'start') this.#wake();
    } else if (view === 'menu') {
      if (action === 'up') this.#move(-1);
      else if (action === 'down') this.#move(1);
      else if (action === 'a' || action === 'start') this.#confirm();
    }
    return true;
  }

  #subscribe() {
    if (this.#offs.length) return;
    this.#offs = NAV_ACTIONS.map((action) => input.onPress(action, () => this.#handle(action)));
  }

  #unsubscribe() {
    for (const off of this.#offs) off();
    this.#offs = [];
  }
}

define('title-screen', TitleScreen);
