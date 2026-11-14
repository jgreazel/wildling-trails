#!/usr/bin/env node
/**
 * Map validator for Wildling Trails.
 *
 *   node tools/validate-maps.mjs            # validate every registered map
 *   node tools/validate-maps.mjs --verbose  # also list per-map stats
 *
 * Exit code 1 when there are errors. Warnings are printed separately and never fail.
 *
 * What it checks (docs/ARCHITECTURE.md → "Map format"):
 *  - structure: rectangular tiles, known tile chars, heights with matching dims and digits only,
 *    spawn on a walkable tile, objects in bounds, no overlapping solid footprints;
 *  - buildings: door on the footprint's bottom row, on a 'D' tile, with a warp on it;
 *  - warps: target map exists, landing tile walkable and not itself a warp, door ↔ exit-mat pairs
 *    are reciprocal (exit lands directly south of the door, door lands directly above the mat);
 *  - NPCs and triggers on walkable tiles not covered by solid objects; look vocabulary;
 *  - every script id referenced by npcs/objects/triggers/onEnter exists;
 *  - every flag in showIf/hideIf/emptyIf is set by some script (static scan of setFlag('…'),
 *    template names such as `chose_${id}` expanded with the known species ids, plus the flags
 *    observed during the script dry-run);
 *  - stairs connect to a neighbour one level up; ledges have a take-off and a landing tile;
 *  - reachability (MapModel.canStep, NPC tiles block, warp/trigger tiles end a path) from the
 *    spawn for a new game and for every with-partner playthrough: every door, warp, NPC and
 *    scripted object must be reachable, and nothing reachable may soft-lock the player;
 *  - outdoor edge exits: unreachable before the player has a partner, reachable after;
 *  - a script dry-run with a mock Script API (isolated runs plus three full playthroughs, one per
 *    starter) — any throw, unknown npc/species/map id or blocked scripted walk is an error;
 *  - dialogue pages longer than 90 characters → warning.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TILE_TYPES } from '../src/world/tiles.js';
import { createMapModel, OBJECT_DEFAULTS, isActive } from '../src/world/map-utils.js';
import { MAP_IDS, getMapDef } from '../src/world/map-registry.js';
import { WILDLINGS } from '../src/data/wildlings.js';
import { DIRS, DIR_NAMES, START_MAP } from '../src/config.js';

/* ---------------------------------------------------------------- vocabulary */

/** NPC `look` vocabulary from the contract. */
export const LOOK_VOCAB = Object.freeze({
  hairStyle: ['short', 'long', 'ponytail', 'bun', 'spiky', 'bald', 'bob', 'cap', 'beanie'],
  outfit: [null, 'labcoat', 'apron', 'overalls', 'jacket', 'dress'],
  build: ['adult', 'kid', 'elder'],
  accessory: [null, 'glasses', 'scarf', 'backpack', 'fishing-rod', 'cane', 'watering-can'],
});
/** NPC behaviours systems understand. */
export const BEHAVIORS = Object.freeze(['stand', 'turn', 'wander']);
/** Music ids the audio module provides. */
export const MUSIC_IDS = Object.freeze(['title', 'town', 'town-night', 'home', 'lab']);
/** Sound-effect ids the audio module provides. */
export const SFX_IDS = Object.freeze([
  'step', 'bump', 'door', 'confirm', 'cancel', 'cursor', 'text', 'ledge', 'grass', 'save', 'fanfare', 'encounter', 'menu',
]);
/** Emote kinds ActorModel.emote accepts. */
export const EMOTES = Object.freeze(['!', '?', '…', '♥', '♪']);
/** Building variants the world builder renders. */
export const BUILDING_VARIANTS = Object.freeze(['cottage', 'house', 'greenhouse', 'mill']);
/** Dialogue pages longer than this produce a warning. */
export const MAX_PAGE_CHARS = 90;

const KINDS = ['outdoor', 'indoor'];
const MAPS_DIR = fileURLToPath(new URL('../src/world/maps/', import.meta.url));

/* ------------------------------------------------------------------- helpers */

/** @param {number} x @param {number} y */
const key = (x, y) => `${x},${y}`;
/** @param {unknown} v @returns {any[]} */
const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
/** @param {unknown} v */
const isInt = (v) => Number.isInteger(v);
/** @param {string} expr */
const flagName = (expr) => (typeof expr === 'string' && expr.startsWith('!') ? expr.slice(1) : expr);

/**
 * Collector for errors and warnings, each prefixed with where it happened.
 * @returns {{errors:string[], warnings:string[], error(where:string, msg:string):void, warn(where:string, msg:string):void}}
 */
export function createReport() {
  const errors = [];
  const warnings = [];
  const seenE = new Set();
  const seenW = new Set();
  return {
    errors,
    warnings,
    error(where, msg) {
      const line = `[${where}] ${msg}`;
      if (!seenE.has(line)) (seenE.add(line), errors.push(line));
    },
    warn(where, msg) {
      const line = `[${where}] ${msg}`;
      if (!seenW.has(line)) (seenW.add(line), warnings.push(line));
    },
  };
}

/**
 * Normalise `text` into pages, or null when it is malformed.
 * @param {unknown} text
 * @returns {string[]|null}
 */
function toPages(text) {
  if (typeof text === 'string') return [text];
  if (Array.isArray(text) && text.length > 0 && text.every((p) => typeof p === 'string')) return text;
  return null;
}

/**
 * Check dialogue pages: shape errors and over-long-page warnings.
 * @param {ReturnType<typeof createReport>} report @param {string} where @param {unknown} text
 */
function checkPages(report, where, text) {
  const pages = toPages(text);
  if (!pages) {
    report.error(where, 'dialogue must be a string or a non-empty array of strings');
    return;
  }
  for (const page of pages) {
    if (!page.trim()) report.error(where, 'empty dialogue page');
    else if (page.length > MAX_PAGE_CHARS) {
      report.warn(where, `dialogue page is ${page.length} chars (> ${MAX_PAGE_CHARS}): "${page}"`);
    }
  }
}

/** Every registered map definition, keyed by id. */
export function loadMaps() {
  /** @type {Record<string, any>} */
  const maps = {};
  for (const id of MAP_IDS) maps[id] = getMapDef(id);
  return maps;
}

/**
 * Source text of every file in src/world/maps (used for the static setFlag scan).
 * @returns {string[]}
 */
