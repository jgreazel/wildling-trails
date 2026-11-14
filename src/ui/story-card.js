/**
 * <story-card> — a centred storybook card for chapter moments.
 *
 *   await card.show({ title: 'A Partner Joins!', body: ['…', '…'], cta: 'Press A' });
 *
 * Closes on a / start / b or a tap anywhere. Calls queue up.
 */
import { input } from '../core/input.js';
import { Base, BASE_CSS, PAPER_CSS, define, emitSfx, h, toParagraphs } from './shared.js';

/** Ignore dismissals this soon after opening (stops a double-tap skipping the card). */
const MIN_SHOW_MS = 320;

const SPRIG_SVG = /* html */ `
<svg viewBox="0 0 120 28" aria-hidden="true" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <path d="M8 18c20-9 38-9 52 0s32 9 52 0" style="stroke: var(--color-paper-line)" stroke-width="2.5" stroke-dasharray="1 7"/>
  <path d="M60 22V9" style="stroke: var(--color-meadow-dark)" stroke-width="2.5"/>
  <path d="M60 14c-5-1-9-4-10-9 5 0 9 3 10 9z" style="fill: var(--color-meadow); stroke: var(--color-ink)" stroke-width="2"/>
  <path d="M60 11c4-1 8-4 9-8-5 0-8 3-9 8z" style="fill: var(--color-meadow-dark); stroke: var(--color-ink)" stroke-width="2"/>
  <circle cx="60" cy="23" r="2.4" style="fill: var(--color-accent); stroke: var(--color-ink)" stroke-width="1.5"/>
</svg>`;

const TEMPLATE = /* html */ `
<style>
  ${BASE_CSS}
  ${PAPER_CSS}
  :host {
    position: absolute;
    inset: 0;
    z-index: var(--z-card, 50);
    display: grid;
    place-items: center;
    padding:
      calc(var(--safe-top) + var(--hud-gap))
      calc(var(--safe-right) + var(--hud-gap))
      calc(var(--safe-bottom) + var(--hud-gap))
      calc(var(--safe-left) + var(--hud-gap));
    pointer-events: none;
    visibility: hidden;
    transition: visibility 0s linear var(--dur-base);
    font-family: var(--font-body);
    color: var(--color-ink);
    cursor: pointer;
  }
  :host([open]) {
    visibility: visible;
    pointer-events: auto;
    transition-delay: 0s;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: var(--color-scrim-strong);
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-out);
  }
  :host([open]) .scrim { opacity: 1; }
  .card {
    width: min(var(--card-max), 100%);
    max-height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    touch-action: pan-y;
    padding: var(--space-5) var(--space-5) var(--space-5);
    border-radius: var(--radius-xl);
    text-align: center;
    opacity: 0;
    transform: translateY(var(--motion-rise)) scale(0.96);
    transition:
      opacity var(--dur-base) var(--ease-out),
      transform var(--dur-base) var(--ease-out);
  }
  .card::before { border-radius: calc(var(--radius-xl) - var(--inner-line-inset)); }
  :host([open]) .card {
    opacity: 1;
    transform: none;
    transition:
      opacity var(--dur-base) var(--ease-out),
      transform var(--dur-slow) var(--ease-spring);
  }
  .sprig { width: 7.5rem; margin: 0 auto var(--space-2); }
  h2 {
    margin: 0 0 var(--space-3);
    font-family: var(--font-display);
    font-weight: var(--fw-display);
    font-size: var(--fs-xl);
    line-height: var(--lh-tight);
    color: var(--color-ink);
  }
  .body p {
    margin: 0 0 var(--space-3);
    font-size: var(--fs-md);
    font-weight: var(--fw-body);
    line-height: var(--lh-body);
    color: var(--color-ink-soft);
  }
  .body p:last-child { margin-bottom: 0; }
  .cta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-5);
    min-height: var(--tap-min);
    padding: var(--space-2) var(--space-5);
    font-family: var(--font-display);
    font-weight: var(--fw-display);
    font-size: var(--fs-sm);
    letter-spacing: 0.04em;
    color: var(--color-accent-ink);
    background: var(--color-accent);
    border: var(--border-w) solid var(--color-ink);
    border-radius: var(--radius-pill);
    box-shadow: var(--shadow-pop);
  }
  .cta .touch { display: none; }
  @media (pointer: coarse) {
    .cta.default .keys { display: none; }
    .cta.default .touch { display: inline; }
  }
  @media (min-width: 720px) {
    .card { padding: var(--space-6) var(--space-7) var(--space-5); }
  }
  @media (prefers-reduced-motion: no-preference) {
    :host([open]) .cta { animation: pulse var(--dur-pulse) var(--ease-in-out) infinite; }
  }
  @keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.05); }
  }
</style>
<div class="scrim" part="scrim"></div>
<section class="card paper" part="card" role="dialog" aria-modal="true" aria-labelledby="title">
  <div class="sprig">${SPRIG_SVG}</div>
  <h2 id="title"></h2>
  <div class="body"></div>
  <div class="cta" aria-hidden="true"></div>
</section>
`;

