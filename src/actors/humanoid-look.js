/**
 * Humanoid `look` vocabulary, defaults, and body proportions per build.
 * `normalizeLook` turns any (possibly partial or invalid) look object into a
 * complete, validated one so the model builder never has to guess.
 */
import * as THREE from 'three';
import { toColor, colorDistance } from './actor-materials.js';

/** Contract `look.hairStyle` values (`cap`/`beanie` use `look.hat`). @type {ReadonlyArray<string>} */
export const HAIR_STYLES = Object.freeze(['short', 'long', 'ponytail', 'bun', 'spiky', 'bald', 'bob', 'cap', 'beanie']);
/** Contract `look.outfit` values (null = plain shirt and trousers). @type {ReadonlyArray<string|null>} */
export const OUTFITS = Object.freeze([null, 'labcoat', 'apron', 'overalls', 'jacket', 'dress']);
/** Contract `look.build` values. @type {ReadonlyArray<string>} */
export const BUILDS = Object.freeze(['adult', 'kid', 'elder']);
/** Contract `look.accessory` values (held items go in the right hand). @type {ReadonlyArray<string|null>} */
export const ACCESSORIES = Object.freeze([null, 'glasses', 'scarf', 'backpack', 'fishing-rod', 'cane', 'watering-can']);

const OUTFIT_COLORS = {
  labcoat: '#f4f1e8',
  apron: '#e8d2a4',
  overalls: '#4f6d8f',
  jacket: '#7d5a7a',
  dress: '#c8643b',
};

const ACCESSORY_COLORS = {
  glasses: '#3a3340',
  scarf: '#c84b4b',
  backpack: '#d9a441',
  'fishing-rod': '#7a5236',
  cane: '#7a5236',
  'watering-can': '#6fa59a',
};

/**
 * @typedef {object} BuildParams
 * @property {number} legH   hip joint height
 * @property {number} hipW
 * @property {number} torsoH
 * @property {number} torsoW
 * @property {number} torsoD
 * @property {number} headR
 * @property {number} armLen
 * @property {number} armR
 * @property {number} legR
 * @property {number} shoeH
 * @property {number} shoeL
 * @property {number} neck
 * @property {number} hunch  forward lean of the spine (rad)
 * @property {number} amp    walk swing multiplier
 * @property {number} outline outline thickness
 * @property {number} eye    eye size multiplier
 * @property {number} item   held-item size multiplier
 */

/** @type {Readonly<Record<string, BuildParams>>} */
export const BUILD_PARAMS = Object.freeze({
  adult: {
    legH: 0.27, hipW: 0.29, torsoH: 0.3, torsoW: 0.33, torsoD: 0.215, headR: 0.215,
    armLen: 0.25, armR: 0.052, legR: 0.062, shoeH: 0.065, shoeL: 0.15, neck: 0.012,
    hunch: 0, amp: 1, outline: 0.011, eye: 1, item: 1,
  },
  kid: {
    legH: 0.175, hipW: 0.24, torsoH: 0.205, torsoW: 0.27, torsoD: 0.185, headR: 0.188,
    armLen: 0.18, armR: 0.046, legR: 0.054, shoeH: 0.058, shoeL: 0.125, neck: 0.008,
    hunch: 0, amp: 1.1, outline: 0.01, eye: 1.12, item: 0.82,
  },
  elder: {
    legH: 0.24, hipW: 0.29, torsoH: 0.28, torsoW: 0.34, torsoD: 0.235, headR: 0.205,
    armLen: 0.235, armR: 0.052, legR: 0.06, shoeH: 0.062, shoeL: 0.145, neck: 0.01,
    hunch: 0.2, amp: 0.72, outline: 0.011, eye: 0.9, item: 1,
  },
});

/**
 * @typedef {object} Look
 * @property {THREE.Color} skin
 * @property {THREE.Color} hair
 * @property {string} hairStyle
 * @property {THREE.Color} hat
 * @property {THREE.Color} shirt
 * @property {THREE.Color} pants
 * @property {THREE.Color} shoes
 * @property {string|null} outfit
 * @property {THREE.Color} outfitColor
 * @property {string} build
 * @property {string|null} accessory
 * @property {THREE.Color} accessoryColor
 * @property {THREE.Color} inner  shirt colour shown inside an open jacket/coat
 */

/**
 * @param {unknown} v @param {ReadonlyArray<string|null>} list @param {string|null} fallback
 */
function pick(v, list, fallback) {
  if (typeof v !== 'string') return fallback;
  const key = v.trim().toLowerCase();
  return list.includes(key) ? key : fallback;
}

/**
 * Fill in and validate a look. Never throws, never logs.
 * @param {unknown} raw
 * @returns {Look}
 */
export function normalizeLook(raw) {
  const look = raw && typeof raw === 'object' ? /** @type {Record<string, any>} */ (raw) : {};
  const build = /** @type {string} */ (pick(look.build, BUILDS, 'adult'));
  const hairStyle = /** @type {string} */ (pick(look.hairStyle, HAIR_STYLES, 'short'));
  const outfit = pick(look.outfit, OUTFITS, null);
  const accessory = pick(look.accessory, ACCESSORIES, null);

  const skin = toColor(look.skin, '#f0c8a0');
  const hair = toColor(look.hair, build === 'elder' ? '#c9c3b8' : '#5a3a26');
  const shirt = toColor(look.shirt, '#7aa6c2');
  const pantsFallback = outfit === 'dress' ? '#' + skin.getHexString(THREE.SRGBColorSpace) : '#3d4a5c';
  const pants = toColor(look.pants, pantsFallback);
  const shoes = toColor(look.shoes, '#5a4032');
  const hat = toColor(look.hat, '#4f6d8f');
  const outfitColor = toColor(look.outfitColor, outfit ? OUTFIT_COLORS[outfit] : '#7d5a7a');
  const accessoryColor = toColor(look.accessoryColor, accessory ? ACCESSORY_COLORS[accessory] : '#7a5236');
  const inner = colorDistance(shirt, outfitColor) < 0.18 ? toColor('#efe6d2') : shirt.clone();

  return { skin, hair, hairStyle, hat, shirt, pants, shoes, outfit, outfitColor, build, accessory, accessoryColor, inner };
}