export function readMapSources() {
  try {
    return readdirSync(MAPS_DIR)
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(path.join(MAPS_DIR, f), 'utf8'));
  } catch {
    return [];
  }
}

const SET_FLAG_RE = /setFlag\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

/**
 * Flag names written by `setFlag('…')` calls in source text. Template literals such as
 * `chose_${id}` are expanded with every known species id.
 * @param {string} source
 * @param {string[]} [ids]
 * @returns {Set<string>}
 */
export function flagsFromSource(source, ids = Object.keys(WILDLINGS)) {
  const out = new Set();
  for (const m of String(source).matchAll(SET_FLAG_RE)) {
    const [, quote, body] = m;
    if (quote === '`' && body.includes('${')) {
      const parts = body.split(/\$\{[^}]*\}/);
      let names = [parts[0]];
      for (let i = 1; i < parts.length; i++) {
        const next = [];
        for (const n of names) for (const id of ids) next.push(n + id + parts[i]);
        names = next;
      }
      names.forEach((n) => out.add(n));
    } else if (body) {
      out.add(body);
    }
  }
  return out;
}

/**
 * Static scan of every script (function source) plus the map module sources.
 * @param {Record<string, any>} maps @param {string[]} [sources]
 */
export function staticSetFlags(maps, sources = []) {
  const out = new Set();
  const add = (src) => flagsFromSource(src).forEach((f) => out.add(f));
  for (const def of Object.values(maps)) {
    for (const fn of Object.values(def?.scripts ?? {})) if (typeof fn === 'function') add(fn.toString());
  }
  sources.forEach(add);
  return out;
}

/* ----------------------------------------------------------- script dry-run */

/**
 * @typedef {object} Answers
 * @property {(prompt:string, index:number) => boolean} confirm
 * @property {(prompt:string, options:string[], index:number) => number} choose
 */

/** Confirm yes, choose the first option. */
export const ANSWER_YES = Object.freeze({ confirm: () => true, choose: () => 0 });
/** Confirm no, choose the last option. */
export const ANSWER_NO = Object.freeze({ confirm: () => false, choose: (_p, options) => options.length - 1 });

/**
 * A mock Script API that records everything a script does and validates every call
 * against the contract. Resolves every prompt immediately.
 *
 * @param {object} opts
 * @param {Record<string, any>} opts.maps all map defs (for warp targets)
 * @param {string} opts.mapId map whose script is running
 * @param {Record<string, boolean>} [opts.flags] initial flags (copied)
 * @param {{species:string, name:string}[]} [opts.party] initial party (copied)
 * @param {{x:number, y:number, facing?:string}} [opts.player] player tile (defaults to spawn)
 * @param {Answers} [opts.answers]
 * @param {string} [opts.where] label for messages
 */
