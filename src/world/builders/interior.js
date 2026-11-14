/**
 * Interiors: wood-plank floors (`o`), lab checker tiles (`t`), the exit mat
 * (`E`), and walls from `W` tiles — a tall back wall (wainscot, windows,
 * pictures) on the top row and low cut-away walls on the sides and bottom so
 * the camera can see in. Floor slab edges toward the void are a dark cut
 * section so the room reads as a diorama piece.
 */
import * as THREE from 'three';
import { MAT } from './context.js';
import { PALETTE, TONES, ACCENTS } from '../../render/palette.js';
import { color, hash2, vary } from '../../render/materials.js';
import { LEVEL_HEIGHT } from '../../config.js';
import { VOID_BOTTOM } from './terrain.js';
import { TALL_FURNITURE } from './furniture.js';

/** Back wall height (world units). */
export const BACK_WALL_HEIGHT = 2.2;
/** Low cut-away wall height. */
export const LOW_WALL_HEIGHT = 0.45;

const SIDES = [
  { dx: 1, dy: 0, s: [0.5, 0.5], e: [0.5, -0.5], n: [1, 0, 0] },
  { dx: -1, dy: 0, s: [-0.5, -0.5], e: [-0.5, 0.5], n: [-1, 0, 0] },
  { dx: 0, dy: 1, s: [-0.5, 0.5], e: [0.5, 0.5], n: [0, 0, 1] },
  { dx: 0, dy: -1, s: [0.5, -0.5], e: [-0.5, -0.5], n: [0, 0, -1] },
];

/**
 * @param {import('./context.js').BuildContext} ctx
 */
