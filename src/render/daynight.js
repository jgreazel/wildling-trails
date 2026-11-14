/**
 * Real-clock day/night lighting: owns the sun (shadow-casting DirectionalLight),
 * the hemisphere fill, scene background and fog. Phase changes, clock overrides
 * and indoor/outdoor switches blend smoothly between hand-tuned keyframes.
 */
import * as THREE from 'three';
import { PALETTE } from './palette.js';

/** Seconds a phase / override change takes to blend. */
export const BLEND_SECONDS = 2;

/** @typedef {'morning'|'day'|'evening'|'night'} TimePhase */

/** @type {ReadonlyArray<TimePhase>} */
export const TIME_PHASES = Object.freeze(['morning', 'day', 'evening', 'night']);

/**
 * Phase of the day for a wall-clock time: 5–10 morning, 10–17 day, 17–20 evening, 20–5 night.
 * @param {Date} [date]
 * @returns {TimePhase}
 */
export function getTimePhase(date = new Date()) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const h = d.getHours();
  if (h >= 5 && h < 10) return 'morning';
  if (h >= 10 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'evening';
  return 'night';
}

/**
 * @typedef {object} LightKeyDef
 * @property {string} sky       background colour
 * @property {string} fog       fog colour
 * @property {number} fogNear
 * @property {number} fogFar
 * @property {string} hemiSky
 * @property {string} hemiGround
 * @property {number} hemiIntensity
 * @property {string} sunColor
 * @property {number} sunIntensity
 * @property {[number, number, number]} sunDir  direction *toward* the sun
 * @property {number} night     0 day … 1 night (lamps/windows)
 * @property {number} exposure  tone-mapping exposure
 */

/** @type {Record<TimePhase, LightKeyDef>} */
const PHASE_DEFS = {
  morning: {
    sky: '#f4dcc4',
    fog: '#f1dcc7',
    fogNear: 20,
    fogFar: 54,
    hemiSky: '#ffe9cf',
    hemiGround: '#7f8a5c',
    hemiIntensity: 1.4,
    sunColor: '#ffd8a6',
    sunIntensity: 1.7,
    sunDir: [0.62, 0.6, 0.5],
    night: 0,
    exposure: 1.0,
  },
  day: {
    sky: '#bfe3ea',
    fog: '#c8e6e6',
    fogNear: 22,
    fogFar: 60,
    hemiSky: '#fff5e2',
    hemiGround: '#6f8f5a',
    hemiIntensity: 1.45,
    sunColor: '#fff2da',
    sunIntensity: 1.8,
    sunDir: [0.28, 0.84, 0.46],
    night: 0,
    exposure: 1.0,
  },
  evening: {
    sky: '#efa98b',
    fog: '#e6a68a',
    fogNear: 18,
    fogFar: 50,
    hemiSky: '#ffc7a3',
    hemiGround: '#6a5468',
    hemiIntensity: 1.25,
    sunColor: '#ff9d60',
    sunIntensity: 1.5,
    sunDir: [-0.64, 0.48, 0.6],
    night: 0.45,
    exposure: 1.0,
  },
  night: {
    sky: '#141a33',
    fog: '#18203d',
    fogNear: 14,
    fogFar: 44,
    hemiSky: '#9aaae0',
    hemiGround: PALETTE.nightAmbient,
    hemiIntensity: 1.1,
    sunColor: '#b4c4ff',
    sunIntensity: 0.6,
    sunDir: [-0.32, 0.82, 0.48],
    night: 1,
    exposure: 1.08,
  },
};

/** Warm, fixed interior lighting (no fog, very dark warm backdrop). */
const INDOOR_DEF = /** @type {LightKeyDef} */ ({
  sky: '#120c09',
  fog: '#120c09',
  fogNear: 60,
  fogFar: 120,
  hemiSky: '#ffe7c8',
  hemiGround: '#5b4232',
  hemiIntensity: 1.65,
  sunColor: '#ffe2bb',
  sunIntensity: 1.35,
  sunDir: [0.32, 0.86, 0.4],
  night: 0,
  exposure: 1.0,
});

/** Shadow frustum half-size outdoors / indoors (world units). */
const SHADOW_EXTENT = 16;
const SHADOW_EXTENT_INDOOR = 11;
const SUN_DISTANCE = 40;

/**
 * @typedef {object} LightKey
 * @property {THREE.Color} sky
 * @property {THREE.Color} fog
 * @property {number} fogNear
 * @property {number} fogFar
 * @property {THREE.Color} hemiSky
 * @property {THREE.Color} hemiGround
 * @property {number} hemiIntensity
 * @property {THREE.Color} sunColor
 * @property {number} sunIntensity
 * @property {THREE.Vector3} sunDir
 * @property {number} night
 * @property {number} exposure
 */

