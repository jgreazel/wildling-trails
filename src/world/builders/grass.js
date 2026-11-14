/**
 * Swaying ground cover: instanced tall-grass clumps (with a per-instance
 * rustle shake), small grass tufts sprinkled over lawns, and instanced
 * flowers (green stems + petals tinted coral / butter / lilac / white).
 */
import * as THREE from 'three';
import { GeometryBatch } from './batch.js';
import { SHAPES } from './shapes.js';
import { patchWorld } from './shaders.js';
import { FLOWER_COLORS, TONES } from '../../render/palette.js';
import { color, getToonGradient, hash2 } from '../../render/materials.js';

/** Seconds a rustle lasts. */
export const RUSTLE_SECONDS = 0.45;
const TALL_HEIGHT = 0.56;

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

/**
 * Blades fanned around a few sub-tufts.
 * @param {number} tufts @param {number} blades per tuft @param {number} spread
 * @param {number} hMin @param {number} hMax @param {number} salt
 */
function clumpGeometry(tufts, blades, spread, hMin, hMax, salt) {
  const b = new GeometryBatch();
  const base = color(TONES.grassBlade);
  const tip = color(TONES.grassTip);
  const shade = (x, y, z, nx, ny, nz, out) => out.copy(base).lerp(tip, Math.min(1, y * 1.1));
  for (let t = 0; t < tufts; t++) {
    const a = (t / tufts) * Math.PI * 2 + hash2(t, salt, 3) * 0.6;
    const r = tufts === 1 ? 0 : spread * (0.55 + hash2(salt, t, 5) * 0.45);
    const tx = Math.cos(a) * r;
    const tz = Math.sin(a) * r;
    for (let i = 0; i < blades; i++) {
      const h = hMin + hash2(t * 7 + i, salt, 11) * (hMax - hMin);
      const yaw = (i / blades) * Math.PI * 2 + hash2(i, t + salt, 13) * 0.8;
      const lean = 0.18 + hash2(t, i + salt, 17) * 0.25;
      _e.set(lean, yaw, 0, 'YXZ');
      _q.setFromEuler(_e);
      const ox = tx + Math.sin(yaw) * 0.03;
      const oz = tz + Math.cos(yaw) * 0.03;
      _m.compose(_p.set(ox, 0, oz), _q, _s.set(0.075, h, 0.075));
      b.add(SHAPES.blade(), _m, shade);
    }
  }
  return /** @type {THREE.BufferGeometry} */ (b.toGeometry());
}

/** Stem + leaves + centre (green / yellow) of a flower, ~0.24 tall. */
function stemGeometry() {
  const b = new GeometryBatch();
  const stem = color(TONES.stem);
  _m.compose(_p.set(0, 0.12, 0), _q.identity(), _s.set(0.022, 0.24, 0.022));
  b.add(SHAPES.cylinder(3, 0.8), _m, stem);
  for (const yaw of [0.6, 2.9]) {
    _e.set(0.9, yaw, 0, 'YXZ');
    _m.compose(_p.set(0, 0.02, 0), _q.setFromEuler(_e), _s.set(0.06, 0.13, 0.06));
    b.add(SHAPES.blade(), _m, stem);
  }
  _m.compose(_p.set(0, 0.252, 0), _q.identity(), _s.set(0.024, 0.018, 0.024));
  b.add(SHAPES.ico(0), _m, color(TONES.flowerCenter));
  return /** @type {THREE.BufferGeometry} */ (b.toGeometry());
}

/** Five white petals (tinted per instance). */
function petalGeometry() {
  const b = new GeometryBatch();
  _m.compose(_p.set(0, 0.236, 0), _q.identity(), _s.set(0.075, 0.12, 0.075));
  b.add(SHAPES.star(5, 0.42), _m, color('#ffffff'));
  return /** @type {THREE.BufferGeometry} */ (b.toGeometry());
}

/**
 * @param {import('./context.js').BuildContext} ctx
 * @param {{height:number, amp:number, rustle?: boolean}} sway
 */
function groundCoverMaterial(ctx, sway) {
  return ctx.kit.own(
    patchWorld(
      new THREE.MeshToonMaterial({
        color: 0xffffff,
        vertexColors: true,
        gradientMap: getToonGradient(),
        side: THREE.DoubleSide,
      }),
      ctx.uniforms,
      { cloud: ctx.outdoor, sway },
    ),
  );
}

/**
 * @param {import('./context.js').BuildContext} ctx
 * @returns {{ rustle(x:number, y:number): boolean }}
 */
