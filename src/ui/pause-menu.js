/**
 * <pause-menu> — bottom sheet on phones, right-hand panel on wider screens.
 *
 * Items: Partner · Journal · Save · Sound · Clock · Controls · Close.
 * Partner / Journal / Controls open sub-views; Save / Sound / Clock / Close
 * dispatch `menu-action` `{ action }` for the game to handle. Closing (Close,
 * start, b at the top level, or a tap outside) dispatches `menu-close`.
 *
 * Feed it live data with setParty / setJournal / setSound / setClock.
 */
import { input } from '../core/input.js';
import {
  Base,
  BASE_CSS,
  PAPER_CSS,
  define,
  elementColor,
  elementIcon,
  emit,
  emitSfx,
  h,
  keepFocusOffButtons,
  revealInContainer,
} from './shared.js';

/** @typedef {'root'|'partner'|'journal'|'controls'} MenuView */
/** @typedef {{ species: string, name: string, element?: string, blurb?: string }} PartyEntry */
/** @typedef {{ id: string, name: string, element?: string, blurb?: string }} JournalEntry */

const NAV_ACTIONS = /** @type {const} */ (['up', 'down', 'left', 'right', 'a', 'b', 'start']);

const EMPTY_PARTNER_TEXT = 'No partner yet — Dr. Marrow is expecting you at the greenhouse.';

/** Original line icons (24×24). */
const ICONS = Object.freeze({
  partner:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><ellipse cx="12" cy="15.8" rx="4.7" ry="3.9"/><circle cx="6" cy="10.2" r="2.1"/><circle cx="9.7" cy="6.6" r="2.1"/><circle cx="14.3" cy="6.6" r="2.1"/><circle cx="18" cy="10.2" r="2.1"/></svg>',
  journal:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"><path d="M5 4.5h10.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10.5"/><path d="M9 8.6h6"/></svg>',
  save:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M7 3.8h10v16.4l-5-3.7-5 3.7z"/></svg>',
  soundOn:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18.2 6.4a7.6 7.6 0 0 1 0 11.2"/></svg>',
  soundOff:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.8 9.6l4.8 4.8M20.6 9.6l-4.8 4.8"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M12 7.6V12l3 2"/></svg>',
  controls:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"><rect x="2.8" y="7" width="18.4" height="10.5" rx="5.2"/><path d="M7.6 10.2v4.2M5.5 12.3h4.2"/><circle cx="15.6" cy="11" r="1.1" fill="currentColor" stroke="none"/><circle cx="17.9" cy="13.5" r="1.1" fill="currentColor" stroke="none"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
  back:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5L8 12l6.5 6.5"/></svg>',
  silhouette:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M7.3 9.8 6.3 3.6l4.3 3.2zM16.7 9.8l1-6.2-4.3 3.2z"/><circle cx="12" cy="10.8" r="4.9"/><ellipse cx="12" cy="18.3" rx="6.8" ry="3.9"/></svg>',
});

/** @type {ReadonlyArray<{ id: string, title: string }>} */
const ITEMS = Object.freeze([
  { id: 'partner', title: 'Partner' },
  { id: 'journal', title: 'Journal' },
  { id: 'save', title: 'Save' },
  { id: 'sound', title: 'Sound' },
  { id: 'clock', title: 'Clock' },
  { id: 'controls', title: 'Controls' },
  { id: 'close', title: 'Close' },
]);

const VIEW_TITLES = Object.freeze({ root: 'Menu', partner: 'Partner', journal: 'Journal', controls: 'Controls' });

/** Keyboard / controller / touch reference shown in the Controls view. */
const CONTROLS = Object.freeze({
  keyboard: [
    ['Move', [['↑', '↓', '←', '→'], ['W', 'A', 'S', 'D']]],
    ['A · Talk, confirm', [['Z'], ['Space'], ['J']]],
    ['B · Back', [['X'], ['Backspace'], ['K']]],
    ['Run', [['Shift'], ['hold B']]],
    ['Menu', [['Enter'], ['Esc']]],
    ['Time of day', [['T']]],
  ],
  gamepad: [
    ['Move', [['D-pad'], ['Left stick']]],
    ['A · Talk, confirm', [['A']]],
    ['B · Back', [['B']]],
    ['Run', [['hold X'], ['LB', 'RB', 'LT', 'RT']]],
    ['Menu', [['Menu'], ['Y']]],
    ['Time of day', [['View']]],
  ],
  touch: [
    ['Move', 'Hold the d-pad — slide your thumb to turn'],
    ['A', 'Talk, read signs, confirm — or tap the text box'],
    ['B', 'Back out · hold while walking to run'],
    ['START', 'Open this menu'],
  ],
});

