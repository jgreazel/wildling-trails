/**
 * Static geometry batching: transformed template geometry and hand-built quads
 * are written straight into growable typed arrays (position / normal / colour),
 * one batch per material key, then turned into a single BufferGeometry each.
 * This is what keeps the whole town to a handful of draw calls.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

class Floats {
  constructor(capacity = 3 * 1024) {
    this.a = new Float32Array(capacity);
    this.n = 0;
  }

  /** @param {number} k */
  reserve(k) {
    if (this.n + k <= this.a.length) return;
    let cap = this.a.length * 2;
    while (cap < this.n + k) cap *= 2;
    const b = new Float32Array(cap);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }

  /** @param {number} x @param {number} y @param {number} z */
  push3(x, y, z) {
    const a = this.a;
    a[this.n++] = x;
    a[this.n++] = y;
    a[this.n++] = z;
  }

  copy() {
    return this.a.slice(0, this.n);
  }
}

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _tmp = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);

/**
 * Colour source for a batch add: a fixed colour, or a function of the template's
 * local vertex position and normal (write into `out` and return it).
 * @typedef {THREE.Color | ((x:number, y:number, z:number, nx:number, ny:number, nz:number, out:THREE.Color) => THREE.Color) | null} ColorSource
 */

/** Accumulates triangles for one material. */
export class GeometryBatch {
  constructor() {
    this.pos = new Floats();
    this.nor = new Floats();
    this.col = new Floats();
  }

  /** @returns {number} */
  get vertexCount() {
    return this.pos.n / 3;
  }

  /**
   * Append a (possibly indexed) template geometry transformed by `matrix`.
   * @param {THREE.BufferGeometry} geo
   * @param {THREE.Matrix4} matrix
   * @param {ColorSource} color
   */
  add(geo, matrix, color) {
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const vcol = geo.getAttribute('color');
    const index = geo.getIndex();
    const count = index ? index.count : pos.count;
    const flip = matrix.determinant() < 0;
    _nm.getNormalMatrix(matrix);
    this.pos.reserve(count * 3);
    this.nor.reserve(count * 3);
    this.col.reserve(count * 3);
    const fn = typeof color === 'function' ? color : null;
    const fixed = fn ? WHITE : color ?? WHITE;
    for (let i = 0; i < count; i++) {
      let j = i;
      if (flip) {
        const r = i % 3;
        if (r === 1) j = i + 1;
        else if (r === 2) j = i - 1;
      }
      const k = index ? index.getX(j) : j;
      const lx = pos.getX(k);
      const ly = pos.getY(k);
      const lz = pos.getZ(k);
      const nx = nor ? nor.getX(k) : 0;
      const ny = nor ? nor.getY(k) : 1;
      const nz = nor ? nor.getZ(k) : 0;
      _p.set(lx, ly, lz).applyMatrix4(matrix);
      _n.set(nx, ny, nz).applyMatrix3(_nm).normalize();
      const c = fn ? fn(lx, ly, lz, nx, ny, nz, _tmp) : fixed;
      let r = c.r;
      let g = c.g;
      let b = c.b;
      if (vcol) {
        r *= vcol.getX(k);
        g *= vcol.getY(k);
        b *= vcol.getZ(k);
      }
      this.pos.push3(_p.x, _p.y, _p.z);
      this.nor.push3(_n.x, _n.y, _n.z);
      this.col.push3(r, g, b);
    }
  }

