/**
 * Primitive templates and the "piece" baker.
 *
 * Actors are modelled from many small primitives, but every rigid node of a rig
 * is rendered as ONE merged, vertex-coloured mesh (plus one merged outline hull),
 * which keeps a whole chibi character to a handful of draw calls.
 *
 * Primitive templates are cached forever and are never rendered directly (their
 * data is copied into the baked geometry), so they never reach the GPU.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { toColor } from './actor-materials.js';

/** @type {Map<string, THREE.BufferGeometry>} */
const templates = new Map();

/** @param {number} n */
const q = (n) => Math.round(n * 1e4) / 1e4;

/**
 * @param {string} key
 * @param {() => THREE.BufferGeometry} make
 */
function cached(key, make) {
  let g = templates.get(key);
  if (!g) {
    g = make();
    g.deleteAttribute('uv');
    g.computeBoundingBox();
    templates.set(key, g);
  }
  return g;
}

/**
 * Cached primitive templates. Unit-sized ones are sized with a part's `s`.
 */
export const prim = {
  /** Unit sphere. `lod` 0 = small detail, 1 = body/head. */
  sphere(lod = 1) {
    return cached(`sphere:${lod}`, () => (lod ? new THREE.SphereGeometry(1, 22, 16) : new THREE.SphereGeometry(1, 12, 8)));
  },
  /** Unit sphere cap from the top pole down to polar angle `theta`. */
  dome(theta = Math.PI / 2) {
    return cached(`dome:${q(theta)}`, () => new THREE.SphereGeometry(1, 22, 9, 0, Math.PI * 2, 0, theta));
  },
  /**
   * Capsule with real radius/length (non-uniform scaling would squash the caps).
   * @param {number} r @param {number} len straight section length
   */
  capsule(r, len) {
    return cached(`capsule:${q(r)}:${q(len)}`, () => new THREE.CapsuleGeometry(r, Math.max(0.0001, len), 4, 12));
  },
  /**
   * Rounded box with real dimensions.
   * @param {number} w @param {number} h @param {number} d @param {number} [radius]
   */
  box(w, h, d, radius = 0.02) {
    const rad = Math.max(0.0005, Math.min(radius, Math.min(w, h, d) / 2 - 0.0005));
    return cached(`box:${q(w)}:${q(h)}:${q(d)}:${q(rad)}`, () => {
      const g = new RoundedBoxGeometry(w, h, d, 2, rad);
      g.deleteAttribute('uv');
      const merged = mergeVertices(g, 1e-5);
      g.dispose();
      return merged;
    });
  },
  /**
   * Unit-height cylinder of bottom radius 1 and top radius `top`.
   * @param {number} [top] @param {number} [segments]
   */
  cylinder(top = 1, segments = 14) {
    return cached(`cyl:${q(top)}:${segments}`, () => new THREE.CylinderGeometry(top, 1, 1, segments, 1));
  },
  /** Unit cone (radius 1, height 1), apex up. */
  cone(segments = 10) {
    return cached(`cone:${segments}`, () => new THREE.ConeGeometry(1, 1, segments, 1));
  },
  /**
   * Torus in the XY plane (ring around +z) with real dimensions.
   * @param {number} R ring radius @param {number} tube tube radius @param {number} [arc]
   */
  torus(R, tube, arc = Math.PI * 2) {
    return cached(`torus:${q(R)}:${q(tube)}:${q(arc)}`, () => new THREE.TorusGeometry(R, tube, 8, 22, arc));
  },
};

/**
 * @typedef {object} PartOptions
 * @property {number[]} [p] position [x, y, z]
 * @property {number[]} [r] Euler rotation [x, y, z] (XYZ), applied after `dir`/`face`
 * @property {number[] | number} [s] scale (number = uniform)
 * @property {number[]} [dir] align the template's +y with this direction
 * @property {number[]} [face] align the template's +z with this direction
 * @property {boolean} [outline] include this part in the node's outline hull
 */

/**
 * @typedef {object} Part
 * @property {THREE.BufferGeometry} geometry
 * @property {THREE.Color} color
 * @property {THREE.Matrix4} matrix
 * @property {THREE.Vector3} scale
 * @property {boolean} outline
 */

/**
 * @typedef {object} Piece
 * @property {Part[]} parts
 * @property {(geometry: THREE.BufferGeometry, color: unknown, opts?: PartOptions) => Piece} add
 */

const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _eul = new THREE.Euler();
const _dir = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, 1);

/**
 * Start collecting parts for one rigid node.
 * @returns {Piece}
 */