export function buildGrass(ctx) {
  const { grid, model, seed } = ctx;
  const tall = [];
  const tufts = [];
  const flowers = [];
  /** @param {number} x @param {number} y */
  const free = (x, y) => model.objectsAt(x, y).length === 0;

  for (const c of grid.cells) {
    if (!c.inMap || c.t.void) continue;
    if (c.t.tallGrass) {
      tall.push(c);
      continue;
    }
    if (c.t.ground !== 'grass' || !c.t.walkable || !free(c.x, c.y)) continue;
    if (c.t.flowers) {
      const n = 5 + Math.floor(hash2(c.x, c.y, seed + 701) * 3);
      for (let i = 0; i < n; i++) flowers.push({ c, i, salt: 703 });
    } else if (hash2(c.x, c.y, seed + 711) < 0.06) {
      flowers.push({ c, i: 0, salt: 713 });
    }
    if (!c.t.flowers && hash2(c.y, c.x, seed + 721) < 0.36) {
      const n = 1 + Math.floor(hash2(c.x * 3, c.y, seed + 723) * 2);
      for (let i = 0; i < n; i++) tufts.push({ c, i });
    }
  }

  /** @type {Map<string, number>} */
  const tallIndex = new Map();
  /** @type {Float32Array} */
  let timers = new Float32Array(0);
  /** @type {THREE.InstancedBufferAttribute|null} */
  let rustleAttr = null;

  if (tall.length) {
    const geo = ctx.ownGeometry(clumpGeometry(5, 4, 0.27, 0.36, TALL_HEIGHT, 1));
    rustleAttr = new THREE.InstancedBufferAttribute(new Float32Array(tall.length), 1);
    rustleAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aRustle', rustleAttr);
    timers = new Float32Array(tall.length);
    const mat = groundCoverMaterial(ctx, { height: TALL_HEIGHT, amp: 0.07, rustle: true });
    const mesh = new THREE.InstancedMesh(geo, mat, tall.length);
    mesh.name = 'tallgrass';
    mesh.receiveShadow = true;
    const tint = new THREE.Color();
    tall.forEach((c, i) => {
      tallIndex.set(`${c.x},${c.y}`, i);
      const s = 0.95 + hash2(c.x, c.y, seed + 731) * 0.15;
      _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.floor(hash2(c.y, c.x, seed + 733) * 4) * (Math.PI / 2) + 0.2);
      _m.compose(_p.set(c.x, c.top, c.y), _q, _s.set(s, s, s));
      mesh.setMatrixAt(i, _m);
      const k = 0.92 + hash2(c.x * 3, c.y * 7, seed + 735) * 0.14;
      mesh.setColorAt(i, tint.setRGB(k, k, k * 0.95));
    });
    mesh.computeBoundingSphere();
    ctx.root.add(mesh);

    ctx.onUpdate((dt) => {
      let dirty = false;
      for (let i = 0; i < timers.length; i++) {
        if (timers[i] <= 0) continue;
        timers[i] = Math.max(0, timers[i] - dt);
        const k = timers[i] / RUSTLE_SECONDS;
        rustleAttr.array[i] = k * k * (3 - 2 * k);
        dirty = true;
      }
      if (dirty) rustleAttr.needsUpdate = true;
    });
  }

  if (tufts.length) {
    const geo = ctx.ownGeometry(clumpGeometry(1, 7, 0, 0.16, 0.3, 2));
    const mat = groundCoverMaterial(ctx, { height: 0.3, amp: 0.04 });
    const mesh = new THREE.InstancedMesh(geo, mat, tufts.length);
    mesh.name = 'tufts';
    mesh.receiveShadow = true;
    const tint = new THREE.Color();
    tufts.forEach(({ c, i }, n) => {
      const x = c.x + (hash2(c.x * 5 + i, c.y, seed + 741) - 0.5) * 0.8;
      const z = c.y + (hash2(c.x, c.y * 5 + i, seed + 743) - 0.5) * 0.8;
      const s = 0.75 + hash2(c.y + i, c.x, seed + 745) * 0.5;
      _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, hash2(c.x + i, c.y, seed + 747) * 6.28);
      _m.compose(_p.set(x, c.top, z), _q, _s.set(s, s, s));
      mesh.setMatrixAt(n, _m);
      const k = 0.88 + hash2(c.x, c.y + i, seed + 749) * 0.2;
      mesh.setColorAt(n, tint.setRGB(k, k, k));
    });
    mesh.computeBoundingSphere();
    ctx.root.add(mesh);
  }

  if (flowers.length) {
    const mat = groundCoverMaterial(ctx, { height: 0.3, amp: 0.035 });
    const stems = new THREE.InstancedMesh(ctx.ownGeometry(stemGeometry()), mat, flowers.length);
    const petals = new THREE.InstancedMesh(ctx.ownGeometry(petalGeometry()), mat, flowers.length);
    stems.name = 'flower-stems';
    petals.name = 'flower-petals';
    stems.receiveShadow = true;
    petals.receiveShadow = true;
    const petalColors = FLOWER_COLORS.map((h) => color(h));
    flowers.forEach(({ c, i, salt }, n) => {
      const spread = c.t.flowers ? 0.82 : 0.6;
      const x = c.x + (hash2(c.x * 9 + i, c.y, seed + salt) - 0.5) * spread;
      const z = c.y + (hash2(c.x, c.y * 9 + i, seed + salt + 1) - 0.5) * spread;
      const s = 0.85 + hash2(c.y * 3 + i, c.x, seed + salt + 2) * 0.45;
      _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, hash2(c.x + i, c.y - i, seed + salt + 3) * 6.28);
      _m.compose(_p.set(x, c.top, z), _q, _s.set(s, s, s));
      stems.setMatrixAt(n, _m);
      petals.setMatrixAt(n, _m);
      // Each flower bed favours one colour, with a few strays.
      const bed = Math.floor(hash2(Math.floor(c.x / 3), Math.floor(c.y / 3), seed + 751) * petalColors.length);
      const stray = hash2(c.x * 13 + i, c.y * 11, seed + 753) < 0.3;
      const k = stray ? Math.floor(hash2(i, c.x * c.y, seed + 755) * petalColors.length) : bed;
      petals.setColorAt(n, petalColors[k]);
    });
    stems.computeBoundingSphere();
    petals.computeBoundingSphere();
    ctx.root.add(stems, petals);
  }

  return {
    /** Start the rustle shake for the tall grass at a tile. @param {number} x @param {number} y */
    rustle(x, y) {
      const i = tallIndex.get(`${x},${y}`);
      if (i === undefined) return false;
      timers[i] = RUSTLE_SECONDS;
      return true;
    },
  };
}