  /**
   * Append a quad a→b→c→d (counter-clockwise seen from the front) with one normal
   * and per-corner colours.
   * @param {number[]} q 12 numbers: ax,ay,az, bx,by,bz, cx,cy,cz, dx,dy,dz
   * @param {number} nx @param {number} ny @param {number} nz
   * @param {THREE.Color} ca @param {THREE.Color} [cb] @param {THREE.Color} [cc] @param {THREE.Color} [cd]
   */
  quad(q, nx, ny, nz, ca, cb = ca, cc = ca, cd = ca) {
    this.pos.reserve(18);
    this.nor.reserve(18);
    this.col.reserve(18);
    const order = [0, 1, 2, 0, 2, 3];
    const cols = [ca, cb, cc, cd];
    for (const i of order) {
      this.pos.push3(q[i * 3], q[i * 3 + 1], q[i * 3 + 2]);
      this.nor.push3(nx, ny, nz);
      const c = cols[i];
      this.col.push3(c.r, c.g, c.b);
    }
  }

  /**
   * Append a single triangle with a flat normal computed from its winding.
   * @param {number[]} t 9 numbers @param {THREE.Color} c
   */
  tri(t, c) {
    const ux = t[3] - t[0];
    const uy = t[4] - t[1];
    const uz = t[5] - t[2];
    const vx = t[6] - t[0];
    const vy = t[7] - t[1];
    const vz = t[8] - t[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    this.pos.reserve(9);
    this.nor.reserve(9);
    this.col.reserve(9);
    for (let i = 0; i < 3; i++) {
      this.pos.push3(t[i * 3], t[i * 3 + 1], t[i * 3 + 2]);
      this.nor.push3(nx, ny, nz);
      this.col.push3(c.r, c.g, c.b);
    }
  }

  /** @returns {THREE.BufferGeometry|null} null when empty */
  toGeometry() {
    if (this.vertexCount === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.copy(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.copy(), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.copy(), 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * @typedef {object} MeshSpec
 * @property {THREE.Material} material
 * @property {boolean} [castShadow]
 * @property {boolean} [receiveShadow]
 * @property {number} [renderOrder]
 */

/** A set of batches keyed by material key. */
export class BatchSet {
  constructor() {
    /** @type {Map<string, GeometryBatch>} */
    this.batches = new Map();
  }

  /** @param {string} key @returns {GeometryBatch} */
  get(key) {
    let b = this.batches.get(key);
    if (!b) {
      b = new GeometryBatch();
      this.batches.set(key, b);
    }
    return b;
  }

  /** @returns {number} total vertices across batches */
  get vertexCount() {
    let n = 0;
    for (const b of this.batches.values()) n += b.vertexCount;
    return n;
  }

  /**
   * Turn every non-empty batch into one mesh and add it to `parent`.
   * Extra geometries contributed for the same key are merged in with
   * BufferGeometryUtils.mergeGeometries.
   * @param {Record<string, MeshSpec>} specs material key → mesh settings
   * @param {THREE.Object3D} parent
   * @param {(g: THREE.BufferGeometry) => void} own registers geometry for disposal
   * @param {Map<string, THREE.BufferGeometry[]>} [extra]
   * @returns {THREE.Mesh[]}
   */
  build(specs, parent, own, extra) {
    /** @type {THREE.Mesh[]} */
    const meshes = [];
    const keys = new Set([...this.batches.keys(), ...(extra?.keys() ?? [])]);
    for (const key of keys) {
      const spec = specs[key];
      if (!spec) continue;
      const parts = [];
      const g0 = this.batches.get(key)?.toGeometry();
      if (g0) parts.push(g0);
      for (const g of extra?.get(key) ?? []) parts.push(g);
      if (parts.length === 0) continue;
      let geometry = parts[0];
      if (parts.length > 1) {
        geometry = mergeGeometries(parts, false) ?? parts[0];
        if (geometry !== parts[0]) for (const p of parts) p.dispose();
      }
      own(geometry);
      const mesh = new THREE.Mesh(geometry, spec.material);
      mesh.name = `batch:${key}`;
      mesh.castShadow = !!spec.castShadow;
      mesh.receiveShadow = !!spec.receiveShadow;
      if (spec.renderOrder) mesh.renderOrder = spec.renderOrder;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      meshes.push(mesh);
    }
    return meshes;
  }
}
