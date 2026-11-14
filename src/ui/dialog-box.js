/**
 * <dialog-box> — bottom-centred storybook text box with a typewriter, an
 * optional speaker tab, and a compact choice list.
 *
 *   await box.say(['Hello!', 'Lovely day.'], { speaker: 'Posy' });
 *   const i = await box.choose('Take the path?', ['Yes', 'No']); // −1 on b
 *
 * Calls queue up, so overlapping say()/choose() run one after another and the
 * box stays up between back-to-back calls. While open it consumes a/b/up/down.
 */
import { input } from '../core/input.js';
import { Base, BASE_CSS, PAPER_CSS, define, emitSfx, toPages } from './shared.js';

/** Typewriter speed. */
export const CHARS_PER_SECOND = 45;
/** Minimum gap between 'text' blips so fast text doesn't buzz. */
const BLIP_GAP_MS = 70;
/** Keep the box up this long after a call ends, in case another follows. */
const CLOSE_GRACE_MS = 110;
/** Extra reveal cost (in characters) for the space after punctuation — a tiny breath. */
const PAUSE_AFTER = Object.freeze({ '.': 6, '!': 6, '?': 6, '…': 7, ',': 3, ';': 3, ':': 3, '—': 3 });

const NAV_ACTIONS = /** @type {const} */ (['a', 'b', 'up', 'down']);

/**
 * Reveal cost of the character at `i` (whitespace after punctuation lingers).
 * @param {string} text @param {number} i
 */
export function revealCost(text, i) {
  if (i > 0 && /\s/.test(text[i])) {
    return 1 + (/** @type {Record<string, number>} */ (PAUSE_AFTER)[text[i - 1]] ?? 0);
  }
  return 1;
}

const TEMPLATE = /* html */ `
<style>
  ${BASE_CSS}
  ${PAPER_CSS}
  :host {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: var(--z-dialog, 20);
    display: block;
    pointer-events: none;
    padding:
      0
      calc(var(--safe-right) + var(--hud-gap) + var(--hud-side-clearance))
      calc(var(--safe-bottom) + var(--hud-gap) + var(--hud-bottom-clearance))
      calc(var(--safe-left) + var(--hud-gap) + var(--hud-side-clearance));
    font-family: var(--font-body);
    color: var(--color-ink);
  }
  .wrap {
    position: relative;
    max-width: var(--dialog-max);
    margin-inline: auto;
  }
  .box {
    min-height: var(--dialog-min-h);
    padding: var(--space-4) var(--space-5) var(--space-5);
    cursor: pointer;
    pointer-events: auto;
    opacity: 0;
    visibility: hidden;
    transform: translateY(var(--motion-rise)) scale(0.985);
    transform-origin: 50% 100%;
    transition:
      opacity var(--dur-base) var(--ease-out),
      transform var(--dur-base) var(--ease-out),
      visibility 0s linear var(--dur-base);
  }
  :host([open]) .box {
    opacity: 1;
    visibility: visible;
    transform: none;
    transition:
      opacity var(--dur-base) var(--ease-out),
      transform var(--dur-slow) var(--ease-spring),
      visibility 0s linear 0s;
  }
  :host([has-speaker]) .box { padding-top: calc(var(--space-4) + var(--space-2)); }

  .speaker {
    position: absolute;
    z-index: 1;
    top: 0;
    left: var(--space-5);
    transform: translateY(-58%);
    max-width: calc(100% - 2 * var(--space-5));
    padding: var(--space-1) var(--space-4);
    font-family: var(--font-display);
    font-weight: var(--fw-display);
    font-size: var(--fs-sm);
    line-height: var(--lh-snug);
    letter-spacing: 0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--color-accent-ink);
    background: var(--color-accent);
    border: var(--border-w) solid var(--color-ink);
    border-radius: var(--radius-pill);
    box-shadow: var(--shadow-pop);
  }

  .text {
    position: relative;
    margin: 0;
    min-height: calc(2em * var(--lh-body));
    font-size: var(--fs-md);
    font-weight: var(--fw-body);
    line-height: var(--lh-body);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  .rest { visibility: hidden; }

  .next {
    position: absolute;
    right: var(--space-4);
    bottom: var(--space-2);
    font-size: var(--fs-xs);
    line-height: 1;
    color: var(--color-accent);
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  :host([ready]) .next { opacity: 1; }

  .options {
    position: absolute;
    right: var(--space-3);
    bottom: calc(100% + var(--space-3));
    min-width: 8.5rem;
    max-width: min(18rem, 86%);
    margin: 0;
    padding: var(--space-2);
    list-style: none;
    border-radius: var(--radius-md);
    pointer-events: auto;
    opacity: 0;
    visibility: hidden;
    transform: translateY(6px) scale(0.96);
    transform-origin: 100% 100%;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-out),
      visibility 0s linear var(--dur-fast);
  }
  .options::before { border-radius: calc(var(--radius-md) - var(--inner-line-inset)); }
  :host([choosing]) .options {
    opacity: 1;
    visibility: visible;
    transform: none;
    transition:
      opacity var(--dur-base) var(--ease-out),
      transform var(--dur-base) var(--ease-spring),
      visibility 0s linear 0s;
  }
  .option {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--tap-min);
    padding: 0 var(--space-4) 0 var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--fs-md);
    font-weight: var(--fw-bold);
    line-height: var(--lh-snug);
    cursor: pointer;
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .option .cursor {
    flex: none;
    width: 1em;
    font-size: 0.8em;
    color: var(--color-accent);
    opacity: 0;
    transform: translateX(-3px);
    transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
  }
  .option[aria-selected='true'] { background: var(--color-highlight); }
  .option[aria-selected='true'] .cursor { opacity: 1; transform: none; }

  @media (pointer: fine) {
    .option { min-height: 2.3rem; }
  }
  @media (min-width: 720px) {
    .box { padding: var(--space-5) var(--space-6) var(--space-5); }
    :host([has-speaker]) .box { padding-top: calc(var(--space-5) + var(--space-1)); }
    .speaker { left: var(--space-6); font-size: var(--fs-md); }
  }
  @media (prefers-reduced-motion: no-preference) {
    :host([ready]) .next { animation: bob var(--dur-bounce) var(--ease-in-out) infinite; }
  }
  @keyframes bob {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(4px); }
  }
</style>
<div class="wrap">
  <div class="box paper" part="box">
    <div class="speaker" part="speaker" hidden></div>
    <p class="text"><span class="typed"></span><span class="rest" aria-hidden="true"></span></p>
    <span class="next" aria-hidden="true">▼</span>
  </div>
  <ul class="options paper" role="listbox" aria-label="Choices" part="options"></ul>
</div>
<div class="sr-only" aria-live="polite" aria-atomic="true"></div>
`;

