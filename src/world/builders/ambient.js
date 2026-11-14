/**
 * Cheap ambient charm: fireflies drifting near water and meadows at night,
 * a few butterflies over the flowers by day, and chimney smoke puffs.
 * (Drifting cloud shadows live in the world material patch.)
 */
import * as THREE from 'three';
import { createBillboardGeometry } from './glow.js';
import { createHaloMaterial, patchWorld } from './shaders.js';
import { FLOWER_COLORS, TONES } from '../../render/palette.js';
import { color, getToonGradient, hash2 } from '../../render/materials.js';

const MAX_FIREFLIES = 26;
const MAX_BUTTERFLIES = 6;
const PUFFS_PER_CHIMNEY = 5;

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * @param {import('./context.js').BuildContext} ctx
 */
export function buildAmbient(ctx) {
  if (ctx.outdoor) {
    buildFireflies(ctx);
    buildButterflies(ctx);
  }
  buildSmoke(ctx);
}

/** Deterministically pick up to `n` items, spread out by hash order. */
function pick(list, n, seed) {
  return list
    .map((c) => ({ c, k: hash2(c.x, c.y, seed) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, n)
    .map((e) => e.c);
}

/** @param {import('./context.js').BuildContext} ctx */
function buildFireflies(ctx) {
  const { grid, seed } = ctx;
  const spots = [];
  for (const c of grid.cells) {
    if (!c.inMap || c.t.void) continue;
    const bank = c.t.water && !c.t.bridge && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const n = grid.get(c.x + dx, c.y + dy);
      return n && !n.t.water;
    });
    if (bank || c.t.tallGrass || c.t.flowers) spots.push(c);
  }
  if (spots.length === 0) return;
  const chosen = pick(spots, MAX_FIREFLIES, seed + 1001);
  const { geo, attrs } = createBillboardGeometry(chosen.length);
  const glowColor = color(TONES.firefly);
  chosen.forEach((c, i) => {
    const y = Math.max(c.top, c.level * 0.5) + 0.45 + hash2(c.x, c.y, seed + 1003) * 0.6;
    attrs.offset.setXYZ(i, c.x + (hash2(i, c.x, seed) - 0.5) * 0.6, y, c.y + (hash2(c.y, i, seed) - 0.5) * 0.6);
    attrs.size.setX(i, 0.22 + hash2(i, c.y, seed + 1005) * 0.08);
    attrs.color.setXYZ(i, glowColor.r, glowColor.g, glowColor.b);
    attrs.phase.setX(i, hash2(c.x * 7, c.y * 3, seed + 1007) * 10);
    attrs.mode.setX(i, 0);
  });
  ctx.ownGeometry(geo);
  const mesh = new THREE.Mesh(geo, ctx.kit.own(createHaloMaterial(ctx.uniforms, { firefly: true })));
  mesh.name = 'fireflies';
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.visible = false;
  ctx.root.add(mesh);
  ctx.onUpdate((dt, t, env) => {
    mesh.visible = env.night > 0.5;
  });
}

