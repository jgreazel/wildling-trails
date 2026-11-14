/**
 * Buildings: cottage (timber-framed cream walls, terracotta roof, chimney),
 * house (two-tone walls, slate roof, dormer), greenhouse (the researcher's lab:
 * framed glass, barrel-vault roof, plants inside) and mill (stone base, wooden
 * upper, mossy roof). Doors sit on the south face at `door.x` with a step and
 * awning; windows glow at night.
 */
import * as THREE from 'three';
import { MAT } from './context.js';
import { SHAPES } from './shapes.js';
import { PALETTE, TONES, FLOWER_COLORS } from '../../render/palette.js';
import { color, hash2, safeColor, vary } from '../../render/materials.js';

/** @typedef {import('./painter.js').Painter} Painter */

const WALL_INSET = 0.1;

/** Variant defaults. */
const VARIANTS = {
  cottage: { wall: PALETTE.wallCream, roof: PALETTE.roofTerracotta, height: 1.45, door: TONES.doorSage },
  house: { wall: TONES.wallWarm, roof: PALETTE.roofSlate, height: 1.6, door: TONES.doorWood },
  greenhouse: { wall: TONES.frameWhite, roof: '#5e9a8f', height: 1.35, door: TONES.frameWhite },
  mill: { wall: TONES.plank, roof: PALETTE.roofMoss, height: 1.75, door: TONES.doorWood },
};

/**
 * Window with frame, muntins and sill on a wall face. The painter's local
 * z = 0 plane is the wall surface, +z outward.
 * @param {import('./context.js').BuildContext} ctx @param {any} o @param {Painter} f
 * @param {number} x @param {number} y @param {{scale?: number, shutters?: THREE.Color|null, flowers?: boolean, frame?: THREE.Color}} [opts]
 */
function windowOn(ctx, o, f, x, y, opts = {}) {
  const s = opts.scale ?? 1;
  const frame = opts.frame ?? color(TONES.frameWhite);
  const day = color(TONES.windowDay);
  const shine = color(TONES.windowShine);
  f.box(0.56 * s, 0.62 * s, 0.06, x, y, 0.02, frame);
  f.mat(MAT.glow).box(0.44 * s, 0.5 * s, 0.05, x, y, 0.035, (lx, ly, lz, nx, ny, nz, out) =>
    out.copy(lx + ly > 0.45 ? shine : day),
  );
  f.box(0.03, 0.5 * s, 0.02, x, y, 0.065, frame);
  f.box(0.44 * s, 0.03, 0.02, x, y, 0.065, frame);
  f.box(0.66 * s, 0.05, 0.13, x, y - 0.33 * s, 0.06, frame);
  if (opts.shutters) {
    f.box(0.17 * s, 0.56 * s, 0.03, x - 0.38 * s, y, 0.03, opts.shutters);
    f.box(0.17 * s, 0.56 * s, 0.03, x + 0.38 * s, y, 0.03, opts.shutters);
  }
  if (opts.flowers) {
    f.box(0.52 * s, 0.11, 0.14, x, y - 0.42 * s, 0.1, color(TONES.wood));
    const leaf = color(PALETTE.foliageLight);
    for (let i = 0; i < 4; i++) {
      const fx = x - 0.18 * s + i * 0.12 * s;
      const fc = color(FLOWER_COLORS[(i + o.x + o.y) % FLOWER_COLORS.length]);
      f.ico(0.06, fx, y - 0.34 * s, 0.1, leaf, { sy: 0.8 });
      f.ico(0.035, fx + 0.02, y - 0.3 * s, 0.13, fc);
    }
  }
  ctx.addHalo(f.world(x, y, 0.3), 1.0 * s, PALETTE.lampGlow, 'night', o);
}

/**
 * Pitched roof with stepped shingle rows, ridge cap and gable infill.
 * @param {Painter} p @param {{ww:number, wd:number, H:number, rise:number, roof:THREE.Color, gable:THREE.Color, overX?:number, overZ?:number, thick?:number, salt:number}} r
 */
