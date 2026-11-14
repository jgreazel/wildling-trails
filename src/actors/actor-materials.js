/**
 * Shared look-and-feel for every actor: colour parsing helpers, the 3-step toon
 * gradient, the shared vertex-coloured toon / unlit / outline materials, and the
 * soft radial texture used for blob shadows and glows.
 *
 * Everything is created lazily on first use and cached for the whole session, so
 * importing this module from Node has no side effects. Shared resources are never
 * disposed by individual actors; per-instance materials are created through the
 * factories below and must be disposed by their owner.
 */
import * as THREE from 'three';

const HEX_RE = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Parse a colour leniently. Accepts THREE.Color, 0xRRGGBB numbers, '#rgb',
 * '#rrggbb', bare hex and CSS colour names. Anything else yields `fallback`
 * without logging (THREE.Color would warn on bad input).
 * @param {unknown} value
 * @param {THREE.ColorRepresentation} [fallback]
 * @returns {THREE.Color} a new Color in the working (linear) colour space
 */
export function toColor(value, fallback = '#ff00ff') {
  const c = new THREE.Color();
  if (value instanceof THREE.Color) return c.copy(value);
  if (typeof value === 'number' && Number.isFinite(value)) return c.setHex(value & 0xffffff);
  if (typeof value === 'string') {
    const v = value.trim();
    if (HEX_RE.test(v)) return c.setStyle(v.startsWith('#') ? v : `#${v}`);
    const named = THREE.Color.NAMES[/** @type {keyof typeof THREE.Color.NAMES} */ (v.toLowerCase())];
    if (named !== undefined) return c.setHex(named);
  }
  if (value !== fallback && fallback !== undefined) return toColor(fallback, '#ff00ff');
  return c.setHex(0xff00ff);
}

/**
 * Blend two colours in sRGB space (perceptually even).
 * @param {THREE.ColorRepresentation | THREE.Color} a
 * @param {THREE.ColorRepresentation | THREE.Color} b
 * @param {number} t 0 → a, 1 → b
 * @returns {THREE.Color}
 */
export function mixColor(a, b, t) {
  const ca = toColor(a).convertLinearToSRGB();
  const cb = toColor(b).convertLinearToSRGB();
  return ca.lerp(cb, t).convertSRGBToLinear();
}

/**
 * Darken (f < 1) or lighten (f > 1) a colour in sRGB space.
 * @param {THREE.ColorRepresentation | THREE.Color} color
 * @param {number} f
 * @returns {THREE.Color}
 */
export function shade(color, f) {
  if (f >= 1) return mixColor(color, '#ffffff', Math.min(1, f - 1));
  return mixColor(color, '#000000', Math.min(1, 1 - f));
}

/**
 * Perceptual-ish distance between two colours (0 … ~1.7) in sRGB space.
 * @param {THREE.Color} a @param {THREE.Color} b
 */
export function colorDistance(a, b) {
  const ca = a.clone().convertLinearToSRGB();
  const cb = b.clone().convertLinearToSRGB();
  return Math.hypot(ca.r - cb.r, ca.g - cb.g, ca.b - cb.b);
}

/** Dark warm ink used for outlines and pupils. */
export const INK = '#2b2024';

/** @type {THREE.DataTexture | null} */
let gradient = null;
/** @type {THREE.MeshToonMaterial | null} */
let toonVC = null;
/** @type {THREE.MeshBasicMaterial | null} */
let unlitVC = null;
/** @type {THREE.MeshBasicMaterial | null} */
let outline = null;
/** @type {THREE.DataTexture | null} */
let radial = null;
/** @type {THREE.MeshBasicMaterial | null} */
let blobMat = null;
/** @type {THREE.PlaneGeometry | null} */
let blobGeo = null;

/**
 * The shared 3-step toon ramp (shadow · mid · lit).
 * @returns {THREE.DataTexture}
 */
export function toonGradient() {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([104, 186, 255]), 3, 1, THREE.RedFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

/**
 * Shared toon material that takes its colour from vertex colours. All rigid,
 * non-glowing actor parts are baked into geometry that uses this material.
 * @returns {THREE.MeshToonMaterial}
 */
export function toonVertexMaterial() {
  if (!toonVC) {
    toonVC = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
    toonVC.name = 'actor-toon';
  }
  return toonVC;
}

/**
 * Shared unlit vertex-colour material for eyes and glints (they must read as
 * crisp black/white in any light).
 * @returns {THREE.MeshBasicMaterial}
 */
export function unlitVertexMaterial() {
  if (!unlitVC) {
    unlitVC = new THREE.MeshBasicMaterial({ vertexColors: true });
    unlitVC.name = 'actor-unlit';
  }
  return unlitVC;
}

/**
 * Shared inverted-hull outline material (back faces of a slightly inflated copy).
 * @returns {THREE.MeshBasicMaterial}
 */
export function outlineMaterial() {
  if (!outline) {
    outline = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
    outline.name = 'actor-outline';
  }
  return outline;
}

/**
 * Per-instance glowing toon material (ember tail tips, glassy shells). The
 * caller owns it and must dispose it.
 * @param {THREE.ColorRepresentation} color
 * @param {THREE.ColorRepresentation} emissive
 * @param {number} [intensity]
 * @returns {THREE.MeshToonMaterial}
 */
export function createGlowToonMaterial(color, emissive, intensity = 1) {
  const m = new THREE.MeshToonMaterial({
    color: toColor(color),
    emissive: toColor(emissive),
    emissiveIntensity: intensity,
    gradientMap: toonGradient(),
  });
  m.name = 'actor-glow';
  return m;
}

/**
 * Soft white radial falloff (alpha) — used for blob shadows and additive glows.
 * Built from raw pixels so it also works without a DOM.
 * @returns {THREE.DataTexture}
 */
export function radialTexture() {
  if (!radial) {
    const size = 64;
    const data = new Uint8Array(size * size * 4);
    const half = (size - 1) / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.min(1, Math.hypot(x - half, y - half) / half);
        const a = 1 - d;
        const soft = a * a * (3 - 2 * a);
        const i = (y * size + x) * 4;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = Math.round(soft * 255);
      }
    }
    radial = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    radial.magFilter = THREE.LinearFilter;
    radial.minFilter = THREE.LinearFilter;
    radial.generateMipmaps = false;
    radial.needsUpdate = true;
  }
  return radial;
}

/**
 * Per-instance additive glow sprite material. Caller disposes it.
 * @param {THREE.ColorRepresentation} color
 * @param {number} [opacity]
 * @returns {THREE.SpriteMaterial}
 */
export function createGlowSpriteMaterial(color, opacity = 0.6) {
  return new THREE.SpriteMaterial({
    map: radialTexture(),
    color: toColor(color),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

/**
 * Shared blob-shadow material (soft dark disc at the feet).
 * @returns {THREE.MeshBasicMaterial}
 */
export function blobShadowMaterial() {
  if (!blobMat) {
    blobMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      map: radialTexture(),
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    blobMat.name = 'actor-blob-shadow';
  }
  return blobMat;
}

/**
 * Shared unit plane lying in XZ (1 × 1, facing +y) for blob shadows.
 * @returns {THREE.PlaneGeometry}
 */
export function blobShadowGeometry() {
  if (!blobGeo) {
    blobGeo = new THREE.PlaneGeometry(1, 1);
    blobGeo.rotateX(-Math.PI / 2);
  }
  return blobGeo;
}
