/**
 * Nature: instanced trees in three deterministic variants (round canopy,
 * conifer, birch) for `T` tiles and the forest skirt, lumpy hedges, mossy
 * rocks, and the landmark big tree object.
 */
import * as THREE from 'three';
import { MAT } from './context.js';
import { GeometryBatch } from './batch.js';
import { SHAPES } from './shapes.js';
import { patchWorld } from './shaders.js';
import { PALETTE, TONES } from '../../render/palette.js';
import { color, getToonGradient, hash2 } from '../../render/materials.js';
import { tileType } from '../tiles.js';

/** Skirt trees closer than this (cells) cast shadows; farther ones don't. */
const SHADOW_RING = 5;

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/**
 * Helper to add a template into a batch with position / scale / yaw.
 * @param {GeometryBatch} b @param {THREE.BufferGeometry} g
 * @param {number} x @param {number} y @param {number} z
 * @param {number} sx @param {number} sy @param {number} sz
 * @param {import('./batch.js').ColorSource} c @param {number} [yaw]
 */
function put(b, g, x, y, z, sx, sy, sz, c, yaw = 0) {
  _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  b.add(g, _m, c);
}

/** Leafy shading by facet normal: light tops, darker undersides. */
function leafy(dark, mid, light) {
  return (x, y, z, nx, ny, nz, out) => {
    out.copy(mid);
    if (ny > 0.15) out.lerp(light, Math.min(1, (ny - 0.15) * 1.4) * 0.9);
    else if (ny < -0.25) out.lerp(dark, 0.55);
    return out;
  };
}

/**
 * The three tree variants. `lod` drops the smallest canopy blobs for the far
 * forest (it sits in fog and never casts shadows), roughly halving its cost.
 * @param {boolean} [lod]
 * @returns {THREE.BufferGeometry[]}
 */
function treeGeometries(lod = false) {
  const bark = color(PALETTE.bark);
  const barkDark = color(TONES.barkDark);
  const variants = [];

  // Round canopy.
  {
    const b = new GeometryBatch();
    put(b, SHAPES.cylinder(lod ? 5 : 6, 0.62, true), 0, 0.45, 0, 0.28, 0.9, 0.28, (x, y, z, nx, ny, nz, out) =>
      out.copy(bark).lerp(barkDark, y < -0.3 ? 0.4 : 0),
    );
    const leaf = leafy(color(TONES.foliageDark), color(PALETTE.foliage), color(PALETTE.foliageLight));
    put(b, SHAPES.ico(0), 0, 1.35, 0, 0.62, 0.55, 0.62, leaf);
    put(b, SHAPES.ico(0), 0.27, 1.72, 0.08, 0.46, 0.42, 0.46, leaf, 0.7);
    if (!lod) {
      put(b, SHAPES.ico(0), -0.28, 1.6, -0.1, 0.42, 0.38, 0.42, leaf, 1.9);
      put(b, SHAPES.ico(0), 0.04, 1.98, -0.12, 0.34, 0.32, 0.34, leaf, 2.6);
    } else {
      put(b, SHAPES.ico(0), -0.2, 1.75, -0.1, 0.42, 0.4, 0.42, leaf, 1.9);
    }
    variants.push(/** @type {THREE.BufferGeometry} */ (b.toGeometry()));
  }
  // Conifer.
  {
    const b = new GeometryBatch();
    put(b, SHAPES.cylinder(5, 0.65, true), 0, 0.28, 0, 0.24, 0.56, 0.24, bark);
    const dark = color(TONES.conifer);
    const light = color(TONES.coniferLight);
    const tiers = (x, y, z, nx, ny, nz, out) => out.copy(dark).lerp(light, Math.min(1, Math.max(0, y + 0.5)) * 0.85);
    const seg = lod ? 6 : 7;
    put(b, SHAPES.cone(seg), 0, 0.85, 0, 1.28, 0.95, 1.28, tiers);
    if (!lod) {
      put(b, SHAPES.cone(seg), 0, 1.36, 0, 1.0, 0.85, 1.0, tiers, 0.4);
      put(b, SHAPES.cone(seg), 0, 1.82, 0, 0.7, 0.75, 0.7, tiers, 0.8);
    } else {
      put(b, SHAPES.cone(seg), 0, 1.6, 0, 0.9, 1.2, 0.9, tiers, 0.4);
    }
    variants.push(/** @type {THREE.BufferGeometry} */ (b.toGeometry()));
  }
  // Birch.
  {
    const b = new GeometryBatch();
    put(b, SHAPES.cylinder(lod ? 5 : 6, 0.7, true), 0, 0.62, 0, 0.17, 1.25, 0.17, color(TONES.birchBark));
    const mark = color(TONES.birchMark);
    if (!lod) {
      for (let i = 0; i < 4; i++) {
        put(b, SHAPES.box(), 0, 0.3 + i * 0.24, 0, 0.19, 0.03, 0.07, mark, i * 1.7);
      }
    }
    const leaf = leafy(color(TONES.birchLeaf).clone().multiplyScalar(0.75), color(TONES.birchLeaf), color(TONES.birchLeafLight));
    put(b, SHAPES.ico(0), 0.05, 1.45, 0, 0.44, 0.4, 0.44, leaf);
    put(b, SHAPES.ico(0), -0.2, 1.76, 0.05, 0.36, 0.34, 0.36, leaf, 1.1);
    if (!lod) put(b, SHAPES.ico(0), 0.2, 1.92, -0.06, 0.31, 0.3, 0.31, leaf, 2.2);
    variants.push(/** @type {THREE.BufferGeometry} */ (b.toGeometry()));
  }
  return variants;
}

