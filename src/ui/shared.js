/**
 * Small helpers shared by the UI components (not a component itself).
 * Everything that touches the DOM does so only when called, so this module —
 * and every component that imports it — loads cleanly in Node.
 */

/**
 * Base class for components: HTMLElement in browsers, an inert class in Node
 * so component modules can be imported by tests without a DOM.
 * @type {typeof HTMLElement}
 */
export const Base = /** @type {any} */ (globalThis).HTMLElement ?? class {};

/**
 * Register a custom element once (no-op without a custom element registry).
 * @param {string} tag
 * @param {CustomElementConstructor} ctor
 */
export function define(tag, ctor) {
  const registry = /** @type {any} */ (globalThis).customElements;
  if (!registry || registry.get(tag)) return;
  registry.define(tag, ctor);
}

/**
 * Ask the game to play a UI sound. Bubbles out of shadow roots to `document`.
 * @param {EventTarget} el
 * @param {'cursor'|'confirm'|'cancel'|'text'|'menu'} id
 */
export function emitSfx(el, id) {
  emit(el, 'ui-sfx', { id });
}

/**
 * Dispatch a bubbling, composed CustomEvent.
 * @param {EventTarget} el @param {string} type @param {unknown} [detail]
 */
export function emit(el, type, detail) {
  try {
    el.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  } catch (err) {
    console.error(`[ui] could not dispatch "${type}"`, err);
  }
}

/** @param {string} query @returns {boolean} */
export function mediaMatches(query) {
  try {
    return !!(/** @type {any} */ (globalThis).matchMedia?.(query)?.matches);
  } catch {
    return false;
  }
}

/** @returns {boolean} whether the primary pointer is a finger. */
export function isCoarsePointer() {
  return mediaMatches('(pointer: coarse)');
}

/**
 * Normalise dialog pages: string | string[] → non-empty strings.
 * @param {unknown} pages
 * @returns {string[]}
 */
export function toPages(pages) {
  const list = Array.isArray(pages) ? pages : [pages];
  return list
    .filter((p) => p !== null && p !== undefined)
    .map((p) => String(p))
    .filter((p) => p.trim().length > 0);
}

/**
 * Normalise body copy into paragraphs: string (blank-line separated) | string[].
 * @param {unknown} body
 * @returns {string[]}
 */
export function toParagraphs(body) {
  if (Array.isArray(body)) return toPages(body);
  if (body === null || body === undefined) return [];
  return String(body)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * CSS value for a wildling element colour token (`Ember` → `var(--el-ember, …)`).
 * @param {unknown} element
 */
export function elementColor(element) {
  const slug = String(element ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  return slug ? `var(--el-${slug}, var(--el-default))` : 'var(--el-default)';
}

/**
 * Resolve once `el` finishes a CSS transition (or after `fallbackMs`, whichever
 * comes first — transitions may be skipped when hidden or reduced).
 * @param {Element} el @param {number} fallbackMs
 * @returns {Promise<void>}
 */
export function afterTransition(el, fallbackMs) {
  return new Promise((resolve) => {
    let done = false;
    /** @param {Event} [e] */
    const finish = (e) => {
      if (done || (e && e.target !== el)) return;
      done = true;
      clearTimeout(timer);
      el.removeEventListener('transitionend', finish);
      resolve();
    };
    const timer = setTimeout(finish, Math.max(0, fallbackMs));
    el.addEventListener('transitionend', finish);
  });
}

/**
 * mousedown handler that keeps buttons from taking focus on click. The game is
 * driven through `input`, so a focused button would otherwise also "click" on
 * Space/Enter and double-activate. Clicks and taps still fire normally.
 * @param {Event} event
 */
export function keepFocusOffButtons(event) {
  const target = /** @type {any} */ (event.target);
  if (target && typeof target.closest === 'function' && target.closest('button')) event.preventDefault();
}

/**
 * Scroll `container` (only) so `el` is fully visible. Unlike scrollIntoView it
 * never scrolls overflow-hidden ancestors such as the HUD layer.
 * @param {Element} container @param {Element|null|undefined} el @param {number} [margin]
 */
export function revealInContainer(container, el, margin = 8) {
  if (!container || !el) return;
  const box = container.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  if (rect.top < box.top + margin) container.scrollTop -= box.top + margin - rect.top;
  else if (rect.bottom > box.bottom - margin) container.scrollTop += rect.bottom - (box.bottom - margin);
}

/**
 * Tiny element factory for shadow-DOM views. Text is always set as text.
 * @param {string} tag
 * @param {Record<string, unknown>} [props] class, text, html (trusted static markup only), on<event>, attributes
 * @param {...(Node|string|number|null|undefined|false|Array<any>)} children
 * @returns {HTMLElement}
 */
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), /** @type {EventListener} */ (value));
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'object' ? child : String(child));
  }
  return node;
}