export function createScriptHarness({ maps, mapId, flags = {}, party = [], player, answers = ANSWER_YES, where }) {
  const def = maps[mapId];
  const model = createMapModel(def);
  const label = where ?? mapId;
  const report = createReport();
  const state = { flags: { ...flags }, party: party.map((p) => ({ ...p })) };
  const log = {
    says: /** @type {{speaker?:string, pages:string[]}[]} */ ([]),
    prompts: /** @type {{kind:string, prompt:string, options?:string[], answer:any}[]} */ ([]),
    cards: /** @type {any[]} */ ([]),
    flagsSet: /** @type {string[]} */ ([]),
    given: /** @type {string[]} */ ([]),
    seen: /** @type {string[]} */ ([]),
    cries: /** @type {string[]} */ ([]),
    sfx: /** @type {string[]} */ ([]),
    music: /** @type {string[]} */ ([]),
    banners: /** @type {string[]} */ ([]),
    warps: /** @type {any[]} */ ([]),
    emotes: /** @type {{who:string, kind:string}[]} */ ([]),
    npcWalks: /** @type {{id:string, dirs:string[]}[]} */ ([]),
    playerWalks: /** @type {string[][]} */ ([]),
    hidden: new Set(),
    shown: new Set(),
  };
  let confirmIndex = 0;
  let chooseIndex = 0;

  const checkDir = (dir, what) => {
    if (!DIR_NAMES.includes(dir)) report.error(label, `${what}: invalid direction ${JSON.stringify(dir)}`);
  };
  const checkEmote = (kind, who) => {
    if (!EMOTES.includes(kind)) report.error(label, `${who}.emote: unknown emote ${JSON.stringify(kind)}`);
    log.emotes.push({ who, kind });
  };
  const checkSpecies = (id, what) => {
    if (!WILDLINGS[id]) report.error(label, `${what}: unknown species ${JSON.stringify(id)}`);
    return !!WILDLINGS[id];
  };
  const checkDirs = (dirs, what) => {
    if (!Array.isArray(dirs)) {
      report.error(label, `${what}: walk() expects an array of directions`);
      return [];
    }
    dirs.forEach((d) => checkDir(d, what));
    return dirs.filter((d) => DIR_NAMES.includes(d));
  };

  /** @type {Map<string, any>} */
  const npcHandles = new Map();
  function npcHandle(id) {
    if (npcHandles.has(id)) return npcHandles.get(id);
    const npc = model.npcs.find((n) => n.id === id);
    if (!npc) {
      report.error(label, `api.npc(${JSON.stringify(id)}): no such npc on map "${mapId}"`);
      npcHandles.set(id, null);
      return null;
    }
    const pos = { x: npc.x, y: npc.y };
    const handle = {
      face: (dir) => checkDir(dir, `npc ${id}.face`),
      facePlayer: () => {},
      async walk(dirs) {
        const list = checkDirs(dirs, `npc ${id}.walk`);
        log.npcWalks.push({ id, dirs: list });
        for (const dir of list) {
          pos.x += DIRS[dir].dx;
          pos.y += DIRS[dir].dy;
          if (!model.isWalkableStatic(pos.x, pos.y, state.flags)) {
            report.error(label, `npc ${id} walks onto a blocked tile (${pos.x},${pos.y})`);
          }
        }
      },
      emote: async (kind) => checkEmote(kind, `npc ${id}`),
      hide: () => (log.hidden.add(id), log.shown.delete(id)),
      show: () => (log.shown.add(id), log.hidden.delete(id)),
      get x() {
        return pos.x;
      },
      get y() {
        return pos.y;
      },
    };
    npcHandles.set(id, handle);
    return handle;
  }

  const start = player ?? model.spawn;
  const playerPos = { x: start.x, y: start.y, facing: start.facing ?? 'down' };
  const playerHandle = {
    face(dir) {
      checkDir(dir, 'player.face');
      if (DIR_NAMES.includes(dir)) playerPos.facing = dir;
    },
    async walk(dirs) {
      const list = checkDirs(dirs, 'player.walk');
      log.playerWalks.push(list);
      for (const dir of list) {
        const step = model.canStep(playerPos.x, playerPos.y, dir, state.flags);
        if (!step.ok) {
          report.error(label, `player.walk ${dir} from (${playerPos.x},${playerPos.y}) is blocked (${step.reason})`);
          break;
        }
        playerPos.x = step.x;
        playerPos.y = step.y;
        playerPos.facing = dir;
      }
    },
    emote: async (kind) => checkEmote(kind, 'player'),
    get x() {
      return playerPos.x;
    },
    get y() {
      return playerPos.y;
    },
    get facing() {
      return playerPos.facing;
    },
  };
  const followerHandle = { emote: async (kind) => checkEmote(kind, 'follower'), hop: () => {} };

  const api = {
    async say(pages, opts = {}) {
      checkPages(report, label, pages);
      if (opts?.speaker != null && typeof opts.speaker !== 'string') report.error(label, 'say(): speaker must be a string');
      log.says.push({ speaker: opts?.speaker, pages: toPages(pages) ?? [] });
    },
    async choose(prompt, options) {
      checkPages(report, label, prompt);
      if (!Array.isArray(options) || options.length < 2 || !options.every((o) => typeof o === 'string' && o)) {
        report.error(label, 'choose(): options must be an array of at least two strings');
        return -1;
      }
      const answer = answers.choose(prompt, options, chooseIndex++);
      log.prompts.push({ kind: 'choose', prompt, options, answer });
      return answer;
    },
    async confirm(prompt) {
      checkPages(report, label, prompt);
      const answer = !!answers.confirm(prompt, confirmIndex++);
      log.prompts.push({ kind: 'confirm', prompt, answer });
      return answer;
    },
    async wait(ms) {
      if (typeof ms !== 'number' || !(ms >= 0)) report.error(label, `wait(): bad duration ${JSON.stringify(ms)}`);
    },
    flag(name) {
      if (typeof name !== 'string' || !name) report.error(label, `flag(): bad name ${JSON.stringify(name)}`);
      return !!state.flags[name];
    },
    setFlag(name, value = true) {
      if (typeof name !== 'string' || !name || name.startsWith('!')) {
        report.error(label, `setFlag(): bad name ${JSON.stringify(name)}`);
        return;
      }
      if (value) state.flags[name] = true;
      else delete state.flags[name];
      log.flagsSet.push(name);
    },
    hasPartner: () => state.party.length > 0,
    partner: () => (state.party[0] ? { ...state.party[0] } : null),
    givePartner(id) {
      if (!checkSpecies(id, 'givePartner')) return;
      if (state.party.length > 0) report.error(label, `givePartner(${id}) while the player already has a partner`);
      state.party.push({ species: id, name: WILDLINGS[id].name });
      log.given.push(id);
      log.seen.push(id);
    },
    markSeen(id) {
      if (checkSpecies(id, 'markSeen')) log.seen.push(id);
    },
    npc: (id) => npcHandle(id),
    player: playerHandle,
    get follower() {
      return state.party.length > 0 ? followerHandle : null;
    },
    sfx(id) {
      if (!SFX_IDS.includes(id)) report.warn(label, `sfx(): unknown sound ${JSON.stringify(id)}`);
      log.sfx.push(id);
    },
    music(id) {
      if (!MUSIC_IDS.includes(id)) report.warn(label, `music(): unknown track ${JSON.stringify(id)}`);
      log.music.push(id);
    },
    cry(id) {
      if (checkSpecies(id, 'cry')) log.cries.push(id);
    },
    banner(text) {
      if (typeof text !== 'string' || !text) report.error(label, 'banner(): text must be a non-empty string');
      log.banners.push(text);
    },
    async card(card) {
      if (!card || typeof card.title !== 'string' || typeof card.body !== 'string' || !card.title || !card.body) {
        report.error(label, 'card(): needs string title and body');
      }
      if (card?.cta != null && typeof card.cta !== 'string') report.error(label, 'card(): cta must be a string');
      log.cards.push(card);
    },
    async warp(target, x, y, facing) {
      const tdef = maps[target];
      if (!tdef) {
        report.error(label, `warp(): unknown map ${JSON.stringify(target)}`);
        return;
      }
      const tm = createMapModel(tdef);
      if (!tm.isWalkableStatic(x, y, state.flags)) report.error(label, `warp(): (${x},${y}) on ${target} is not walkable`);
      if (facing != null) checkDir(facing, 'warp');
      log.warps.push({ to: target, x, y, facing });
    },
    save: () => {},
  };

  return { api, log, state, report, model, player: playerPos };
}

/**
 * Run one script with a timeout; throws/timeouts are recorded as errors.
 * @param {ReturnType<typeof createScriptHarness>} harness
 * @param {string} scriptId
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>} true when the script completed
 */