/** Bottom-of-screen dialogue box. See module docs. */
export class DialogBox extends Base {
  /** @type {Promise<unknown>} */ #queue = Promise.resolve();
  #pending = 0;
  /** @type {'idle'|'typing'|'ready'|'choosing'} */ #phase = 'idle';
  /** @type {Array<() => void>} */ #offs = [];
  #raf = 0;
  /** @type {ReturnType<typeof setTimeout>|0} */ #closeTimer = 0;
  /** @type {(() => void)|null} */ #finishTyping = null;
  /** @type {(() => void)|null} */ #advance = null;
  /** @type {{ index: number, count: number, resolve: (i: number) => void }|null} */ #choice = null;
  #detached = false;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = TEMPLATE;
    this.$box = /** @type {HTMLElement} */ (root.querySelector('.box'));
    this.$speaker = /** @type {HTMLElement} */ (root.querySelector('.speaker'));
    this.$typed = /** @type {HTMLElement} */ (root.querySelector('.typed'));
    this.$rest = /** @type {HTMLElement} */ (root.querySelector('.rest'));
    this.$options = /** @type {HTMLElement} */ (root.querySelector('.options'));
    this.$live = /** @type {HTMLElement} */ (root.querySelector('[aria-live]'));
    this.onBoxClick = this.onBoxClick.bind(this);
  }

  connectedCallback() {
    this.#detached = false;
    this.$box.addEventListener('click', this.onBoxClick);
    if (this.#pending > 0) this.#subscribe();
  }

  disconnectedCallback() {
    this.$box.removeEventListener('click', this.onBoxClick);
    // Never leave a script hanging: settle everything that is waiting on the box.
    this.#detached = true;
    this.#unsubscribe();
    clearTimeout(this.#closeTimer);
    this.#finishTyping?.();
    this.#advance?.();
    if (this.#choice) this.#commitChoice(-1, null);
  }

  /** @returns {boolean} true from a say()/choose() call until its promise settles */
  get isOpen() {
    return this.#pending > 0;
  }

  /**
   * Show one or more pages of text. a (or a tap) finishes the current page,
   * then turns to the next; the promise resolves after the last page.
   * @param {string|string[]} pages
   * @param {{ speaker?: string }} [opts]
   * @returns {Promise<void>}
   */
  say(pages, { speaker } = {}) {
    const list = toPages(pages);
    const name = speaker === null || speaker === undefined ? '' : String(speaker).trim();
    return /** @type {Promise<void>} */ (
      this.#enqueue(async () => {
        if (!list.length) return;
        this.#show(name);
        for (let i = 0; i < list.length; i++) {
          await this.#type(list[i], name);
          await this.#waitForAdvance();
        }
      }, undefined)
    );
  }

  /**
   * Ask a question with a short list of answers.
   * @param {string} prompt shown in the box
   * @param {string[]} options
   * @param {{ speaker?: string }} [opts]
   * @returns {Promise<number>} chosen index, or −1 when cancelled with b
   */
  choose(prompt, options, { speaker } = {}) {
    const labels = Array.isArray(options) ? options.map((o) => String(o ?? '')) : [];
    const text = prompt === null || prompt === undefined ? '' : String(prompt);
    const name = speaker === null || speaker === undefined ? '' : String(speaker).trim();
    return /** @type {Promise<number>} */ (
      this.#enqueue(async () => {
        if (!labels.length) return -1;
        this.#show(name);
        await this.#type(text, name);
        return this.#pick(labels, text);
      }, -1)
    );
  }

  /** Tap on the box: finish the page, or turn it. */
  onBoxClick() {
    if (this.#phase === 'typing') this.#finishTyping?.();
    else if (this.#phase === 'ready') this.#advance?.();
  }

  /**
   * @param {() => Promise<unknown>} task
   * @param {unknown} fallback value when the task throws
   */
  #enqueue(task, fallback) {
    this.#pending += 1;
    clearTimeout(this.#closeTimer);
    this.#subscribe(); // consume input for as long as isOpen is true
    const run = this.#queue
      .then(task)
      .catch((err) => {
        console.error('[dialog-box]', err);
        return fallback;
      })
      .finally(() => {
        this.#pending -= 1;
        if (this.#pending === 0) this.#hide();
      });
    this.#queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  /** @param {string} speaker */
  #show(speaker) {
    clearTimeout(this.#closeTimer);
    this.$speaker.textContent = speaker;
    this.$speaker.hidden = !speaker;
    this.toggleAttribute('has-speaker', !!speaker);
    if (!this.hasAttribute('open')) this.setAttribute('open', '');
    this.#subscribe();
  }

  #hide() {
    this.#unsubscribe();
    this.#phase = 'idle';
    this.removeAttribute('ready');
    this.removeAttribute('choosing');
    clearTimeout(this.#closeTimer);
    this.#closeTimer = setTimeout(() => {
      this.#closeTimer = 0;
      this.removeAttribute('open');
    }, CLOSE_GRACE_MS);
  }

  #subscribe() {
    if (this.#offs.length || this.#detached) return;
    this.#offs = NAV_ACTIONS.map((action) => input.onPress(action, () => this.#handle(action)));
  }

  #unsubscribe() {
    for (const off of this.#offs) off();
    this.#offs = [];
  }

  /** @param {'a'|'b'|'up'|'down'} action @returns {boolean} consumed */
  #handle(action) {
    if (this.#pending === 0) return false;
    switch (this.#phase) {
      case 'typing':
        if (action === 'a' || action === 'b') this.#finishTyping?.();
        break;
      case 'ready':
        if (action === 'a' || action === 'b') this.#advance?.();
        break;
      case 'choosing':
        if (action === 'up') this.#moveChoice(-1);
        else if (action === 'down') this.#moveChoice(1);
        else if (action === 'a' && this.#choice) this.#commitChoice(this.#choice.index, 'confirm');
        else if (action === 'b') this.#commitChoice(-1, 'cancel');
        break;
      default:
        break;
    }
    return true;
  }

  /**
   * Typewriter one page. Resolves when the whole page is visible.
   * @param {string} text @param {string} speaker
   * @returns {Promise<void>}
   */
  #type(text, speaker) {
    return new Promise((resolve) => {
      cancelAnimationFrame(this.#raf);
      this.removeAttribute('ready');
      this.#phase = 'typing';
      this.$live.textContent = speaker ? `${speaker}: ${text}` : text;

      let shown = 0;
      let budget = 1; // first character appears on the first frame
      let last = -1;
      let lastBlip = -Infinity;
      const paint = () => {
        this.$typed.textContent = text.slice(0, shown);
        this.$rest.textContent = text.slice(shown);
      };
      const finish = () => {
        cancelAnimationFrame(this.#raf);
        this.#raf = 0;
        this.#finishTyping = null;
        shown = text.length;
        paint();
        resolve();
      };
      this.#finishTyping = finish;
      paint();
      if (!text.length || this.#detached) {
        finish();
        return;
      }

      /** @param {number} now */
      const step = (now) => {
        if (last < 0) last = now;
        budget += (Math.min(250, Math.max(0, now - last)) / 1000) * CHARS_PER_SECOND;
        last = now;
        let revealedInk = false;
        const before = shown;
        while (shown < text.length) {
          const cost = revealCost(text, shown);
          if (budget < cost) break;
          budget -= cost;
          if (!/\s/.test(text[shown])) revealedInk = true;
          shown += 1;
        }
        if (shown !== before) paint();
        if (revealedInk && now - lastBlip >= BLIP_GAP_MS) {
          lastBlip = now;
          emitSfx(this, 'text');
        }
        if (shown >= text.length) finish();
        else this.#raf = requestAnimationFrame(step);
      };
      this.#raf = requestAnimationFrame(step);
    });
  }

  /** Show ▼ and wait for a/tap. @returns {Promise<void>} */
  #waitForAdvance() {
    return new Promise((resolve) => {
      if (this.#detached) {
        resolve();
        return;
      }
      this.#phase = 'ready';
      this.setAttribute('ready', '');
      this.#advance = () => {
        this.#advance = null;
        this.#phase = 'idle';
        this.removeAttribute('ready');
        resolve();
      };
    });
  }

  /**
   * Show the option list and wait for a pick.
   * @param {string[]} labels @param {string} prompt
   * @returns {Promise<number>}
   */
  #pick(labels, prompt) {
    return new Promise((resolve) => {
      if (this.#detached) {
        resolve(-1);
        return;
      }
      const list = this.$options;
      list.replaceChildren(
        ...labels.map((label, i) => {
          const li = document.createElement('li');
          li.className = 'option';
          li.setAttribute('role', 'option');
          li.setAttribute('aria-selected', 'false');
          const cursor = document.createElement('span');
          cursor.className = 'cursor';
          cursor.setAttribute('aria-hidden', 'true');
          cursor.textContent = '▶';
          const text = document.createElement('span');
          text.textContent = label;
          li.append(cursor, text);
          li.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.#phase === 'choosing') this.#commitChoice(i, 'confirm');
          });
          li.addEventListener('pointermove', (e) => {
            if (e.pointerType === 'mouse' && this.#choice && this.#choice.index !== i) {
              this.#choice.index = i;
              this.#paintChoice();
            }
          });
          return li;
        }),
      );
      this.#choice = { index: 0, count: labels.length, resolve };
      this.#phase = 'choosing';
      this.setAttribute('choosing', '');
      this.#paintChoice();
      this.$live.textContent = `${prompt ? `${prompt} ` : ''}Choices: ${labels.join(', ')}.`;
    });
  }

  /** @param {number} delta */
  #moveChoice(delta) {
    const choice = this.#choice;
    if (!choice || choice.count < 2) return;
    choice.index = (choice.index + delta + choice.count) % choice.count;
    emitSfx(this, 'cursor');
    this.#paintChoice();
  }

  #paintChoice() {
    const index = this.#choice?.index ?? -1;
    this.$options.querySelectorAll('.option').forEach((li, i) => {
      li.setAttribute('aria-selected', String(i === index));
    });
  }

  /**
   * @param {number} index chosen option or −1
   * @param {'confirm'|'cancel'|null} sfx
   */
  #commitChoice(index, sfx) {
    const choice = this.#choice;
    if (!choice) return;
    this.#choice = null;
    this.#phase = 'idle';
    this.removeAttribute('choosing');
    if (sfx) emitSfx(this, sfx);
    choice.resolve(index);
  }
}

define('dialog-box', DialogBox);
