/**
 * Shared toon shading kit: the stepped gradient texture, cached material
 * factories (global and per-map "kits" that can be disposed together) and
 * deterministic hash / noise helpers used for hand-painted variation.
 *
 * Nothing here touches the DOM; textures are created lazily on first use.
 */
import * as THREE from 'three';

/** Brightness of each toon band, darkest (facing away from light) → lit. */
export const TOON_STEPS = Object.freeze([0.3, 0.56, 0.82, 1.0]);

/** @type {THREE.DataTexture|null} */
let gradientTexture = null;

/**
 * The shared stepped gradient for MeshToonMaterial (NearestFilter, never disposed).
 * @returns {THREE.DataTexture}
 */
export function getToonGradient() {
  if (gradientTexture) return gradientTexture;
  const data = new Uint8Array(TOON_STEPS.map((v) => Math.round(v * 255)));
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  gradientTexture = tex;
  return tex;
}

/** @type {Map<string, THREE.Color>} */
const colorCache = new Map();

/**
 * Cached, read-only THREE.Color for a hex string / number. Never mutate the result.
 * @param {THREE.ColorRepresentation} hex
 * @returns {THREE.Color}
 */
export function color(hex) {
  const key = String(hex);
  let c = colorCache.get(key);
  if (!c) {
    c = new THREE.Color(hex);
    colorCache.set(key, c);
  }
  return c;
}

/**
 * Parse a user colour (from map data) safely; falls back when invalid.
 * @param {unknown} value
 * @param {THREE.ColorRepresentation} fallback
 * @returns {THREE.Color}
 */
export function safeColor(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return color(value);
  if (typeof value === 'string' && /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value.trim())) {
    const v = value.trim();
    return color(v.startsWith('#') ? v : `#${v}`);
  }
  return color(fallback);
}

/**
 * @typedef {object} ToonOptions
 * @property {boolean} [vertexColors]
 * @property {THREE.ColorRepresentation} [emissive]
 * @property {number} [emissiveIntensity]
 * @property {boolean} [transparent]
 * @property {number} [opacity]
 * @property {boolean} [doubleSide]
 * @property {boolean} [depthWrite]
 */