/** Centred chapter card. */
export class StoryCard extends Base {
  /** @type {Promise<unknown>} */ #queue = Promise.resolve();
  /** @type {Array<() => void>} */ #offs = [];
  /** @type {(() => void)|null} */ #close = null;
  #openedAt = 0;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = TEMPLATE;
    this.$title = /** @type {HTMLElement} */ (root.querySelector('h2'));
    this.$body = /** @type {HTMLElement} */ (root.querySelector('.body'));
    this.$cta = /** @type {HTMLElement} */ (root.querySelector('.cta'));
    this.onClick = () => this.#dismiss();
  }

  connectedCallback() {
    this.addEventListener('click', this.onClick);
    if (this.#close) this.#subscribe();
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.onClick);
    this.#unsubscribe();
    this.#close?.();
  }

  /** @returns {boolean} */
  get isOpen() {
    return this.#close !== null;
  }

  /**
   * Show a card and wait until the player dismisses it.
   * @param {{ title?: string, body?: string|string[], cta?: string }} [card]
   * @returns {Promise<void>}
   */
  show({ title = '', body = '', cta } = {}) {
    const run = this.#queue.then(() => this.#present(String(title ?? ''), toParagraphs(body), cta));
    this.#queue = run.catch(() => {});
    return run;
  }

  /**
   * @param {string} title @param {string[]} paragraphs @param {string|undefined} cta
   * @returns {Promise<void>}
   */
  #present(title, paragraphs, cta) {
    return new Promise((resolve) => {
      this.$title.textContent = title;
      this.$title.hidden = !title;
      this.$body.replaceChildren(...paragraphs.map((p) => h('p', { text: p })));
      this.#renderCta(cta);
      this.#openedAt = performance.now();
      this.setAttribute('open', '');
      this.#close = () => {
        this.#close = null;
        this.#unsubscribe();
        this.removeAttribute('open');
        resolve();
      };
      if (this.isConnected) this.#subscribe();
      else this.#close();
    });
  }

  /** @param {string|undefined} cta */
  #renderCta(cta) {
    const custom = typeof cta === 'string' && cta.trim();
    this.$cta.classList.toggle('default', !custom);
    if (custom) {
      this.$cta.replaceChildren(h('span', { text: cta.trim() }), h('span', { text: '▸', 'aria-hidden': 'true' }));
    } else {
      this.$cta.replaceChildren(
        h('span', { class: 'keys', text: 'Press A' }),
        h('span', { class: 'touch', text: 'Tap to continue' }),
        h('span', { text: '▸', 'aria-hidden': 'true' }),
      );
    }
  }

  #dismiss() {
    if (!this.#close) return false;
    if (performance.now() - this.#openedAt < MIN_SHOW_MS) return true;
    emitSfx(this, 'confirm');
    this.#close();
    return true;
  }

  #subscribe() {
    if (this.#offs.length) return;
    this.#offs = ['a', 'b', 'start'].map((action) =>
      input.onPress(/** @type {any} */ (action), () => (this.#close ? (this.#dismiss(), true) : false)),
    );
  }

  #unsubscribe() {
    for (const off of this.#offs) off();
    this.#offs = [];
  }
}

define('story-card', StoryCard);