const TEMPLATE = /* html */ `
<style>
  ${BASE_CSS}
  ${PAPER_CSS}
  :host {
    position: absolute;
    inset: 0;
    z-index: var(--z-menu, 40);
    display: block;
    pointer-events: none;
    visibility: hidden;
    transition: visibility 0s linear var(--dur-base);
    font-family: var(--font-body);
    color: var(--color-ink);
  }
  :host([open]) { visibility: visible; transition-delay: 0s; }

  .scrim {
    position: absolute;
    inset: 0;
    background: var(--color-scrim);
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-out);
  }
  :host([open]) .scrim { opacity: 1; pointer-events: auto; }

  /* Phone first: a bottom sheet. */
  .panel {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    max-height: var(--sheet-max-h);
    padding:
      var(--space-2)
      calc(var(--safe-right) + var(--space-4))
      calc(var(--safe-bottom) + var(--space-3))
      calc(var(--safe-left) + var(--space-4));
    border-bottom: 0;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    box-shadow: var(--shadow-sheet);
    pointer-events: auto;
    transform: translateY(calc(100% + var(--space-6)));
    transition: transform var(--dur-base) var(--ease-in);
  }
  .panel::before { inset: var(--inner-line-inset) var(--inner-line-inset) 0; border-bottom: 0; border-radius: calc(var(--radius-xl) - var(--inner-line-inset)) calc(var(--radius-xl) - var(--inner-line-inset)) 0 0; }
  :host([open]) .panel { transform: none; transition: transform var(--dur-slow) var(--ease-out); }

  .grabber {
    flex: none;
    width: 2.75rem;
    height: 5px;
    margin: var(--space-1) auto var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--color-paper-3);
  }
  .head {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--tap-min);
    margin-bottom: var(--space-2);
  }
  .back {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--tap-min);
    height: var(--tap-min);
    margin-left: calc(var(--space-2) * -1);
    border-radius: 50%;
    color: var(--color-ink);
  }
  .back svg { width: 1.4rem; height: 1.4rem; }
  .back:active { background: var(--color-paper-3); }
  h2 {
    flex: 1;
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--fw-display);
    font-size: var(--fs-xl);
    line-height: var(--lh-tight);
  }
  .body {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    touch-action: pan-y;
    margin-inline: calc(var(--space-2) * -1);
    padding: var(--space-1) var(--space-2) var(--space-2);
    scrollbar-width: thin;
  }
  .foot {
    flex: none;
    display: none;
    justify-content: center;
    gap: var(--space-4);
    padding-top: var(--space-2);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-bold);
    letter-spacing: 0.04em;
    color: var(--color-ink-muted);
  }

  /* ── Root list ─────────────────────────────── */
  .items { display: grid; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
  .item {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 3rem;
    padding: 0 var(--space-3) 0 var(--space-2);
    font-size: var(--fs-md);
    font-weight: var(--fw-bold);
    border: var(--border-w-thin) solid transparent;
    border-radius: var(--radius-md);
    transition: background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
  }
  .item .cursor {
    flex: none;
    width: 0.9rem;
    font-size: 0.75em;
    color: var(--color-accent);
    opacity: 0;
    transform: translateX(-3px);
    transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
  }
  .item .icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    color: var(--color-ink-soft);
    background: var(--color-paper-2);
    border: var(--border-w-thin) solid var(--color-paper-line);
  }
  .item .icon svg { width: 1.15rem; height: 1.15rem; }
  .item .value {
    display: inline-block;
    margin-left: 0.15em;
    padding: 0 0.55em;
    border-radius: var(--radius-pill);
    font-size: 0.9em;
    color: var(--color-accent-ink);
    background: var(--color-ink-soft);
  }
  .item[data-id='close'] { color: var(--color-ink-soft); }
  .item[aria-current='true'] {
    background: var(--color-highlight);
    border-color: var(--color-ink);
    box-shadow: var(--shadow-pop);
  }
  .item[aria-current='true'] .cursor { opacity: 1; transform: none; }
  .item[aria-current='true'] .icon { color: var(--color-accent-ink); background: var(--color-accent); border-color: var(--color-ink); }

  /* ── Shared bits ───────────────────────────── */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    padding: 0.1em 0.65em;
    font-size: var(--fs-xs);
    font-weight: var(--fw-bold);
    letter-spacing: 0.03em;
    color: var(--el-ink);
    background: var(--chip, var(--el-default));
    border: var(--border-w-thin) solid var(--color-ink);
    border-radius: var(--radius-pill);
    white-space: nowrap;
  }
  .badge {
    flex: none;
    display: grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
    border-radius: 50%;
    color: var(--el-ink);
    background: var(--gloss), var(--chip, var(--el-default));
    border: var(--border-w) solid var(--color-ink);
    box-shadow: var(--shadow-pop);
  }
  .badge svg { width: 55%; height: 55%; }
  .badge.lg { width: 4.25rem; height: 4.25rem; }
  .badge.unknown { color: var(--color-silhouette); background: var(--color-paper-3); }
  .badge.unknown svg { width: 70%; height: 70%; }

  /* ── Partner ───────────────────────────────── */
  .mon {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    padding: var(--space-4);
    margin-bottom: var(--space-3);
    background: var(--color-paper-hi);
    border: var(--border-w-thin) solid var(--color-paper-line);
    border-radius: var(--radius-lg);
  }
  .mon .eyebrow {
    margin: 0;
    font-size: var(--fs-2xs);
    font-weight: var(--fw-bold);
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
    color: var(--color-ink-muted);
  }
  .mon h3 {
    margin: 0 0 var(--space-1);
    font-family: var(--font-display);
    font-weight: var(--fw-display);
    font-size: var(--fs-lg);
    line-height: var(--lh-tight);
  }
  .mon .blurb {
    grid-column: 1 / -1;
    margin: var(--space-1) 0 0;
    font-size: var(--fs-sm);
    line-height: var(--lh-body);
    color: var(--color-ink-soft);
  }
  .empty {
    display: grid;
    justify-items: center;
    gap: var(--space-3);
    padding: var(--space-5) var(--space-3);
    text-align: center;
  }
  .empty p { margin: 0; max-width: 22rem; font-size: var(--fs-md); line-height: var(--lh-body); color: var(--color-ink-soft); }

  /* ── Journal ───────────────────────────────── */
  .count {
    margin: 0 0 var(--space-3);
    font-size: var(--fs-sm);
    font-weight: var(--fw-bold);
    color: var(--color-ink-muted);
  }
  .count b { color: var(--color-ink); }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(5.75rem, 1fr));
    gap: var(--space-2);
  }
  .tile {
    position: relative;
    display: grid;
    justify-items: center;
    gap: var(--space-1);
    min-height: var(--tap-min);
    padding: var(--space-2) var(--space-1) var(--space-2);
    text-align: center;
    background: var(--color-paper-hi);
    border: var(--border-w-thin) solid var(--color-paper-line);
    border-radius: var(--radius-md);
    transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
  }
  .tile .no { font-size: var(--fs-2xs); font-weight: var(--fw-bold); color: var(--color-ink-muted); letter-spacing: 0.04em; }
  .tile .name { font-size: var(--fs-xs); font-weight: var(--fw-bold); line-height: var(--lh-snug); overflow-wrap: anywhere; }
  .tile[aria-selected='true'] {
    background: var(--color-highlight);
    border-color: var(--color-ink);
    box-shadow: var(--shadow-pop);
    transform: translateY(-1px);
  }
  .detail {
    margin-top: var(--space-3);
    padding: var(--space-3) var(--space-4);
    min-height: 6.5rem;
    background: var(--color-paper-hi);
    border: var(--border-w-thin) dashed var(--color-paper-line);
    border-radius: var(--radius-md);
  }
  .detail .row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-bottom: var(--space-1); }
  .detail h3 { margin: 0; font-family: var(--font-display); font-weight: var(--fw-display); font-size: var(--fs-lg); }
  .detail p { margin: 0; font-size: var(--fs-sm); line-height: var(--lh-body); color: var(--color-ink-soft); }

  /* ── Controls ──────────────────────────────── */
  .ctl + .ctl { margin-top: var(--space-4); }
  .ctl h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--fs-2xs);
    font-weight: var(--fw-bold);
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
    color: var(--color-ink-muted);
  }
  .ctl dl { margin: 0; display: grid; gap: var(--space-2); }
  .ctl .row {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    background: var(--color-paper-hi);
    border: var(--border-w-thin) solid var(--color-paper-line);
    border-radius: var(--radius-sm);
  }
  .ctl dt { font-weight: var(--fw-bold); font-size: var(--fs-sm); }
  .ctl dd { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); font-size: var(--fs-sm); color: var(--color-ink-soft); }
  .ctl .or { padding: 0 var(--space-1); font-size: var(--fs-xs); color: var(--color-ink-muted); }
  kbd {
    display: inline-block;
    min-width: 1.75em;
    padding: 0.05em 0.45em;
    font: inherit;
    font-size: var(--fs-xs);
    font-weight: var(--fw-bold);
    text-align: center;
    color: var(--color-ink);
    background: var(--color-paper);
    border: var(--border-w-thin) solid var(--color-ink);
    border-radius: var(--radius-xs);
    box-shadow: 0 2px 0 var(--color-ink);
  }

  @media (pointer: fine) {
    .foot { display: flex; }
    .item { min-height: 2.75rem; }
  }
  @media (min-width: 420px) {
    .ctl .row { grid-template-columns: 8.5rem 1fr; align-items: center; }
  }
  /* Wider screens: a floating panel on the right. */
  @media (min-width: 720px) {
    .panel {
      left: auto;
      top: calc(var(--safe-top) + var(--hud-gap));
      right: calc(var(--safe-right) + var(--hud-gap));
      bottom: auto;
      width: var(--menu-width);
      max-height: calc(100% - var(--safe-top) - var(--safe-bottom) - 2 * var(--hud-gap));
      padding: var(--space-4) var(--space-5) var(--space-4);
      border-bottom: var(--border-w) solid var(--color-ink);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-panel);
      transform: translateX(calc(100% + var(--hud-gap) + var(--safe-right) + var(--space-4)));
    }
    .panel::before { inset: var(--inner-line-inset); border-bottom: var(--border-w-thin) solid var(--panel-inner-line); border-radius: calc(var(--radius-xl) - var(--inner-line-inset)); }
    .grabber { display: none; }
    .ctl .row { grid-template-columns: 1fr; }
  }
  @media (prefers-reduced-motion: reduce) {
    .panel, :host([open]) .panel { transform: none; }
    .panel { opacity: 0; transition: opacity var(--dur-base) var(--ease-out); }
    :host([open]) .panel { opacity: 1; transition: opacity var(--dur-base) var(--ease-out); }
  }
</style>
<div class="scrim" part="scrim"></div>
<section class="panel paper" part="panel" role="dialog" aria-modal="true" aria-labelledby="menu-title">
  <div class="grabber" aria-hidden="true"></div>
  <header class="head">
    <button class="back" type="button" tabindex="-1" aria-label="Back" hidden>${ICONS.back}</button>
    <h2 id="menu-title">Menu</h2>
  </header>
  <div class="body">
    <ul class="items" role="menu" aria-labelledby="menu-title"></ul>
    <div class="view" data-view="partner" hidden></div>
    <div class="view" data-view="journal" hidden></div>
    <div class="view" data-view="controls" hidden></div>
  </div>
  <div class="foot" aria-hidden="true"><span>↑↓ Choose</span><span>A Select</span><span>B Back</span></div>
</section>
`;

