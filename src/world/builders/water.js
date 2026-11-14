/**
 * Water: one animated surface mesh per map (sunken below its level, lighter
 * shallows and foam along the banks, little waterfalls between levels),
 * wooden plank bridges with rails, and bobbing lily pads.
 */
import * as THREE from 'three';
import { MAT } from './context.js';
import { createWaterMaterial } from './shaders.js';
import { PALETTE, TONES } from '../../render/palette.js';
import { color, hash2, vary } from '../../render/materials.js';
import { LEVEL_HEIGHT } from '../../config.js';
import { WATER_DROP } from './grid.js';
import { GeometryBatch } from './batch.js';
import { SHAPES } from './shapes.js';

const LH = LEVEL_HEIGHT;
const SUB = 2; // subdivisions per tile edge

/** @param {number} a @param {number} b @param {number} x */
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * @param {import('./context.js').BuildContext} ctx
 */
export function buildWater(ctx) {
  const { grid } = ctx;
  const waterCells = grid.cells.filter((c) => c.t.water);
  if (waterCells.length > 0) buildSurface(ctx, waterCells);
  for (const c of waterCells) if (c.t.bridge && c.inMap) buildBridge(ctx, c);
  buildLilypads(ctx);
}

/**
 * @param {import('./context.js').BuildContext} ctx
 * @param {import('./grid.js').Cell[]} cells
 */
function buildSurface(ctx, cells) {
  const { grid } = ctx;
  const deep = color(PALETTE.waterDeep);
  const shallow = color(PALETTE.water);

  /** Shore factor 0..1 for a point: 1 at a bank, 0 in open water. */
  function shoreAt(vx, vz) {
    let best = Infinity;
    const rx = Math.round(vx);
    const rz = Math.round(vz);
    for (let y = rz - 2; y <= rz + 2; y++) {
      for (let x = rx - 2; x <= rx + 2; x++) {
        const c = grid.get(x, y);
        if (!c || c.t.water || c.t.void) continue;
        const dx = Math.max(Math.abs(vx - x) - 0.5, 0);
        const dz = Math.max(Math.abs(vz - y) - 0.5, 0);
        best = Math.min(best, Math.hypot(dx, dz));
      }
    }
    return 1 - smoothstep(0, 0.75, best);
  }

  const positions = [];
  const colors = [];
  const shore = [];
  const normals = [];
  const tmp = new THREE.Color();

  /** @param {number} x @param {number} y @param {number} z @param {number} s @param {number} [ny] @param {number} [nx] @param {number} [nz] */
  function vert(x, y, z, s, nx = 0, ny = 1, nz = 0) {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    shore.push(s);
    tmp.copy(deep).lerp(shallow, Math.min(1, 0.15 + s * 1.3));
    colors.push(tmp.r, tmp.g, tmp.b);
  }

  for (const c of cells) {
    const y = c.level * LH - WATER_DROP;
    const step = 1 / SUB;
    for (let j = 0; j < SUB; j++) {
      for (let i = 0; i < SUB; i++) {
        const x0 = c.x - 0.5 + i * step;
        const x1 = x0 + step;
        const z0 = c.y - 0.5 + j * step;
        const z1 = z0 + step;
        const s00 = shoreAt(x0, z0);
        const s01 = shoreAt(x0, z1);
        const s11 = shoreAt(x1, z1);
        const s10 = shoreAt(x1, z0);
        // (x0,z0) → (x0,z1) → (x1,z1) and (x0,z0) → (x1,z1) → (x1,z0): faces +y.
        vert(x0, y, z0, s00);
        vert(x0, y, z1, s01);
        vert(x1, y, z1, s11);
        vert(x0, y, z0, s00);
        vert(x1, y, z1, s11);
        vert(x1, y, z0, s10);
      }
    }
    // Little waterfalls down to lower water neighbours.
    const falls = [
      [1, 0, [c.x + 0.5, c.y + 0.5], [c.x + 0.5, c.y - 0.5], [1, 0, 0]],
      [-1, 0, [c.x - 0.5, c.y - 0.5], [c.x - 0.5, c.y + 0.5], [-1, 0, 0]],
      [0, 1, [c.x - 0.5, c.y + 0.5], [c.x + 0.5, c.y + 0.5], [0, 0, 1]],
      [0, -1, [c.x + 0.5, c.y - 0.5], [c.x - 0.5, c.y - 0.5], [0, 0, -1]],
    ];
    for (const [dx, dy, a, b, n] of falls) {
      const nb = grid.get(c.x + dx, c.y + dy);
      if (!nb || !nb.t.water || nb.level >= c.level) continue;
      const yb = nb.level * LH - WATER_DROP;
      const [nx, , nz] = n;
      // Sit the sheet just proud of the rock face behind it (no z-fighting).
      const ox = nx * 0.035;
      const oz = nz * 0.035;
      vert(a[0] + ox, y, a[1] + oz, 0.7, nx, 0, nz);
      vert(a[0] + ox, yb, a[1] + oz, 0.95, nx, 0, nz);
      vert(b[0] + ox, yb, b[1] + oz, 0.95, nx, 0, nz);
      vert(a[0] + ox, y, a[1] + oz, 0.7, nx, 0, nz);
      vert(b[0] + ox, yb, b[1] + oz, 0.95, nx, 0, nz);
      vert(b[0] + ox, y, b[1] + oz, 0.7, nx, 0, nz);
    }
  }

  const geometry = ctx.ownGeometry(new THREE.BufferGeometry());
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aShore', new THREE.Float32BufferAttribute(shore, 1));
  geometry.computeBoundingSphere();
  const material = ctx.kit.own(createWaterMaterial(ctx.uniforms));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'water';
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  ctx.root.add(mesh);
}

