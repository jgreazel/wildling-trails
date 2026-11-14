/**
 * MapModel: a queryable view over a raw map definition.
 * Authoritative home of the movement rules (canStep) shared by systems and tests.
 */
import { tileType } from './tiles.js';
import { DIRS, LEVEL_HEIGHT } from '../config.js';

/** Default footprint and solidity per object type. */
export const OBJECT_DEFAULTS = Object.freeze({
  building: { w: 4, h: 3, solid: true },
  bigtree: { w: 2, h: 2, solid: true },
  sign: { w: 1, h: 1, solid: true },
  mailbox: { w: 1, h: 1, solid: true },
  lamp: { w: 1, h: 1, solid: true },
  barrel: { w: 1, h: 1, solid: true },
  crate: { w: 1, h: 1, solid: true },
  flowerpot: { w: 1, h: 1, solid: true },
  stump: { w: 1, h: 1, solid: true },
  statue: { w: 1, h: 1, solid: true },
  well: { w: 2, h: 2, solid: true },
  bench: { w: 2, h: 1, solid: true },
  logpile: { w: 2, h: 1, solid: true },
  waterwheel: { w: 1, h: 2, solid: true },
  lilypad: { w: 1, h: 1, solid: false },
  bed: { w: 1, h: 2, solid: true },
  table: { w: 2, h: 1, solid: true },
  bookshelf: { w: 2, h: 1, solid: true },
  desk: { w: 2, h: 1, solid: true },
  planter: { w: 2, h: 1, solid: true },
  fireplace: { w: 2, h: 1, solid: true },
  counter: { w: 1, h: 1, solid: true },
  chair: { w: 1, h: 1, solid: true },
  stool: { w: 1, h: 1, solid: true },
  stove: { w: 1, h: 1, solid: true },
  cupboard: { w: 1, h: 1, solid: true },
  plant: { w: 1, h: 1, solid: true },
  radio: { w: 1, h: 1, solid: true },
  terminal: { w: 1, h: 1, solid: true },
  machine: { w: 1, h: 1, solid: true },
  sink: { w: 1, h: 1, solid: true },
  pedestal: { w: 1, h: 1, solid: true },
  rug: { w: 2, h: 2, solid: false },
});

const FALLBACK_OBJECT = Object.freeze({ w: 1, h: 1, solid: true });