export function createPiece() {
  /** @type {Piece} */
  const piece = {
    parts: [],
    add(geometry, color, opts = {}) {
      const p = opts.p ?? [0, 0, 0];
      const s = opts.s ?? 1;
      _pos.set(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
      if (typeof s === 'number') _scl.set(s, s, s);
      else _scl.set(s[0] ?? 1, s[1] ?? 1, s[2] ?? 1);
      _quat.identity();
      if (opts.dir) {
        _dir.set(opts.dir[0], opts.dir[1], opts.dir[2]);
        if (_dir.lengthSq() > 1e-12) _quat.setFromUnitVectors(UP, _dir.normalize());
      } else if (opts.face) {
        _dir.set(opts.face[0], opts.face[1], opts.face[2]);
        if (_dir.lengthSq() > 1e-12) _quat.setFromUnitVectors(FWD, _dir.normalize());
      }
      if (opts.r) {
        _q2.setFromEuler(_eul.set(opts.r[0] ?? 0, opts.r[1] ?? 0, opts.r[2] ?? 0));
        _quat.multiply(_q2);
      }
      piece.parts.push({
        geometry,
        color: toColor(color, '#cccccc'),
        matrix: new THREE.Matrix4().compose(_pos, _quat, _scl),
        scale: _scl.clone(),
        outline: !!opts.outline,
      });
      return piece;
    },
  };
  return piece;
}

const _m = new THREE.Matrix4();
const _hull = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _v = new THREE.Vector3();

/**
 * Inflation factors that grow a part by `t` world units on every side.
 * @param {Part} part @param {number} t
 */
function hullScale(part, t) {
  const bb = /** @type {THREE.Box3} */ (part.geometry.boundingBox);
  const hx = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)) * Math.abs(part.scale.x);
  const hy = Math.max(Math.abs(bb.min.y), Math.abs(bb.max.y)) * Math.abs(part.scale.y);
  const hz = Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z)) * Math.abs(part.scale.z);
  const f = (h) => Math.min(3, 1 + t / Math.max(1e-4, h));
  return _hull.makeScale(f(hx), f(hy), f(hz));
}

/**
 * Bake parts into one indexed BufferGeometry (position, normal[, color]).
 * With `hull > 0` only parts flagged `outline` are baked, each inflated by
 * `hull` world units — the result is meant for the BackSide outline material.
 * @param {Part[]} parts
 * @param {{ colors?: boolean, hull?: number }} [opts]
 * @returns {THREE.BufferGeometry | null} null when nothing qualifies
 */
export function bakeParts(parts, { colors = true, hull = 0 } = {}) {
  const list = hull > 0 ? parts.filter((p) => p.outline) : parts;
  if (!list.length) return null;

  let vCount = 0;
  let iCount = 0;
  for (const p of list) {
    const n = p.geometry.attributes.position.count;
    vCount += n;
    iCount += p.geometry.index ? p.geometry.index.count : n;
  }
  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const col = colors ? new Float32Array(vCount * 3) : null;
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);

  let vo = 0;
  let io = 0;
  for (const p of list) {
    const g = p.geometry;
    const P = g.attributes.position;
    const N = g.attributes.normal;
    _m.copy(p.matrix);
    if (hull > 0) _m.multiply(hullScale(p, hull));
    _nm.getNormalMatrix(_m);
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(_m);
      pos[(vo + i) * 3] = _v.x;
      pos[(vo + i) * 3 + 1] = _v.y;
      pos[(vo + i) * 3 + 2] = _v.z;
      if (N) _v.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
      else _v.set(0, 1, 0);
      nrm[(vo + i) * 3] = _v.x;
      nrm[(vo + i) * 3 + 1] = _v.y;
      nrm[(vo + i) * 3 + 2] = _v.z;
      if (col) {
        col[(vo + i) * 3] = p.color.r;
        col[(vo + i) * 3 + 1] = p.color.g;
        col[(vo + i) * 3 + 2] = p.color.b;
      }
    }
    const flip = _m.determinant() < 0;
    const count = g.index ? g.index.count : P.count;
    for (let j = 0; j < count; j += 3) {
      const a = g.index ? g.index.getX(j) : j;
      const b = g.index ? g.index.getX(j + 1) : j + 1;
      const c = g.index ? g.index.getX(j + 2) : j + 2;
      idx[io++] = vo + a;
      idx[io++] = vo + (flip ? c : b);
      idx[io++] = vo + (flip ? b : c);
    }
    vo += P.count;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
