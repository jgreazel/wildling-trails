/**
 * Terrain grid: the map's tiles plus (outdoors) a "skirt" ring of extra cells
 * beyond the bounds so the camera never sees the void. Skirt cells continue the
 * nearest edge tile: its level, water (rivers keep flowing) and paths (roads
 * lead off into the forest); everything else becomes forest floor.
 */
import { tileType } from '../tiles.js';
import { LEVEL_HEIGHT } from '../../config.js';

/** Skirt width (cells) around outdoor maps. */
export const SKIRT = 12;
/** Depth of water basins below their level's surface. */
export const BASIN_DEPTH = 0.46;
/** Water surface offset below its level's surface. */
export const WATER_DROP = 0.18;
/** Path / cobble / sand tops sit this much below grass for a crisp edge. */
export const PATH_INSET = 0.025;

/**
 * @typedef {object} Cell
 * @property {number} x
 * @property {number} y
 * @property {string} ch       tile character (skirt cells get a derived one)
 * @property {import('../tiles.js').TileType} t
 * @property {number} level
 * @property {number} d        0 inside the map, else Chebyshev distance beyond the edge
 * @property {number} top      ground top height (water: basin floor)
 * @property {boolean} inMap
 */

/** @param {string} ch */
function isPathChar(ch) {
  return ch === ',' || ch === ':' || ch === '_';
}

/**
 * Character for a cell outside the map, continuing the nearest edge tile.
 * @param {import('../map-utils.js').MapModel} model @param {number} x @param {number} y
 */
export function skirtChar(model, x, y) {
  const cx = Math.min(model.width - 1, Math.max(0, x));
  const cy = Math.min(model.height - 1, Math.max(0, y));
  const edge = model.charAt(cx, cy);
  const t = tileType(edge);
  if (t.water) return '~';
  if (isPathChar(edge)) return edge === '_' ? '_' : ',';
  if (t.void) return ' ';
  return '.';
}

/**
 * Ground top height of a cell (world y).
 * @param {import('../tiles.js').TileType} t @param {number} level
 */
export function groundTop(t, level) {
  const base = level * LEVEL_HEIGHT;
  if (t.water) return base - BASIN_DEPTH;
  if (t.ground === 'dirt' || t.ground === 'sand' || (t.ground === 'stone' && !t.stairs && !t.door)) return base - PATH_INSET;
  return base;
}

/**
 * Build the terrain grid.
 * @param {import('../map-utils.js').MapModel} model
 * @param {number} pad skirt width (0 for interiors)
 */
export function createGrid(model, pad) {
  const minX = -pad;
  const minY = -pad;
  const cols = model.width + pad * 2;
  const rows = model.height + pad * 2;
  /** @type {Cell[]} */
  const cells = new Array(cols * rows);
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const x = gx + minX;
      const y = gy + minY;
      const inMap = model.inBounds(x, y);
      const ch = inMap ? model.charAt(x, y) : skirtChar(model, x, y);
      const t = tileType(ch);
      const cx = Math.min(model.width - 1, Math.max(0, x));
      const cy = Math.min(model.height - 1, Math.max(0, y));
      const level = model.levelAt(cx, cy);
      const d = inMap ? 0 : Math.max(cx - x, x - cx, cy - y, y - cy);
      cells[gy * cols + gx] = { x, y, ch, t, level, d, top: groundTop(t, level), inMap };
    }
  }

  /** @param {number} x @param {number} y @returns {Cell|null} */
  function get(x, y) {
    const gx = x - minX;
    const gy = y - minY;
    if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) return null;
    return cells[gy * cols + gx];
  }

  let lowest = Infinity;
  for (const c of cells) if (!c.t.void) lowest = Math.min(lowest, c.top);
  if (!Number.isFinite(lowest)) lowest = 0;

  return {
    pad,
    minX,
    minY,
    maxX: minX + cols - 1,
    maxY: minY + rows - 1,
    cols,
    rows,
    cells,
    get,
    /** Lowest ground top in the grid (for the far ground plane). */
    lowest,
  };
}

/** @typedef {ReturnType<typeof createGrid>} Grid */