export async function runScript(harness, scriptId, timeoutMs = 2000) {
  const fn = harness.model.scripts[scriptId];
  const where = `${harness.model.id}:${scriptId}`;
  if (typeof fn !== 'function') {
    harness.report.error(where, 'script is not a function');
    return false;
  }
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => fn(harness.api)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
        timer.unref?.();
      }),
    ]);
    return true;
  } catch (err) {
    harness.report.error(where, `script threw: ${err?.stack?.split('\n').slice(0, 2).join(' ') ?? err}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Where the player stands when a script starts: on the trigger tile for trigger scripts,
 * otherwise at the spawn.
 * @param {any} model @param {string} scriptId
 */
function playerTileFor(model, scriptId) {
  const trig = model.triggers.find((t) => t.script === scriptId);
  if (trig) return { x: trig.x, y: trig.y, facing: 'up' };
  return model.spawn;
}

/**
 * Every script reachable from the map data, in play order: onEnter, triggers, NPCs, objects.
 * @param {any} model @param {Record<string, boolean>} flags active-filter flags, or null for all
 */
function scriptQueue(model, flags) {
  const out = [];
  const add = (id) => id && !out.includes(id) && out.push(id);
  const active = (e) => flags == null || isActive(e, flags);
  add(model.def.onEnter);
  model.triggers.filter(active).forEach((t) => add(t.script));
  model.npcs.filter(active).forEach((n) => add(n.script));
  model.objects.filter(active).forEach((o) => add(o.script));
  return out;
}

/**
 * Execute every script with a mock API: isolated runs (new-game flags and end-game flags,
 * yes/no answers) and one full playthrough per partner choice.
 * @param {Record<string, any>} maps
 * @param {{ playthroughs?: number, rounds?: number }} [opts]
 */
export async function dryRunScripts(maps, { playthroughs = 3, rounds = 3 } = {}) {
  const report = createReport();
  const flagsSet = new Set();
  /** @type {{label:string, flags:Record<string, boolean>, party:{species:string,name:string}[]}[]} */
  const finals = [];
  let runs = 0;
  const ids = Object.keys(maps).filter((id) => {
    try {
      createMapModel(maps[id]);
      return true;
    } catch {
      return false; // structural errors are reported by validateMaps
    }
  });
  const order = [START_MAP, ...ids.filter((id) => id !== START_MAP)].filter((id) => ids.includes(id));

  const absorb = (h) => {
    h.report.errors.forEach((e) => report.errors.includes(e) || report.errors.push(e));
    h.report.warnings.forEach((w) => report.warnings.includes(w) || report.warnings.push(w));
    h.log.flagsSet.forEach((f) => flagsSet.add(f));
  };

  // 1) Full playthroughs. Variant v declines the first v partner offers, so each starter is chosen once.
  for (let v = 0; v < playthroughs; v++) {
    let flags = {};
    let party = [];
    const answers = { confirm: (_p, i) => i >= v, choose: () => 0 };
    let confirms = 0;
    for (let round = 0; round < rounds; round++) {
      for (const mapId of order) {
        const model = createMapModel(maps[mapId]);
        for (const sid of scriptQueue(model, flags)) {
          const h = createScriptHarness({
            maps,
            mapId,
            flags,
            party,
            player: playerTileFor(model, sid),
            answers: { confirm: (p) => answers.confirm(p, confirms++), choose: answers.choose },
            where: `${mapId}:${sid} (playthrough ${v + 1})`,
          });
          await runScript(h, sid);
          runs++;
          absorb(h);
          flags = h.state.flags;
          party = h.state.party;
        }
      }
    }
    finals.push({ label: `playthrough ${v + 1}`, flags: { ...flags }, party: party.map((p) => ({ ...p })) });
  }

  // 2) Isolated runs of every script, including ones the playthroughs never reach.
  const endFlags = Object.assign({}, ...finals.map((f) => f.flags));
  const scenarios = [
    { name: 'new game', flags: {}, party: [] },
    { name: 'end game', flags: endFlags, party: finals[0]?.party ?? [] },
  ];
  for (const mapId of order) {
    const model = createMapModel(maps[mapId]);
    for (const sid of Object.keys(model.scripts)) {
      for (const sc of scenarios) {
        for (const [aname, answers] of [
          ['yes', ANSWER_YES],
          ['no', ANSWER_NO],
        ]) {
          const h = createScriptHarness({
            maps,
            mapId,
            flags: sc.flags,
            party: sc.party,
            player: playerTileFor(model, sid),
            answers,
            where: `${mapId}:${sid} (${sc.name}, ${aname})`,
          });
          await runScript(h, sid);
          runs++;
          absorb(h);
        }
      }
    }
  }

  return { errors: report.errors, warnings: report.warnings, flagsSet, finals, runs };
}

/* ------------------------------------------------------------- map checks */

/**
 * Structural checks that must pass before a MapModel can be trusted.
 * @returns {boolean} whether the tile grid is usable
 */
function checkStructure(report, id, def) {
  const where = id;
  if (!def || typeof def !== 'object') {
    report.error(where, 'map definition is not an object');
    return false;
  }
  if (def.id !== id) report.error(where, `def.id is ${JSON.stringify(def.id)}, expected "${id}" (registry key)`);
  if (typeof def.name !== 'string' || !def.name) report.warn(where, 'missing display name');
  if (!KINDS.includes(def.kind)) report.error(where, `kind must be one of ${KINDS.join('/')}`);
  if (def.music != null && !MUSIC_IDS.includes(def.music)) report.warn(where, `unknown music "${def.music}"`);
  if (def.musicNight != null && !MUSIC_IDS.includes(def.musicNight)) report.warn(where, `unknown musicNight "${def.musicNight}"`);

  const rows = def.tiles;
  if (!Array.isArray(rows) || rows.length === 0 || !rows.every((r) => typeof r === 'string')) {
    report.error(where, 'tiles must be a non-empty array of strings');
    return false;
  }
  const width = rows[0].length;
  let ok = width > 0;
  rows.forEach((r, y) => {
    if (r.length !== width) {
      report.error(where, `tiles row ${y} has ${r.length} columns, expected ${width} (not rectangular)`);
      ok = false;
    }
    [...r].forEach((c, x) => {
      if (!(c in TILE_TYPES)) report.error(where, `unknown tile char ${JSON.stringify(c)} at (${x},${y})`);
    });
  });
  if (def.heights != null) {
    const hs = def.heights;
    if (!Array.isArray(hs) || hs.length !== rows.length) {
      report.error(where, `heights must have ${rows.length} rows like tiles`);
    } else {
      hs.forEach((r, y) => {
        if (typeof r !== 'string' || r.length !== width) {
          report.error(where, `heights row ${y} must be a string of ${width} digits`);
        } else if (!/^[0-9]*$/.test(r)) {
          report.error(where, `heights row ${y} contains non-digits: ${JSON.stringify(r)}`);
        }
      });
    }
  }
  for (const field of ['objects', 'npcs', 'warps', 'triggers']) {
    if (def[field] != null && !Array.isArray(def[field])) report.error(where, `${field} must be an array`);
  }
  if (def.scripts != null && typeof def.scripts !== 'object') report.error(where, 'scripts must be an object');
  return ok;
}

/** Tiles covered by an object footprint. */
function footprint(o) {
  const out = [];
  for (let dy = 0; dy < o.h; dy++) for (let dx = 0; dx < o.w; dx++) out.push({ x: o.x + dx, y: o.y + dy });
  return out;
}

/**
 * Breadth-first reachability using MapModel.canStep. NPC tiles block; warp and trigger
 * tiles are reached but not expanded (stepping on them hands control to a warp/script).
 * @returns {{reached:Set<string>, terminal:Set<string>, edges:Map<string, string[]>}}
 */
export function reachable(model, start, flags) {
  const blocked = new Set(model.npcs.filter((n) => isActive(n, flags)).map((n) => key(n.x, n.y)));
  const terminal = new Set([
    ...model.warps.filter((w) => isActive(w, flags)).map((w) => key(w.x, w.y)),
    ...model.triggers.filter((t) => isActive(t, flags)).map((t) => key(t.x, t.y)),
  ]);
  const reached = new Set();
  /** @type {Map<string, string[]>} forward edges between reached tiles */
  const edges = new Map();
  if (!model.inBounds(start.x, start.y)) return { reached, terminal, edges };
  const queue = [[start.x, start.y]];
  reached.add(key(start.x, start.y));
  while (queue.length) {
    const [x, y] = queue.shift();
    const k = key(x, y);
    if (terminal.has(k) && !(x === start.x && y === start.y)) continue;
    for (const dir of DIR_NAMES) {
      const step = model.canStep(x, y, dir, flags);
      if (!step.ok) continue;
      const nk = key(step.x, step.y);
      if (blocked.has(nk)) continue;
      if (!edges.has(k)) edges.set(k, []);
      edges.get(k).push(nk);
      if (!reached.has(nk)) {
        reached.add(nk);
        queue.push([step.x, step.y]);
      }
    }
  }
  return { reached, terminal, edges };
}

/** Tiles from which `goal` can be reached, following only recorded forward edges. */
function canReturn(edges, goal) {
  const rev = new Map();
  for (const [from, list] of edges) {
    for (const to of list) {
      if (!rev.has(to)) rev.set(to, []);
      rev.get(to).push(from);
    }
  }
  const ok = new Set([goal]);
  const queue = [goal];
  while (queue.length) {
    const k = queue.shift();
    for (const from of rev.get(k) ?? []) {
      if (!ok.has(from)) {
        ok.add(from);
        queue.push(from);
      }
    }
  }
  return ok;
}

/**
 * Validate every map. Pure: needs the set of flags scripts can set and the flag scenarios
 * (new game first) to test reachability under.
 * @param {Record<string, any>} maps
 * @param {{ setFlags: Set<string>, scenarios: {name:string, flags:Record<string, boolean>}[], report?: ReturnType<typeof createReport> }} ctx
 */
export function validateMaps(maps, { setFlags, scenarios, report = createReport() }) {
  /** @type {Record<string, any>} */
  const models = {};
  for (const [id, def] of Object.entries(maps)) {
    if (!checkStructure(report, id, def)) continue;
    try {
      models[id] = createMapModel(def);
    } catch (err) {
      report.error(id, `createMapModel failed: ${err?.message ?? err}`);
    }
  }
  for (const [id, model] of Object.entries(models)) checkMap(report, id, model, { maps, models, setFlags, scenarios });
  return report;
}

/** All checks for one structurally valid map. */
function checkMap(report, id, model, { maps, models, setFlags, scenarios }) {
  const def = model.def;
  const scripts = def.scripts ?? {};
  const flagOf = (where, list) => {
    for (const expr of asList(list)) {
      if (typeof expr !== 'string' || !expr || expr === '!') {
        report.error(where, `bad flag expression ${JSON.stringify(expr)}`);
        continue;
      }
      if (!setFlags.has(flagName(expr))) report.error(where, `flag "${flagName(expr)}" is never set by any script`);
    }
  };
  const scriptRef = (where, sid) => {
    if (sid == null) return;
    if (typeof scripts[sid] !== 'function') report.error(where, `script "${sid}" does not exist`);
  };
  const facingOk = (where, f) => {
    if (f != null && !DIR_NAMES.includes(f)) report.error(where, `invalid facing ${JSON.stringify(f)}`);
  };
  const walkable = (x, y, flags = {}) => model.isWalkableStatic(x, y, flags);

  // --- scripts table ---
  for (const [sid, fn] of Object.entries(scripts)) {
    if (typeof fn !== 'function') report.error(`${id}:${sid}`, 'script is not a function');
  }
  scriptRef(`${id} onEnter`, def.onEnter);

  // --- spawn ---
  if (!def.spawn) report.warn(id, 'no spawn (defaults to the map centre)');
  else {
    const { x, y, facing } = def.spawn;
    if (!model.inBounds(x, y)) report.error(`${id} spawn`, `(${x},${y}) is out of bounds`);
    else if (!walkable(x, y)) report.error(`${id} spawn`, `(${x},${y}) is not walkable`);
    facingOk(`${id} spawn`, facing);
  }

  // --- objects ---
  const objIds = new Set();
  for (const o of model.objects) {
    const where = `${id} object ${o.id}`;
    if (objIds.has(o.id)) report.warn(where, 'duplicate object id');
    objIds.add(o.id);
    if (!(o.type in OBJECT_DEFAULTS)) report.warn(where, `unknown type "${o.type}" (renders as a placeholder)`);
    if (!isInt(o.x) || !isInt(o.y)) {
      report.error(where, 'x and y must be integers');
      continue;
    }
    for (const t of footprint(o)) {
      if (!model.inBounds(t.x, t.y)) {
        report.error(where, `footprint tile (${t.x},${t.y}) is out of bounds`);
        break;
      }
    }
    if (o.text != null) checkPages(report, where, o.text);
    scriptRef(where, o.script);
    flagOf(where, o.showIf);
    flagOf(where, o.hideIf);
    flagOf(where, o.emptyIf);
    facingOk(where, o.facing);
    if ((o.type === 'pedestal' || o.type === 'statue') && o.species != null && !WILDLINGS[o.species]) {
      report.error(where, `unknown species "${o.species}"`);
    }
    if (o.type === 'pedestal' && o.species == null) report.warn(where, 'pedestal without species');
    if (o.type === 'lilypad' && !model.typeAt(o.x, o.y).water) report.warn(where, 'lilypad is not on water');
    if (o.type === 'waterwheel' && !footprint(o).every((t) => model.typeAt(t.x, t.y).water)) {
      report.warn(where, 'waterwheel should sit on water');
    }
    if (o.type === 'building') {
      if (!BUILDING_VARIANTS.includes(o.variant)) report.warn(where, `unknown building variant "${o.variant}"`);
      if (o.door) {
        const { x: dx, y: dy } = o.door;
        if (dy !== o.y + o.h - 1 || dx < o.x || dx >= o.x + o.w) {
          report.error(where, `door (${dx},${dy}) is not on the footprint's bottom row`);
        }
        if (model.charAt(dx, dy) !== 'D') report.error(where, `door tile (${dx},${dy}) is "${model.charAt(dx, dy)}", expected "D"`);
        if (!model.warps.some((w) => w.x === dx && w.y === dy)) report.error(where, `no warp on door tile (${dx},${dy})`);
      }
    }
  }
  // 'D' tiles must be building doors; 'E' tiles must carry a warp.
  for (let y = 0; y < model.height; y++) {
    for (let x = 0; x < model.width; x++) {
      const c = model.charAt(x, y);
      if (c === 'D' && !model.doorBuildingAt(x, y)) report.warn(`${id} (${x},${y})`, "'D' tile without a building door");
      if (c === 'E' && !model.warps.some((w) => w.x === x && w.y === y)) report.error(`${id} (${x},${y})`, "exit mat 'E' without a warp");
    }
  }

  // --- overlaps & covered special tiles, per scenario ---
  for (const sc of scenarios) {
    const solid = model.objects.filter((o) => o.solid && isActive(o, sc.flags) && isInt(o.x) && isInt(o.y));
    /** @type {Map<string, any>} */
    const owner = new Map();
    for (const o of solid) {
      for (const t of footprint(o)) {
        const k = key(t.x, t.y);
        if (owner.has(k) && owner.get(k) !== o) {
          report.error(`${id} object ${o.id}`, `solid footprint overlaps "${owner.get(k).id}" at (${t.x},${t.y})`);
        }
        owner.set(k, o);
      }
    }
    const coveredBy = (x, y) => {
      const o = owner.get(key(x, y));
      if (!o) return null;
      if (o.type === 'building' && o.door && o.door.x === x && o.door.y === y) return null;
      return o;
    };
    for (const w of model.warps.filter((w) => isActive(w, sc.flags))) {
      const o = coveredBy(w.x, w.y);
      if (o) report.error(`${id} warp (${w.x},${w.y})`, `covered by solid object "${o.id}"`);
    }
    for (const t of model.triggers.filter((t) => isActive(t, sc.flags))) {
      const o = coveredBy(t.x, t.y);
      if (o) report.error(`${id} trigger (${t.x},${t.y})`, `covered by solid object "${o.id}" (${sc.name})`);
    }
    if (def.spawn) {
      const o = coveredBy(def.spawn.x, def.spawn.y);
      if (o) report.error(`${id} spawn`, `covered by solid object "${o.id}" (${sc.name})`);
    }
  }

  // --- warps ---
  for (const w of model.warps) {
    const where = `${id} warp (${w.x},${w.y})`;
    if (!model.inBounds(w.x, w.y)) {
      report.error(where, 'out of bounds');
      continue;
    }
    if (!model.typeAt(w.x, w.y).walkable) report.error(where, 'warp sits on a non-walkable tile');
    facingOk(where, w.facing);
    flagOf(where, w.showIf);
    flagOf(where, w.hideIf);
    const target = models[w.to];
    if (!maps[w.to]) {
      report.error(where, `target map "${w.to}" does not exist`);
      continue;
    }
    if (!target) continue; // structurally broken target, already reported
    if (!target.inBounds(w.tx, w.ty)) {
      report.error(where, `lands out of bounds on ${w.to} at (${w.tx},${w.ty})`);
      continue;
    }
    if (!target.isWalkableStatic(w.tx, w.ty, {})) report.error(where, `lands on a non-walkable tile of ${w.to} (${w.tx},${w.ty})`);
    if (target.warps.some((o) => o.x === w.tx && o.y === w.ty)) report.error(where, `lands on another warp on ${w.to} (${w.tx},${w.ty})`);

    // Door ↔ exit-mat reciprocity.
    const here = model.charAt(w.x, w.y);
    if (here === 'D') {
      const back = target.warps.find((o) => o.to === id && target.charAt(o.x, o.y) === 'E' && o.x === w.tx && o.y === w.ty + 1);
      if (!back) report.error(where, `door warp needs an exit mat on ${w.to} at (${w.tx},${w.ty + 1}) leading back here`);
      else if (back.tx !== w.x || back.ty !== w.y + 1) {
        report.error(where, `exit on ${w.to} should land at (${w.x},${w.y + 1}), directly south of this door`);
      }
      if (target.kind === 'indoor' && w.facing !== 'up') report.warn(where, "warps into an interior should face 'up'");
    } else if (here === 'E') {
      const door = target.warps.find((o) => o.to === id && target.charAt(o.x, o.y) === 'D' && o.x === w.tx && o.y === w.ty - 1);
      if (!door) report.error(where, `exit mat must land directly south of a door on ${w.to} that leads back here`);
      else if (door.tx !== w.x || door.ty !== w.y - 1) {
        report.error(where, `door on ${w.to} should land at (${w.x},${w.y - 1}), directly above this exit mat`);
      }
      if (w.facing !== 'down') report.warn(where, "exits should face 'down'");
    }
  }

  // --- npcs ---
  const npcIds = new Set();
  for (const n of model.npcs) {
    const where = `${id} npc ${n.id}`;
    if (npcIds.has(n.id)) report.error(where, 'duplicate npc id');
    npcIds.add(n.id);
    if (typeof n.name !== 'string' || !n.name) report.warn(where, 'missing name (dialog speaker label)');
    if (!isInt(n.x) || !isInt(n.y) || !model.inBounds(n.x, n.y)) {
      report.error(where, 'position out of bounds');
      continue;
    }
    facingOk(where, n.facing);
    if (!BEHAVIORS.includes(n.behavior)) report.error(where, `unknown behavior "${n.behavior}"`);
    if (n.behavior === 'wander' && !(isInt(n.radius) && n.radius > 0)) report.warn(where, 'wander needs a positive integer radius');
    if (n.noTurn != null && typeof n.noTurn !== 'boolean') report.warn(where, 'noTurn should be a boolean');
    if (n.text == null && n.script == null) report.warn(where, 'has neither text nor script');
    if (n.text != null) checkPages(report, where, n.text);
    scriptRef(where, n.script);
    flagOf(where, n.showIf);
    flagOf(where, n.hideIf);
    checkLook(report, where, n.look);
    if (model.warps.some((w) => w.x === n.x && w.y === n.y)) report.error(where, 'stands on a warp tile');
    if (n.behavior === 'wander') {
      const r = isInt(n.radius) ? n.radius : 2;
      for (const w of model.warps) {
        if (Math.abs(w.x - n.x) <= r && Math.abs(w.y - n.y) <= r) report.warn(where, `may wander onto warp (${w.x},${w.y})`);
      }
      for (const t of model.triggers) {
        if (Math.abs(t.x - n.x) <= r && Math.abs(t.y - n.y) <= r) report.warn(where, `may wander onto trigger (${t.x},${t.y})`);
      }
    }
  }
  for (const sc of scenarios) {
    const occupied = new Map();
    for (const n of model.npcs.filter((n) => isActive(n, sc.flags) && model.inBounds(n.x, n.y))) {
      const where = `${id} npc ${n.id}`;
      if (!walkable(n.x, n.y, sc.flags)) report.error(where, `stands on a blocked tile (${n.x},${n.y}) (${sc.name})`);
      if (model.triggerAt(n.x, n.y, sc.flags)) report.warn(where, `stands on an active trigger (${sc.name})`);
      const k = key(n.x, n.y);
      if (occupied.has(k)) report.error(where, `shares tile (${n.x},${n.y}) with "${occupied.get(k)}" (${sc.name})`);
      occupied.set(k, n.id);
    }
  }

  // --- triggers ---
  for (const t of model.triggers) {
    const where = `${id} trigger (${t.x},${t.y})`;
    if (!model.inBounds(t.x, t.y)) {
      report.error(where, 'out of bounds');
      continue;
    }
    if (!model.typeAt(t.x, t.y).walkable) report.error(where, 'sits on a non-walkable tile');
    if (t.script == null) report.error(where, 'has no script');
    scriptRef(where, t.script);
    flagOf(where, t.showIf);
    flagOf(where, t.hideIf);
  }

  // --- stairs & ledges ---
  for (let y = 0; y < model.height; y++) {
    for (let x = 0; x < model.width; x++) {
      const type = model.typeAt(x, y);
      if (type.stairs) {
        const L = model.levelAt(x, y);
        const up = DIR_NAMES.filter((d) => {
          const nx = x + DIRS[d].dx;
          const ny = y + DIRS[d].dy;
          return model.inBounds(nx, ny) && model.levelAt(nx, ny) === L + 1 && model.typeAt(nx, ny).walkable;
        });
        const same = DIR_NAMES.filter((d) => {
          const nx = x + DIRS[d].dx;
          const ny = y + DIRS[d].dy;
          return model.inBounds(nx, ny) && model.levelAt(nx, ny) === L && model.typeAt(nx, ny).walkable;
        });
        if (up.length === 0) report.error(`${id} stairs (${x},${y})`, `no walkable neighbour at level ${L + 1}`);
        if (up.length > 1) report.warn(`${id} stairs (${x},${y})`, `several upper neighbours (${up.join(', ')}); direction is ambiguous`);
        if (same.length === 0) report.warn(`${id} stairs (${x},${y})`, `no walkable neighbour at level ${L} to climb from`);
      }
      if (type.ledge) {
        const d = DIRS[type.ledge];
        if (!walkable(x + d.dx, y + d.dy)) report.warn(`${id} ledge (${x},${y})`, 'landing tile is not walkable');
        if (!walkable(x - d.dx, y - d.dy)) report.warn(`${id} ledge (${x},${y})`, 'take-off tile is not walkable');
      }
    }
  }

  checkReachability(report, id, model, { maps, models, scenarios });
}