/** Two flat wings hinged on the body axis (z), plus a slim body. */
function butterflyGeometry() {
  const pos = [];
  const col = [];
  const white = [1, 1, 1];
  const body = color(TONES.birchMark);
  const tri = (a, b, c, rgb) => {
    pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) col.push(...rgb);
  };
  for (const s of [-1, 1]) {
    tri([0, 0, -0.04], [s * 0.13, 0, -0.08], [s * 0.12, 0, 0.02], white);
    tri([0, 0, -0.04], [s * 0.12, 0, 0.02], [0, 0, 0.03], white);
    tri([0, 0, 0.0], [s * 0.09, 0, 0.03], [s * 0.05, 0, 0.09], white);
  }
  tri([-0.008, 0.005, -0.06], [0.008, 0.005, -0.06], [0, 0.005, 0.07], [body.r, body.g, body.b]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** @param {import('./context.js').BuildContext} ctx */
function buildButterflies(ctx) {
  const { grid, seed } = ctx;
  const flowerCells = grid.cells.filter((c) => c.inMap && c.t.flowers);
  const homes = flowerCells.length
    ? pick(flowerCells, MAX_BUTTERFLIES, seed + 1101)
    : pick(grid.cells.filter((c) => c.inMap && c.t.ground === 'grass' && c.t.walkable), 3, seed + 1103);
  if (homes.length === 0) return;
  const n = homes.length;
  const geo = ctx.ownGeometry(butterflyGeometry());
  const flap = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  geo.setAttribute('aFlap', flap);
  const material = ctx.kit.own(
    patchWorld(
      new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: getToonGradient(), side: THREE.DoubleSide }),
      ctx.uniforms,
      { flap: true },
    ),
  );
  const mesh = new THREE.InstancedMesh(geo, material, n);
  mesh.name = 'butterflies';
  mesh.frustumCulled = false;
  const data = homes.map((c, i) => {
    flap.setX(i, hash2(i, c.x, seed + 1105) * 6.28);
    mesh.setColorAt(i, color(FLOWER_COLORS[(i + c.x) % FLOWER_COLORS.length]));
    return { x: c.x, y: c.top, z: c.y, ph: hash2(c.y, i, seed + 1107) * 6.28, r: 0.8 + hash2(i, c.y, seed + 1109) * 0.8 };
  });
  ctx.root.add(mesh);
  const place = (t, scale) => {
    data.forEach((d, i) => {
      const a = t * 0.45 + d.ph;
      const x = d.x + Math.sin(a) * d.r;
      const z = d.z + Math.sin(a * 0.7 + 1.3) * d.r * 0.8;
      const dxdt = Math.cos(a) * d.r;
      const dzdt = Math.cos(a * 0.7 + 1.3) * d.r * 0.56;
      _q.setFromAxisAngle(UP, Math.atan2(dxdt, dzdt));
      _m.compose(
        _p.set(x, d.y + 0.55 + Math.sin(t * 1.9 + d.ph) * 0.18, z),
        _q,
        _s.set(scale, scale, scale),
      );
      mesh.setMatrixAt(i, _m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  place(0, 1);
  ctx.onUpdate((dt, t, env) => {
    const day = 1 - Math.min(1, env.night * 1.6);
    mesh.visible = day > 0.05;
    if (mesh.visible) place(t, day);
  });
}

/** @param {import('./context.js').BuildContext} ctx */
function buildSmoke(ctx) {
  const chimneys = ctx.chimneys;
  if (chimneys.length === 0) return;
  const n = chimneys.length * PUFFS_PER_CHIMNEY;
  const geo = ctx.ownGeometry(new THREE.IcosahedronGeometry(1, 0));
  geo.deleteAttribute('uv');
  const material = ctx.kit.toon(TONES.smoke, { transparent: true, opacity: 0.78, depthWrite: false });
  const mesh = new THREE.InstancedMesh(geo, material, n);
  mesh.name = 'chimney-smoke';
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  ctx.root.add(mesh);
  let flags = ctx.flags;
  ctx.onFlags((f) => {
    flags = f;
  });
  const place = (t) => {
    chimneys.forEach((c, ci) => {
      const on = !c.owner || ctx.model.isActive(c.owner, flags);
      for (let k = 0; k < PUFFS_PER_CHIMNEY; k++) {
        const i = ci * PUFFS_PER_CHIMNEY + k;
        const phase = (t * 0.22 + k / PUFFS_PER_CHIMNEY + ci * 0.37) % 1;
        const grow = phase < 0.1 ? phase / 0.1 : 1;
        const fade = phase > 0.7 ? 1 - (phase - 0.7) / 0.3 : 1;
        const s = on ? (0.07 + phase * 0.2) * grow * fade : 0;
        _p.set(
          c.pos.x + phase * 0.45 + Math.sin(t * 0.8 + k + ci) * 0.05,
          c.pos.y + phase * 1.4,
          c.pos.z - phase * 0.15,
        );
        _q.setFromAxisAngle(UP, phase * 3 + k);
        _m.compose(_p, _q, _s.set(s, s * 0.85, s));
        mesh.setMatrixAt(i, _m);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  place(0);
  ctx.onUpdate((dt, t) => place(t));
}