function gableRoof(p, r) {
  const overX = r.overX ?? 0.18;
  const overZ = r.overZ ?? 0.24;
  const thick = r.thick ?? 0.1;
  const a = Math.atan2(r.rise, r.wd);
  const len = (r.wd + overZ) / Math.cos(a);
  const width = 2 * r.ww + 2 * overX;
  const rows = Math.max(3, Math.round(len / 0.28));
  const tmp = new THREE.Color();
  p.geo(SHAPES.gable(), 0, r.H, 0, 2 * r.ww, r.rise, r.wd, r.gable);
  for (const side of [1, -1]) {
    for (let i = 0; i < rows; i++) {
      const s0 = (i / rows) * len;
      const s1 = ((i + 1) / rows) * len;
      const sm = (s0 + s1) / 2;
      const off = thick / 2 + (i % 2) * 0.014;
      const z = side * (sm * Math.cos(a) + off * Math.sin(a));
      const y = r.H + r.rise - sm * Math.sin(a) + off * Math.cos(a);
      vary(tmp, r.roof, hash2(i, side + r.salt, 17), 0.12);
      if (i === rows - 1) tmp.multiplyScalar(0.88);
      p.box(width, thick, s1 - s0 + 0.03, 0, y, z, tmp, { x: side * a });
    }
  }
  const ridge = r.roof.clone().multiplyScalar(0.78);
  p.box(width + 0.04, 0.13, 0.13, 0, r.H + r.rise + thick * 0.55, 0, ridge, { x: Math.PI / 4 });
}

/** Roof surface height at local z on a gable roof. */
const roofY = (H, rise, wd, z) => H + rise * (1 - Math.min(1, Math.abs(z) / wd));

/**
 * Door with frame, knob, little glowing pane, step and awning.
 * @param {import('./context.js').BuildContext} ctx @param {any} o @param {Painter} p
 * @param {number} dx @param {number} wd @param {THREE.Color} doorColor @param {THREE.Color} trim @param {THREE.Color} awning
 */
function door(ctx, o, p, dx, wd, doorColor, trim, awning) {
  const z = wd;
  p.box(0.6, 1.0, 0.08, dx, 0.62, z + 0.03, doorColor);
  const panel = doorColor.clone().multiplyScalar(0.85);
  p.box(0.4, 0.32, 0.02, dx, 0.4, z + 0.075, panel);
  p.mat(MAT.glow).box(0.24, 0.16, 0.02, dx, 0.88, z + 0.075, color(TONES.windowDay));
  p.box(0.76, 0.09, 0.11, dx, 1.16, z + 0.04, trim);
  p.box(0.08, 1.04, 0.11, dx - 0.34, 0.64, z + 0.04, trim);
  p.box(0.08, 1.04, 0.11, dx + 0.34, 0.64, z + 0.04, trim);
  p.sphere(0.035, dx + 0.2, 0.6, z + 0.09, color(TONES.brass), { w: 6, h: 4 });
  p.block(0.92, 0.08, 0.38, dx, 0, z + 0.19, color(TONES.stoneLight));
  p.box(1.0, 0.05, 0.44, dx, 1.36, z + 0.2, awning, { x: 0.32 });
  p.box(0.05, 0.05, 0.3, dx - 0.4, 1.24, z + 0.14, trim, { x: -0.7 });
  p.box(0.05, 0.05, 0.3, dx + 0.4, 1.24, z + 0.14, trim, { x: -0.7 });
}

/**
 * Small wall lantern (glows at night, real light candidate).
 * @param {import('./context.js').BuildContext} ctx @param {any} o @param {Painter} p @param {number} x @param {number} z
 */
function wallLantern(ctx, o, p, x, z) {
  const iron = color(TONES.iron);
  p.box(0.05, 0.05, 0.14, x, 1.08, z + 0.07, iron);
  p.mat(MAT.glow).box(0.13, 0.17, 0.13, x, 0.98, z + 0.16, color(TONES.canvas));
  p.box(0.17, 0.04, 0.17, x, 1.08, z + 0.16, iron);
  p.cone(0.1, 0.08, x, 1.13, z + 0.16, iron, 4, Math.PI / 4);
  const at = p.world(x, 0.98, z + 0.16);
  ctx.addHalo(at, 1.1, PALETTE.lampGlow, 'night', o);
  ctx.addLight(at, PALETTE.lampGlow, 0.6, 'night', o);
}

/** Side of the door the wall lantern hangs on (+1 east, −1 west): the roomier side. */
function lanternSide(dx) {
  return dx <= 0 ? 1 : -1;
}

/**
 * Window centres on the south face: evenly spread through the wall spans left
 * and right of the door (the lantern side keeps extra room).
 * @param {number} ww half wall width @param {number} dx door x @param {number} slot width one window needs
 */