/** @param {THREE.ColorRepresentation} c @param {ToonOptions} opts */
function makeToon(c, opts) {
  const m = new THREE.MeshToonMaterial({
    color: c,
    gradientMap: getToonGradient(),
    vertexColors: !!opts.vertexColors,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (opts.depthWrite === false) m.depthWrite = false;
  return m;
}

/** @param {THREE.ColorRepresentation} c @param {number} intensity @param {ToonOptions} opts */
function makeGlow(c, intensity, opts) {
  return makeToon(opts.base ?? c, { ...opts, emissive: c, emissiveIntensity: intensity });
}

/** @param {string} kind @param {THREE.ColorRepresentation} c @param {object} opts */
function keyOf(kind, c, opts) {
  return `${kind}|${new THREE.Color(c).getHexString()}|${JSON.stringify(opts ?? {})}`;
}

/** @type {Map<string, THREE.Material>} */
const globalCache = new Map();

/**
 * Global cached toon material (shared by every module; never dispose it).
 * @param {THREE.ColorRepresentation} c
 * @param {ToonOptions} [opts]
 * @returns {THREE.MeshToonMaterial}
 */
export function toon(c, opts = {}) {
  const key = keyOf('toon', c, opts);
  let m = globalCache.get(key);
  if (!m) {
    m = makeToon(c, opts);
    globalCache.set(key, m);
  }
  return /** @type {THREE.MeshToonMaterial} */ (m);
}

/**
 * Global cached emissive toon material (e.g. lantern glass, embers).
 * @param {THREE.ColorRepresentation} c emissive colour
 * @param {number} [intensity]
 * @param {ToonOptions & {base?: THREE.ColorRepresentation}} [opts]
 * @returns {THREE.MeshToonMaterial}
 */
export function glow(c, intensity = 1, opts = {}) {
  const key = keyOf(`glow:${intensity}`, c, opts);
  let m = globalCache.get(key);
  if (!m) {
    m = makeGlow(c, intensity, opts);
    globalCache.set(key, m);
  }
  return /** @type {THREE.MeshToonMaterial} */ (m);
}

/**
 * A disposable material cache: everything created through a kit is freed by
 * `kit.dispose()`. Used per map so switching maps releases GPU programs/buffers.
 */
export function createMaterialKit() {
  /** @type {Map<string, THREE.Material>} */
  const cache = new Map();
  /** @type {Set<THREE.Material>} */
  const owned = new Set();

  /** @template {THREE.Material} M @param {string} key @param {() => M} make @returns {M} */
  function cached(key, make) {
    let m = cache.get(key);
    if (!m) {
      m = make();
      cache.set(key, m);
      owned.add(m);
    }
    return /** @type {M} */ (m);
  }

  return {
    /** @param {THREE.ColorRepresentation} c @param {ToonOptions} [opts] */
    toon: (c, opts = {}) => cached(keyOf('toon', c, opts), () => makeToon(c, opts)),
    /** @param {THREE.ColorRepresentation} c @param {number} [intensity] @param {ToonOptions & {base?: THREE.ColorRepresentation}} [opts] */
    glow: (c, intensity = 1, opts = {}) => cached(keyOf(`glow:${intensity}`, c, opts), () => makeGlow(c, intensity, opts)),
    /** Unlit material (screens, flames). @param {THREE.ColorRepresentation} c @param {{vertexColors?: boolean, transparent?: boolean, opacity?: number}} [opts] */
    basic: (c, opts = {}) =>
      cached(keyOf('basic', c, opts), () => new THREE.MeshBasicMaterial({
        color: c,
        vertexColors: !!opts.vertexColors,
        transparent: !!opts.transparent,
        opacity: opts.opacity ?? 1,
      })),
    /**
     * Take ownership of a hand-made material so dispose() frees it.
     * @template {THREE.Material} M @param {M} material @returns {M}
     */
    own(material) {
      owned.add(material);
      return material;
    },
    /** Number of live materials owned by this kit. */
    get size() {
      return owned.size;
    },
    /** Dispose every material created or owned by this kit. */
    dispose() {
      for (const m of owned) {
        try {
          m.dispose();
        } catch {
          /* already gone */
        }
      }
      owned.clear();
      cache.clear();
    },
  };
}

/** @typedef {ReturnType<typeof createMaterialKit>} MaterialKit */

// ---------------------------------------------------------------------------
// Deterministic hash / noise helpers
// ---------------------------------------------------------------------------

/**
 * Hash two integers (+ seed) to a float in [0, 1). Non-integers are rounded.
 * @param {number} x @param {number} y @param {number} [seed]
 */
export function hash2(x, y, seed = 0) {
  let h = Math.imul(Math.round(x) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(y) | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x2545f491);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Hash three integers to [0, 1).
 * @param {number} x @param {number} y @param {number} z @param {number} [seed]
 */
export function hash3(x, y, z, seed = 0) {
  return hash2(x, Math.imul(Math.round(y) | 0, 31) ^ Math.round(z * 7919), seed);
}

/**
 * FNV-1a hash of a string → unsigned 32-bit int.
 * @param {string} str
 */
export function hashString(str) {
  let h = 0x811c9dc5;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Seeded PRNG (mulberry32) → function returning floats in [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {number} t */
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Smooth 2D value noise in [0, 1).
 * @param {number} x @param {number} y @param {number} [seed]
 */
export function noise2(x, y, seed = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/**
 * Two-octave value noise in [0, 1).
 * @param {number} x @param {number} y @param {number} [seed]
 */
export function fbm2(x, y, seed = 0) {
  return (noise2(x, y, seed) * 2 + noise2(x * 2.13 + 7.1, y * 2.13 - 3.3, seed + 17)) / 3;
}

/**
 * Write `base` scaled by a brightness factor (1 + (t - 0.5) * amount) into `out`.
 * @param {THREE.Color} out @param {THREE.Color} base @param {number} t 0..1 @param {number} amount
 * @returns {THREE.Color}
 */
export function vary(out, base, t, amount) {
  const k = 1 + (t - 0.5) * amount;
  return out.setRGB(base.r * k, base.g * k, base.b * k);
}
