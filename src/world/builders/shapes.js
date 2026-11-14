/**
 * Template geometries for batching. Templates are created lazily, cached for the
 * process lifetime and never rendered directly (only read by GeometryBatch), so
 * they never touch the GPU and need no disposal.
 * All templates are centred on the origin with unit size unless noted.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** @type {Map<string, THREE.BufferGeometry>} */
const cache = new Map();

/** @param {string} key @param {() => THREE.BufferGeometry} make */
function cached(key, make) {
  let g = cache.get(key);
  if (!g) {
    g = make();
    // Templates only need position + normal (+ optional colour).
    g.deleteAttribute('uv');
    cache.set(key, g);
  }
  return g;
}

/**
 * Build a non-indexed geometry from triangles, flipping each so its face normal
 * agrees with `wantNormal(centroid, faceNormal)`.
 * @param {number[][]} tris each [ax,ay,az,bx,by,bz,cx,cy,cz]
 * @param {(cx:number, cy:number, cz:number) => [number, number, number]} want desired outward direction
 */
function fromTriangles(tris, want) {
  const pos = [];
  for (const t of tris) {
    const ux = t[3] - t[0];
    const uy = t[4] - t[1];
    const uz = t[5] - t[2];
    const vx = t[6] - t[0];
    const vy = t[7] - t[1];
    const vz = t[8] - t[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const [wx, wy, wz] = want((t[0] + t[3] + t[6]) / 3, (t[1] + t[4] + t[7]) / 3, (t[2] + t[5] + t[8]) / 3);
    if (nx * wx + ny * wy + nz * wz < 0) pos.push(t[0], t[1], t[2], t[6], t[7], t[8], t[3], t[4], t[5]);
    else pos.push(...t);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Shape templates. */
export const SHAPES = {
  /** Unit cube. */
  box: () => cached('box', () => new THREE.BoxGeometry(1, 1, 1)),

  /** Unit cube with softly rounded edges. */
  roundBox: () => cached('rbox', () => new RoundedBoxGeometry(1, 1, 1, 1, 0.16)),

  /**
   * Cylinder of height 1, bottom radius 0.5, top radius 0.5 × taper.
   * @param {number} [seg] radial segments @param {number} [taper] @param {boolean} [open] no caps
   */
  cylinder: (seg = 8, taper = 1, open = false) => {
    const t = Math.round(taper * 100) / 100;
    return cached(`cyl:${seg}:${t}:${+open}`, () => new THREE.CylinderGeometry(0.5 * t, 0.5, 1, seg, 1, open));
  },

  /** Cone of height 1, base radius 0.5. @param {number} [seg] */
  cone: (seg = 6) => cached(`cone:${seg}`, () => new THREE.ConeGeometry(0.5, 1, seg, 1)),

  /** Icosahedron radius 1 (detail 0 = flat faceted). @param {number} [detail] */
  ico: (detail = 0) => cached(`ico:${detail}`, () => new THREE.IcosahedronGeometry(1, detail)),

  /** Dodecahedron radius 1. */
  dodeca: () => cached('dodeca', () => new THREE.DodecahedronGeometry(1, 0)),

  /** Octahedron radius 1. */
  octa: () => cached('octa', () => new THREE.OctahedronGeometry(1, 0)),

  /** Sphere radius 1. @param {number} [w] @param {number} [h] */
  sphere: (w = 10, h = 7) => cached(`sphere:${w}:${h}`, () => new THREE.SphereGeometry(1, w, h)),

  /**
   * Torus of radius 1 lying in the XY plane.
   * @param {number} tube tube radius (relative) @param {number} [arc] @param {number} [rs] @param {number} [ts]
   */
  torus: (tube, arc = Math.PI * 2, rs = 5, ts = 16) => {
    const k = `torus:${tube.toFixed(3)}:${arc.toFixed(3)}:${rs}:${ts}`;
    return cached(k, () => new THREE.TorusGeometry(1, tube, rs, ts, arc));
  },

  /** Open half-cylinder (upper half once rotated by rz = π/2), radius 1, length 1 along local y. @param {number} [seg] */
  halfCylinder: (seg = 10) =>
    cached(`halfcyl:${seg}`, () => new THREE.CylinderGeometry(1, 1, 1, seg, 1, true, 0, Math.PI)),

  /** Half disc (upper half, y ≥ 0) radius 1 in the XY plane facing +z. @param {number} [seg] */
  halfDisc: (seg = 10) => cached(`halfdisc:${seg}`, () => new THREE.CircleGeometry(1, seg, 0, Math.PI)),

  /** Disc radius 1 lying flat, facing +y. @param {number} [seg] */
  disc: (seg = 12) => cached(`disc:${seg}`, () => new THREE.CircleGeometry(1, seg).rotateX(-Math.PI / 2)),

  /** Lily pad: a flat disc with a notch, radius 1, facing +y. */
  notchDisc: () =>
    cached('notchDisc', () => new THREE.CircleGeometry(1, 12, 0.32, Math.PI * 2 - 0.64).rotateX(-Math.PI / 2)),

  /** Unit plane lying flat, facing +y. */
  planeUp: () => cached('planeUp', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)),

  /** Unit plane facing +z. */
  plane: () => cached('plane', () => new THREE.PlaneGeometry(1, 1)),

  /**
   * Prism: a convex polygon given in (z, y) extruded along x from −0.5 to 0.5.
   * Used for gables, roof caps and wedges.
   * @param {string} name cache key @param {Array<[number, number]>} pts polygon in (z, y)
   */
  prism: (name, pts) =>
    cached(`prism:${name}`, () => {
      const tris = [];
      let cz = 0;
      let cy = 0;
      for (const [z, y] of pts) {
        cz += z / pts.length;
        cy += y / pts.length;
      }
      for (let i = 1; i < pts.length - 1; i++) {
        const [z0, y0] = pts[0];
        const [z1, y1] = pts[i];
        const [z2, y2] = pts[i + 1];
        tris.push([0.5, y0, z0, 0.5, y1, z1, 0.5, y2, z2]);
        tris.push([-0.5, y0, z0, -0.5, y1, z1, -0.5, y2, z2]);
      }
      for (let i = 0; i < pts.length; i++) {
        const [z0, y0] = pts[i];
        const [z1, y1] = pts[(i + 1) % pts.length];
        tris.push([-0.5, y0, z0, 0.5, y0, z0, 0.5, y1, z1]);
        tris.push([-0.5, y0, z0, 0.5, y1, z1, -0.5, y1, z1]);
      }
      return fromTriangles(tris, (x, y, z) => {
        if (Math.abs(x) > 0.49) return [Math.sign(x), 0, 0];
        return [0, y - cy, z - cz];
      });
    }),

  /** Gable triangle prism: base from z −1..1 at y 0, apex at y 1. */
  gable: () =>
    SHAPES.prism('gable', [
      [-1, 0],
      [1, 0],
      [0, 1],
    ]),

  /**
   * Flat star (flower petals) facing +y, radius 1, `points` petals.
   * @param {number} [points] @param {number} [inner]
   */
  star: (points = 5, inner = 0.45) =>
    cached(`star:${points}:${inner}`, () => {
      const tris = [];
      const n = points * 2;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        const r0 = i % 2 === 0 ? 1 : inner;
        const r1 = i % 2 === 0 ? inner : 1;
        tris.push([0, 0.12, 0, Math.cos(a0) * r0, 0, Math.sin(a0) * r0, Math.cos(a1) * r1, 0, Math.sin(a1) * r1]);
      }
      return fromTriangles(tris, () => [0, 1, 0]);
    }),

  /**
   * Thin grass blade: tapered, slightly bent, base centred at origin, height 1.
   */
  blade: () =>
    cached('blade', () => {
      const w = 0.5;
      const pts = [
        [-w, 0, 0],
        [w, 0, 0],
        [-w * 0.6, 0.55, 0.08],
        [w * 0.6, 0.55, 0.08],
        [0, 1, 0.22],
      ];
      const tris = [
        [...pts[0], ...pts[1], ...pts[3]],
        [...pts[0], ...pts[3], ...pts[2]],
        [...pts[2], ...pts[3], ...pts[4]],
      ];
      return fromTriangles(tris, () => [0, 0, 1]);
    }),
};
