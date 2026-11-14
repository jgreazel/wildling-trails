/**
 * Diorama camera rig: critically damped follow from south-above (outdoor),
 * room framing with clamped follow (indoor) and a slow orbit (title).
 * `focus` is the smoothed look-at point — read it, never replace it.
 */
import * as THREE from 'three';

/** @typedef {'outdoor'|'indoor'|'title'} CameraMode */
/** @typedef {{minX:number, maxX:number, minZ:number, maxZ:number}} Bounds */

/** Camera offset from the focus outdoors (south and above). */
export const OUTDOOR_OFFSET = Object.freeze({ x: 0, y: 8.5, z: 7.5 });
/** Camera offset from the focus indoors (a little closer). */
export const INDOOR_OFFSET = Object.freeze({ x: 0, y: 7.1, z: 6.3 });
const TITLE_RADIUS = 16;
const TITLE_HEIGHT = 11;
const TITLE_SPEED = 0.055; // rad/s

/** Look a little north of (ahead of) the player and at chest height. */
const OUTDOOR_LOOK = Object.freeze({ y: 0.4, z: -0.45 });
const INDOOR_LOOK = Object.freeze({ y: 0.55, z: -0.25 });

/** Smoothing times (seconds) for the focus point per mode, and for offset changes. */
const FOCUS_SMOOTH = Object.freeze({ outdoor: 0.16, indoor: 0.22, title: 0.9 });
const OFFSET_SMOOTH = 0.55;

/**
 * Critically damped spring step (Game Programming Gems 4, "SmoothDamp").
 * @param {number} current @param {number} target @param {{v:number}} vel
 * @param {number} smoothTime @param {number} dt
 */
export function smoothDamp(current, target, vel, smoothTime, dt) {
  const st = Math.max(0.0001, smoothTime);
  const omega = 2 / st;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (vel.v + omega * change) * dt;
  vel.v = (vel.v - omega * temp) * exp;
  let out = target + (change + temp) * exp;
  // Prevent overshoot.
  if ((target - current > 0) === (out > target)) {
    out = target;
    vel.v = 0;
  }
  return out;
}

/** @param {unknown} v */
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * @param {THREE.PerspectiveCamera} camera
 */
