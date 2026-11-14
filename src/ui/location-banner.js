/**
 * <location-banner> — a little wooden plaque that swings in at the top-left
 * when you arrive somewhere, lingers, then slides away.
 *
 *   banner.show('Fernhollow');          // 2.2 s
 *   banner.show('Progress saved', 1500);
 *
 * Calling show() again while visible swaps the text and restarts the timer.
 */
import { Base, BASE_CSS, define } from './shared.js';

const DEFAULT_MS = 2200;
const MIN_MS = 500;

const TEMPLATE = /* html */ `
<style>
  ${BASE_CSS}
  :host {
    position: absolute;
    top: calc(var(--safe-top) + var(--hud-gap));
    left: calc(var(--safe-left) + var(--hud-gap));
    z-index: var(--z-banner, 45);
    display: block;
    max-width: calc(100% - 2 * var(--hud-gap) - var(--safe-left) - var(--safe-right));
    pointer-events: none;
  }
  .plaque {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    max-width: 100%;
    min-height: var(--tap-min);
    padding: var(--space-2) var(--space-4);
    font-family: var(--font-display);
    font-weight: var(--fw-display);
    font-size: var(--fs-lg);
    line-height: var(--lh-tight);
    letter-spacing: 0.01em;
    color: var(--color-on-dark);
    text-shadow: 0 2px 0 var(--color-wood-dark);
    background: var(--sign-bg);
    border: var(--border-w) solid var(--color-ink);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-bevel), var(--shadow-panel);
    transform-origin: 0% 0%;
    opacity: 0;
    transform: translateX(calc(-100% - var(--hud-gap) - var(--safe-left) - 1rem)) rotate(-4deg);
    transition:
      transform var(--dur-slow) var(--ease-in),
      opacity var(--dur-slow) var(--ease-in);
  }
  :host([shown]) .plaque {
    opacity: 1;
    transform: rotate(-1.5deg);
    transition:
      transform var(--dur-slower) var(--ease-spring),
      opacity var(--dur-base) var(--ease-out);
  }
  .nail {
    flex: none;
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, var(--color-nail-hi) 0 18%, var(--color-nail) 60%);
    box-shadow: 0 1px 0 var(--color-sheen);
  }
  .label {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding-block: 0.1em;
  }
  .plaque.bump { animation: bump var(--dur-slow) var(--ease-spring); }
  @keyframes bump {
    0% { transform: rotate(-1.5deg) scale(1); }
    40% { transform: rotate(-2.5deg) scale(1.06); }
    100% { transform: rotate(-1.5deg) scale(1); }
  }
  @media (min-width: 720px) {
    .plaque { padding: var(--space-2) var(--space-5); gap: var(--space-4); }
  }
  @media (prefers-reduced-motion: reduce) {
    .plaque, :host([shown]) .plaque { transform: none; }
    .plaque.bump { animation: none; }
  }
</style>
<div class="plaque" part="plaque" role="status" aria-live="polite">
  <span class="nail" aria-hidden="true"></span>
  <span class="label"></span>
  <span class="nail" aria-hidden="true"></span>
</div>
`;

/** Top-left wooden location sign. */
export class LocationBanner extends Base {
  /** @type {ReturnType<typeof setTimeout>|0} */ #timer = 0;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = TEMPLATE;
    this.$plaque = /** @type {HTMLElement} */ (root.querySelector('.plaque'));
    this.$label = /** @type {HTMLElement} */ (root.querySelector('.label'));
    this.onAnimationEnd = () => this.$plaque.classList.remove('bump');
  }

  connectedCallback() {
    this.$plaque.addEventListener('animationend', this.onAnimationEnd);
  }

  disconnectedCallback() {
    this.$plaque.removeEventListener('animationend', this.onAnimationEnd);
    clearTimeout(this.#timer);
    this.#timer = 0;
    this.removeAttribute('shown');
  }

  /**
   * Show the sign for `ms` milliseconds (an empty text hides it).
   * @param {string} text
   * @param {number} [ms]
   */
  show(text, ms = DEFAULT_MS) {
    const label = String(text ?? '').trim();
    clearTimeout(this.#timer);
    this.#timer = 0;
    if (!label) {
      this.removeAttribute('shown');
      return;
    }
    const wasShown = this.hasAttribute('shown');
    this.$label.textContent = label;
    if (wasShown) {
      // Already up: give it a friendly wobble instead of sliding again.
      this.$plaque.classList.remove('bump');
      void this.$plaque.offsetWidth;
      this.$plaque.classList.add('bump');
    } else {
      this.setAttribute('shown', '');
    }
    const hold = Number.isFinite(ms) ? Math.max(MIN_MS, ms) : DEFAULT_MS;
    this.#timer = setTimeout(() => {
      this.#timer = 0;
      this.removeAttribute('shown');
    }, hold);
  }

  /** Slide the sign away now. */
  hide() {
    clearTimeout(this.#timer);
    this.#timer = 0;
    this.removeAttribute('shown');
  }
}

define('location-banner', LocationBanner);