/**
 * @param {import('./context.js').BuildContext} ctx
 */
export function buildNature(ctx) {
  buildTrees(ctx);
  buildHedges(ctx);
  buildRocks(ctx);
}

/** @param {import('./context.js').BuildContext} ctx */
function buildTrees(ctx) {
  const { grid, model, seed } = ctx;
  /** @type {Array<{x:number,y:number,z:number,s:number,yaw:number,v:number,tint:number,near:boolean}>} */
  const spots = [];

  for (const c of grid.cells) {
    if (c.inMap) {
      if (!c.t.tree) continue;
      const h = hash2(c.x, c.y, seed + 401);
      spots.push({
        x: c.x + (hash2(c.x, c.y, seed + 403) - 0.5) * 0.22,
        z: c.y + (hash2(c.y, c.x, seed + 405) - 0.5) * 0.22,
        y: c.top,
        s: 0.95 + hash2(c.x * 3, c.y, seed + 407) * 0.22,
        yaw: hash2(c.x, c.y * 3, seed + 409) * Math.PI * 2,
        v: h < 0.6 ? 0 : h < 0.85 ? 1 : 2,
        tint: 0.9 + hash2(c.x * 7, c.y * 5, seed + 411) * 0.18,
        near: true,
      });
      continue;
    }
    if (c.ch !== '.') continue;
    const cx = Math.min(model.width - 1, Math.max(0, c.x));
    const cy = Math.min(model.height - 1, Math.max(0, c.y));
    const edgeTree = tileType(model.charAt(cx, cy)).tree;
    let chance = c.d === 1 ? 0.5 : c.d === 2 ? 0.7 : 0.88;
    if (edgeTree) chance = Math.max(chance, 0.92);
    // Keep roads and rivers leading out of town readable.
    let nearOpen = false;
    for (let dy = -1; dy <= 1 && !nearOpen; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = grid.get(c.x + dx, c.y + dy);
        if (n && !n.inMap && n.ch !== '.') {
          nearOpen = true;
          break;
        }
      }
    }
    if (nearOpen) chance *= 0.3;
    if (hash2(c.x, c.y, seed + 421) > chance) continue;
    const h = hash2(c.x, c.y, seed + 423);
    spots.push({
      x: c.x + (hash2(c.x, c.y, seed + 425) - 0.5) * 0.55,
      z: c.y + (hash2(c.y, c.x, seed + 427) - 0.5) * 0.55,
      y: c.top,
      s: 0.9 + hash2(c.x * 3, c.y, seed + 429) * 0.4,
      yaw: hash2(c.x, c.y * 3, seed + 431) * Math.PI * 2,
      v: h < 0.5 ? 0 : h < 0.88 ? 1 : 2,
      tint: 0.86 + hash2(c.x * 7, c.y * 5, seed + 433) * 0.2,
      near: c.d <= SHADOW_RING,
    });
  }
  if (spots.length === 0) return;

  const geos = { near: treeGeometries(false), far: treeGeometries(true) };
  for (const list of Object.values(geos)) list.forEach((g) => ctx.ownGeometry(g));
  const material = ctx.kit.own(
    patchWorld(
      new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: getToonGradient() }),
      ctx.uniforms,
      { cloud: ctx.outdoor, sway: { height: 2.2, amp: 0.05 } },
    ),
  );
  const tint = new THREE.Color();
  for (let v = 0; v < 3; v++) {
    for (const near of [true, false]) {
      const list = spots.filter((s) => s.v === v && s.near === near);
      if (list.length === 0) continue;
      const mesh = new THREE.InstancedMesh((near ? geos.near : geos.far)[v], material, list.length);
      mesh.name = `trees:${['round', 'conifer', 'birch'][v]}:${near ? 'near' : 'far'}`;
      mesh.castShadow = near;
      mesh.receiveShadow = true;
      list.forEach((s, i) => {
        _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, s.yaw);
        _m.compose(_p.set(s.x, s.y, s.z), _q, _s.set(s.s, s.s * (0.95 + (s.tint - 0.9) * 0.6), s.s));
        mesh.setMatrixAt(i, _m);
        mesh.setColorAt(i, tint.setRGB(s.tint, s.tint, s.tint * 0.97));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      ctx.root.add(mesh);
    }
  }
}