function southWindows(ww, dx, slot) {
  const side = lanternSide(dx);
  const spans = [
    [-ww + 0.08, dx - (side < 0 ? 0.66 : 0.42)],
    [dx + (side > 0 ? 0.66 : 0.42), ww - 0.08],
  ];
  const xs = [];
  for (const [a, b] of spans) {
    const len = b - a;
    const n = Math.floor(len / slot);
    for (let i = 0; i < n; i++) xs.push(a + (len / n) * (i + 0.5));
  }
  return xs;
}

/**
 * @param {import('./context.js').BuildContext} ctx
 * @param {any} o normalised building object
 * @param {Painter} p painter in the building's frame (footprint centre, ground)
 */
export function buildBuilding(ctx, o, p) {
  const variant = VARIANTS[o.variant] ? o.variant : 'cottage';
  const v = VARIANTS[variant];
  const w = Math.max(1, o.w);
  const h = Math.max(1, o.h);
  const ww = w / 2 - WALL_INSET;
  const wd = h / 2 - WALL_INSET;
  const doorX = Number.isFinite(o.door?.x) ? o.door.x : o.x + Math.floor(w / 2);
  const dx = Math.min(ww - 0.35, Math.max(-ww + 0.35, doorX - o.x - (w - 1) / 2));
  const wall = safeColor(o.wall, v.wall);
  const roof = safeColor(o.roof, v.roof);
  const salt = (o.index ?? 0) * 31 + o.x * 7 + o.y;
  const args = { ctx, o, p, w, h, ww, wd, dx, wall, roof, salt, H: v.height, doorColor: color(v.door) };
  if (variant === 'greenhouse') greenhouse(args);
  else if (variant === 'mill') mill(args);
  else if (variant === 'house') house(args);
  else cottage(args);
}

/**
 * @typedef {object} BuildingArgs
 * @property {import('./context.js').BuildContext} ctx
 * @property {any} o
 * @property {Painter} p
 * @property {number} w
 * @property {number} h
 * @property {number} ww
 * @property {number} wd
 * @property {number} dx
 * @property {THREE.Color} wall
 * @property {THREE.Color} roof
 * @property {number} salt
 * @property {number} H
 * @property {THREE.Color} doorColor
 */

/** Stone plinth under walls. @param {Painter} p @param {number} ww @param {number} wd */
function foundation(p, ww, wd) {
  p.block(2 * ww + 0.12, 0.16, 2 * wd + 0.12, 0, 0, 0, color(TONES.stone));
}

/** Chimney on the north slope; registers smoke. @param {BuildingArgs} a @param {number} rise @param {THREE.Color} c */
function chimney(a, rise, c) {
  const { ctx, o, p, ww, wd, H } = a;
  const cx = ww * 0.55;
  const cz = -wd * 0.32;
  const bottom = roofY(H, rise, wd, cz) - 0.3;
  const top = H + rise + 0.42;
  p.block(0.34, top - bottom, 0.34, cx, bottom, cz, c);
  p.block(0.42, 0.08, 0.42, cx, top, cz, c.clone().multiplyScalar(0.8));
  ctx.addChimney(p.world(cx, top + 0.12, cz), o);
}

/** @param {BuildingArgs} a */
function cottage(a) {
  const { ctx, o, p, w, h, ww, wd, dx, wall, roof, salt, H } = a;
  const timber = color(PALETTE.timber);
  const rise = Math.min(1.2, Math.max(0.75, h * 0.36));
  foundation(p, ww, wd);
  p.block(2 * ww, H - 0.12, 2 * wd, 0, 0.12, 0, wall);
  // Timber framing: corner posts and belts.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.block(0.13, H - 0.12, 0.13, sx * ww, 0.12, sz * wd, timber);
  for (const yy of [H * 0.55, H - 0.05]) {
    p.box(2 * ww, 0.08, 0.05, 0, yy, wd + 0.015, timber);
    p.box(0.05, 0.08, 2 * wd, ww + 0.015, yy, 0, timber);
    p.box(0.05, 0.08, 2 * wd, -ww - 0.015, yy, 0, timber);
  }
  // Gable timbers (king post) on the visible ends.
  for (const sx of [-1, 1]) {
    p.box(0.05, rise * 0.85, 0.07, sx * (ww + 0.01), H + rise * 0.42, 0, timber);
  }
  gableRoof(p, { ww, wd, H, rise, roof, gable: wall, salt });
  chimney(a, rise, color(TONES.brick));
  door(ctx, o, p, dx, wd, a.doorColor, timber, roof);
  const south = p.frame(0, 0, wd, 0);
  for (const x of southWindows(ww, dx, 0.98)) windowOn(ctx, o, south, x, 0.9, { shutters: a.doorColor, flowers: true, frame: color(TONES.frameWhite) });
  if (h >= 2) {
    windowOn(ctx, o, p.frame(ww, 0, 0, Math.PI / 2), 0, 0.9, { frame: color(TONES.frameWhite) });
    windowOn(ctx, o, p.frame(-ww, 0, 0, -Math.PI / 2), 0, 0.9, { frame: color(TONES.frameWhite) });
  }
  wallLantern(ctx, o, p, dx + lanternSide(dx) * 0.52, wd);
}

