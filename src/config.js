/**
 * Shared constants and tiny helpers used across every module group.
 * Pure data — safe to import from Node tests.
 */

export const GAME_TITLE = 'Wildling Trails';
export const TOWN_NAME = 'Fernhollow';

/** World units per tile. Tile (x, y) is centred at world (x, 0, y). */
export const TILE = 1;
/** World height of one elevation level (heights digit). */
export const LEVEL_HEIGHT = 0.5;

/** Milliseconds to cross one tile. */
export const WALK_STEP_MS = 250;
export const RUN_STEP_MS = 135;
/** Milliseconds for a ledge hop (covers two tiles). */
export const HOP_MS = 430;
/** A direction tap shorter than this only turns the player in place. */
export const TURN_DELAY_MS = 90;

/** @typedef {'up'|'down'|'left'|'right'} Dir */

/** @type {Readonly<Record<Dir, {dx:number, dy:number}>>} */
export const DIRS = Object.freeze({
  up: Object.freeze({ dx: 0, dy: -1 }),
  down: Object.freeze({ dx: 0, dy: 1 }),
  left: Object.freeze({ dx: -1, dy: 0 }),
  right: Object.freeze({ dx: 1, dy: 0 }),
});

/** @type {ReadonlyArray<Dir>} */
export const DIR_NAMES = Object.freeze(['up', 'down', 'left', 'right']);

/** @type {Readonly<Record<Dir, Dir>>} */
export const OPPOSITE = Object.freeze({ up: 'down', down: 'up', left: 'right', right: 'left' });

/**
 * rotation.y for a model that faces +z at rotation 0.
 * rotation.y = θ maps +z to (sin θ, 0, cos θ).
 * @type {Readonly<Record<Dir, number>>}
 */
export const FACING_ANGLE = Object.freeze({
  down: 0,
  right: Math.PI / 2,
  up: Math.PI,
  left: -Math.PI / 2,
});

/**
 * Direction from tile a to an adjacent tile b (or the dominant axis otherwise).
 * @param {number} ax @param {number} ay @param {number} bx @param {number} by
 * @returns {Dir}
 */
export function dirBetween(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) return dx > 0 ? 'right' : 'left';
  return dy < 0 ? 'up' : 'down';
}

/**
 * World-space centre of a tile (y left to the caller — use MapModel.surfaceY).
 * @param {number} x @param {number} y
 */
export function tileToWorld(x, y) {
  return { x: x * TILE, z: y * TILE };
}

/** The player's look — an original design (moss beanie, rust hoodie, mustard backpack). */
export const PLAYER_LOOK = Object.freeze({
  skin: '#f0c8a0',
  hair: '#5a3a26',
  hairStyle: 'beanie',
  hat: '#5f7d4a',
  shirt: '#c8643b',
  pants: '#3d4a5c',
  shoes: '#efe6d2',
  outfit: 'jacket',
  outfitColor: '#c8643b',
  build: 'kid',
  accessory: 'backpack',
  accessoryColor: '#d9a441',
});

/** First map of a new game. */
export const START_MAP = 'home';
/** Map shown behind the title screen. */
export const PREVIEW_MAP = 'fernhollow';