/** Pause menu with partner, journal and settings. */
export class PauseMenu extends Base {
  #open = false;
  /** @type {MenuView} */ #view = 'root';
  #cursor = 0;
  #journalCursor = 0;
  /** @type {PartyEntry[]} */ #party = [];
  /** @type {{ seen: string[], all: JournalEntry[] }} */ #journal = { seen: [], all: [] };
  #soundOn = true;
  #clock = 'Live';
  /** @type {Array<() => void>} */ #offs = [];

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = TEMPLATE;
    this.$panel = /** @type {HTMLElement} */ (root.querySelector('.panel'));
    this.$scrim = /** @type {HTMLElement} */ (root.querySelector('.scrim'));
    this.$back = /** @type {HTMLButtonElement} */ (root.querySelector('.back'));
    this.$title = /** @type {HTMLElement} */ (root.querySelector('h2'));
    this.$body = /** @type {HTMLElement} */ (root.querySelector('.body'));
    this.$items = /** @type {HTMLElement} */ (root.querySelector('.items'));
    this.$views = {
      partner: /** @type {HTMLElement} */ (root.querySelector('[data-view="partner"]')),
      journal: /** @type {HTMLElement} */ (root.querySelector('[data-view="journal"]')),
      controls: /** @type {HTMLElement} */ (root.querySelector('[data-view="controls"]')),
    };
    this.onScrimClick = () => {
      if (!this.#open) return;
      emitSfx(this, 'cancel');
      this.close();
    };
    this.onBackClick = () => this.#back();
    this.#buildItems();
    this.#buildControls();
  }