export function buildInterior(ctx) {
  const { model, seed } = ctx;
  const batch = ctx.staticSet.get(MAT.solid);
  const p = ctx.painter(MAT.solid);
  const W = model.width;
  const H = model.height;
  /** @param {number} x @param {number} y */
  const t = (x, y) => model.typeAt(x, y);
  /** @param {number} x @param {number} y */
  const isFloor = (x, y) => {
    const tt = t(x, y);
    return !tt.void && !tt.wall;
  };

  let labCount = 0;
  let floorCount = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (model.charAt(x, y) === 't') labCount++;
      if (isFloor(x, y)) floorCount++;
    }
  }
  const lab = labCount > floorCount * 0.3;
  const theme = {
    plaster: color(lab ? TONES.plasterLab : TONES.plaster),
    wainscot: color(lab ? TONES.wainscotLab : TONES.wainscot),
    trim: color(TONES.trim),
    cut: color(TONES.cutSection),
    curtain: color(lab ? '#9fc9b8' : '#d98c6a'),
    frame: color(TONES.frameWhite),
  };

  const q = new Array(12);
  const ca = new THREE.Color();

  /** Flat quad on a tile sub-rectangle. */
  function flat(x0, z0, x1, z1, y, c) {
    q[0] = x0; q[1] = y; q[2] = z0;
    q[3] = x0; q[4] = y; q[5] = z1;
    q[6] = x1; q[7] = y; q[8] = z1;
    q[9] = x1; q[10] = y; q[11] = z0;
    batch.quad(q, 0, 1, 0, c);
  }

  /** Vertical face on a tile edge. */
  function face(x, y, side, yT, yB, cT, cB) {
    const ax = x + side.s[0];
    const az = y + side.s[1];
    const bx = x + side.e[0];
    const bz = y + side.e[1];
    q[0] = ax; q[1] = yT; q[2] = az;
    q[3] = ax; q[4] = yB; q[5] = az;
    q[6] = bx; q[7] = yB; q[8] = bz;
    q[9] = bx; q[10] = yT; q[11] = bz;
    batch.quad(q, side.n[0], side.n[1], side.n[2], cT, cB, cB, cT);
  }

  const plank = color(TONES.floorWood);
  const plankDark = color(TONES.floorWoodDark);
  const plankLight = color(TONES.floorWoodLight);
  const tileA = color(TONES.labTile);
  const tileB = color(TONES.labTileAlt);

  // ---- floors ---------------------------------------------------------------
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const tt = t(x, y);
      if (!tt.indoor || tt.wall) continue;
      const top = model.levelAt(x, y) * LEVEL_HEIGHT;
      if (tt.ground === 'tile') {
        for (let j = 0; j < 2; j++) {
          for (let i = 0; i < 2; i++) {
            const c = (x * 2 + i + y * 2 + j) % 2 === 0 ? tileA : tileB;
            vary(ca, c, hash2(x * 2 + i, y * 2 + j, seed + 901), 0.04);
            flat(x - 0.5 + i * 0.5 + 0.008, y - 0.5 + j * 0.5 + 0.008, x + i * 0.5 - 0.008, y + j * 0.5 - 0.008, top, ca);
          }
        }
        // Grout beneath the tiles.
        flat(x - 0.5, y - 0.5, x + 0.5, y + 0.5, top - 0.004, color('#b9c7bd'));
      } else {
        // Wood planks running east–west, staggered seams.
        for (let r = 0; r < 4; r++) {
          const z0 = y - 0.5 + r * 0.25;
          const z1 = z0 + 0.25 - 0.012;
          const seam = 0.2 + hash2(x, y * 4 + r, seed + 903) * 0.6;
          const split = hash2(y * 4 + r, x, seed + 905) < 0.45;
          const pick = (k) => {
            const h = hash2(x * 3 + k, y * 4 + r, seed + 907);
            return h < 0.33 ? plankDark : h < 0.66 ? plank : plankLight;
          };
          if (split) {
            vary(ca, pick(0), hash2(x, r, seed + 909), 0.06);
            flat(x - 0.5, z0, x - 0.5 + seam - 0.006, z1, top, ca);
            vary(ca, pick(1), hash2(r, x, seed + 911), 0.06);
            flat(x - 0.5 + seam + 0.006, z0, x + 0.5, z1, top, ca);
          } else {
            vary(ca, pick(2), hash2(x, y + r, seed + 913), 0.06);
            flat(x - 0.5, z0, x + 0.5, z1, top, ca);
          }
        }
        flat(x - 0.5, y - 0.5, x + 0.5, y + 0.5, top - 0.004, color(TONES.trim));
      }
      if (tt.exit) {
        p.block(0.9, 0.025, 0.64, x, top, y + 0.08, color(TONES.matBorder));
        p.block(0.76, 0.03, 0.5, x, top, y + 0.08, color(TONES.matRed));
        p.box(0.5, 0.032, 0.05, x, top + 0.016, y + 0.08, color(TONES.matBorder));
        // Daylight spilling in through the doorway.
        p.mat(MAT.lit).block(0.8, 0.004, 0.18, x, top + 0.001, y + 0.42, color('#f6e2b8'));
      }
      // Slab edges toward the void.
      for (const side of SIDES) {
        const nx = x + side.dx;
        const ny = y + side.dy;
        if (model.inBounds(nx, ny) && !t(nx, ny).void) continue;
        ca.copy(plankDark);
        face(x, y, side, top, top - 0.06, ca, ca);
        face(x, y, side, top - 0.06, VOID_BOTTOM, theme.cut, theme.cut);
      }
    }
  }

  // ---- walls ------------------------------------------------------------------
  const minFloorY = new Array(W).fill(Infinity);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      if (isFloor(x, y)) {
        minFloorY[x] = y;
        break;
      }
    }
  }
  /** @param {number} x @param {number} y */
  const isBack = (x, y) => {
    const m = Math.min(minFloorY[x - 1] ?? Infinity, minFloorY[x], minFloorY[x + 1] ?? Infinity);
    return Number.isFinite(m) && y === m - 1;
  };
  /** @param {number} x @param {number} y */
  const nearFloor = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && isFloor(x + dx, y + dy)) return true;
    return false;
  };

  let windowSlot = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!t(x, y).wall) continue;
      const base = model.levelAt(x, y) * LEVEL_HEIGHT;
      if (isBack(x, y)) {
        p.block(1, base - VOID_BOTTOM, 1, x, VOID_BOTTOM, y, theme.cut);
        p.block(1, BACK_WALL_HEIGHT, 1, x, base, y, theme.plaster);
        p.block(1, 0.04, 1.0, x, base + BACK_WALL_HEIGHT, y, theme.cut);
        const front = y + 0.5;
        if (isFloor(x, y + 1) || nearFloor(x, y)) {
          p.box(1.0, 0.8, 0.04, x, base + 0.4, front + 0.02, theme.wainscot);
          p.box(1.02, 0.05, 0.06, x, base + 0.82, front + 0.03, theme.trim);
          p.box(1.02, 0.1, 0.06, x, base + 0.05, front + 0.03, theme.trim);
          p.box(1.02, 0.08, 0.06, x, base + BACK_WALL_HEIGHT - 0.06, front + 0.03, theme.trim);
        }
        if (!isFloor(x, y + 1)) continue;
        const blocked = model.objectsAt(x, y + 1).some((o) => TALL_FURNITURE.has(o.type));
        if (blocked) continue;
        const slot = windowSlot++;
        if (slot % 3 === 1) {
          backWindow(x, base, front);
        } else if (hash2(x, y, seed + 921) < 0.55) {
          decor(x, base, front, Math.floor(hash2(y, x, seed + 923) * 4));
        }
        continue;
      }
      if (!nearFloor(x, y)) continue;
      p.block(1, base - VOID_BOTTOM, 1, x, VOID_BOTTOM, y, theme.cut);
      p.block(1, LOW_WALL_HEIGHT, 1, x, base, y, theme.plaster);
      p.block(1.02, 0.05, 1.02, x, base + LOW_WALL_HEIGHT, y, theme.trim);
      // Door posts beside the exit mat.
      for (const dx of [-1, 1]) {
        if (t(x - dx, y).exit) {
          p.block(0.14, 1.0, 0.3, x - dx * 0.43, base, y, theme.trim);
        }
      }
    }
  }

  /** A window on the back wall showing the sky. */
  function backWindow(x, base, front) {
    const y = base + 1.38;
    p.box(0.66, 0.76, 0.06, x, y, front + 0.03, theme.frame);
    p.mat(MAT.sky).box(0.52, 0.62, 0.02, x, y, front + 0.062);
    p.box(0.03, 0.62, 0.03, x, y, front + 0.075, theme.frame);
    p.box(0.52, 0.03, 0.03, x, y, front + 0.075, theme.frame);
    p.box(0.74, 0.05, 0.14, x, y - 0.4, front + 0.07, theme.frame);
    p.box(0.92, 0.025, 0.025, x, y + 0.46, front + 0.1, color(TONES.iron));
    p.box(0.16, 0.86, 0.04, x - 0.4, y + 0.02, front + 0.1, theme.curtain);
    p.box(0.16, 0.86, 0.04, x + 0.4, y + 0.02, front + 0.1, theme.curtain);
    p.cyl(0.06, 0.05, 0.08, x + 0.2, y - 0.33, front + 0.09, color(TONES.brick), 7);
    p.ico(0.06, x + 0.2, y - 0.25, front + 0.09, color(PALETTE.foliageLight));
  }

  /** Small wall decorations: picture, shelf, clock, pressed leaf. */
  function decor(x, base, front, kind) {
    const y = base + 1.4;
    if (kind === 0) {
      p.box(0.56, 0.44, 0.04, x, y, front + 0.02, theme.trim);
      p.box(0.46, 0.14, 0.02, x, y + 0.1, front + 0.042, color('#bfe3ea'));
      p.box(0.46, 0.12, 0.02, x, y - 0.02, front + 0.043, color(PALETTE.meadow));
      p.box(0.46, 0.1, 0.02, x, y - 0.13, front + 0.044, color(PALETTE.path));
      p.ico(0.06, x + 0.12, y + 0.12, front + 0.05, color(TONES.flowerButter), { sz: 0.2 });
    } else if (kind === 1) {
      p.box(0.7, 0.04, 0.2, x, y - 0.1, front + 0.1, theme.trim);
      for (let i = 0; i < 3; i++) {
        p.cyl(0.06, 0.06, 0.16 + i * 0.03, x - 0.2 + i * 0.2, y + 0.0 + i * 0.015, front + 0.1, color(ACCENTS[(i + x) % ACCENTS.length]), 8);
      }
    } else if (kind === 2) {
      p.cyl(0.18, 0.18, 0.05, x, y, front + 0.03, theme.trim, 14, { x: Math.PI / 2 });
      p.cyl(0.15, 0.15, 0.02, x, y, front + 0.06, theme.frame, 14, { x: Math.PI / 2 });
      p.box(0.02, 0.11, 0.015, x, y + 0.05, front + 0.075, color(TONES.iron));
      p.box(0.08, 0.02, 0.015, x + 0.035, y, front + 0.075, color(TONES.iron));
    } else {
      p.box(0.42, 0.52, 0.03, x, y, front + 0.02, theme.frame);
      p.box(0.36, 0.46, 0.02, x, y, front + 0.035, color(TONES.canvas));
      p.ico(0.12, x, y + 0.04, front + 0.05, color(PALETTE.foliage), { sx: 0.6, sy: 1.4, sz: 0.15, rot: { z: 0.3 } });
      p.box(0.01, 0.3, 0.01, x - 0.02, y - 0.06, front + 0.05, color(PALETTE.meadowDark), { z: 0.3 });
    }
  }
}
