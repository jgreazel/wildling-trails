/**
 * Outdoor props: sign, mailbox, lamp, barrel, crate, flowerpot, stump, statue,
 * well, bench, logpile and the animated waterwheel. Each builder receives a
 * painter in the object's frame (footprint centre on the ground, facing applied).
 */
import { MAT } from './context.js';
import { PALETTE, TONES, FLOWER_COLORS } from '../../render/palette.js';
import { color, hash2, hashString, safeColor } from '../../render/materials.js';
import { BASIN_DEPTH, WATER_DROP } from './grid.js';

/** @typedef {import('./painter.js').Painter} Painter */
/** @typedef {import('./context.js').BuildContext} Ctx */

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function sign(ctx, o, p) {
  const post = color(TONES.woodDark);
  const board = safeColor(o.color, TONES.woodLight);
  const ink = color(TONES.woodDark);
  p.box(0.08, 0.78, 0.08, -0.3, 0.39, -0.02, post);
  p.box(0.08, 0.78, 0.08, 0.3, 0.39, -0.02, post);
  p.box(0.8, 0.46, 0.07, 0, 0.6, 0.02, board);
  p.box(0.86, 0.05, 0.09, 0, 0.85, 0.02, post);
  p.box(0.86, 0.05, 0.09, 0, 0.36, 0.02, post);
  p.box(0.52, 0.035, 0.02, -0.02, 0.7, 0.06, ink);
  p.box(0.42, 0.035, 0.02, -0.07, 0.61, 0.06, ink);
  p.box(0.48, 0.035, 0.02, -0.04, 0.52, 0.06, ink);
  p.ico(0.05, 0.27, 0.7, 0.07, color(PALETTE.foliageLight), { sx: 1.3, sy: 0.7, sz: 0.4 });
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function mailbox(ctx, o, p) {
  const body = safeColor(o.color, PALETTE.roofSlate);
  p.box(0.09, 0.62, 0.09, 0, 0.31, 0, color(TONES.woodDark));
  p.block(0.28, 0.2, 0.44, 0, 0.6, 0, body);
  p.cyl(0.14, 0.14, 0.44, 0, 0.8, 0, body, 10, { x: Math.PI / 2 });
  p.box(0.22, 0.26, 0.02, 0, 0.72, 0.225, body.clone().multiplyScalar(0.8));
  p.box(0.02, 0.24, 0.02, 0.16, 0.86, -0.08, color(TONES.iron));
  p.box(0.02, 0.1, 0.14, 0.165, 0.94, -0.02, color(TONES.flowerCoral));
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function lamp(ctx, o, p) {
  const iron = color(TONES.iron);
  const ironLight = color(TONES.ironLight);
  p.block(0.24, 0.12, 0.24, 0, 0, 0, color(TONES.stone));
  p.cyl(0.045, 0.065, 1.42, 0, 0.83, 0, iron, 8);
  p.cyl(0.07, 0.07, 0.06, 0, 1.5, 0, ironLight, 8);
  p.mat(MAT.glow).box(0.2, 0.26, 0.2, 0, 1.66, 0, color(TONES.canvas));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(0.03, 0.28, 0.03, sx * 0.105, 1.66, sz * 0.105, iron);
  p.box(0.26, 0.04, 0.26, 0, 1.53, 0, iron);
  p.cone(0.21, 0.16, 0, 1.87, 0, iron, 4, Math.PI / 4);
  p.sphere(0.03, 0, 1.97, 0, ironLight, { w: 6, h: 4 });
  const head = p.world(0, 1.66, 0);
  ctx.addHalo(head, 2.4, PALETTE.lampGlow, 'night', o);
  ctx.addLight(head, PALETTE.lampGlow, 1, 'night', o);
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function barrel(ctx, o, p) {
  const wood = safeColor(o.color, TONES.wood);
  const hoop = color(TONES.iron);
  p.cyl(0.27, 0.23, 0.3, 0, 0.15, 0, wood, 10);
  p.cyl(0.23, 0.27, 0.3, 0, 0.45, 0, wood, 10);
  p.cyl(0.275, 0.26, 0.04, 0, 0.12, 0, hoop, 10);
  p.cyl(0.26, 0.275, 0.04, 0, 0.48, 0, hoop, 10);
  p.cyl(0.21, 0.21, 0.02, 0, 0.6, 0, color(TONES.woodDark), 10);
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function crate(ctx, o, p) {
  const wood = safeColor(o.color, TONES.woodLight);
  const dark = color(TONES.wood);
  p.box(0.68, 0.64, 0.68, 0, 0.32, 0, wood);
  for (const y of [0.04, 0.6]) p.box(0.72, 0.07, 0.72, 0, y, 0, dark);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(0.07, 0.64, 0.07, sx * 0.33, 0.32, sz * 0.33, dark);
  p.box(0.06, 0.78, 0.02, 0, 0.32, 0.35, dark, { z: 0.78 });
  p.box(0.02, 0.78, 0.06, 0.35, 0.32, 0, dark, { x: 0.78 });
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function flowerpot(ctx, o, p) {
  const pot = color(TONES.brick);
  p.cyl(0.24, 0.17, 0.32, 0, 0.16, 0, pot, 9);
  p.cyl(0.27, 0.27, 0.06, 0, 0.33, 0, pot.clone().multiplyScalar(1.08), 9);
  p.cyl(0.22, 0.22, 0.02, 0, 0.36, 0, color(TONES.earthDark), 9);
  p.ico(0.24, 0, 0.5, 0, color(PALETTE.foliageLight), { sy: 0.75 });
  const petal = safeColor(o.color, FLOWER_COLORS[(o.x + o.y) % FLOWER_COLORS.length]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    p.ico(0.055, Math.cos(a) * 0.16, 0.6 + (i % 2) * 0.06, Math.sin(a) * 0.16, petal);
  }
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function stump(ctx, o, p) {
  const bark = color(PALETTE.bark);
  p.cyl(0.3, 0.36, 0.34, 0, 0.17, 0, bark, 9);
  p.cyl(0.28, 0.28, 0.02, 0, 0.345, 0, color(TONES.woodPale), 9);
  p.cyl(0.18, 0.18, 0.02, 0, 0.352, 0, color(TONES.woodLight), 9);
  p.cyl(0.08, 0.08, 0.02, 0, 0.358, 0, color(TONES.woodPale), 7);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.5;
    p.box(0.12, 0.12, 0.3, Math.sin(a) * 0.33, 0.05, Math.cos(a) * 0.33, bark, { y: a, x: -0.3 });
  }
  p.cyl(0.025, 0.03, 0.1, 0.3, 0.05, 0.22, color(TONES.canvas), 5);
  p.sphere(0.07, 0.3, 0.11, 0.22, color(TONES.flowerCoral), { sy: 0.55, w: 8, h: 5 });
}

/**
 * Stone plinth with an original abstract stone creature (round belly, leaf crest).
 * `species` picks the ear style so different statues read differently.
 * @param {Ctx} ctx @param {any} o @param {Painter} p
 */
function statue(ctx, o, p) {
  const stone = color(TONES.stone);
  const stoneLight = color(TONES.stoneLight);
  const moss = color(TONES.moss);
  const carved = (x, y, z, nx, ny, nz, out) => out.copy(stone).lerp(ny > 0.6 ? moss : stoneLight, ny > 0.6 ? 0.55 : Math.max(0, ny) * 0.4);
  p.block(0.66, 0.34, 0.66, 0, 0, 0, stone);
  p.block(0.54, 0.1, 0.54, 0, 0.34, 0, stoneLight);
  p.box(0.3, 0.12, 0.02, 0, 0.18, 0.335, color(TONES.brass));
  p.ico(0.2, 0, 0.62, 0, carved, { sy: 1.05, detail: 1 });
  p.ico(0.15, 0, 0.9, 0.04, carved, { detail: 1 });
  p.ico(0.05, -0.06, 0.92, 0.17, stoneLight);
  p.ico(0.05, 0.06, 0.92, 0.17, stoneLight);
  const style = o.species ? hashString(o.species) % 3 : 0;
  for (const sx of [-1, 1]) {
    if (style === 0) p.cone(0.055, 0.2, sx * 0.09, 1.08, 0, carved, 5, { z: -sx * 0.35 });
    else if (style === 1) p.ico(0.05, sx * 0.08, 1.12, -0.02, carved, { sy: 2.4, rot: { z: -sx * 0.25 } });
    else p.ico(0.075, sx * 0.13, 1.0, 0, carved, { sz: 0.4 });
  }
  p.ico(0.07, 0, 1.06, -0.04, moss, { sx: 0.5, sy: 1.4, sz: 0.9, rot: { x: -0.4 } });
  p.torus(0.12, 0.045, 0, 0.55, -0.2, carved, { arc: Math.PI * 1.4, rot: { y: Math.PI / 2 }, rs: 4, ts: 8 });
  p.ico(0.06, -0.1, 0.44, 0.12, carved);
  p.ico(0.06, 0.1, 0.44, 0.12, carved);
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function well(ctx, o, p) {
  const stones = [color(TONES.stone), color(TONES.stoneLight), color(TONES.rockWarm), color(TONES.stoneDark)];
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    p.box(0.36, 0.5, 0.18, Math.sin(a) * 0.6, 0.25, Math.cos(a) * 0.6, stones[(i * 7 + o.x) % stones.length], a);
  }
  p.torus(0.6, 0.1, 0, 0.52, 0, color(TONES.stoneLight), { rot: { x: Math.PI / 2 }, rs: 4, ts: 14 });
  p.disc(0.52, 0, 0.3, 0, color(PALETTE.waterDeep), 12);
  const wood = color(TONES.wood);
  for (const sx of [-1, 1]) p.box(0.1, 1.42, 0.1, sx * 0.72, 0.71, 0, wood);
  const roof = safeColor(o.color, PALETTE.roofTerracotta);
  p.box(1.8, 0.06, 0.66, 0, 1.5, 0.25, roof, { x: 0.62 });
  p.box(1.8, 0.06, 0.66, 0, 1.5, -0.25, roof, { x: -0.62 });
  p.box(1.84, 0.08, 0.08, 0, 1.69, 0, roof.clone().multiplyScalar(0.8));
  p.cyl(0.045, 0.045, 1.44, 0, 1.08, 0, color(TONES.woodDark), 6, { z: Math.PI / 2 });
  p.box(0.04, 0.2, 0.04, 0.78, 1.0, 0.0, color(TONES.iron));
  p.box(0.12, 0.04, 0.04, 0.82, 0.9, 0.0, color(TONES.iron));
  p.box(0.015, 0.22, 0.015, 0, 0.94, 0, color(TONES.woodPale));
  p.cyl(0.1, 0.08, 0.14, 0, 0.78, 0, wood, 8);
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function bench(ctx, o, p) {
  const wood = safeColor(o.color, TONES.woodLight);
  const frame = color(TONES.iron);
  for (const z of [-0.1, 0.03, 0.16]) p.box(1.62, 0.05, 0.12, 0, 0.42, z, wood);
  p.box(1.62, 0.1, 0.04, 0, 0.62, -0.2, wood, { x: -0.15 });
  p.box(1.62, 0.1, 0.04, 0, 0.77, -0.22, wood, { x: -0.15 });
  for (const sx of [-0.68, 0.68]) {
    p.box(0.06, 0.42, 0.06, sx, 0.21, 0.14, frame);
    p.box(0.06, 0.82, 0.06, sx, 0.41, -0.2, frame, { x: -0.12 });
    p.box(0.06, 0.05, 0.38, sx, 0.58, -0.02, frame);
  }
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function logpile(ctx, o, p) {
  const bark = color(PALETTE.bark);
  const end = color(TONES.woodPale);
  const rows = [
    [-0.29, 0.14],
    [0, 0.14],
    [0.29, 0.14],
    [-0.145, 0.39],
    [0.145, 0.39],
    [0, 0.64],
  ];
  rows.forEach(([z, y], i) => {
    const len = 1.5 + hash2(i, o.x, 3) * 0.2;
    const shift = (hash2(o.y, i, 5) - 0.5) * 0.12;
    p.cyl(0.14, 0.14, len, shift, y, z, bark, 8, { z: Math.PI / 2 });
    p.cyl(0.115, 0.115, 0.02, shift + len / 2, y, z, end, 8, { z: Math.PI / 2 });
    p.cyl(0.115, 0.115, 0.02, shift - len / 2, y, z, end, 8, { z: Math.PI / 2 });
  });
  for (const sx of [-0.62, 0.62]) p.box(0.08, 0.8, 0.08, sx, 0.4, 0.42, color(TONES.woodDark));
}

/**
 * Waterwheel beside a mill: a static axle + supports, and a wheel that turns.
 * @param {Ctx} ctx @param {any} o @param {Painter} p
 */
function waterwheel(ctx, o, p) {
  const { model } = ctx;
  const millWest = [o.y, o.y + 1].some((y) => model.objectsAt(o.x - 1, y).some((b) => b.type === 'building'));
  const millEast = [o.y, o.y + 1].some((y) => model.objectsAt(o.x + 1, y).some((b) => b.type === 'building'));
  const toward = millWest ? -1 : millEast ? 1 : -1;
  const hubY = 0.62;
  const R = 0.82;
  const wood = color(TONES.wood);
  const dark = color(TONES.woodDark);
  const plank = color(TONES.plank);
  const floor = -(BASIN_DEPTH - WATER_DROP);

  // Static: axle into the mill wall and a support trestle on the open side.
  p.cyl(0.05, 0.05, 0.8, toward * 0.4, hubY, 0, color(TONES.iron), 8, { z: Math.PI / 2 });
  for (const sz of [-0.2, 0.2]) {
    p.box(0.1, hubY - floor + 0.05, 0.1, -toward * 0.28, (hubY + floor) / 2, sz, dark, { x: sz * 0.6 });
  }
  const foam = color(TONES.waterFoam);
  for (let i = 0; i < 4; i++) {
    p.ico(0.14 + i * 0.02, (i - 1.5) * 0.08, 0.02, -0.5 + i * 0.33, foam, { sy: 0.25 });
  }

  // Turning wheel.
  const dyn = ctx.dynamic(o, `waterwheel:${o.id}`);
  const w = dyn.painter();
  for (const sx of [-0.16, 0.16]) {
    w.torus(R, 0.045, sx, 0, 0, dark, { rot: Math.PI / 2, rs: 4, ts: 18 });
    w.torus(R * 0.55, 0.03, sx, 0, 0, dark, { rot: Math.PI / 2, rs: 4, ts: 12 });
    for (let k = 0; k < 4; k++) w.box(0.04, R * 2, 0.06, sx, 0, 0, wood, { x: (k * Math.PI) / 4 });
  }
  const paddles = 12;
  for (let k = 0; k < paddles; k++) {
    const phi = (k / paddles) * Math.PI * 2;
    w.box(0.4, 0.26, 0.05, 0, Math.sin(phi) * (R - 0.08), Math.cos(phi) * (R - 0.08), plank, { x: Math.PI / 2 - phi });
  }
  w.cyl(0.12, 0.12, 0.42, 0, 0, 0, dark, 8, { z: Math.PI / 2 });
  dyn.finish();
  const at = p.world(0, hubY, 0);
  dyn.group.position.copy(at);
  dyn.group.rotation.order = 'YXZ';
  ctx.onUpdate((dt) => {
    dyn.group.rotation.x -= dt * 0.75;
  });
}

/**
 * Builders keyed by object type (outdoor props).
 * @type {Record<string, (ctx: Ctx, o: any, p: Painter) => void>}
 */
export const PROP_BUILDERS = {
  sign,
  mailbox,
  lamp,
  barrel,
  crate,
  flowerpot,
  stump,
  statue,
  well,
  bench,
  logpile,
  waterwheel,
};

/**
 * Neutral placeholder for unknown object types.
 * @param {Ctx} ctx @param {any} o @param {Painter} p
 */
export function placeholder(ctx, o, p) {
  const w = Math.max(0.5, (o.w ?? 1) - 0.3);
  const d = Math.max(0.5, (o.h ?? 1) - 0.3);
  p.box(w, 0.6, d, 0, 0.3, 0, color('#a9a3b5'));
  p.box(w + 0.04, 0.08, d + 0.04, 0, 0.3, 0, color('#7d778a'));
}