/**
 * Plank bridge across one '=' tile.
 * @param {import('./context.js').BuildContext} ctx
 * @param {import('./grid.js').Cell} c
 */
function buildBridge(ctx, c) {
  const { grid, seed } = ctx;
  /** @param {import('./grid.js').Cell|null} n */
  const walk = (n) => !!n && !n.t.void && (n.t.bridge || (!n.t.water && n.t.walkable));
  /** @param {import('./grid.js').Cell|null} n */
  const isBridge = (n) => !!n && n.t.bridge;
  const ew = walk(grid.get(c.x - 1, c.y)) || walk(grid.get(c.x + 1, c.y));
  const ns = walk(grid.get(c.x, c.y - 1)) || walk(grid.get(c.x, c.y + 1));
  const alongX = ew || !ns;
  const deck = c.level * LH;
  const floor = c.top;
  const p = ctx.painter(MAT.solid).frame(c.x, 0, c.y, alongX ? 0 : Math.PI / 2);
  const plank = color(TONES.plank);
  const plankLight = color(TONES.woodLight);
  const beam = color(TONES.woodDark);
  const rail = color(PALETTE.timber);
  const tmp = new THREE.Color();

  // Neighbours along the run (local −x / +x) and across it (local −z / +z).
  const prev = alongX ? grid.get(c.x - 1, c.y) : grid.get(c.x, c.y + 1);
  const next = alongX ? grid.get(c.x + 1, c.y) : grid.get(c.x, c.y - 1);
  const sideA = alongX ? grid.get(c.x, c.y - 1) : grid.get(c.x - 1, c.y);
  const sideB = alongX ? grid.get(c.x, c.y + 1) : grid.get(c.x + 1, c.y);

  // Stringers and planks.
  p.box(1.02, 0.1, 0.08, 0, deck - 0.11, -0.43, beam);
  p.box(1.02, 0.1, 0.08, 0, deck - 0.11, 0.43, beam);
  for (let i = 0; i < 5; i++) {
    const lx = -0.4 + i * 0.2;
    const j = hash2(c.x * 5 + i, c.y, seed + 201);
    vary(tmp, j > 0.5 ? plank : plankLight, hash2(c.y, c.x * 5 + i, seed + 203), 0.16);
    p.box(0.18, 0.07, 1.02, lx, deck - 0.035 + (j - 0.5) * 0.012, 0, tmp, (j - 0.5) * 0.06);
  }
  // Support piles at the start of each tile.
  for (const z of [-0.43, 0.43]) {
    const h = deck - 0.1 - floor;
    if (h > 0.02) p.cyl(0.06, 0.07, h, -0.5, floor + h / 2, z, beam, 6);
  }
  // Rails on sides that face open water.
  const railSides = [
    [-0.5, sideA],
    [0.5, sideB],
  ];
  for (const [z, nb] of railSides) {
    const open = !nb || (nb.t.water && !nb.t.bridge);
    if (!open) continue;
    const zz = /** @type {number} */ (z) * 0.92;
    p.box(0.08, 0.5, 0.08, -0.46, deck + 0.25, zz, rail);
    if (!isBridge(next)) p.box(0.08, 0.5, 0.08, 0.46, deck + 0.25, zz, rail);
    p.box(1.02, 0.06, 0.07, 0, deck + 0.47, zz, plankLight);
    p.box(1.02, 0.04, 0.05, 0, deck + 0.26, zz, rail);
  }
  void prev;
}