/** @param {import('./context.js').BuildContext} ctx */
function buildHedges(ctx) {
  const { grid, seed } = ctx;
  const p = ctx.painter(MAT.solid);
  const hedge = color(TONES.hedge);
  const light = color(TONES.hedgeLight);
  const dark = color(TONES.foliageDark);
  const shade = (x, y, z, nx, ny, nz, out) => {
    out.copy(hedge);
    if (ny > 0.4) out.lerp(light, 0.75);
    else if (y < -0.2) out.lerp(dark, 0.35);
    return out;
  };
  const blossom = [color(TONES.flowerWhite), color(TONES.flowerCoral), color(TONES.flowerButter)];
  for (const c of grid.cells) {
    if (!c.inMap || !c.t.hedge) continue;
    const h = 0.7 + hash2(c.x, c.y, seed + 501) * 0.06;
    p.geo(SHAPES.roundBox(), c.x, c.top + h / 2, c.y, 0.94, h, 0.94, shade);
    const east = grid.get(c.x + 1, c.y);
    const south = grid.get(c.x, c.y + 1);
    if (east?.t.hedge && east.inMap) p.geo(SHAPES.box(), c.x + 0.5, c.top + h / 2 - 0.01, c.y, 0.3, h - 0.06, 0.84, shade);
    if (south?.t.hedge && south.inMap) p.geo(SHAPES.box(), c.x, c.top + h / 2 - 0.01, c.y + 0.5, 0.84, h - 0.06, 0.3, shade);
    const bumps = 2 + Math.floor(hash2(c.y, c.x, seed + 503) * 2);
    for (let i = 0; i < bumps; i++) {
      const bx = c.x + (hash2(c.x * 3 + i, c.y, seed + 505) - 0.5) * 0.55;
      const bz = c.y + (hash2(c.x, c.y * 3 + i, seed + 507) - 0.5) * 0.55;
      const r = 0.17 + hash2(i, c.x + c.y, seed + 509) * 0.08;
      p.ico(r, bx, c.top + h - 0.02, bz, light, { sy: 0.7, rot: i * 1.1 });
    }
    if (hash2(c.x, c.y, seed + 511) < 0.35) {
      const col = blossom[Math.floor(hash2(c.y, c.x, seed + 513) * blossom.length)];
      for (let i = 0; i < 3; i++) {
        const fx = c.x + (hash2(c.x + i, c.y * 2, seed + 515) - 0.5) * 0.8;
        const fz = c.y + 0.47;
        p.ico(0.045, fx, c.top + 0.25 + hash2(i, c.y, seed + 517) * 0.35, fz, col);
      }
    }
  }
}