/** @param {LightKeyDef} d @returns {LightKey} */
function toKey(d) {
  return {
    sky: new THREE.Color(d.sky),
    fog: new THREE.Color(d.fog),
    fogNear: d.fogNear,
    fogFar: d.fogFar,
    hemiSky: new THREE.Color(d.hemiSky),
    hemiGround: new THREE.Color(d.hemiGround),
    hemiIntensity: d.hemiIntensity,
    sunColor: new THREE.Color(d.sunColor),
    sunIntensity: d.sunIntensity,
    sunDir: new THREE.Vector3(...d.sunDir).normalize(),
    night: d.night,
    exposure: d.exposure,
  };
}

/** @param {LightKey} out @param {LightKey} src */
function copyKey(out, src) {
  out.sky.copy(src.sky);
  out.fog.copy(src.fog);
  out.fogNear = src.fogNear;
  out.fogFar = src.fogFar;
  out.hemiSky.copy(src.hemiSky);
  out.hemiGround.copy(src.hemiGround);
  out.hemiIntensity = src.hemiIntensity;
  out.sunColor.copy(src.sunColor);
  out.sunIntensity = src.sunIntensity;
  out.sunDir.copy(src.sunDir);
  out.night = src.night;
  out.exposure = src.exposure;
  return out;
}

/** @param {number} a @param {number} b @param {number} t */
const mix = (a, b, t) => a + (b - a) * t;

/** @param {LightKey} out @param {LightKey} a @param {LightKey} b @param {number} t */
function lerpKey(out, a, b, t) {
  out.sky.lerpColors(a.sky, b.sky, t);
  out.fog.lerpColors(a.fog, b.fog, t);
  out.fogNear = mix(a.fogNear, b.fogNear, t);
  out.fogFar = mix(a.fogFar, b.fogFar, t);
  out.hemiSky.lerpColors(a.hemiSky, b.hemiSky, t);
  out.hemiGround.lerpColors(a.hemiGround, b.hemiGround, t);
  out.hemiIntensity = mix(a.hemiIntensity, b.hemiIntensity, t);
  out.sunColor.lerpColors(a.sunColor, b.sunColor, t);
  out.sunIntensity = mix(a.sunIntensity, b.sunIntensity, t);
  out.sunDir.lerpVectors(a.sunDir, b.sunDir, t);
  if (out.sunDir.lengthSq() < 1e-6) out.sunDir.set(0, 1, 0);
  out.sunDir.normalize();
  out.night = mix(a.night, b.night, t);
  out.exposure = mix(a.exposure, b.exposure, t);
  return out;
}

/** @type {Record<TimePhase, LightKey>|null} */
let phaseKeys = null;
/** @type {LightKey|null} */
let indoorKey = null;

function keys() {
  if (!phaseKeys) {
    phaseKeys = /** @type {Record<TimePhase, LightKey>} */ (
      Object.fromEntries(TIME_PHASES.map((p) => [p, toKey(PHASE_DEFS[p])]))
    );
    indoorKey = toKey(INDOOR_DEF);
  }
  return { phaseKeys, indoorKey: /** @type {LightKey} */ (indoorKey) };
}

/** @returns {boolean} */
function isCoarsePointer() {
  try {
    return !!globalThis.matchMedia?.('(pointer: coarse)')?.matches;
  } catch {
    return false;
  }
}

/** @param {number} t */
const smoothstep01 = (t) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/**
 * Create the day/night controller.
 * @param {{ scene: THREE.Scene, renderer?: any }} deps renderer may be a plain object in tests
 */
