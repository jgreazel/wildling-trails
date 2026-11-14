/**
 * Persistent game state + preferences, saved to localStorage.
 * Never cache state.flags / state.party / state.seen — resetState() replaces them.
 */
import { bus } from './events.js';
import { START_MAP } from '../config.js';
import { WILDLINGS } from '../data/wildlings.js';

const SAVE_KEY = 'wildling-trails:save:v1';
const PREFS_KEY = 'wildling-trails:prefs:v1';
const VERSION = 1;

function fresh() {
  return {
    version: VERSION,
    /** @type {string} */ mapId: START_MAP,
    /** @type {number|null} */ x: null,
    /** @type {number|null} */ y: null,
    /** @type {'up'|'down'|'left'|'right'} */ facing: 'down',
    /** @type {Record<string, true>} */ flags: {},
    /** @type {{species:string, name:string}[]} */ party: [],
    /** @type {string[]} */ seen: [],
    playTime: 0,
  };
}

/** Live game state (mutated in place). */
export const state = fresh();

/** User preferences that survive new games. */
export const prefs = { muted: false };

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Start a brand-new game (keeps prefs). */
export function resetState() {
  Object.assign(state, fresh());
  bus.emit('party');
}

/** @returns {boolean} whether a save exists */
export function hasSave() {
  try {
    return !!storage()?.getItem(SAVE_KEY);
  } catch {
    return false;
  }
}

/** @returns {boolean} success */
export function saveState() {
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(SAVE_KEY, JSON.stringify(state));
    bus.emit('saved');
    return true;
  } catch {
    return false;
  }
}

/** Load the save into `state`. @returns {boolean} success */
export function loadState() {
  try {
    const raw = storage()?.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || data.version !== VERSION) return false;
    const base = fresh();
    Object.assign(state, base, data, {
      flags: { ...(data.flags ?? {}) },
      party: Array.isArray(data.party) ? data.party.filter((p) => p && WILDLINGS[p.species]) : [],
      seen: Array.isArray(data.seen) ? data.seen.filter((s) => WILDLINGS[s]) : [],
    });
    bus.emit('party');
    return true;
  } catch {
    return false;
  }
}

/** Delete the save slot. */
export function clearSave() {
  try {
    storage()?.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

/** @param {string} name */
export function getFlag(name) {
  if (typeof name !== 'string') return false;
  if (name.startsWith('!')) return !state.flags[name.slice(1)];
  return !!state.flags[name];
}

/** @param {string} name @param {boolean} [value] */
export function setFlag(name, value = true) {
  if (value) state.flags[name] = true;
  else delete state.flags[name];
  bus.emit('flag', { name, value: !!value });
}

/** @param {string} species */
export function markSeen(species) {
  if (!WILDLINGS[species] || state.seen.includes(species)) return;
  state.seen.push(species);
  bus.emit('seen', { species });
}

/**
 * Add a wildling to the party (the first one becomes the follower).
 * @param {string} species
 * @returns {{species:string, name:string}|null}
 */
export function addPartner(species) {
  const data = WILDLINGS[species];
  if (!data) return null;
  const member = { species, name: data.name };
  state.party.push(member);
  markSeen(species);
  bus.emit('party');
  return member;
}

export function loadPrefs() {
  try {
    const raw = storage()?.getItem(PREFS_KEY);
    if (raw) Object.assign(prefs, JSON.parse(raw));
  } catch {
    /* ignore */
  }
  return prefs;
}

export function savePrefs() {
  try {
    storage()?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}
