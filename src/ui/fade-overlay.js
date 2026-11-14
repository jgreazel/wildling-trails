/**
 * <fade-overlay> — full-screen black veil for scene changes.
 *
 *   await fade.fadeOut();   // to black
 *   …swap the map…
 *   await fade.fadeIn();    // back to the world
 *
 * Calls run in order (a fadeIn issued mid-fadeOut waits for it). The veil only
 * blocks pointers while it is (becoming) opaque.
 */
import { Base, BASE_CSS, define } from './shared.js';

const DEFAULT_MS = 220;

const TEMPLATE = /* html */ `
<style>
  ${BASE_CSS}
  :host {
    position: absolute;
    inset: 0;
    z-index: var(--z-fade, 70);
    display: block;
    pointer-events: none;
  }
  :host([opaque]) { pointer-events: auto; cursor: progress; }
  .veil {
    position: absolute;
    inset: 0;
    background: var(--color-fade);
    opacity: 0;
    transition-property: opacity;
    transition-timing-function: var(--ease-in-out);
    transition-duration: 0ms;
    will-change: opacity;
  }
</style>
<div class="veil" part="veil"></div>
`;

/** Full-screen fade to/from black. */
export class FadeOverlay extends Base {
  /** @type {Promise<void>} */ #chain = Promise.resolve();
  /** @type {ReturnType<typeof setTimeout>|0} */ #timer = 0;
  /** @type {(() => void)|null} */ #settle = null;
  #level = 0;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = TEMPLATE;
    this.$veil = /** @type {HTMLElement} */ (root.querySelector('.veil'));
  }

  connectedCallback() {
    this.setAttribute('aria-hidden', 'true');
  }

  disconnectedCallback() {
    // Finish any running fade so awaiting scripts continue.
    this.#settle?.();
  }

  /** @returns {boolean} whether the screen is currently black (or going black) */
  get isOpaque() {
    return this.#level === 1;
  }

  /**
   * Fade the screen to black.
   * @param {number} [ms]
   * @returns {Promise<void>}
   */
  fadeOut(ms = DEFAULT_MS) {
    return this.#enqueue(1, ms);
  }

  /**
   * Fade back from black.
   * @param {number} [ms]
   * @returns {Promise<void>}
   */
  fadeIn(ms = DEFAULT_MS) {
    return this.#enqueue(0, ms);
  }

  /** @param {0|1} level @param {number} ms */
  #enqueue(level, ms) {
    const run = this.#chain.then(() => this.#animate(level, ms));
    this.#chain = run.catch(() => {});
    return run;
  }

  /** @param {0|1} level @param {number} ms @returns {Promise<void>} */
  #animate(level, ms) {
    const duration = Number.isFinite(ms) ? Math.max(0, ms) : DEFAULT_MS;
    return new Promise((resolve) => {
      this.#level = level;
      if (level === 1) this.setAttribute('opaque', '');
      const veil = this.$veil;
      veil.style.transitionDuration = `${duration}ms`;
      veil.style.opacity = String(level);
      const settle = () => {
        clearTimeout(this.#timer);
        this.#timer = 0;
        this.#settle = null;
        if (level === 0) this.removeAttribute('opaque');
        resolve();
      };
      this.#settle = settle;
      // A timer (not transitionend) so hidden tabs and instant fades still resolve.
      this.#timer = setTimeout(settle, duration + 16);
    });
  }
}

define('fade-overlay', FadeOverlay);