/** @param {unknown} v @returns {string[]} */
function asList(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Test one flag expression ('name' or '!name').
 * @param {string} expr @param {Record<string, any>} flags
 */
export function testFlag(expr, flags) {
  if (typeof expr !== 'string' || !expr) return false;
  return expr.startsWith('!') ? !flags?.[expr.slice(1)] : !!flags?.[expr];
}

/**
 * True if any expression in `list` holds.
 * @param {string|string[]|undefined} list @param {Record<string, any>} flags
 */
export function anyFlag(list, flags) {
  return asList(list).some((f) => testFlag(f, flags));
}

/**
 * showIf: all must hold. hideIf: any hides.
 * @param {{showIf?:string|string[], hideIf?:string|string[]}|null|undefined} entity
 * @param {Record<string, any>} [flags]
 */
export function isActive(entity, flags = {}) {
  if (!entity) return false;
  if (!asList(entity.showIf).every((f) => testFlag(f, flags))) return false;
  if (asList(entity.hideIf).some((f) => testFlag(f, flags))) return false;
  return true;
}

/**
 * @param {any} o raw object def
 * @param {number} index
 */
function normalizeObject(o, index) {
  const d = OBJECT_DEFAULTS[o.type] ?? FALLBACK_OBJECT;
  return {
    ...o,
    id: o.id ?? `${o.type}-${index}`,
    w: Math.max(1, o.w ?? d.w),
    h: Math.max(1, o.h ?? d.h),
    solid: o.solid ?? d.solid,
    index,
  };
}

/** @param {any} n @param {number} index */
function normalizeNpc(n, index) {
  return {
    behavior: 'stand',
    facing: 'down',
    radius: 2,
    ...n,
    id: n.id ?? `npc-${index}`,
  };
}

/**
 * @typedef {{ok:boolean, x:number, y:number, hop:boolean, reason:string|null}} StepResult
 */

/**
 * Build a MapModel from a raw map definition.
 * @param {any} def
 */
export function createMapModel(def) {
  if (!def || !Array.isArray(def.tiles) || def.tiles.length === 0) {
    throw new Error(`Map "${def?.id ?? '?'}" has no tiles`);
  }
  /** @type {string[]} */
  const rows = def.tiles;
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  /** @type {string[]|null} */
  const heights = Array.isArray(def.heights) ? def.heights : null;
  const kind = def.kind === 'indoor' ? 'indoor' : 'outdoor';

  const objects = (def.objects ?? []).map(normalizeObject);
  const npcs = (def.npcs ?? []).map(normalizeNpc);
  const warps = def.warps ?? [];
  const triggers = def.triggers ?? [];
  const scripts = def.scripts ?? {};

  /** @param {number} x @param {number} y */
  const inBounds = (x, y) =>
    Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
  /** @param {number} x @param {number} y */
  const key = (x, y) => y * width + x;

  /** @type {Map<number, any[]>} tile → objects whose footprint covers it */
  const cover = new Map();
  for (const o of objects) {
    for (let dy = 0; dy < o.h; dy++) {
      for (let dx = 0; dx < o.w; dx++) {
        const tx = o.x + dx;
        const ty = o.y + dy;
        if (!inBounds(tx, ty)) continue;
        const k = key(tx, ty);
        if (!cover.has(k)) cover.set(k, []);
        cover.get(k).push(o);
      }
    }
  }

  /** @param {number} x @param {number} y */
  function charAt(x, y) {
    if (!inBounds(x, y)) return ' ';
    return rows[y][x] ?? ' ';
  }

  /** @param {number} x @param {number} y */
  function typeAt(x, y) {
    return tileType(charAt(x, y));
  }

  /** @param {number} x @param {number} y */
  function levelAt(x, y) {
    if (!heights || !inBounds(x, y)) return 0;
    const c = heights[y]?.[x];
    if (c === undefined) return 0;
    const n = c.charCodeAt(0) - 48;
    return n >= 0 && n <= 9 ? n : 0;
  }

  /** World y of the walking surface at a tile. @param {number} x @param {number} y */
  function surfaceY(x, y) {
    return levelAt(x, y) * LEVEL_HEIGHT + (typeAt(x, y).stairs ? LEVEL_HEIGHT / 2 : 0);
  }

  /** @param {number} x @param {number} y */
  function objectsAt(x, y) {
    if (!inBounds(x, y)) return [];
    return cover.get(key(x, y)) ?? [];
  }

  /**
   * The active object at a tile, preferring solid ones.
   * @param {number} x @param {number} y @param {Record<string, any>} [flags]
   */
  function activeObjectAt(x, y, flags = {}) {
    const list = objectsAt(x, y).filter((o) => isActive(o, flags));
    return list.find((o) => o.solid) ?? list[0] ?? null;
  }

  /** The building whose door is at this tile, if any. @param {number} x @param {number} y */
  function doorBuildingAt(x, y) {
    return objects.find((o) => o.type === 'building' && o.door && o.door.x === x && o.door.y === y) ?? null;
  }

  /** @param {number} x @param {number} y @param {Record<string, any>} [flags] */
  function warpAt(x, y, flags = {}) {
    return warps.find((w) => w.x === x && w.y === y && isActive(w, flags)) ?? null;
  }

  /** @param {number} x @param {number} y @param {Record<string, any>} [flags] */
  function triggerAt(x, y, flags = {}) {
    return triggers.find((t) => t.x === x && t.y === y && isActive(t, flags)) ?? null;
  }

  /**
   * Walkable ignoring actors: tile walkable and no active solid object (door tiles exempt).
   * @param {number} x @param {number} y @param {Record<string, any>} [flags]
   */
  function isWalkableStatic(x, y, flags = {}) {
    if (!inBounds(x, y)) return false;
    if (!typeAt(x, y).walkable) return false;
    for (const o of objectsAt(x, y)) {
      if (!o.solid || !isActive(o, flags)) continue;
      if (o.type === 'building' && o.door && o.door.x === x && o.door.y === y) continue;
      return false;
    }
    return true;
  }

  /**
   * Movement rule from (x, y) in `dir`. Ignores actors.
   * @param {number} x @param {number} y @param {import('../config.js').Dir} dir
   * @param {Record<string, any>} [flags]
   * @returns {StepResult}
   */
  function canStep(x, y, dir, flags = {}) {
    const d = DIRS[dir];
    if (!d) return { ok: false, x, y, hop: false, reason: 'bad-dir' };
    const nx = x + d.dx;
    const ny = y + d.dy;
    if (!inBounds(nx, ny)) return { ok: false, x: nx, y: ny, hop: false, reason: 'edge' };

    const target = typeAt(nx, ny);
    if (target.ledge) {
      if (target.ledge !== dir) return { ok: false, x: nx, y: ny, hop: false, reason: 'ledge' };
      const lx = nx + d.dx;
      const ly = ny + d.dy;
      if (!isWalkableStatic(lx, ly, flags)) {
        return { ok: false, x: nx, y: ny, hop: false, reason: 'ledge-blocked' };
      }
      return { ok: true, x: lx, y: ly, hop: true, reason: null };
    }

    if (!isWalkableStatic(nx, ny, flags)) {
      return { ok: false, x: nx, y: ny, hop: false, reason: target.water ? 'water' : 'blocked' };
    }

    const la = levelAt(x, y);
    const lb = levelAt(nx, ny);
    if (la !== lb) {
      const fromStairs = typeAt(x, y).stairs && lb === la + 1;
      const ontoStairs = target.stairs && la === lb + 1;
      if (!fromStairs && !ontoStairs) return { ok: false, x: nx, y: ny, hop: false, reason: 'cliff' };
    }
    return { ok: true, x: nx, y: ny, hop: false, reason: null };
  }

  return {
    def,
    id: def.id,
    name: def.name ?? def.id,
    kind,
    width,
    height,
    spawn: def.spawn ?? { x: Math.floor(width / 2), y: Math.floor(height / 2), facing: 'down' },
    objects,
    npcs,
    warps,
    triggers,
    scripts,
    inBounds,
    charAt,
    typeAt,
    levelAt,
    surfaceY,
    objectsAt,
    activeObjectAt,
    doorBuildingAt,
    warpAt,
    triggerAt,
    isWalkableStatic,
    canStep,
    isActive,
  };
}

/** @typedef {ReturnType<typeof createMapModel>} MapModel */
