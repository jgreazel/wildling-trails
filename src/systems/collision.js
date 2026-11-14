/**
 * Free-movement collision: a circle (the player) sliding against the tile map.
 *
 * The map stays a grid of rules — walkable tiles, solid objects, cliffs between
 * elevation levels, stairs that bridge one level — and the circle is pushed out
 * of every tile it may not enter, which makes it slide along walls and round
 * corners. Tiles are unit squares centred on integer coordinates.
 *
 * Pure functions over a MapModel: no THREE, no session state.
 */

/** Longest distance moved per collision sub-step (keeps thin walls solid). */
const MAX_SUBSTEP = 0.2;

/**
 * @typedef {object} Collider
 * @property {(cx:number, cy:number, tx:number, ty:number) => boolean} passable
 *   may a body centred in tile (cx, cy) overlap tile (tx, ty)?
 * @property {(x:number, z:number, dx:number, dz:number) => {x:number, z:number}} move
 *   move a circle by (dx, dz), sliding along whatever blocks it
 * @property {(x:number, z:number) => boolean} fits  does a circle at (x, z) overlap nothing it may not?
 */

/**
 * @param {object} opts
 * @param {any} opts.model  MapModel
 * @param {Record<string, any>} [opts.flags]
 * @param {number} opts.radius
 * @param {(x:number, y:number) => boolean} [opts.isBlocked]  extra blockers (NPC tiles)
 * @returns {Collider}
 */
export function createCollider({ model, flags = {}, radius, isBlocked }) {
  const r = Math.max(0.05, Math.min(0.49, radius));

  /** @type {Collider['passable']} */
  function passable(cx, cy, tx, ty) {
    if (tx === cx && ty === cy) return true;
    if (!model.isWalkableStatic(tx, ty, flags)) return false;
    const la = model.levelAt(cx, cy);
    const lb = model.levelAt(tx, ty);
    if (la !== lb) {
      const fromStairs = model.typeAt(cx, cy).stairs && lb === la + 1;
      const ontoStairs = model.typeAt(tx, ty).stairs && la === lb + 1;
      if (!fromStairs && !ontoStairs) return false;
    }
    if (isBlocked?.(tx, ty)) return false;
    return true;
  }

  /**
   * Push (x, z) out of every tile the body (centred in tile cx, cy) may not overlap.
   * @param {number} x @param {number} z @param {number} cx @param {number} cy
   */
  function resolve(x, z, cx, cy) {
    let nx = x;
    let nz = z;
    for (let iter = 0; iter < 3; iter++) {
      let pushed = false;
      const x0 = Math.round(nx - r);
      const x1 = Math.round(nx + r);
      const z0 = Math.round(nz - r);
      const z1 = Math.round(nz + r);
      for (let ty = z0; ty <= z1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (passable(cx, cy, tx, ty)) continue;
          const qx = Math.max(tx - 0.5, Math.min(tx + 0.5, nx));
          const qz = Math.max(ty - 0.5, Math.min(ty + 0.5, nz));
          const ddx = nx - qx;
          const ddz = nz - qz;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 >= r * r) continue;
          if (d2 < 1e-12) return null; // centre inside a blocked tile: refuse the move
          const d = Math.sqrt(d2);
          const push = r - d + 1e-6;
          nx += (ddx / d) * push;
          nz += (ddz / d) * push;
          pushed = true;
        }
      }
      if (!pushed) break;
    }
    return { x: nx, z: nz };
  }

  return {
    passable,

    move(x, z, dx, dz) {
      const dist = Math.hypot(dx, dz);
      const steps = Math.max(1, Math.ceil(dist / MAX_SUBSTEP));
      let px = x;
      let pz = z;
      for (let i = 0; i < steps; i++) {
        const cx = Math.round(px);
        const cy = Math.round(pz);
        const next = resolve(px + dx / steps, pz + dz / steps, cx, cy);
        if (!next) break;
        // Entering a new tile must itself be allowed from where we stand.
        const ncx = Math.round(next.x);
        const ncy = Math.round(next.z);
        if ((ncx !== cx || ncy !== cy) && !passable(cx, cy, ncx, ncy)) break;
        px = next.x;
        pz = next.z;
      }
      return { x: px, z: pz };
    },

    fits(x, z) {
      const cx = Math.round(x);
      const cy = Math.round(z);
      const res = resolve(x, z, cx, cy);
      return !!res && Math.abs(res.x - x) < 1e-5 && Math.abs(res.z - z) < 1e-5;
    },
  };
}

/**
 * Tiles a circle overlaps (for occupancy: NPCs never walk into the player).
 * @param {number} x @param {number} z @param {number} radius
 * @returns {{x:number, y:number}[]}
 */
export function tilesUnder(x, z, radius) {
  const out = [];
  const x0 = Math.round(x - radius);
  const x1 = Math.round(x + radius);
  const z0 = Math.round(z - radius);
  const z1 = Math.round(z + radius);
  for (let ty = z0; ty <= z1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const qx = Math.max(tx - 0.5, Math.min(tx + 0.5, x));
      const qz = Math.max(ty - 0.5, Math.min(ty + 0.5, z));
      if ((x - qx) ** 2 + (z - qz) ** 2 < radius * radius - 1e-9) out.push({ x: tx, y: ty });
    }
  }
  return out;
}