  connectedCallback() {
    this.$scrim.addEventListener('click', this.onScrimClick);
    this.$back.addEventListener('click', this.onBackClick);
    this.shadowRoot?.addEventListener('mousedown', keepFocusOffButtons);
    if (this.#open) this.#subscribe();
  }

  disconnectedCallback() {
    this.$scrim.removeEventListener('click', this.onScrimClick);
    this.$back.removeEventListener('click', this.onBackClick);
    this.shadowRoot?.removeEventListener('mousedown', keepFocusOffButtons);
    this.#unsubscribe();
  }

  /** @returns {boolean} */
  get isOpen() {
    return this.#open;
  }

  /** Open at the top-level list (no-op if already open). */
  open() {
    if (this.#open) return;
    this.#open = true;
    this.#cursor = 0;
    this.#showView('root');
    this.setAttribute('open', '');
    this.$body.scrollTop = 0;
    this.#subscribe();
  }

  /** Close the menu and dispatch `menu-close` (no-op if already closed). */
  close() {
    if (!this.#open) return;
    this.#open = false;
    this.#unsubscribe();
    this.removeAttribute('open');
    emit(this, 'menu-close');
  }

  /**
   * @param {PartyEntry[]} party first entry is the following partner
   */
  setParty(party) {
    this.#party = (Array.isArray(party) ? party : [])
      .filter((p) => p && typeof p === 'object' && (p.species || p.name))
      .map((p) => ({
        species: String(p.species ?? ''),
        name: String(p.name ?? p.species ?? '???'),
        element: p.element ? String(p.element) : '',
        blurb: p.blurb ? String(p.blurb) : '',
      }));
    if (this.#view === 'partner') this.#renderPartner();
  }

  /**
   * @param {{ seen?: string[], all?: JournalEntry[] }} journal
   */
  setJournal(journal) {
    const seen = Array.isArray(journal?.seen) ? journal.seen.map(String) : [];
    const all = (Array.isArray(journal?.all) ? journal.all : [])
      .filter((e) => e && typeof e === 'object' && e.id)
      .map((e) => ({
        id: String(e.id),
        name: String(e.name ?? e.id),
        element: e.element ? String(e.element) : '',
        blurb: e.blurb ? String(e.blurb) : '',
      }));
    this.#journal = { seen, all };
    if (this.#journalCursor >= all.length) this.#journalCursor = 0;
    if (this.#view === 'journal') this.#renderJournal();
  }

  /** @param {boolean} on */
  setSound(on) {
    this.#soundOn = !!on;
    this.#paintItems();
  }

  /** @param {string} label e.g. 'Live', 'Night' */
  setClock(label) {
    this.#clock = String(label ?? '').trim() || 'Live';
    this.#paintItems();
  }

  // ── Building ─────────────────────────────────────────────

  #buildItems() {
    this.$items.replaceChildren(
      ...ITEMS.map((item, i) =>
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
              'data-id': item.id,
              onclick: () => {
                if (!this.#open || this.#view !== 'root') return;
                this.#cursor = i;
                this.#paintItems();
                this.#activate(item.id);
              },
              onpointermove: (/** @type {PointerEvent} */ e) => {
                if (e.pointerType === 'mouse' && this.#cursor !== i && this.#view === 'root') {
                  this.#cursor = i;
                  this.#paintItems();
                }
              },
            },
            h('span', { class: 'cursor', 'aria-hidden': 'true', text: '▶' }),
            h('span', { class: 'icon' }),
            h('span', { class: 'label' }),
          ),
        ),
      ),
    );
    this.#paintItems();
  }

  #paintItems() {
    const buttons = this.$items.querySelectorAll('.item');
    buttons.forEach((btn, i) => {
      const id = ITEMS[i].id;
      btn.setAttribute('aria-current', String(i === this.#cursor));
      const icon = /** @type {HTMLElement} */ (btn.querySelector('.icon'));
      const label = /** @type {HTMLElement} */ (btn.querySelector('.label'));
      const iconKey = id === 'sound' ? (this.#soundOn ? 'soundOn' : 'soundOff') : id;
      if (icon.dataset.icon !== iconKey) {
        icon.innerHTML = /** @type {Record<string,string>} */ (ICONS)[iconKey] ?? '';
        icon.dataset.icon = iconKey;
      }
      if (id === 'sound') label.replaceChildren('Sound: ', h('b', { class: 'value', text: this.#soundOn ? 'On' : 'Off' }));
      else if (id === 'clock') label.replaceChildren('Clock: ', h('b', { class: 'value', text: this.#clock }));
      else label.textContent = ITEMS[i].title;
    });
  }

  #buildControls() {
    /** @param {string[][]} groups */
    const keys = (groups) =>
      groups.flatMap((group, gi) => [
        gi > 0 ? h('span', { class: 'or', text: 'or' }) : null,
        ...group.map((k) => (k.startsWith('hold ') ? h('span', { text: k }) : h('kbd', { text: k }))),
      ]);
    this.$views.controls.replaceChildren(
      h(
        'section',
        { class: 'ctl' },
        h('h3', { text: 'Keyboard' }),
        h(
          'dl',
          {},
          CONTROLS.keyboard.map(([what, groups]) =>
            h('div', { class: 'row' }, h('dt', { text: what }), h('dd', {}, keys(/** @type {string[][]} */ (groups)))),
          ),
        ),
      ),
      h(
        'section',
        { class: 'ctl' },
        h('h3', { text: 'Controller' }),
        h(
          'dl',
          {},
          CONTROLS.gamepad.map(([what, groups]) =>
            h('div', { class: 'row' }, h('dt', { text: what }), h('dd', {}, keys(/** @type {string[][]} */ (groups)))),
          ),
        ),
      ),
      h(
        'section',
        { class: 'ctl' },
        h('h3', { text: 'Touch' }),
        h(
          'dl',
          {},
          CONTROLS.touch.map(([what, how]) => h('div', { class: 'row' }, h('dt', { text: what }), h('dd', { text: how }))),
        ),
      ),
    );
  }

  /** @param {string} element */
  #chip(element) {
    if (!element) return null;
    return h('span', { class: 'chip', style: `--chip: ${elementColor(element)}`, text: element });
  }

  /** @param {string} element */
  #badge(element, large = false) {
    return h('span', {
      class: `badge${large ? ' lg' : ''}`,
      style: `--chip: ${elementColor(element)}`,
      html: elementIcon(element),
      'aria-hidden': 'true',
    });
  }

  #renderPartner() {
    const view = this.$views.partner;
    if (!this.#party.length) {
      view.replaceChildren(
        h(
          'div',
          { class: 'empty' },
          h('span', { class: 'badge lg unknown', html: ICONS.silhouette, 'aria-hidden': 'true' }),
          h('p', { text: EMPTY_PARTNER_TEXT }),
        ),
      );
      return;
    }
    view.replaceChildren(
      ...this.#party.map((p, i) =>
        h(
          'article',
          { class: 'mon' },
          this.#badge(p.element, true),
          h(
            'div',
            {},
            h('p', { class: 'eyebrow', text: i === 0 ? 'Partner' : 'Companion' }),
            h('h3', { text: p.name }),
            this.#chip(p.element),
          ),
          p.blurb ? h('p', { class: 'blurb', text: p.blurb }) : null,
        ),
      ),
    );
  }

  #renderJournal() {
    const { seen, all } = this.#journal;
    const seenCount = all.filter((e) => seen.includes(e.id)).length;
    const grid = h(
      'div',
      { class: 'grid', role: 'listbox', 'aria-label': 'Wildlings' },
      all.map((entry, i) => {
        const known = seen.includes(entry.id);
        return h(
          'button',
          {
            class: 'tile',
            type: 'button',
            role: 'option',
            tabindex: '-1',
            'aria-selected': String(i === this.#journalCursor),
            'aria-label': known ? entry.name : 'Unknown wildling',
            onclick: () => {
              if (this.#journalCursor === i) return;
              this.#journalCursor = i;
              emitSfx(this, 'cursor');
              this.#paintJournal();
            },
          },
          h('span', { class: 'no', text: `No.${String(i + 1).padStart(2, '0')}` }),
          known
            ? this.#badge(entry.element)
            : h('span', { class: 'badge unknown', html: ICONS.silhouette, 'aria-hidden': 'true' }),
          h('span', { class: 'name', text: known ? entry.name : '???' }),
        );
      }),
    );
    this.$views.journal.replaceChildren(
      h('p', { class: 'count' }, 'Seen ', h('b', { text: String(seenCount) }), ` / ${all.length}`),
      all.length ? grid : h('p', { class: 'count', text: 'The journal is empty for now.' }),
      all.length ? h('div', { class: 'detail', 'aria-live': 'polite' }) : null,
    );
    this.#paintJournal();
  }

  #paintJournal() {
    const view = this.$views.journal;
    const tiles = view.querySelectorAll('.tile');
    tiles.forEach((tile, i) => tile.setAttribute('aria-selected', String(i === this.#journalCursor)));
    const entry = this.#journal.all[this.#journalCursor];
    const detail = view.querySelector('.detail');
    if (!detail || !entry) return;
    const known = this.#journal.seen.includes(entry.id);
    detail.replaceChildren(
      h('div', { class: 'row' }, h('h3', { text: known ? entry.name : '???' }), known ? this.#chip(entry.element) : null),
      h('p', {
        text: known ? entry.blurb || 'No notes yet.' : 'Not seen yet. Keep exploring — wildlings love quiet, leafy places.',
      }),
    );
    revealInContainer(this.$body, tiles[this.#journalCursor]);
  }

  // ── Navigation ───────────────────────────────────────────

  /** @param {MenuView} view */
  #showView(view) {
    this.#view = view;
    this.$items.hidden = view !== 'root';
    for (const [name, el] of Object.entries(this.$views)) el.hidden = name !== view;
    this.$back.hidden = view === 'root';
    this.$title.textContent = VIEW_TITLES[view];
    this.$body.scrollTop = 0;
    if (view === 'partner') this.#renderPartner();
    else if (view === 'journal') this.#renderJournal();
    else if (view === 'root') {
      this.#paintItems();
      revealInContainer(this.$body, this.$items.querySelectorAll('.item')[this.#cursor]);
    }
  }

  #back() {
    if (!this.#open || this.#view === 'root') return;
    emitSfx(this, 'cancel');
    this.#showView('root');
  }

  /** @param {string} id */
  #activate(id) {
    switch (id) {
      case 'partner':
      case 'journal':
      case 'controls':
        emitSfx(this, 'confirm');
        this.#showView(/** @type {MenuView} */ (id));
        break;
      case 'save':
        // The game plays its own save jingle.
        emit(this, 'menu-action', { action: 'save' });
        break;
      case 'sound':
        emit(this, 'menu-action', { action: 'sound' });
        emitSfx(this, 'confirm'); // audible only when sound just came back on
        break;
      case 'clock':
        emit(this, 'menu-action', { action: 'clock' });
        emitSfx(this, 'confirm');
        break;
      case 'close':
        emitSfx(this, 'cancel');
        emit(this, 'menu-action', { action: 'close' });
        this.close(); // no-op if the game already closed us
        break;
      default:
        break;
    }
  }

  /** @param {string} action @returns {boolean} consumed */
  #handle(action) {
    if (!this.#open) return false;
    if (action === 'start') {
      emitSfx(this, 'cancel');
      this.close();
      return true;
    }
    if (this.#view === 'root') {
      if (action === 'up' || action === 'down') {
        const n = ITEMS.length;
        this.#cursor = (this.#cursor + (action === 'up' ? -1 : 1) + n) % n;
        emitSfx(this, 'cursor');
        this.#paintItems();
        revealInContainer(this.$body, this.$items.querySelectorAll('.item')[this.#cursor]);
      } else if (action === 'a') {
        this.#activate(ITEMS[this.#cursor].id);
      } else if (action === 'b') {
        emitSfx(this, 'cancel');
        this.close();
      }
      return true;
    }
    if (action === 'b') {
      this.#back();
      return true;
    }
    if (this.#view === 'journal') {
      const n = this.#journal.all.length;
      if (n > 1 && action !== 'a') {
        const delta = action === 'up' || action === 'left' ? -1 : 1;
        this.#journalCursor = (this.#journalCursor + delta + n) % n;
        emitSfx(this, 'cursor');
        this.#paintJournal();
      }
      return true;
    }
    if (action === 'up' || action === 'down') {
      this.$body.scrollBy?.({ top: action === 'up' ? -72 : 72, behavior: 'smooth' });
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

define('pause-menu', PauseMenu);
