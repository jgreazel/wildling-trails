/**
 * Painter: a tiny immediate-mode modelling API over a BatchSet. Every primitive
 * is placed by its centre in the painter's local frame (an object's footprint
 * centre at ground level, rotated by its facing) and appended to the batch of
 * the painter's material key.
 */
import * as THREE from 'three';
import { SHAPES } from './shapes.js';
import { color as cachedColor } from '../../render/materials.js';

const _local = new THREE.Matrix4();
const _world = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * Rotation: a number (yaw) or Euler angles (applied z, then x, then yaw).
 * @typedef {number | {x?: number, y?: number, z?: number} | undefined} Rot
 */

/**
 * @typedef {import('./batch.js').ColorSource | string | number} PaintColor
 */

/** @param {PaintColor} c */
function toColor(c) {
  if (c === null || c === undefined) return null;
  if (typeof c === 'string' || typeof c === 'number') return cachedColor(c);
  return c;
}

/** @param {Rot} rot */
function setEuler(rot) {
  if (typeof rot === 'number') _euler.set(0, rot, 0, 'YXZ');
  else if (rot) _euler.set(rot.x ?? 0, rot.y ?? 0, rot.z ?? 0, 'YXZ');
  else _euler.set(0, 0, 0, 'YXZ');
  return _quat.setFromEuler(_euler);
}

export class Painter {
  /**
   * @param {import('./batch.js').BatchSet} set
   * @param {string} key material key
   * @param {THREE.Matrix4} [base] local → world transform
   */
  constructor(set, key, base) {
    this.set = set;
    this.key = key;
    this.base = base ? base.clone() : new THREE.Matrix4();
  }

  /** Same frame, different material batch. @param {string} key */
  mat(key) {
    return new Painter(this.set, key, this.base);
  }

  /** World position of a local point. @param {number} x @param {number} y @param {number} z */
  world(x, y, z) {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.base);
  }

  /**
   * Nested frame: translate / rotate / scale relative to this painter.
   * @param {number} x @param {number} y @param {number} z @param {Rot} [rot] @param {number} [s]
   */
  frame(x, y, z, rot, s = 1) {
    _local.compose(_pos.set(x, y, z), setEuler(rot), _scale.set(s, s, s));
    return new Painter(this.set, this.key, new THREE.Matrix4().multiplyMatrices(this.base, _local));
  }

  /**
   * Append any template with explicit transform.
   * @param {THREE.BufferGeometry} geo
   * @param {number} x @param {number} y @param {number} z
   * @param {number} sx @param {number} sy @param {number} sz
   * @param {PaintColor} c @param {Rot} [rot]
   */
  geo(geo, x, y, z, sx, sy, sz, c, rot) {
    _local.compose(_pos.set(x, y, z), setEuler(rot), _scale.set(sx, sy, sz));
    _world.multiplyMatrices(this.base, _local);
    this.set.get(this.key).add(geo, _world, /** @type {any} */ (toColor(c)));
    return this;
  }

  /** Box centred at (x, y, z). @param {number} w @param {number} h @param {number} d @param {number} x @param {number} y @param {number} z @param {PaintColor} c @param {Rot} [rot] */
  box(w, h, d, x, y, z, c, rot) {
    return this.geo(SHAPES.box(), x, y, z, w, h, d, c, rot);
  }

  /** Box whose bottom sits at y. @param {number} w @param {number} h @param {number} d @param {number} x @param {number} y @param {number} z @param {PaintColor} c @param {Rot} [rot] */
  block(w, h, d, x, y, z, c, rot) {
    return this.geo(SHAPES.box(), x, y + h / 2, z, w, h, d, c, rot);
  }

  /** Rounded box centred at (x, y, z). @param {number} w @param {number} h @param {number} d @param {number} x @param {number} y @param {number} z @param {PaintColor} c @param {Rot} [rot] */
  rbox(w, h, d, x, y, z, c, rot) {
    return this.geo(SHAPES.roundBox(), x, y, z, w, h, d, c, rot);
  }

  /**
   * Cylinder centred at (x, y, z) along local y.
   * @param {number} rTop @param {number} rBottom @param {number} h
   * @param {number} x @param {number} y @param {number} z @param {PaintColor} c
   * @param {number} [seg] @param {Rot} [rot]
   */
  cyl(rTop, rBottom, h, x, y, z, c, seg = 8, rot) {
    const rb = Math.max(rBottom, 1e-4);
    return this.geo(SHAPES.cylinder(seg, rTop / rb), x, y, z, rb * 2, h, rb * 2, c, rot);
  }

  /** Cone (apex up) centred at (x, y, z). @param {number} r @param {number} h @param {number} x @param {number} y @param {number} z @param {PaintColor} c @param {number} [seg] @param {Rot} [rot] */
  cone(r, h, x, y, z, c, seg = 6, rot) {
    return this.geo(SHAPES.cone(seg), x, y, z, r * 2, h, r * 2, c, rot);
  }

  /**
   * Faceted blob (icosahedron) of radius r, optionally squashed.
   * @param {number} r @param {number} x @param {number} y @param {number} z @param {PaintColor} c
   * @param {{sx?: number, sy?: number, sz?: number, rot?: Rot, detail?: number}} [o]
   */
  ico(r, x, y, z, c, o = {}) {
    return this.geo(SHAPES.ico(o.detail ?? 0), x, y, z, r * (o.sx ?? 1), r * (o.sy ?? 1), r * (o.sz ?? 1), c, o.rot);
  }

  /** Rock-like dodecahedron. @param {number} r @param {number} x @param {number} y @param {number} z @param {PaintColor} c @param {{sx?: number, sy?: number, sz?: number, rot?: Rot}} [o] */
  dodeca(r, x, y, z, c, o = {}) {
    return this.geo(SHAPES.dodeca(), x, y, z, r * (o.sx ?? 1), r * (o.sy ?? 1), r * (o.sz ?? 1), c, o.rot);
  }

  /** Smooth sphere. @param {number} r @param {number} x @param {number} y @param {number} z @param {PaintColor} c @param {{sx?: number, sy?: number, sz?: number, rot?: Rot, w?: number, h?: number}} [o] */
  sphere(r, x, y, z, c, o = {}) {
    return this.geo(SHAPES.sphere(o.w ?? 10, o.h ?? 7), x, y, z, r * (o.sx ?? 1), r * (o.sy ?? 1), r * (o.sz ?? 1), c, o.rot);
  }

  /**
   * Torus of radius R in the local XY plane.
   * @param {number} R @param {number} tube @param {number} x @param {number} y @param {number} z @param {PaintColor} c
   * @param {{arc?: number, rot?: Rot, sy?: number, rs?: number, ts?: number}} [o]
   */
  torus(R, tube, x, y, z, c, o = {}) {
    const geo = SHAPES.torus(tube / R, o.arc ?? Math.PI * 2, o.rs ?? 5, o.ts ?? 16);
    return this.geo(geo, x, y, z, R, R * (o.sy ?? 1), R, c, o.rot);
  }

  /** Flat disc facing up. @param {number} r @param {number} x @param {number} y @param {number} z @param {PaintColor} c @param {number} [seg] */
  disc(r, x, y, z, c, seg = 12) {
    return this.geo(SHAPES.disc(seg), x, y, z, r, 1, r, c);
  }
}
