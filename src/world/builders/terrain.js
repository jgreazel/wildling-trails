/**
 * Terrain: per-tile ground tops (hand-painted vertex colour variation), cliff
 * faces between levels with rock strata and chunks, earthy water banks,
 * stone stairs, ledge lips with a stone face on the hop side, cobble pavers,
 * path pebbles and (outdoors) a far ground plane under the skirt.
 */
import * as THREE from 'three';
import { MAT } from './context.js';
import { PALETTE, TONES } from '../../render/palette.js';
import { color, hash2, noise2, vary } from '../../render/materials.js';
import { LEVEL_HEIGHT } from '../../config.js';
import { WATER_DROP } from './grid.js';
import { SHAPES } from './shapes.js';

const LH = LEVEL_HEIGHT;
/** Bottom of the diorama slab for interiors / holes. */
export const VOID_BOTTOM = -0.6;

/** Cardinal sides: offset, edge start/end (relative to tile centre) and outward normal. */
const SIDES = [
  { dx: 1, dy: 0, s: [0.5, 0.5], e: [0.5, -0.5], n: [1, 0, 0], ry: Math.PI / 2 },
  { dx: -1, dy: 0, s: [-0.5, -0.5], e: [-0.5, 0.5], n: [-1, 0, 0], ry: Math.PI / 2 },
  { dx: 0, dy: 1, s: [-0.5, 0.5], e: [0.5, 0.5], n: [0, 0, 1], ry: 0 },
  { dx: 0, dy: -1, s: [0.5, -0.5], e: [-0.5, -0.5], n: [0, 0, -1], ry: 0 },
];

/** Ledge hop direction → yaw so that local +z points along the hop. */
const LEDGE_YAW = { down: 0, right: Math.PI / 2, left: -Math.PI / 2 };
/** Ledge hop direction → side index in SIDES. */
const LEDGE_SIDE = { right: 0, left: 1, down: 2 };

/** @param {import('../tiles.js').TileType} t */
const isPaved = (t) => t.ground === 'dirt' || t.ground === 'sand' || t.ground === 'stone';

/**
 * @param {import('./context.js').BuildContext} ctx
 */