/** @param {BuildingArgs} a */
function house(a) {
  const { ctx, o, p, w, h, ww, wd, dx, wall, roof, salt, H } = a;
  const lower = safeColor(null, TONES.siding).clone();
  if (o.wall) lower.copy(wall).multiplyScalar(0.72);
  const trim = color(TONES.frameWhite);
  const rise = Math.min(1.25, Math.max(0.8, h * 0.38));
  foundation(p, ww, wd);
  p.block(2 * ww, H - 0.12, 2 * wd, 0, 0.12, 0, wall);
  p.block(2 * ww + 0.03, 0.6, 2 * wd + 0.03, 0, 0.12, 0, lower);
  for (let k = 1; k <= 3; k++) {
    p.box(2 * ww + 0.05, 0.025, 0.02, 0, 0.12 + k * 0.15, wd + 0.025, lower.clone().multiplyScalar(0.85));
  }
  p.block(2 * ww + 0.06, 0.06, 2 * wd + 0.06, 0, 0.72, 0, trim);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.block(0.1, H - 0.12, 0.1, sx * ww, 0.12, sz * wd, trim);
  gableRoof(p, { ww, wd, H, rise, roof, gable: wall, salt, overZ: 0.28 });
  chimney(a, rise, color(TONES.chimneyStone));
  // Dormer on the south slope.
  const xD = Math.abs(dx) < 0.6 ? -ww * 0.45 : -Math.sign(dx) * ww * 0.35;
  const front = wd * 0.42;
  const base = roofY(H, rise, wd, front) - 0.1;
  p.block(0.74, 0.62, 0.62, xD, base, front - 0.31, wall);
  p.geo(SHAPES.gable(), xD, base + 0.62, front - 0.27, 0.78, 0.34, 0.47, roof, Math.PI / 2);
  windowOn(ctx, o, p.frame(xD, 0, front, 0), 0, base + 0.33, { scale: 0.62, frame: trim });
  door(ctx, o, p, dx, wd, a.doorColor, trim, roof);
  const south = p.frame(0, 0, wd, 0);
  southWindows(ww, dx, 0.76).forEach((x, i) => windowOn(ctx, o, south, x, 1.0, { frame: trim, flowers: (i + salt) % 2 === 0 }));
  if (h >= 2) {
    windowOn(ctx, o, p.frame(ww, 0, 0, Math.PI / 2), 0, 1.0, { frame: trim });
    windowOn(ctx, o, p.frame(-ww, 0, 0, -Math.PI / 2), 0, 1.0, { frame: trim });
  }
  wallLantern(ctx, o, p, dx + lanternSide(dx) * 0.52, wd);
}