/** Look vocabulary checks. */
function checkLook(report, where, look) {
  if (!look || typeof look !== 'object') {
    report.warn(where, 'missing look (renders with defaults)');
    return;
  }
  for (const [field, allowed] of Object.entries(LOOK_VOCAB)) {
    const v = look[field] ?? null;
    if (!allowed.includes(v)) report.warn(where, `look.${field} "${v}" is not in the vocabulary`);
  }
  for (const c of ['skin', 'hair', 'shirt', 'pants', 'shoes', 'hat', 'outfitColor', 'accessoryColor']) {
    if (look[c] != null && !/^#[0-9a-fA-F]{6}$/.test(look[c])) report.warn(where, `look.${c} should be a #rrggbb colour`);
  }
}

/** Reachability, soft-lock and gated-exit checks for every scenario. */
function checkReachability(report, id, model, { maps, models, scenarios }) {
  const def = model.def;
  if (!def.spawn || !model.inBounds(def.spawn.x, def.spawn.y)) return;
  const spawn = def.spawn;

  for (const sc of scenarios) {
    const tag = `(${sc.name})`;
    const { reached, terminal, edges } = reachable(model, spawn, sc.flags);
    const has = (x, y) => reached.has(key(x, y));

    // Arrivals from other maps must connect to the spawn area.
    for (const [otherId, other] of Object.entries(models)) {
      for (const w of other.warps.filter((w) => w.to === id && isActive(w, sc.flags))) {
        if (!has(w.tx, w.ty)) report.error(`${id} arrival (${w.tx},${w.ty})`, `from ${otherId} is not connected to the spawn ${tag}`);
      }
    }
    // Doors and warps.
    for (const o of model.objects.filter((o) => o.type === 'building' && o.door && isActive(o, sc.flags))) {
      if (!has(o.door.x, o.door.y)) report.error(`${id} object ${o.id}`, `door (${o.door.x},${o.door.y}) is unreachable ${tag}`);
    }
    for (const w of model.warps.filter((w) => isActive(w, sc.flags))) {
      if (!has(w.x, w.y)) report.error(`${id} warp (${w.x},${w.y})`, `is unreachable ${tag}`);
    }
    // NPCs: an adjacent tile on the same level, or across a counter.
    for (const n of model.npcs.filter((n) => isActive(n, sc.flags) && model.inBounds(n.x, n.y))) {
      const ok = DIR_NAMES.some((d) => {
        const ax = n.x + DIRS[d].dx;
        const ay = n.y + DIRS[d].dy;
        if (has(ax, ay) && model.levelAt(ax, ay) === model.levelAt(n.x, n.y)) return true;
        const counter = model.objectsAt(ax, ay).some((o) => o.type === 'counter' && isActive(o, sc.flags));
        const bx = ax + DIRS[d].dx;
        const by = ay + DIRS[d].dy;
        return counter && has(bx, by);
      });
      if (!ok) report.error(`${id} npc ${n.id}`, `cannot be talked to: no reachable neighbouring tile ${tag}`);
    }
    // Interactable objects.
    for (const o of model.objects.filter((o) => (o.text != null || o.script != null) && isActive(o, sc.flags))) {
      if (!isInt(o.x) || !isInt(o.y)) continue;
      const tiles = footprint(o);
      const inside = new Set(tiles.map((t) => key(t.x, t.y)));
      const ok = tiles.some((t) =>
        DIR_NAMES.some((d) => {
          const ax = t.x + DIRS[d].dx;
          const ay = t.y + DIRS[d].dy;
          return !inside.has(key(ax, ay)) && has(ax, ay) && model.levelAt(ax, ay) === model.levelAt(t.x, t.y);
        }),
      );
      if (!ok) {
        const msg = `cannot be interacted with: no reachable neighbouring tile ${tag}`;
        if (o.script != null) report.error(`${id} object ${o.id}`, msg);
        else report.warn(`${id} object ${o.id}`, msg);
      }
    }
    // Triggers (a trigger nobody can reach is suspicious, not fatal).
    for (const t of model.triggers.filter((t) => isActive(t, sc.flags))) {
      if (!has(t.x, t.y)) report.warn(`${id} trigger (${t.x},${t.y})`, `is unreachable ${tag}`);
    }

    // Soft-locks: every reached, non-terminal tile must be able to walk back to the spawn.
    const back = canReturn(edges, key(spawn.x, spawn.y));
    const stuck = [...reached].filter((k) => !terminal.has(k) && !back.has(k));
    if (stuck.length) report.error(id, `player can get stuck (no way back) at ${stuck.slice(0, 6).join(' ')} ${tag}`);

    // Outdoor edge exits are gated on having a partner.
    if (model.kind === 'outdoor') {
      const exits = [];
      for (let x = 0; x < model.width; x++) exits.push([x, 0], [x, model.height - 1]);
      for (let y = 1; y < model.height - 1; y++) exits.push([0, y], [model.width - 1, y]);
      const open = exits.filter(([x, y]) => model.isWalkableStatic(x, y, sc.flags));
      const reachedExits = open.filter(([x, y]) => has(x, y));
      if (!sc.flags.has_partner && reachedExits.length) {
        report.error(id, `edge exit ${reachedExits.map(([x, y]) => `(${x},${y})`).join(' ')} is reachable before the partner ${tag}`);
      }
      if (sc.flags.has_partner && open.length && !reachedExits.length) {
        report.error(id, `no edge exit is reachable with a partner ${tag}`);
      }
    }
  }
}

/* ---------------------------------------------------------------- top level */

/**
 * Run everything: script dry-run, then all map checks under the new-game scenario and the
 * end state of every playthrough.
 * @param {{ maps?: Record<string, any>, sources?: string[] }} [opts]
 * @returns {Promise<{errors:string[], warnings:string[], stats:{maps:number, runs:number, flags:string[], scenarios:string[]}, finals:any[]}>}
 */
export async function validateAll({ maps = loadMaps(), sources = readMapSources() } = {}) {
  const report = createReport();
  const dry = await dryRunScripts(maps);
  dry.errors.forEach((e) => report.errors.push(e));
  dry.warnings.forEach((w) => report.warnings.push(w));

  const setFlags = new Set([...staticSetFlags(maps, sources), ...dry.flagsSet]);
  const scenarios = [{ name: 'new game', flags: {} }];
  for (const f of dry.finals) {
    if (!scenarios.some((s) => JSON.stringify(s.flags) === JSON.stringify(f.flags))) {
      scenarios.push({ name: `${f.label}, partner ${f.party[0]?.species ?? 'none'}`, flags: f.flags });
    }
  }
  if (!scenarios.some((s) => s.flags.has_partner)) {
    scenarios.push({ name: 'with partner', flags: { has_partner: true } });
  }
  validateMaps(maps, { setFlags, scenarios, report });
  return {
    errors: report.errors,
    warnings: report.warnings,
    stats: { maps: Object.keys(maps).length, runs: dry.runs, flags: [...setFlags].sort(), scenarios: scenarios.map((s) => s.name) },
    finals: dry.finals,
  };
}

/** CLI entry point. */
async function main() {
  const verbose = process.argv.includes('--verbose');
  const maps = loadMaps();
  const result = await validateAll({ maps });
  console.log(`Validating ${Object.keys(maps).length} maps: ${Object.keys(maps).join(', ')}`);
  if (verbose) {
    for (const [id, def] of Object.entries(maps)) {
      const rows = def.tiles?.length ?? 0;
      const cols = def.tiles?.[0]?.length ?? 0;
      console.log(
        `  ${id.padEnd(12)} ${cols}x${rows}  objects ${def.objects?.length ?? 0}  npcs ${def.npcs?.length ?? 0}  ` +
          `warps ${def.warps?.length ?? 0}  triggers ${def.triggers?.length ?? 0}  scripts ${Object.keys(def.scripts ?? {}).length}`,
      );
    }
    console.log(`  scenarios: ${result.stats.scenarios.join(' | ')}`);
    console.log(`  flags set by scripts: ${result.stats.flags.join(', ')}`);
  }
  console.log(`Script dry-run: ${result.stats.runs} runs`);
  if (result.warnings.length) {
    console.log(`\nWarnings (${result.warnings.length}):`);
    result.warnings.forEach((w) => console.log(`  - ${w}`));
  }
  if (result.errors.length) {
    console.log(`\nErrors (${result.errors.length}):`);
    result.errors.forEach((e) => console.log(`  - ${e}`));
    console.log('\nMap validation FAILED.');
    process.exitCode = 1;
  } else {
    console.log(`\nMap validation passed (${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}).`);
  }
}

const invokedDirectly = (() => {
  try {
    return !!process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