export function buildTerrain(ctx) {
  const { grid, outdoor, seed } = ctx;
  const batch = ctx.staticSet.get(MAT.solid);
  const paint = ctx.painter(MAT.solid);

  const C = {
    meadow: color(PALETTE.meadow),
    meadowLight: color(TONES.meadowLight),
    meadowDark: color(PALETTE.meadowDark),
    meadowShade: color(TONES.meadowShade),
    worn: color(TONES.meadowWorn),
    forest: color(TONES.forestFloor),
    path: color(PALETTE.path),
    pathLight: color(TONES.pathLight),
    pathDark: color(TONES.pathDark),
    sand: color(PALETTE.sand),
    sandDark: color(TONES.sandDark),
    mortar: color(TONES.cobbleMortar),
    cobble: color(PALETTE.cobble),
    cobbleLight: color(TONES.cobbleLight),
    stone: color(TONES.stone),
    stoneLight: color(TONES.stoneLight),
    stoneDark: color(TONES.stoneDark),
    basin: color(TONES.basin),
    basinShallow: color(TONES.basinShallow),
    earth: color(TONES.earth),
    earthDark: color(TONES.earthDark),
    earthWet: color(TONES.earthWet),
    ledge: color(TONES.ledgeStone),
    ledgeMortar: color(TONES.ledgeMortar),
    rocks: [color(TONES.rock), color(TONES.rockLight), color(TONES.rockWarm), color(TONES.rockDark)],
  };

  // ---- corner data (shared by the 4 tiles around each corner) -------------
  const ccols = grid.cols + 1;
  const crows = grid.rows + 1;
  const pathFrac = new Float32Array(ccols * crows);
  const landFrac = new Float32Array(ccols * crows);
  const QUAD = [
    [-1, -1],
    [0, -1],
    [-1, 0],
    [0, 0],
  ];
  for (let iy = 0; iy < crows; iy++) {
    for (let ix = 0; ix < ccols; ix++) {
      let n = 0;
      let paved = 0;
      let land = 0;
      for (const [dx, dy] of QUAD) {
        const c = grid.get(grid.minX + ix + dx, grid.minY + iy + dy);
        if (!c || c.t.void) continue;
        n++;
        if (isPaved(c.t) && !c.t.stairs) paved++;
        if (!c.t.water) land++;
      }
      pathFrac[iy * ccols + ix] = n ? paved / n : 0;
      landFrac[iy * ccols + ix] = n ? land / n : 1;
    }
  }

  const tmp = new THREE.Color();
  /**
   * Colour of a tile top at one of its corners.
   * @param {import('./grid.js').Cell} cell @param {number} ix @param {number} iy @param {THREE.Color} out
   */
  function topColor(cell, ix, iy, out) {
    const wx = grid.minX + ix - 0.5;
    const wz = grid.minY + iy - 0.5;
    const n = noise2(wx * 0.23, wz * 0.23, seed);
    const speck = hash2(grid.minX + ix, grid.minY + iy, seed + 7);
    const t = cell.t;
    if (t.water) {
      out.copy(C.basin).lerp(C.basinShallow, landFrac[iy * ccols + ix] * 0.8);
    } else if (t.ground === 'dirt') {
      out.copy(C.path).lerp(n > 0.5 ? C.pathLight : C.pathDark, Math.abs(n - 0.5) * 1.3);
    } else if (t.ground === 'sand') {
      out.copy(C.sand).lerp(C.sandDark, n * 0.6);
    } else if (t.ground === 'stone') {
      out.copy(t.stairs ? C.stone : C.mortar);
    } else {
      out.copy(C.meadow).lerp(n > 0.5 ? C.meadowLight : C.meadowDark, Math.abs(n - 0.5) * 1.1);
      if (t.tallGrass) out.lerp(C.meadowShade, 0.45);
      const pf = pathFrac[iy * ccols + ix];
      if (pf > 0) out.lerp(C.worn, pf * 0.5);
      if (cell.d > 0) out.lerp(C.forest, Math.min(1, cell.d / 6) * 0.85);
      if (t.tree) out.multiplyScalar(0.84);
    }
    return vary(out, out, speck, 0.08);
  }

  const ca = new THREE.Color();
  const cb = new THREE.Color();
  const cc = new THREE.Color();
  const cd = new THREE.Color();
  const q = new Array(12);

  /** Far plane height (outdoors) / slab bottom (indoors). */
  let landLow = Infinity;
  for (const c of grid.cells) if (!c.t.void && !c.t.water && !c.t.indoor) landLow = Math.min(landLow, c.top);
  if (!Number.isFinite(landLow)) landLow = 0;
  const planeY = outdoor ? landLow - 0.03 : VOID_BOTTOM;

  /**
   * Quad on a tile edge between heights, over a sub-span [u0, u1] of the edge.
   * @param {import('./grid.js').Cell} cell @param {typeof SIDES[number]} side
   * @param {number} yT @param {number} yB @param {THREE.Color} cT @param {THREE.Color} cB
   * @param {number} [u0] @param {number} [u1] @param {boolean} [inward] flip to face the tile
   */
  function edgeQuad(cell, side, yT, yB, cT, cB, u0 = 0, u1 = 1, inward = false) {
    if (yT - yB < 1e-4) return;
    const sx = cell.x + side.s[0];
    const sz = cell.y + side.s[1];
    const ex = cell.x + side.e[0];
    const ez = cell.y + side.e[1];
    let ax = sx + (ex - sx) * u0;
    let az = sz + (ez - sz) * u0;
    let bx = sx + (ex - sx) * u1;
    let bz = sz + (ez - sz) * u1;
    let [nx, ny, nz] = side.n;
    if (inward) {
      [ax, bx] = [bx, ax];
      [az, bz] = [bz, az];
      nx = -nx;
      nz = -nz;
    }
    q[0] = ax; q[1] = yT; q[2] = az;
    q[3] = ax; q[4] = yB; q[5] = az;
    q[6] = bx; q[7] = yB; q[8] = bz;
    q[9] = bx; q[10] = yT; q[11] = bz;
    batch.quad(q, nx, ny, nz, cT, cB, cB, cT);
  }

  /** Rock strata bands from yT down to yB. */
  function rockFace(cell, side, yT, yB, salt) {
    let y = yT;
    let i = 0;
    while (y > yB + 1e-4) {
      const hgt = 0.15 + hash2(cell.x * 7 + i, cell.y * 3 + salt, seed + 41) * 0.12;
      const y2 = Math.max(yB, y - hgt);
      const k = Math.floor(hash2(cell.x + i * 13, cell.y - salt, seed + 5) * C.rocks.length);
      const base = C.rocks[k];
      vary(ca, base, hash2(cell.x, i, seed + salt), 0.1);
      cb.copy(ca).multiplyScalar(0.9);
      edgeQuad(cell, side, y, y2, ca, cb);
      y = y2;
      i++;
    }
    // Protruding chunks give the cliff a hand-built, chunky silhouette.
    const drop = yT - yB;
    if (drop < 0.35) return;
    const count = 1 + Math.floor(hash2(cell.x, cell.y, seed + salt * 3) * 2.2);
    for (let j = 0; j < count; j++) {
      const u = 0.18 + hash2(cell.x + j, cell.y * 5, seed + 61 + salt) * 0.64;
      const w = 0.22 + hash2(cell.x - j, cell.y, seed + 67) * 0.2;
      const h = Math.min(drop * 0.6, 0.12 + hash2(cell.x, cell.y + j, seed + 71) * 0.16);
      const yc = yB + h / 2 + 0.04 + hash2(j, cell.x + cell.y, seed + 73) * Math.max(0, drop - h - 0.12);
      const depth = 0.08 + hash2(cell.y, j, seed + 79) * 0.06;
      const px = cell.x + side.s[0] + (side.e[0] - side.s[0]) * u + side.n[0] * (depth / 2 - 0.02);
      const pz = cell.y + side.s[1] + (side.e[1] - side.s[1]) * u + side.n[2] * (depth / 2 - 0.02);
      const col = C.rocks[(j + cell.x + cell.y + 1000) % C.rocks.length];
      paint.box(w, h, depth, px, yc, pz, col, side.ry);
    }
  }

  /** Neat stone blocks for a ledge's hop face. */
  function ledgeFace(cell, side, yT, yB) {
    let y = yT;
    let row = 0;
    while (y > yB + 1e-4) {
      const y2 = Math.max(yB, y - 0.13);
      const splits = row % 2 === 0 ? [0, 0.5, 1] : [0, 0.25, 0.75, 1];
      for (let i = 0; i < splits.length - 1; i++) {
        vary(ca, C.ledge, hash2(cell.x * 4 + i, cell.y * 4 + row, seed + 91), 0.12);
        cb.copy(ca).lerp(C.ledgeMortar, 0.35);
        edgeQuad(cell, side, y, y2, ca, cb, splits[i] + 0.01, splits[i + 1] - 0.01);
        // Mortar slivers between blocks.
        edgeQuad(cell, side, y, y2, C.ledgeMortar, C.ledgeMortar, splits[i + 1] - 0.01, Math.min(1, splits[i + 1] + 0.01));
        if (i === 0) edgeQuad(cell, side, y, y2, C.ledgeMortar, C.ledgeMortar, 0, 0.01);
      }
      y = y2;
      row++;
    }
  }

  /** Side faces of one cell toward each neighbour that sits lower. */
  function sides(cell, gx, gy) {
    const top = cell.top;
    const grassy = cell.t.ground === 'grass';
    for (let si = 0; si < 4; si++) {
      const side = SIDES[si];
      const nb = grid.get(cell.x + side.dx, cell.y + side.dy);
      let nTop;
      if (!nb || nb.t.void) {
        nTop = planeY;
        // Close holes where a basin meets the edge of the world.
        if (!nb && top < planeY) {
          edgeQuad(cell, side, planeY, top, C.earthDark, C.earthWet, 0, 1, true);
          continue;
        }
      } else if (nb.t.indoor) {
        nTop = nb.level * LH;
      } else {
        nTop = nb.top;
      }
      const drop = top - nTop;
      if (drop <= 1e-3) continue;

      if (cell.t.ledge && LEDGE_SIDE[cell.t.ledge] === si) {
        ledgeFace(cell, side, top, nTop);
        continue;
      }
      if (drop < 0.1) {
        // Small lip (grass beside a path, slab edges).
        topColor(cell, gx, gy, ca);
        ca.multiplyScalar(0.8);
        cb.copy(ca).multiplyScalar(0.85);
        edgeQuad(cell, side, top, nTop, ca, cb);
        continue;
      }
      let y = top;
      if (grassy) {
        const lip = 0.07;
        ca.copy(C.meadowDark);
        cb.copy(C.meadowDark).multiplyScalar(0.8);
        edgeQuad(cell, side, y, y - lip, ca, cb);
        y -= lip;
      }
      if (nb && nb.t.water && !cell.t.water) {
        // Bank down to the basin: earth above the waterline, wet below.
        const waterY = nb.level * LH - WATER_DROP;
        const earthBottom = Math.max(nTop, Math.min(y, waterY + 0.03));
        if (y - earthBottom > 0.2 + 1e-3 && y - earthBottom > LH * 0.9) {
          rockFace(cell, side, y, earthBottom, si + 1);
        } else {
          edgeQuad(cell, side, y, earthBottom, C.earth, C.earthDark);
        }
        edgeQuad(cell, side, earthBottom, nTop, C.earthWet, C.earthWet);
        continue;
      }
      rockFace(cell, side, y, nTop, si + 1);
    }
  }

  /** Stone steps rising toward the neighbour one level up. */
  function stairs(cell) {
    const L = cell.level;
    let yaw = null;
    const dirs = [
      [0, -1, 0],
      [0, 1, Math.PI],
      [1, 0, -Math.PI / 2],
      [-1, 0, Math.PI / 2],
    ];
    for (const [dx, dy, a] of dirs) {
      const nb = grid.get(cell.x + dx, cell.y + dy);
      if (nb && nb.inMap && nb.level === L + 1 && !nb.t.void) {
        yaw = a;
        if (nb.t.walkable) break;
      }
    }
    const base = L * LH;
    const f = paint.frame(cell.x, base, cell.y, yaw ?? 0);
    if (yaw === null) {
      f.box(0.96, 0.06, 0.96, 0, 0.03, 0, C.stoneLight);
      return;
    }
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      const h = ((i + 1) * LH) / steps;
      const light = vary(tmp, i % 2 ? C.stoneLight : C.cobbleLight, hash2(cell.x, i, seed + 13), 0.08).clone();
      const dark = C.stoneDark;
      f.geo(
        // Unit box; colour by face: lighter treads, darker risers.
        SHAPES.box(),
        0,
        h / 2,
        0.5 - (i + 0.5) / steps,
        1.0,
        h,
        1 / steps,
        (x, y, z, nx, ny) => (ny > 0.5 ? light : dark),
      );
    }
  }

  /** Raised grassy lip on the hop side of a ledge tile. */
  function ledgeLip(cell) {
    const yaw = LEDGE_YAW[cell.t.ledge] ?? 0;
    const f = paint.frame(cell.x, cell.top, cell.y, yaw);
    const grassTop = topColor(cell, cell.x - grid.minX, cell.y - grid.minY, new THREE.Color());
    const side = C.meadowDark;
    const face = C.ledge;
    f.geo(SHAPES.box(), 0, 0.075, 0.5 - 0.21, 1.0, 0.15, 0.42, (x, y, z, nx, ny, nz) =>
      nz > 0.5 ? face : ny > 0.5 ? grassTop : side,
    );
  }

  /** Four chunky pavers on cobble tiles. */
  function pavers(cell) {
    for (let i = 0; i < 4; i++) {
      const ox = (i % 2 === 0 ? -0.23 : 0.23) + (hash2(cell.x * 2 + i, cell.y, seed + 101) - 0.5) * 0.05;
      const oz = (i < 2 ? -0.23 : 0.23) + (hash2(cell.x, cell.y * 2 + i, seed + 103) - 0.5) * 0.05;
      const s = 0.39 + hash2(cell.x + i, cell.y - i, seed + 107) * 0.05;
      vary(ca, i % 3 === 0 ? C.cobbleLight : C.cobble, hash2(cell.x - i, cell.y + i, seed + 109), 0.14);
      paint.box(s, 0.05, s * (0.9 + hash2(i, cell.x, seed) * 0.15), cell.x + ox, cell.top + 0.02, cell.y + oz, ca, (hash2(cell.y, i, seed + 113) - 0.5) * 0.25);
    }
  }

  /** A few pebbles on dirt paths. */
  function pebbles(cell) {
    if (hash2(cell.x, cell.y, seed + 131) > 0.3) return;
    const count = 1 + Math.floor(hash2(cell.y, cell.x, seed + 137) * 3);
    for (let i = 0; i < count; i++) {
      const px = cell.x + (hash2(cell.x * 3 + i, cell.y, seed + 139) - 0.5) * 0.8;
      const pz = cell.y + (hash2(cell.x, cell.y * 3 + i, seed + 149) - 0.5) * 0.8;
      const r = 0.035 + hash2(i, cell.x + cell.y, seed + 151) * 0.035;
      paint.ico(r, px, cell.top + r * 0.3, pz, i % 2 ? C.stoneLight : C.stone, { sy: 0.55, rot: i * 1.3 });
    }
  }

  // ---- main pass -----------------------------------------------------------
  for (const cell of grid.cells) {
    const t = cell.t;
    if (t.void || t.indoor) continue;
    const gx = cell.x - grid.minX;
    const gy = cell.y - grid.minY;
    const y = cell.top;
    const x0 = cell.x - 0.5;
    const x1 = cell.x + 0.5;
    const z0 = cell.y - 0.5;
    const z1 = cell.y + 0.5;
    topColor(cell, gx, gy, ca);
    topColor(cell, gx, gy + 1, cb);
    topColor(cell, gx + 1, gy + 1, cc);
    topColor(cell, gx + 1, gy, cd);
    q[0] = x0; q[1] = y; q[2] = z0;
    q[3] = x0; q[4] = y; q[5] = z1;
    q[6] = x1; q[7] = y; q[8] = z1;
    q[9] = x1; q[10] = y; q[11] = z0;
    batch.quad(q, 0, 1, 0, ca, cb, cc, cd);
    sides(cell, gx, gy);
    if (t.stairs) stairs(cell);
    else if (t.ledge) ledgeLip(cell);
    else if (t.ground === 'stone' && !t.door) pavers(cell);
    else if (t.ground === 'dirt') pebbles(cell);
  }

  // ---- far ground ring around the skirt (never under it: basins sit lower) --
  if (outdoor) {
    const gx0 = grid.minX - 0.5;
    const gx1 = grid.maxX + 0.5;
    const gz0 = grid.minY - 0.5;
    const gz1 = grid.maxY + 0.5;
    const R = 140;
    const fc = C.forest;
    /** @param {number} ax @param {number} az @param {number} bx @param {number} bz */
    const flat = (ax, az, bx, bz) => {
      q[0] = ax; q[1] = planeY; q[2] = az;
      q[3] = ax; q[4] = planeY; q[5] = bz;
      q[6] = bx; q[7] = planeY; q[8] = bz;
      q[9] = bx; q[10] = planeY; q[11] = az;
      batch.quad(q, 0, 1, 0, fc, fc, fc, fc);
    };
    flat(gx0 - R, gz0 - R, gx1 + R, gz0); // north
    flat(gx0 - R, gz1, gx1 + R, gz1 + R); // south
    flat(gx0 - R, gz0, gx0, gz1); // west
    flat(gx1, gz0, gx1 + R, gz1); // east
  }
}