export function createDayNight({ scene, renderer } = /** @type {any} */ ({})) {
  if (!scene) throw new Error('createDayNight needs a scene');
  const { phaseKeys: PK, indoorKey: IK } = keys();

  const hemi = new THREE.HemisphereLight(0xffffff, 0x556655, 1.5);
  hemi.name = 'daynight:hemi';
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.name = 'daynight:sun';
  sun.castShadow = true;
  const mapSize = isCoarsePointer() ? 1024 : 2048;
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  const cam = /** @type {THREE.OrthographicCamera} */ (sun.shadow.camera);
  cam.near = 1;
  cam.far = SUN_DISTANCE * 2.2;
  setShadowExtent(SHADOW_EXTENT);
  scene.add(hemi, sun, sun.target);

  const fog = new THREE.Fog(0xc8e6e6, 22, 60);
  const background = new THREE.Color(0xbfe3ea);

  /** @type {TimePhase|null} */
  let override = null;
  /** @type {TimePhase} */
  let livePhase = getTimePhase();
  let clockTimer = 0;
  let indoor = false;

  const current = copyKey(toKey(PHASE_DEFS.day), PK[livePhase]);
  const from = copyKey(toKey(PHASE_DEFS.day), current);
  const target = copyKey(toKey(PHASE_DEFS.day), current);
  let blend = 1;
  /** @type {string} */
  let targetSig = '';

  const lastFocus = new THREE.Vector3();
  const snapped = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const WORLD_UP = new THREE.Vector3(0, 1, 0);
  const ALT_UP = new THREE.Vector3(0, 0, -1);

  /** @param {number} extent */
  function setShadowExtent(extent) {
    if (cam.right === extent) return;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.updateProjectionMatrix();
  }

  /** @returns {TimePhase} */
  function phase() {
    return override ?? livePhase;
  }

  /** Recompute the target keyframe; returns true when it changed. */
  function refreshTarget() {
    const p = phase();
    const sig = `${p}|${indoor}`;
    if (sig === targetSig) return false;
    targetSig = sig;
    copyKey(target, indoor ? IK : PK[p]);
    target.night = PK[p].night;
    return true;
  }

  /** @param {boolean} instant */
  function retarget(instant) {
    if (!refreshTarget()) return;
    copyKey(from, current);
    blend = instant ? 1 : 0;
    if (instant) copyKey(current, target);
  }

  /** Push the current keyframe into scene / lights / renderer. */
  function apply() {
    if (scene.background !== background) scene.background = background;
    background.copy(current.sky);
    if (indoor) {
      if (scene.fog) scene.fog = null;
    } else {
      if (scene.fog !== fog) scene.fog = fog;
      fog.color.copy(current.fog);
      fog.near = current.fogNear;
      fog.far = current.fogFar;
    }
    hemi.color.copy(current.hemiSky);
    hemi.groundColor.copy(current.hemiGround);
    hemi.intensity = current.hemiIntensity;
    sun.color.copy(current.sunColor);
    sun.intensity = current.sunIntensity;
    if (renderer && typeof renderer === 'object' && typeof renderer.toneMappingExposure === 'number') {
      renderer.toneMappingExposure = current.exposure;
    }
    placeSun();
  }

  /** Keep the shadow frustum centred on the focus, snapped to shadow texels to avoid shimmer. */
  function placeSun() {
    const dir = current.sunDir;
    const extent = indoor ? SHADOW_EXTENT_INDOOR : SHADOW_EXTENT;
    setShadowExtent(extent);
    right.crossVectors(Math.abs(dir.y) > 0.98 ? ALT_UP : WORLD_UP, dir);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    up.crossVectors(dir, right).normalize();
    const texel = (extent * 2) / mapSize;
    const u = lastFocus.dot(right);
    const v = lastFocus.dot(up);
    snapped
      .copy(lastFocus)
      .addScaledVector(right, Math.round(u / texel) * texel - u)
      .addScaledVector(up, Math.round(v / texel) * texel - v);
    sun.target.position.copy(snapped);
    sun.position.copy(snapped).addScaledVector(dir, SUN_DISTANCE);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }

  // First frame should already be correct — no blend from nothing.
  refreshTarget();
  copyKey(current, target);
  copyKey(from, target);
  apply();

  return {
    /**
     * Advance blending, follow the focus with the shadow camera, apply lighting.
     * @param {number} dt seconds
     * @param {THREE.Vector3|{x:number,y:number,z:number}} [focus]
     */
    update(dt, focus) {
      const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
      if (focus && Number.isFinite(focus.x) && Number.isFinite(focus.y) && Number.isFinite(focus.z)) {
        lastFocus.set(focus.x, focus.y, focus.z);
      }
      clockTimer -= step;
      if (clockTimer <= 0) {
        clockTimer = 1;
        livePhase = getTimePhase();
      }
      retarget(false);
      if (blend < 1) {
        blend = Math.min(1, blend + step / BLEND_SECONDS);
        lerpKey(current, from, target, smoothstep01(blend));
      }
      apply();
    },

    /**
     * Switch to warm interior lighting (no fog) or back to the sky. Snaps — map
     * changes happen behind a fade.
     * @param {boolean} value
     */
    setIndoor(value) {
      const next = !!value;
      if (next === indoor) return;
      indoor = next;
      retarget(true);
      apply();
    },

    /**
     * Force a phase (from the pause menu / T key) or return to the live clock.
     * @param {TimePhase|null} value
     */
    setOverride(value) {
      const next = value && TIME_PHASES.includes(/** @type {TimePhase} */ (value)) ? /** @type {TimePhase} */ (value) : null;
      if (next === override) return;
      override = next;
      if (!override) livePhase = getTimePhase();
      retarget(false);
    },

    /** @returns {TimePhase|null} */
    get override() {
      return override;
    },
    /** @returns {TimePhase} current target phase (live clock or override) */
    get phase() {
      return phase();
    },
    /** @returns {number} 0 day … 1 night, smoothed */
    get nightFactor() {
      return current.night;
    },
    /** @returns {boolean} */
    get isNight() {
      return phase() === 'night';
    },
    /** @returns {boolean} */
    get indoor() {
      return indoor;
    },
    /** The shadow-casting sun / moon light. */
    get sun() {
      return sun;
    },
    /** The hemisphere fill light. */
    get hemi() {
      return hemi;
    },
    /** Remove lights from the scene and free the shadow map. */
    dispose() {
      scene.remove(hemi, sun, sun.target);
      if (scene.fog === fog) scene.fog = null;
      sun.shadow.map?.dispose();
      sun.dispose?.();
      hemi.dispose?.();
    },
  };
}