/** Base styles every component's shadow root starts with. */
export const BASE_CSS = /* css */ `
  :host { box-sizing: border-box; }
  :host([hidden]) { display: none !important; }
  *, *::before, *::after { box-sizing: border-box; }
  [hidden] { display: none !important; }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0;
  }
  button {
    font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0;
    cursor: pointer; text-align: inherit;
    -webkit-tap-highlight-color: transparent; touch-action: manipulation;
  }
  button:focus-visible { outline: 3px solid var(--color-focus, #ffc56b); outline-offset: 2px; }
  svg { display: block; }
`;

/**
 * Paper panel look (cream paper, thick rounded ink border, soft shadow, inner
 * pencil line). Apply with class="paper".
 */
export const PAPER_CSS = /* css */ `
  .paper {
    position: relative;
    color: var(--color-ink, #2a2420);
    background: var(--panel-bg, #fbf6ea);
    border: var(--border-w, 3px) solid var(--color-ink, #2a2420);
    border-radius: var(--radius-lg, 20px);
    box-shadow: var(--shadow-panel, 0 4px 0 rgba(42, 36, 32, 0.4));
    color-scheme: light;
  }
  .paper::before {
    content: '';
    position: absolute;
    inset: var(--inner-line-inset, 5px);
    border: var(--border-w-thin, 2px) solid var(--panel-inner-line, #e0cfa9);
    border-radius: calc(var(--radius-lg, 20px) - var(--inner-line-inset, 5px));
    pointer-events: none;
  }
`;

/** Original element glyphs (24×24, stroke = currentColor). */
export const ELEMENT_ICONS = Object.freeze({
  ember:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c1 3.2 5 5.6 5 10a5 5 0 0 1-10 0c0-2.2 1.1-3.6 2.3-4.6.1 1.6.8 2.6 1.9 3.1C11 9.2 11.2 5.8 12 3z" fill="currentColor"/></svg>',
  tide:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5c2.6 3.6 5.5 7 5.5 10.3a5.5 5.5 0 0 1-11 0C6.5 10.5 9.4 7.1 12 3.5z" fill="currentColor"/><path d="M9.6 14.4a2.6 2.6 0 0 0 2.4 2.3" fill="none" style="stroke: var(--color-glyph-shade)" stroke-width="1.6" stroke-linecap="round"/></svg>',
  bloom:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19C5 10 10.5 5 19 5c0 8.5-5 14-14 14z" fill="currentColor"/><path d="M5.5 18.5L14 10" fill="none" style="stroke: var(--color-glyph-shade)" stroke-width="1.6" stroke-linecap="round"/></svg>',
  gust:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M3.5 9h10.5a3 3 0 1 0-3-3"/><path d="M3.5 13.5h14a3 3 0 1 1-3 3"/><path d="M3.5 18h6"/></svg>',
  default:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5.5" fill="currentColor"/></svg>',
});

/**
 * @param {unknown} element
 * @returns {string} static SVG markup for an element glyph
 */
export function elementIcon(element) {
  const slug = String(element ?? '').toLowerCase();
  return /** @type {Record<string,string>} */ (ELEMENT_ICONS)[slug] ?? ELEMENT_ICONS.default;
}
