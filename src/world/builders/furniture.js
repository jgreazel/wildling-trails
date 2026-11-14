/**
 * Indoor furniture: bed, table, bookshelf, desk, planter, fireplace (animated
 * flames + real light), counter, chair, stool, stove, cupboard, plant, radio,
 * terminal, machine, sink, rug, and the starter pedestal that shows a live
 * wildling model (hidden when `emptyIf` holds).
 */
import { MAT } from './context.js';
import { ACCENTS, FLOWER_COLORS, PALETTE, TONES } from '../../render/palette.js';
import { color, hash2, safeColor } from '../../render/materials.js';
import { anyFlag } from '../map-utils.js';

/** @typedef {import('./painter.js').Painter} Painter */
/** @typedef {import('./context.js').BuildContext} Ctx */

const C = {
  wood: () => color(TONES.wood),
  woodLight: () => color(TONES.woodLight),
  woodDark: () => color(TONES.woodDark),
  brass: () => color(TONES.brass),
  iron: () => color(TONES.iron),
  linen: () => color(TONES.linen),
};

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function bed(ctx, o, p) {
  const wood = C.wood();
  const dark = C.woodDark();
  p.block(0.9, 0.3, 1.86, 0, 0, 0, wood);
  p.block(0.96, 0.78, 0.09, 0, 0, -0.9, dark);
  p.cyl(0.05, 0.05, 0.98, 0, 0.8, -0.9, wood, 8, { z: Math.PI / 2 });
  p.block(0.96, 0.46, 0.07, 0, 0, 0.92, dark);
  p.block(0.84, 0.14, 1.74, 0, 0.3, 0, C.linen());
  p.rbox(0.6, 0.13, 0.3, 0, 0.5, -0.64, C.linen());
  const blanket = safeColor(o.color, TONES.blanket);
  p.rbox(0.9, 0.1, 1.1, 0, 0.47, 0.3, blanket);
  p.rbox(0.9, 0.06, 0.18, 0, 0.53, -0.2, blanket.clone().lerp(color('#ffffff'), 0.35));
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function table(ctx, o, p) {
  const top = C.woodLight();
  p.block(1.84, 0.07, 0.86, 0, 0.62, 0, top);
  for (const sx of [-0.8, 0.8]) for (const sz of [-0.34, 0.34]) p.cyl(0.04, 0.05, 0.62, sx, 0.31, sz, C.wood(), 6);
  p.box(0.5, 0.01, 0.88, 0, 0.695, 0, safeColor(o.color, TONES.rug));
  p.cyl(0.06, 0.05, 0.16, 0.42, 0.77, -0.05, color(TONES.pedestalGlass), 8);
  for (let i = 0; i < 3; i++) p.ico(0.045, 0.42 + (i - 1) * 0.05, 0.89 + (i % 2) * 0.03, -0.05, color(FLOWER_COLORS[i]));
  for (const z of [-0.18, 0.18]) {
    p.cyl(0.05, 0.04, 0.08, -0.45, 0.73, z, color(TONES.frameWhite), 8);
  }
  p.cyl(0.14, 0.14, 0.02, -0.05, 0.705, 0.1, color(TONES.frameWhite), 10);
  p.ico(0.08, -0.05, 0.75, 0.1, color(TONES.flowerButter), { sy: 0.6 });
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function bookshelf(ctx, o, p) {
  const wood = C.wood();
  const dark = C.woodDark();
  const H = 1.6;
  p.block(1.84, H, 0.05, 0, 0, -0.2, dark);
  for (const sx of [-0.9, 0.9]) p.block(0.06, H, 0.44, sx, 0, -0.02, wood);
  const shelves = [0, 0.4, 0.8, 1.2];
  for (const y of [...shelves, H - 0.04]) p.block(1.8, 0.04, 0.44, 0, y, -0.02, wood);
  const salt = o.x * 13 + o.y * 7;
  shelves.forEach((y, row) => {
    let x = -0.84;
    let i = 0;
    while (x < 0.8) {
      const h1 = hash2(i, row + salt, 3);
      const bw = 0.06 + h1 * 0.07;
      if (x + bw > 0.84) break;
      if (hash2(row, i + salt, 5) < 0.08) {
        x += 0.12;
        i++;
        continue;
      }
      const bh = 0.22 + hash2(i + salt, row, 7) * 0.12;
      const lean = hash2(salt, i * row, 9) < 0.06 ? 0.2 : 0;
      p.box(bw, bh, 0.3, x + bw / 2, y + 0.04 + bh / 2, 0, color(ACCENTS[Math.floor(hash2(i, row * 3 + salt, 11) * ACCENTS.length)]), { z: lean });
      x += bw + 0.008;
      i++;
    }
  });
  p.cyl(0.07, 0.06, 0.12, 0.6, H + 0.06, -0.02, color(TONES.brick), 7);
  p.ico(0.11, 0.6, H + 0.19, -0.02, color(PALETTE.foliageLight), { sy: 0.8 });
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function desk(ctx, o, p) {
  const top = C.woodLight();
  const wood = C.wood();
  p.block(1.8, 0.06, 0.76, 0, 0.66, 0, top);
  p.block(0.52, 0.66, 0.72, 0.6, 0, 0, wood);
  for (const y of [0.14, 0.38]) {
    p.box(0.44, 0.18, 0.02, 0.6, y + 0.09, 0.37, C.woodDark());
    p.sphere(0.02, 0.6, y + 0.09, 0.39, C.brass(), { w: 6, h: 4 });
  }
  for (const sz of [-0.32, 0.32]) p.block(0.06, 0.66, 0.06, -0.84, 0, sz, wood);
  p.box(0.3, 0.015, 0.22, -0.28, 0.7, 0.05, C.linen(), 0.15);
  p.box(0.3, 0.015, 0.22, 0.0, 0.7, 0.06, C.linen(), -0.1);
  p.box(0.2, 0.012, 0.012, -0.1, 0.71, 0.2, color(TONES.flowerButter), 0.6);
  // Little desk lamp with a warm shade.
  p.cyl(0.07, 0.08, 0.03, -0.66, 0.705, -0.18, C.iron(), 8);
  p.box(0.025, 0.36, 0.025, -0.66, 0.88, -0.18, C.iron());
  p.mat(MAT.glow).cyl(0.06, 0.13, 0.13, -0.66, 1.06, -0.12, color(TONES.canvas), 8, { x: 0.3 });
  const at = p.world(-0.66, 1.0, -0.1);
  ctx.addHalo(at, 1.0, PALETTE.lampGlow, 'always', o);
  ctx.addLight(at, PALETTE.lampGlow, 0.45, 'always', o);
  p.cyl(0.06, 0.05, 0.08, 0.6, 0.73, -0.2, color(TONES.brick), 7);
  p.ico(0.07, 0.6, 0.82, -0.2, color(PALETTE.meadowDark), { sy: 1.2 });
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function planter(ctx, o, p) {
  p.block(1.84, 0.42, 0.7, 0, 0, 0, C.wood());
  p.block(1.88, 0.05, 0.74, 0, 0.4, 0, C.woodDark());
  p.box(1.74, 0.04, 0.6, 0, 0.42, 0, color(TONES.earthDark));
  const greens = [color(PALETTE.foliage), color(PALETTE.foliageLight), color(TONES.coniferLight), color(PALETTE.meadowDark)];
  for (let i = 0; i < 6; i++) {
    const x = -0.72 + i * 0.29;
    const hgt = 0.14 + hash2(i, o.x, 3) * 0.16;
    if (i % 3 === 1) p.cone(0.1, hgt * 2, x, 0.44 + hgt, 0, greens[2], 6);
    else p.ico(0.12 + hgt * 0.4, x, 0.47 + hgt * 0.6, (i % 2 ? 0.1 : -0.1), greens[i % greens.length], { sy: 1.2 });
    if (i % 2 === 0) p.ico(0.045, x + 0.06, 0.6 + hgt, 0.12, color(FLOWER_COLORS[(i + o.y) % FLOWER_COLORS.length]));
    p.box(0.02, 0.12, 0.05, x + 0.1, 0.5, 0.27, C.linen());
  }
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function fireplace(ctx, o, p) {
  const stone = color(TONES.stone);
  const stones = [color(TONES.stoneLight), color(TONES.stoneDark), color(TONES.rockWarm)];
  p.block(1.8, 1.2, 0.58, 0, 0, -0.12, stone);
  p.block(2.0, 0.1, 0.9, 0, 0, 0.02, color(TONES.stoneLight));
  p.block(0.94, 0.66, 0.04, 0, 0.1, 0.18, color('#2a1f1a'));
  p.block(2.0, 0.1, 0.72, 0, 1.2, -0.08, C.woodDark());
  for (let i = 0; i < 14; i++) {
    const x = -0.82 + hash2(i, o.x, 3) * 1.64;
    const y = 0.15 + hash2(o.y, i, 5) * 0.95;
    if (Math.abs(x) < 0.55 && y < 0.82) continue;
    p.box(0.2 + hash2(i, 7, 7) * 0.14, 0.1 + hash2(9, i, 9) * 0.06, 0.04, x, y, 0.18, stones[i % stones.length]);
  }
  // Logs and embers.
  p.cyl(0.07, 0.07, 0.6, 0, 0.17, 0.05, color(PALETTE.bark), 7, { z: Math.PI / 2, y: 0.2 });
  p.cyl(0.07, 0.07, 0.6, 0, 0.17, -0.04, color(PALETTE.bark), 7, { z: Math.PI / 2, y: -0.25 });
  p.mat(MAT.lit).ico(0.16, 0, 0.14, 0.02, color(TONES.ember), { sy: 0.35 });
  // Mantel trinkets.
  p.cyl(0.03, 0.03, 0.14, -0.7, 1.32, -0.05, C.linen(), 6);
  p.mat(MAT.lit).ico(0.025, -0.7, 1.42, -0.05, color(TONES.flame));
  p.box(0.26, 0.22, 0.03, 0.55, 1.36, -0.2, C.woodLight(), { x: -0.15 });
  p.box(0.2, 0.16, 0.035, 0.55, 1.36, -0.19, color(PALETTE.roofSlate), { x: -0.15 });

  // Animated flames.
  const dyn = ctx.dynamic(o, `flames:${o.id}`);
  const f = dyn.painter(MAT.lit);
  f.cone(0.13, 0.36, 0, 0.18, 0, color(TONES.ember), 5);
  f.cone(0.09, 0.3, 0.1, 0.15, 0.02, color(TONES.flame), 5, 0.6);
  f.cone(0.08, 0.26, -0.11, 0.13, -0.02, color(TONES.flame), 5, 1.3);
  dyn.finish();
  dyn.group.position.copy(p.world(0, 0.17, 0.04));
  const phase = hash2(o.x, o.y, 11) * 10;
  ctx.onUpdate((dt, t) => {
    const k = 1 + Math.sin(t * 9 + phase) * 0.08 + Math.sin(t * 15.3 + phase * 2) * 0.06;
    dyn.group.scale.set(1 + (k - 1) * 0.5, k, 1 + (k - 1) * 0.5);
    dyn.group.rotation.y = Math.sin(t * 2.1 + phase) * 0.3;
  });
  const at = p.world(0, 0.45, 0.35);
  ctx.addHalo(at, 2.4, TONES.ember, 'always', o);
  ctx.addLight(at, TONES.ember, 1.3, 'always', o);
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function counter(ctx, o, p) {
  const w = Math.max(1, o.w ?? 1);
  const wood = safeColor(o.color, TONES.wood);
  p.block(w - 0.06, 0.88, 0.7, 0, 0, 0, wood);
  for (let i = 0; i < w; i++) {
    const x = -w / 2 + 0.5 + i;
    p.box(0.78, 0.6, 0.02, x, 0.46, 0.355, wood.clone().multiplyScalar(0.86));
  }
  p.block(w + 0.04, 0.06, 0.78, 0, 0.88, 0, C.woodLight());
  p.cyl(0.07, 0.07, 0.03, -w / 2 + 0.35, 0.955, 0, C.brass(), 8);
  p.sphere(0.06, -w / 2 + 0.35, 0.99, 0, C.brass(), { sy: 0.8, w: 8, h: 5 });
  if (w >= 2) {
    p.cyl(0.07, 0.07, 0.18, w / 2 - 0.35, 1.0, -0.1, color(TONES.pedestalGlass), 8);
    p.ico(0.05, w / 2 - 0.35, 0.96, -0.1, color(TONES.flowerButter), { sy: 0.6 });
  }
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function chair(ctx, o, p) {
  const wood = C.wood();
  p.block(0.46, 0.06, 0.46, 0, 0.4, 0, wood);
  for (const sx of [-0.19, 0.19]) for (const sz of [-0.19, 0.19]) p.block(0.05, 0.4, 0.05, sx, 0, sz, wood);
  for (const sx of [-0.19, 0.19]) p.block(0.05, 0.55, 0.05, sx, 0.46, -0.19, wood);
  p.box(0.42, 0.07, 0.04, 0, 0.88, -0.19, wood);
  p.box(0.42, 0.05, 0.03, 0, 0.7, -0.19, wood);
  p.rbox(0.42, 0.06, 0.4, 0, 0.48, 0.01, safeColor(o.color, ACCENTS[(o.x + o.y) % ACCENTS.length]));
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function stool(ctx, o, p) {
  const wood = C.wood();
  p.cyl(0.21, 0.21, 0.06, 0, 0.5, 0, safeColor(o.color, TONES.woodLight), 10);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    p.box(0.045, 0.5, 0.045, Math.sin(a) * 0.13, 0.24, Math.cos(a) * 0.13, wood, { y: a, x: 0.12 });
  }
  p.torus(0.14, 0.018, 0, 0.2, 0, wood, { rot: { x: Math.PI / 2 }, rs: 3, ts: 10 });
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function stove(ctx, o, p) {
  const body = safeColor(o.color, '#4a4a52');
  p.block(0.78, 0.82, 0.68, 0, 0, -0.04, body);
  p.block(0.84, 0.04, 0.74, 0, 0.82, -0.04, color(TONES.ironLight));
  p.box(0.5, 0.36, 0.02, 0, 0.36, 0.31, body.clone().multiplyScalar(0.8));
  p.box(0.36, 0.03, 0.03, 0, 0.58, 0.33, C.brass());
  p.mat(MAT.lit).box(0.2, 0.08, 0.02, 0, 0.36, 0.325, color(TONES.ember));
  p.cyl(0.07, 0.07, 1.1, 0.24, 1.38, -0.26, C.iron(), 8);
  p.cyl(0.16, 0.14, 0.18, -0.12, 0.95, 0, color('#b8734a'), 10);
  p.cyl(0.165, 0.165, 0.03, -0.12, 1.05, 0, color('#9c5e3c'), 10);
  p.sphere(0.03, -0.12, 1.08, 0, C.brass(), { w: 6, h: 4 });
  const at = p.world(0, 0.36, 0.4);
  ctx.addHalo(at, 0.7, TONES.ember, 'always', o);
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function cupboard(ctx, o, p) {
  const wood = safeColor(o.color, TONES.wood);
  p.block(0.86, 1.5, 0.52, 0, 0, -0.12, wood);
  p.block(0.94, 0.06, 0.58, 0, 1.5, -0.12, C.woodDark());
  for (const sx of [-0.2, 0.2]) {
    p.box(0.36, 0.62, 0.02, sx, 1.08, 0.15, wood.clone().multiplyScalar(0.85));
    p.box(0.36, 0.5, 0.02, sx, 0.38, 0.15, wood.clone().multiplyScalar(0.85));
    p.sphere(0.025, sx * 0.3, 0.75, 0.17, C.brass(), { w: 6, h: 4 });
  }
  p.cyl(0.06, 0.06, 0.16, -0.2, 1.64, -0.12, color(TONES.pedestalGlass), 8);
  p.cyl(0.07, 0.05, 0.12, 0.18, 1.62, -0.12, color(TONES.brick), 8);
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function plant(ctx, o, p) {
  p.cyl(0.2, 0.15, 0.32, 0, 0.16, 0, color(TONES.brick), 9);
  p.cyl(0.19, 0.19, 0.02, 0, 0.32, 0, color(TONES.earthDark), 9);
  const leaf = safeColor(o.color, PALETTE.foliage);
  const light = color(PALETTE.foliageLight);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    p.ico(0.17, Math.sin(a) * 0.16, 0.5 + (i % 2) * 0.14, Math.cos(a) * 0.16, i % 2 ? light : leaf, {
      sx: 0.45,
      sy: 1.1,
      sz: 0.18,
      rot: { y: a, x: 0.5 },
    });
  }
  p.ico(0.14, 0, 0.78, 0, light, { sx: 0.5, sy: 1.5, sz: 0.25 });
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function radio(ctx, o, p) {
  const wood = C.wood();
  p.block(0.6, 0.06, 0.5, 0, 0.52, 0, C.woodLight());
  for (const sx of [-0.25, 0.25]) for (const sz of [-0.2, 0.2]) p.block(0.04, 0.52, 0.04, sx, 0, sz, wood);
  const body = safeColor(o.color, '#c98a4b');
  p.rbox(0.46, 0.3, 0.24, 0, 0.73, 0, body);
  p.box(0.22, 0.2, 0.02, -0.08, 0.73, 0.12, body.clone().multiplyScalar(0.6));
  p.mat(MAT.lit).cyl(0.045, 0.045, 0.02, 0.13, 0.76, 0.125, color(TONES.flame), 10, { x: Math.PI / 2 });
  p.sphere(0.022, 0.13, 0.66, 0.13, C.brass(), { w: 6, h: 4 });
  p.box(0.012, 0.32, 0.012, 0.12, 1.02, -0.05, C.iron(), { z: -0.35 });
  ctx.addHalo(p.world(0.13, 0.76, 0.2), 0.45, TONES.flame, 'always', o);
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function terminal(ctx, o, p) {
  const wood = C.woodLight();
  p.block(0.82, 0.06, 0.6, 0, 0.66, 0, wood);
  p.block(0.76, 0.66, 0.5, 0, 0, -0.03, C.wood());
  const brass = C.brass();
  p.box(0.56, 0.44, 0.2, 0, 1.0, -0.12, color('#5d6f6a'), { x: -0.12 });
  p.mat(MAT.lit).box(0.44, 0.32, 0.02, 0, 1.0, -0.005, color(TONES.screen), { x: -0.12 });
  p.box(0.48, 0.03, 0.18, 0, 0.705, 0.16, color('#e8e1cf'), { x: 0.08 });
  p.cyl(0.03, 0.03, 0.02, 0.32, 0.71, 0.2, brass, 8);
  p.mat(MAT.lit).sphere(0.018, -0.32, 0.72, 0.2, color(TONES.flowerCoral), { w: 6, h: 4 });
  ctx.addHalo(p.world(0, 1.0, 0.15), 1.1, TONES.screen, 'always', o);
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function machine(ctx, o, p) {
  const base = color(TONES.ironLight);
  const brass = C.brass();
  p.block(0.72, 0.4, 0.62, 0, 0, 0, base);
  p.block(0.76, 0.04, 0.66, 0, 0.4, 0, brass);
  p.mat(MAT.lit).cyl(0.16, 0.16, 0.4, 0, 0.66, 0, color(TONES.screen), 10);
  p.mat(MAT.glass).cyl(0.2, 0.2, 0.62, 0, 0.75, 0, null, 12);
  p.cyl(0.22, 0.22, 0.06, 0, 1.09, 0, brass, 12);
  p.cyl(0.04, 0.04, 0.5, 0.3, 0.75, -0.1, brass, 6);
  p.cyl(0.035, 0.035, 0.36, 0.13, 1.0, -0.1, brass, 6, { z: Math.PI / 2 });
  p.mat(MAT.lit).cyl(0.05, 0.05, 0.02, -0.2, 0.22, 0.315, color(TONES.flowerButter), 10, { x: Math.PI / 2 });
  p.mat(MAT.lit).cyl(0.05, 0.05, 0.02, 0.05, 0.22, 0.315, color(TONES.screen), 10, { x: Math.PI / 2 });
  ctx.addHalo(p.world(0, 0.7, 0.1), 1.3, TONES.screen, 'always', o);
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function sink(ctx, o, p) {
  const wood = safeColor(o.color, TONES.wood);
  p.block(0.8, 0.82, 0.62, 0, 0, -0.05, wood);
  p.box(0.66, 0.6, 0.02, 0, 0.42, 0.265, wood.clone().multiplyScalar(0.86));
  p.block(0.86, 0.05, 0.68, 0, 0.82, -0.05, color(TONES.frameWhite));
  p.box(0.5, 0.02, 0.4, 0, 0.875, -0.05, color('#9fb7c4'));
  p.cyl(0.025, 0.025, 0.24, 0, 0.98, -0.28, C.brass(), 6);
  p.box(0.03, 0.03, 0.16, 0, 1.08, -0.21, C.brass());
  p.box(0.18, 0.3, 0.02, 0.28, 0.6, 0.275, color(TONES.flowerCoral));
}

/** @param {Ctx} ctx @param {any} o @param {Painter} p */
function rug(ctx, o, p) {
  const w = Math.max(1, o.w ?? 2) - 0.12;
  const d = Math.max(1, o.h ?? 2) - 0.12;
  const main = safeColor(o.color, TONES.rug);
  const border = color(TONES.rugBorder);
  p.block(w, 0.015, d, 0, 0.002, 0, border);
  p.block(w - 0.16, 0.017, d - 0.16, 0, 0.003, 0, main);
  p.block(w - 0.36, 0.019, d - 0.36, 0, 0.004, 0, main.clone().multiplyScalar(0.8));
  p.box(Math.min(w, d) * 0.32, 0.021, Math.min(w, d) * 0.32, 0, 0.0145, 0, border, Math.PI / 4);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(0.12, 0.021, 0.12, sx * (w / 2 - 0.26), 0.0145, sz * (d / 2 - 0.26), border, Math.PI / 4);
}

/**
 * Starter pedestal: plinth, glassy ring and a live wildling model on top.
 * @param {Ctx} ctx @param {any} o @param {Painter} p
 */
function pedestal(ctx, o, p) {
  p.cyl(0.3, 0.36, 0.55, 0, 0.275, 0, color(TONES.stoneLight), 10);
  p.cyl(0.36, 0.36, 0.06, 0, 0.58, 0, color(TONES.frameWhite), 12);
  p.cyl(0.4, 0.4, 0.06, 0, 0.03, 0, color(TONES.stone), 12);
  p.mat(MAT.glass).torus(0.31, 0.04, 0, 0.66, 0, null, { rot: { x: Math.PI / 2 }, rs: 6, ts: 18 });
  p.mat(MAT.lit).torus(0.31, 0.012, 0, 0.62, 0, color(TONES.pedestalGlass), { rot: { x: Math.PI / 2 }, rs: 3, ts: 18 });
  ctx.addHalo(p.world(0, 0.66, 0), 1.0, TONES.pedestalGlass, 'always', o);

  const species = typeof o.species === 'string' ? o.species : null;
  if (!species || !ctx.createWildlingModel) return;
  let model = null;
  try {
    model = ctx.createWildlingModel(species);
  } catch (err) {
    console.error(`[world] Could not create wildling "${species}" for pedestal "${o.id}"`, err);
    return;
  }
  if (!model?.group) return;
  const group = model.group;
  group.position.copy(p.world(0, 0.62, 0));
  group.rotation.y = ctx.facingAngle(o);
  group.scale.multiplyScalar(0.85);
  ctx.groupFor(o).add(group);
  const apply = (flags) => {
    group.visible = ctx.model.isActive(o, flags) && !anyFlag(o.emptyIf, flags);
  };
  apply(ctx.flags);
  ctx.onFlags(apply);
  ctx.onUpdate((dt) => {
    if (!group.visible) return;
    try {
      model.update?.(dt);
    } catch {
      /* a broken idle animation must not stop the world */
    }
  });
  ctx.onDispose(() => {
    group.removeFromParent();
    model.dispose?.();
  });
}

/**
 * Builders keyed by object type (indoor furniture).
 * @type {Record<string, (ctx: Ctx, o: any, p: Painter) => void>}
 */
export const FURNITURE_BUILDERS = {
  bed,
  table,
  bookshelf,
  desk,
  planter,
  fireplace,
  counter,
  chair,
  stool,
  stove,
  cupboard,
  plant,
  radio,
  terminal,
  machine,
  sink,
  rug,
  pedestal,
};

/** Types tall enough to hide a back-wall window. */
export const TALL_FURNITURE = new Set(['bookshelf', 'cupboard', 'fireplace', 'stove', 'machine', 'plant']);

