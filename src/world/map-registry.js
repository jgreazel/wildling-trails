/**
 * Registry of every map definition, keyed by id.
 */
import fernhollow from './maps/fernhollow.js';
import home from './maps/home.js';
import wrenHouse from './maps/wren-house.js';
import lab from './maps/lab.js';

const MAPS = Object.freeze({
  fernhollow,
  home,
  'wren-house': wrenHouse,
  lab,
});

/** @type {ReadonlyArray<string>} */
export const MAP_IDS = Object.freeze(Object.keys(MAPS));

/**
 * @param {string} id
 * @returns {any} raw map definition
 */
export function getMapDef(id) {
  const def = MAPS[id];
  if (!def) throw new Error(`Unknown map "${id}"`);
  return def;
}