/** @param {BuildingArgs} a */
function mill(a) {
  const { ctx, o, p, w, h, ww, wd, dx, wall, roof, salt, H } = a;
  const stone = color(TONES.stone);
  const stones = [color(TONES.stoneLight), color(TONES.stoneDark), color(TONES.rockWarm), color(TONES.stone)];
  const timber = color(PALETTE.timber);
  const baseH = 0.85;
  const rise = Math.min(1.1, Math.max(0.8, h * 0.36));
  p.block(2 * ww + 0.06, baseH, 2 * wd + 0.06, 0, 0, 0, stone);
  // Protruding stones for a hand-laid look.
  const faces = [
    [p.frame(0, 0, wd + 0.03, 0), 2 * ww],
    [p.frame(ww + 0.03, 0, 0, Math.PI / 2), 2 * wd],
    [p.frame(-ww - 0.03, 0, 0, -Math.PI / 2), 2 * wd],
  ];
  faces.forEach(([f, span], fi) => {
    const n = Math.round(/** @type {number} */ (span) * 3.5);
    for (let i = 0; i < n; i++) {
      const sx = (hash2(i, fi + salt, 3) - 0.5) * (/** @type {number} */ (span) - 0.3);
      const sy = 0.12 + hash2(fi, i + salt, 5) * (baseH - 0.25);
      if (fi === 0 && Math.abs(sx - dx) < 0.45 && sy < 1.1) continue;
      /** @type {Painter} */ (f).box(0.18 + hash2(i, fi, 7) * 0.16, 0.1 + hash2(fi, i, 9) * 0.08, 0.04, sx, sy, 0.01, stones[(i + fi) % stones.length]);
    }
  });
  p.block(2 * ww + 0.08, 0.1, 2 * wd + 0.08, 0, baseH - 0.04, 0, timber);
  p.block(2 * ww - 0.02, H - baseH, 2 * wd - 0.02, 0, baseH, 0, wall);
  const batten = wall.clone().multiplyScalar(0.78);
  for (let x = -ww + 0.2; x < ww - 0.1; x += 0.3) p.box(0.04, H - baseH, 0.03, x, (H + baseH) / 2, wd + 0.005, batten);
  for (const sx of [-1, 1]) p.box(0.03, H - baseH, 0.04, sx * (ww + 0.005), (H + baseH) / 2, 0, batten);
  gableRoof(p, { ww, wd, H, rise, roof, gable: wall, salt, overX: 0.24, overZ: 0.3, thick: 0.14 });
  // Moss tufts along the eave and ridge.
  const mossLight = color(TONES.moss);
  const a0 = Math.atan2(rise, wd);
  for (let i = 0; i < Math.round(w * 2.5); i++) {
    const mx = -ww + (i + 0.5) * ((2 * ww) / Math.round(w * 2.5));
    const s = 0.75 + hash2(i, salt, 11) * 0.2;
    const z = wd * s;
    p.ico(0.12 + hash2(salt, i, 13) * 0.06, mx, roofY(H, rise, wd, z) + 0.1, z, mossLight, { sy: 0.6, rot: { x: a0 } });
    if (i % 2 === 0) p.ico(0.1, mx + 0.1, H + rise + 0.12, 0, mossLight, { sy: 0.6 });
  }
  // Door in the stone base, with a lintel stone.
  p.box(0.62, 0.92, 0.08, dx, 0.46, wd + 0.06, a.doorColor);
  p.box(0.82, 0.14, 0.12, dx, 0.98, wd + 0.06, color(TONES.stoneLight));
  p.block(0.92, 0.08, 0.38, dx, 0, wd + 0.22, color(TONES.stoneLight));
  // Flour sacks.
  const sack = color(TONES.canvas);
  const sx = dx + (dx < 0 ? 0.62 : -0.62);
  p.rbox(0.3, 0.36, 0.24, sx, 0.18, wd + 0.25, sack, 0.2);
  p.rbox(0.26, 0.3, 0.22, sx + (dx < 0 ? 0.26 : -0.26), 0.15, wd + 0.3, sack, -0.3);
  const south = p.frame(0, 0, wd, 0);
  for (const x of southWindows(ww, dx, 0.62)) windowOn(ctx, o, south, x, (baseH + H) / 2 + 0.05, { scale: 0.7, frame: timber });
  windowOn(ctx, o, p.frame(ww, 0, 0, Math.PI / 2), 0, (baseH + H) / 2 + 0.05, { scale: 0.7, frame: timber });
  windowOn(ctx, o, p.frame(-ww, 0, 0, -Math.PI / 2), 0, (baseH + H) / 2 + 0.05, { scale: 0.7, frame: timber });
  wallLantern(ctx, o, p, dx + lanternSide(dx) * 0.52, wd + 0.03);
}

