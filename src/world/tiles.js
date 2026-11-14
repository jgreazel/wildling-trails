/**
 * Tile legend. One character per tile in map `tiles` rows.
 * See docs/ARCHITECTURE.md → "Tile legend".
 */

/**
 * @typedef {object} TileType
 * @property {string} id
 * @property {boolean} walkable
 * @property {'grass'|'dirt'|'stone'|'sand'|'water'|'wood'|'tile'|'mat'|'wall'|'void'} ground
 * @property {boolean} [tallGrass]
 * @property {boolean} [flowers]
 * @property {boolean} [water]
 * @property {boolean} [bridge]
 * @property {boolean} [tree]
 * @property {boolean} [hedge]
 * @property {boolean} [rock]
 * @property {boolean} [fence]
 * @property {'down'|'left'|'right'} [ledge]
 * @property {boolean} [stairs]
 * @property {boolean} [door]
 * @property {boolean} [wall]
 * @property {boolean} [exit]
 * @property {boolean} [indoor]
 * @property {boolean} [void]
 */

/** @type {TileType} */
export const VOID_TYPE = Object.freeze({ id: 'void', walkable: false, ground: 'void', void: true });

/** @type {Readonly<Record<string, TileType>>} */
export const TILE_TYPES = Object.freeze({
  // outdoor ground
  '.': { id: 'grass', walkable: true, ground: 'grass' },
  ',': { id: 'path', walkable: true, ground: 'dirt' },
  ':': { id: 'cobble', walkable: true, ground: 'stone' },
  _: { id: 'sand', walkable: true, ground: 'sand' },
  f: { id: 'flowers', walkable: true, ground: 'grass', flowers: true },
  '"': { id: 'tallgrass', walkable: true, ground: 'grass', tallGrass: true },
  // water
  '~': { id: 'water', walkable: false, ground: 'water', water: true },
  '=': { id: 'bridge', walkable: true, ground: 'water', water: true, bridge: true },
  // blockers
  T: { id: 'tree', walkable: false, ground: 'grass', tree: true },
  h: { id: 'hedge', walkable: false, ground: 'grass', hedge: true },
  R: { id: 'rock', walkable: false, ground: 'grass', rock: true },
  F: { id: 'fence', walkable: false, ground: 'grass', fence: true },
  '#': { id: 'block', walkable: false, ground: 'grass' },
  // ledges (hop over in the given direction)
  v: { id: 'ledge-down', walkable: false, ground: 'grass', ledge: 'down' },
  '<': { id: 'ledge-left', walkable: false, ground: 'grass', ledge: 'left' },
  '>': { id: 'ledge-right', walkable: false, ground: 'grass', ledge: 'right' },
  // connectors
  S: { id: 'stairs', walkable: true, ground: 'stone', stairs: true },
  D: { id: 'door', walkable: true, ground: 'stone', door: true },
  // indoor
  o: { id: 'floor', walkable: true, ground: 'wood', indoor: true },
  t: { id: 'labfloor', walkable: true, ground: 'tile', indoor: true },
  E: { id: 'exit', walkable: true, ground: 'mat', exit: true, indoor: true },
  W: { id: 'wall', walkable: false, ground: 'wall', wall: true, indoor: true },
  ' ': VOID_TYPE,
});

/**
 * @param {string|undefined} char
 * @returns {TileType}
 */
export function tileType(char) {
  return (char !== undefined && TILE_TYPES[char]) || VOID_TYPE;
}