export function createCameraRig(camera) {
  const focus = new THREE.Vector3();
  const target = new THREE.Vector3();
  const offset = new THREE.Vector3(OUTDOOR_OFFSET.x, OUTDOOR_OFFSET.y, OUTDOOR_OFFSET.z);
  const desiredFocus = new THREE.Vector3();
  const desiredOffset = new THREE.Vector3();
  const center = new THREE.Vector3();
  const fv = { x: { v: 0 }, y: { v: 0 }, z: { v: 0 } };
  const ov = { x: { v: 0 }, y: { v: 0 }, z: { v: 0 } };
  /** @type {CameraMode} */
  let mode = 'outdoor';
  /** @type {Bounds|null} */
  let bounds = null;
  let hasCenter = false;
  let orbit = 0;

  /** Visible half extents on the ground around the focus for the given offset. */
  function visibleHalfExtents(off) {
    const dist = Math.hypot(off.x, off.y, off.z) || 1;
    const fov = THREE.MathUtils.degToRad(camera?.fov || 38);
    const halfH = Math.tan(fov / 2) * dist;
    const aspect = camera?.aspect > 0 ? camera.aspect : 16 / 9;
    const pitch = Math.atan2(off.y, Math.hypot(off.x, off.z) || 1e-3);
    return { halfW: halfH * aspect, halfD: halfH / Math.max(0.3, Math.sin(pitch)) };
  }

  /**
   * Centre an axis when the room fits, otherwise follow the target clamped to the room.
   * @param {number} t target coordinate @param {number} min @param {number} max
   * @param {number} half visible half-extent @param {number} margin
   */
  function frameAxis(t, min, max, half, margin) {
    const mid = (min + max) / 2;
    if ((max - min) / 2 + margin <= half) return mid;
    const lo = min + half - margin;
    const hi = max - half + margin;
    if (lo > hi) return mid;
    return Math.min(hi, Math.max(lo, t));
  }

  function computeDesired() {
    if (mode === 'title') {
      const c = hasCenter ? center : target;
      desiredFocus.copy(c);
      desiredOffset.set(Math.sin(orbit) * TITLE_RADIUS, TITLE_HEIGHT, Math.cos(orbit) * TITLE_RADIUS);
      return;
    }
    if (mode === 'indoor') {
      desiredOffset.set(INDOOR_OFFSET.x, INDOOR_OFFSET.y, INDOOR_OFFSET.z);
      desiredFocus.set(target.x, target.y + INDOOR_LOOK.y, target.z + INDOOR_LOOK.z);
      if (bounds) {
        const { halfW, halfD } = visibleHalfExtents(desiredOffset);
        desiredFocus.x = frameAxis(desiredFocus.x, bounds.minX, bounds.maxX, halfW, 0.6);
        desiredFocus.z = frameAxis(desiredFocus.z, bounds.minZ, bounds.maxZ, halfD * 0.92, 0.9);
      }
      return;
    }
    desiredOffset.set(OUTDOOR_OFFSET.x, OUTDOOR_OFFSET.y, OUTDOOR_OFFSET.z);
    desiredFocus.set(target.x, target.y + OUTDOOR_LOOK.y, target.z + OUTDOOR_LOOK.z);
  }

  function applyCamera() {
    if (!camera) return;
    camera.position.copy(focus).add(offset);
    camera.lookAt(focus);
  }

  /** @param {any} b @returns {Bounds|null} */
  function readBounds(b) {
    if (!b || ![b.minX, b.maxX, b.minZ, b.maxZ].every(finite)) return null;
    return {
      minX: Math.min(b.minX, b.maxX),
      maxX: Math.max(b.minX, b.maxX),
      minZ: Math.min(b.minZ, b.maxZ),
      maxZ: Math.max(b.minZ, b.maxZ),
    };
  }

  return {
    /** Smoothed look-at point (shared object; read it, don't replace it). */
    focus,

    /** @returns {CameraMode} */
    get mode() {
      return mode;
    },

    /**
     * @param {CameraMode} next
     * @param {{ center?: {x:number,y:number,z:number}, bounds?: Bounds }} [opts]
     */
    setMode(next, opts = {}) {
      mode = next === 'indoor' || next === 'title' ? next : 'outdoor';
      bounds = readBounds(opts?.bounds);
      const c = opts?.center;
      hasCenter = !!c && finite(c.x) && finite(c.y) && finite(c.z);
      if (hasCenter) center.set(c.x, c.y, c.z);
      if (mode === 'title') {
        // Start the orbit from wherever the camera currently is for a seamless sweep.
        const base = hasCenter ? center : target;
        orbit = Math.atan2(offset.x + focus.x - base.x, offset.z + focus.z - base.z) || 0;
      }
    },

    /** @param {{x:number, y:number, z:number}} p world position to follow */
    setTarget(p) {
      if (!p) return;
      target.set(finite(p.x) ? p.x : target.x, finite(p.y) ? p.y : target.y, finite(p.z) ? p.z : target.z);
    },

    /** Jump straight to the desired framing (after a warp / map load). */
    snap() {
      computeDesired();
      focus.copy(desiredFocus);
      offset.copy(desiredOffset);
      fv.x.v = fv.y.v = fv.z.v = 0;
      ov.x.v = ov.y.v = ov.z.v = 0;
      applyCamera();
    },

    /** @param {number} dt seconds */
    update(dt) {
      const step = finite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
      if (mode === 'title') orbit += step * TITLE_SPEED;
      computeDesired();
      if (step > 0) {
        const fs = FOCUS_SMOOTH[mode];
        focus.set(
          smoothDamp(focus.x, desiredFocus.x, fv.x, fs, step),
          smoothDamp(focus.y, desiredFocus.y, fv.y, fs, step),
          smoothDamp(focus.z, desiredFocus.z, fv.z, fs, step),
        );
        offset.set(
          smoothDamp(offset.x, desiredOffset.x, ov.x, OFFSET_SMOOTH, step),
          smoothDamp(offset.y, desiredOffset.y, ov.y, OFFSET_SMOOTH, step),
          smoothDamp(offset.z, desiredOffset.z, ov.z, OFFSET_SMOOTH, step),
        );
      }
      applyCamera();
    },
  };
}