/** @param {BuildingArgs} a */
function greenhouse(a) {
  const { ctx, o, p, w, ww, wd, dx, roof, salt, H } = a;
  const frame = safeColor(o.wall, TONES.frameWhite);
  const knee = color(TONES.brick);
  const g = p.mat(MAT.glass);
  const kneeH = 0.36;
  const rise = Math.min(1.25, wd * 0.9);
  const doorHalf = 0.4;

  // Knee wall (split around the door) and tiled floor.
  const southLeft = dx - doorHalf - -ww;
  const southRight = ww - (dx + doorHalf);
  if (southLeft > 0.05) p.block(southLeft, kneeH, 0.14, -ww + southLeft / 2, 0, wd - 0.07, knee);
  if (southRight > 0.05) p.block(southRight, kneeH, 0.14, ww - southRight / 2, 0, wd - 0.07, knee);
  p.block(2 * ww, kneeH, 0.14, 0, 0, -wd + 0.07, knee);
  p.block(0.14, kneeH, 2 * wd, ww - 0.07, 0, 0, knee);
  p.block(0.14, kneeH, 2 * wd, -ww + 0.07, 0, 0, knee);
  p.block(2 * ww - 0.12, 0.05, 2 * wd - 0.12, 0, 0, 0, color(TONES.labTileAlt));
  p.block(2 * ww + 0.1, 0.06, 0.18, 0, kneeH, wd - 0.07, frame);

  // Glass walls.
  const paneH = H - kneeH;
  const yMid = kneeH + paneH / 2;
  if (southLeft > 0.05) g.box(southLeft, paneH, 0.03, -ww + southLeft / 2, yMid, wd - 0.05);
  if (southRight > 0.05) g.box(southRight, paneH, 0.03, ww - southRight / 2, yMid, wd - 0.05);
  g.box(2 * ww, paneH, 0.03, 0, yMid, -wd + 0.05);
  g.box(0.03, paneH, 2 * wd, ww - 0.05, yMid, 0);
  g.box(0.03, paneH, 2 * wd, -ww + 0.05, yMid, 0);

  // White frame: posts, rails, door frame.
  const postsX = Math.max(2, Math.round((2 * ww) / 0.6));
  for (let i = 0; i <= postsX; i++) {
    const x = -ww + (i * 2 * ww) / postsX;
    if (Math.abs(x - dx) < doorHalf - 0.02) continue;
    p.box(0.05, paneH, 0.06, x, yMid, wd - 0.04, frame);
    p.box(0.05, paneH, 0.06, x, yMid, -wd + 0.04, frame);
  }
  const postsZ = Math.max(2, Math.round((2 * wd) / 0.6));
  for (let i = 0; i <= postsZ; i++) {
    const z = -wd + (i * 2 * wd) / postsZ;
    p.box(0.06, paneH, 0.05, ww - 0.04, yMid, z, frame);
    p.box(0.06, paneH, 0.05, -ww + 0.04, yMid, z, frame);
  }
  for (const y of [kneeH + paneH * 0.55, H]) {
    p.box(2 * ww + 0.06, 0.05, 0.07, 0, y, wd - 0.04, frame);
    p.box(2 * ww + 0.06, 0.05, 0.07, 0, y, -wd + 0.04, frame);
    p.box(0.07, 0.05, 2 * wd, ww - 0.04, y, 0, frame);
    p.box(0.07, 0.05, 2 * wd, -ww + 0.04, y, 0, frame);
  }

  // Barrel-vault glass roof with ribs, glass gable ends and a little cupola.
  g.geo(SHAPES.halfCylinder(14), 0, H, 0, rise, 2 * ww + 0.04, wd, null, { z: Math.PI / 2 });
  g.geo(SHAPES.halfDisc(14), ww, H, 0, wd, rise, 1, null, Math.PI / 2);
  g.geo(SHAPES.halfDisc(14), -ww, H, 0, wd, rise, 1, null, -Math.PI / 2);
  const ribs = Math.max(2, Math.round((2 * ww) / 0.6));
  for (let i = 0; i <= ribs; i++) {
    const x = -ww + (i * 2 * ww) / ribs;
    p.torus(wd, 0.035, x, H, 0, frame, { arc: Math.PI, rot: Math.PI / 2, sy: rise / wd, rs: 3, ts: 12 });
  }
  p.box(2 * ww + 0.1, 0.06, 0.08, 0, H + rise, 0, roof);
  p.block(0.5, 0.26, 0.5, 0, H + rise - 0.06, 0, frame);
  g.box(0.42, 0.18, 0.52, 0, H + rise + 0.08, 0);
  p.cone(0.42, 0.28, 0, H + rise + 0.34, 0, roof, 4, Math.PI / 4);
  p.box(0.02, 0.36, 0.02, 0, H + rise + 0.62, 0, color(TONES.iron));
  p.ico(0.09, 0.06, H + rise + 0.74, 0, color(PALETTE.foliageLight), { sx: 1.4, sy: 0.6, sz: 0.4 });

  // Glass door with frame, step and a leaf sign above.
  p.box(0.06, 1.05, 0.08, dx - doorHalf + 0.03, 0.52, wd - 0.03, frame);
  p.box(0.06, 1.05, 0.08, dx + doorHalf - 0.03, 0.52, wd - 0.03, frame);
  p.box(2 * doorHalf, 0.07, 0.08, dx, 1.06, wd - 0.03, frame);
  p.box(0.05, 1.0, 0.05, dx, 0.52, wd - 0.03, frame);
  g.box(2 * doorHalf - 0.1, 1.0, 0.02, dx, 0.52, wd - 0.04);
  p.block(0.95, 0.08, 0.38, dx, 0, wd + 0.18, color(TONES.stoneLight));
  p.box(0.62, 0.22, 0.05, dx, 1.24, wd + 0.0, color(TONES.wood));
  p.ico(0.08, dx - 0.08, 1.24, wd + 0.04, color(PALETTE.foliageLight), { sx: 1.5, sy: 0.7, sz: 0.3, rot: { z: 0.5 } });
  p.ico(0.07, dx + 0.1, 1.25, wd + 0.04, color(PALETTE.meadow), { sx: 1.5, sy: 0.7, sz: 0.3, rot: { z: -0.5 } });

  // Plants inside: a potting bench along the back, pots and a small tree.
  const wood = color(TONES.wood);
  const pot = color(TONES.brick);
  const greens = [color(PALETTE.foliage), color(PALETTE.foliageLight), color(PALETTE.meadowDark), color(TONES.coniferLight)];
  p.block(2 * ww - 0.5, 0.06, 0.4, 0, 0.5, -wd + 0.36, wood);
  for (const x of [-ww + 0.4, ww - 0.4]) p.block(0.06, 0.5, 0.36, x, 0, -wd + 0.36, wood);
  const benchPots = Math.max(2, Math.floor((2 * ww - 0.6) / 0.45));
  for (let i = 0; i < benchPots; i++) {
    const x = -ww + 0.5 + (i * (2 * ww - 1.0)) / Math.max(1, benchPots - 1);
    const leaf = greens[(i + salt) % greens.length];
    p.cyl(0.11, 0.08, 0.16, x, 0.64, -wd + 0.36, pot, 7);
    p.ico(0.15 + hash2(i, salt, 3) * 0.08, x, 0.84, -wd + 0.36, leaf, { sy: 1.1 });
    if (hash2(salt, i, 5) > 0.5) p.ico(0.045, x + 0.06, 0.95, -wd + 0.44, color(FLOWER_COLORS[i % FLOWER_COLORS.length]));
  }
  const tx = ww - 0.55;
  const tz = -wd + 0.95;
  p.cyl(0.2, 0.16, 0.3, tx, 0.2, tz, pot, 8);
  p.cyl(0.04, 0.06, 0.8, tx, 0.7, tz, color(PALETTE.bark), 5);
  p.ico(0.42, tx, 1.25, tz, greens[0], { sy: 0.9 });
  p.ico(0.3, tx - 0.18, 1.5, tz + 0.1, greens[1], { sy: 0.9 });
  const floorPots = Math.max(1, Math.floor((2 * ww - 1.2) / 0.7));
  for (let i = 0; i < floorPots; i++) {
    const x = -ww + 0.45 + i * 0.7;
    if (Math.abs(x - dx) < 0.6) continue;
    const z = wd - 0.38;
    p.cyl(0.13, 0.1, 0.22, x, 0.16, z, pot, 7);
    p.ico(0.2, x, 0.42, z, greens[(i + 1) % greens.length], { sx: 1.1, sy: 0.9 });
    p.ico(0.06, x + 0.08, 0.55, z + 0.05, color(FLOWER_COLORS[(i + salt) % FLOWER_COLORS.length]));
  }

  // Warm interior glow at night, visible through the glass.
  ctx.addHalo(p.world(-ww * 0.4, 1.0, 0), 1.8, PALETTE.lampGlow, 'night', o);
  ctx.addHalo(p.world(ww * 0.4, 1.0, 0), 1.8, PALETTE.lampGlow, 'night', o);
  ctx.addLight(p.world(0, 1.1, 0.2), PALETTE.lampGlow, 0.8, 'night', o);
  void w;
}