/**
 * Instanced lily pads (objects of type `lilypad`), bobbing gently.
 * @param {import('./context.js').BuildContext} ctx
 */
function buildLilypads(ctx) {
  const { model, seed } = ctx;
  const pads = model.objects.filter((o) => o.type === 'lilypad');
  if (pads.length === 0) return;

  const batch = new GeometryBatch();
  const m = new THREE.Matrix4();
  const lily = color(TONES.lily);
  const vein = color(PALETTE.meadowDark);
  m.compose(new THREE.Vector3(0, 0, 0), new THREE.Quaternion(), new THREE.Vector3(0.36, 1, 0.36));
  batch.add(SHAPES.notchDisc(), m, (x, y, z, nx, ny, nz, out) =>
    out.copy(lily).lerp(vein, Math.min(1, Math.hypot(x, z) < 0.2 ? 0.4 : 0)),
  );
  // A small blossom on top.
  const petal = color(TONES.lilyFlower);
  const centre = color(TONES.flowerCenter);
  m.compose(new THREE.Vector3(0.08, 0.035, 0.05), new THREE.Quaternion(), new THREE.Vector3(0.08, 0.1, 0.08));
  batch.add(SHAPES.star(6, 0.5), m, petal);
  m.compose(new THREE.Vector3(0.08, 0.05, 0.05), new THREE.Quaternion(), new THREE.Vector3(0.025, 0.02, 0.025));
  batch.add(SHAPES.ico(0), m, centre);
  const geometry = ctx.ownGeometry(/** @type {THREE.BufferGeometry} */ (batch.toGeometry()));

  const mesh = new THREE.InstancedMesh(geometry, ctx.mats.solid, pads.length);
  mesh.name = 'lilypads';
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const data = pads.map((o, i) => {
    const jx = (hash2(o.x, o.y, seed + 301) - 0.5) * 0.24;
    const jz = (hash2(o.y, o.x, seed + 307) - 0.5) * 0.24;
    const tint = 0.9 + hash2(i, o.x, seed + 311) * 0.2;
    mesh.setColorAt(i, new THREE.Color(tint, tint, tint));
    return {
      o,
      x: o.x + jx,
      z: o.y + jz,
      y: model.levelAt(o.x, o.y) * LH - WATER_DROP + 0.012,
      yaw: hash2(o.x * 3, o.y * 7, seed + 313) * Math.PI * 2,
      scale: 0.85 + hash2(o.x * 5, o.y, seed + 317) * 0.3,
      phase: hash2(o.x, o.y * 3, seed + 319) * Math.PI * 2,
      visible: true,
    };
  });
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const place = (t) => {
    data.forEach((d, i) => {
      const s = d.visible ? d.scale : 0;
      pos.set(d.x, d.y + Math.sin(t * 1.3 + d.phase) * 0.012, d.z);
      quat.setFromAxisAngle(up, d.yaw + Math.sin(t * 0.4 + d.phase) * 0.12);
      scl.set(s, s, s);
      m.compose(pos, quat, scl);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  place(0);
  ctx.root.add(mesh);
  ctx.onUpdate((dt, t) => place(t));
  ctx.onFlags((flags) => {
    for (const d of data) d.visible = model.isActive(d.o, flags);
    place(ctx.uniforms.uTime.value);
  });
}
