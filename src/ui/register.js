/**
 * Registers every UI custom element. Import once from main.js:
 *   import './ui/register.js';
 * Safe to import in Node (definitions are skipped without a DOM).
 */
import './dialog-box.js';
import './location-banner.js';
import './fade-overlay.js';
import './story-card.js';
import './title-screen.js';
import './pause-menu.js';
import './touch-pad.js';

/** Tags defined by this module, in HUD stacking order (bottom → top). */
export const UI_TAGS = Object.freeze([
  'dialog-box',
  'touch-pad',
  'pause-menu',
  'location-banner',
  'story-card',
  'title-screen',
  'fade-overlay',
]);
