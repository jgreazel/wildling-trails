/**
 * Fences: a post on every `F` tile with two rails that auto-connect to
 * neighbouring fence tiles (east / south links, so each rail is built once).
 */
import { MAT } from './context.js';
import { TONES } from '../../render/palette.js';
import { color, hash2, vary } from '../../render/materials.js';
import * as THREE from 'three';

/**
 * @param {import('./context.js').BuildContext} ctx
 */
export function buildFences(ctx) {
  const { grid, seed } = ctx;
  const p = ctx.painter(MAT.solid);
  const postBase = color(TONES.woodDark);
  const railBase = color(TONES.wood);
  const cap = color(TONES.woodLight);
  const tmp = new THREE.Color();
  /** @param {number} x @param {number} y */
  const isFence = (x, y) => {
    const c = grid.get(x, y);
    return !!c && c.inMap && !!c.t.fence;
  };

  for (const c of grid.cells) {
    if (!c.inMap || !c.t.fence) continue;
    const y0 = c.top;
    const tilt = (hash2(c.x, c.y, seed + 801) - 0.5) * 0.06;
    vary(tmp, postBase, hash2(c.y, c.x, seed + 803), 0.18);
    p.box(0.14, 0.66, 0.14, c.x, y0 + 0.33, c.y, tmp, { z: tilt });
    p.cone(0.11, 0.12, c.x, y0 + 0.72, c.y, cap, 4, Math.PI / 4);

    const links = [
      [1, 0],
      [0, 1],
    ];
    let linked = false;
    for (const [dx, dy] of links) {
      if (!isFence(c.x + dx, c.y + dy)) continue;
      linked = true;
      const n = grid.get(c.x + dx, c.y + dy);
      const midY = (y0 + /** @type {any} */ (n).top) / 2;
      const mx = c.x + dx / 2;
      const mz = c.y + dy / 2;
      const yaw = dx ? 0 : Math.PI / 2;
      vary(tmp, railBase, hash2(c.x * 2 + dx, c.y * 2 + dy, seed + 805), 0.16);
      p.box(1.0, 0.07, 0.06, mx, midY + 0.27, mz, tmp, yaw);
      p.box(1.0, 0.07, 0.06, mx, midY + 0.5, mz, tmp, yaw);
    }
    // Lonely posts get a little stub rail so they still read as fence.
    if (!linked && !isFence(c.x - 1, c.y) && !isFence(c.x, c.y - 1)) {
      p.box(0.5, 0.07, 0.06, c.x, y0 + 0.5, c.y, railBase);
    }
  }
}