/** @param {import('./context.js').BuildContext} ctx */
function buildRocks(ctx) {
  const { grid, seed } = ctx;
  const p = ctx.painter(MAT.solid);
  const rock = color(TONES.rock);
  const rockLight = color(TONES.rockLight);
  const moss = color(TONES.moss);
  for (const c of grid.cells) {
    if (!c.inMap || !c.t.rock) continue;
    const mossy = hash2(c.x, c.y, seed + 601) < 0.45;
    const shade = (x, y, z, nx, ny, nz, out) => {
      if (ny > 0.55) return out.copy(mossy ? moss : rockLight);
      return out.copy(rock).lerp(rockLight, Math.max(0, ny) * 0.6);
    };
    const r = 0.38 + hash2(c.y, c.x, seed + 603) * 0.07;
    const ox = (hash2(c.x * 2, c.y, seed + 605) - 0.5) * 0.12;
    const oz = (hash2(c.x, c.y * 2, seed + 607) - 0.5) * 0.12;
    p.dodeca(r, c.x + ox, c.top + r * 0.5, c.y + oz, shade, { sy: 0.78, rot: hash2(c.x, c.y, seed + 609) * 6.28 });
    const sr = 0.14 + hash2(c.x * 5, c.y, seed + 611) * 0.07;
    const sa = hash2(c.x, c.y * 5, seed + 613) * Math.PI * 2;
    p.dodeca(sr, c.x + Math.cos(sa) * 0.36, c.top + sr * 0.45, c.y + Math.sin(sa) * 0.36, shade, { sy: 0.7, rot: sa });
  }
}

/**
 * Landmark 2×2 tree with flaring roots and a rope swing (object type `bigtree`).
 * @param {import('./context.js').BuildContext} ctx
 * @param {any} o
 * @param {import('./painter.js').Painter} p painter in the object's frame
 */
export function buildBigTree(ctx, o, p) {
  const bark = color(PALETTE.bark);
  const barkDark = color(TONES.barkDark);
  const rope = color(TONES.woodPale);
  const seat = color(TONES.wood);
  const leaf = leafy(color(TONES.foliageDark), color(PALETTE.foliage), color(PALETTE.foliageLight));
  p.cyl(0.3, 0.44, 1.7, 0, 0.85, 0, bark, 9);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    p.box(0.2, 0.22, 0.5, Math.sin(a) * 0.4, 0.09, Math.cos(a) * 0.4, barkDark, { y: a, x: -0.35 });
  }
  p.box(0.16, 0.16, 1.1, 0.12, 1.75, 0.45, bark, { x: -0.45 });
  p.box(0.14, 0.14, 0.9, -0.3, 1.9, -0.25, bark, { x: 0.5, y: 0.6 });
  p.ico(1.08, 0, 2.5, 0, leaf, { sy: 0.82, detail: 1 });
  p.ico(0.86, 0.72, 2.78, 0.22, leaf, { sy: 0.85, detail: 1 });
  p.ico(0.8, -0.74, 2.62, -0.18, leaf, { sy: 0.85, detail: 1 });
  p.ico(0.74, 0.12, 3.22, -0.34, leaf, { sy: 0.85, detail: 1 });
  p.ico(0.6, -0.3, 3.04, 0.56, leaf, { sy: 0.85, detail: 1 });
  // Rope swing on the south (camera) side.
  p.box(0.03, 1.1, 0.03, -0.24, 1.07, 0.92, rope);
  p.box(0.03, 1.1, 0.03, 0.24, 1.07, 0.92, rope);
  p.box(0.62, 0.05, 0.2, 0, 0.5, 0.92, seat);
  p.box(0.7, 0.1, 0.1, 0, 1.64, 0.92, bark);
}
