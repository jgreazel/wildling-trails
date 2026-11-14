/**
 * The a-button in the overworld: talk to whoever / read whatever is in front.
 *
 * The player moves freely, so "in front" is a cone along their facing:
 *   1. the nearest visible NPC within reach and roughly ahead (they turn to
 *      face the player unless noTurn; the player turns to face them)
 *   2. a counter/desk ahead with an NPC on the far side → talk across it
 *   3. an active object with `text` or `script` on a tile ahead (solid first)
 *   4. the follower, if it's right there → a little moment of affection
 */
import { DIRS, dirBetween, yawToDir } from '../config.js';
import { isActive } from '../world/map-utils.js';

/** Object types you can talk across. */
const ACROSS_TYPES = new Set(['counter', 'desk']);

/**
 * Affection lines. `{name}` is the partner's name. Kept short (≤ ~70 chars).
 * @type {Record<string, string[]>}
 */
export const AFFECTION_LINES = Object.freeze({
  any: [
    '{name} nuzzles your hand and makes a happy little chirp.',
    '{name} looks up at you, eyes bright. Ready for anything!',
    '{name} does a proud little twirl.',
    '{name} leans against your leg with a contented sigh.',
    '{name} sniffs your pockets. No snacks? Hmm. Suspicious.',
    '{name} wiggles all over. You two make a good team.',
  ],
  emberkit: [
    "{name}'s tail-tip flares a cosy orange.",
    '{name} curls its warm tail around your ankle.',
  ],
  brookling: [
    "{name}'s gill fronds flush a happy pink.",
    '{name} blows a tiny bubble at you. It pops. Delight!',
  ],
  mossbun: [
    "The fern on {name}'s back perks right up.",
    '{name} thumps a paw. A tiny flower opens nearby.',
  ],
  night: [
    '{name} yawns a big yawn. The stars are out.',
    '{name} gazes up at the night sky, ears twitching.',
  ],
  indoor: [
    '{name} is sniffing every corner with great interest.',
    '{name} found a sunny spot on the floor. Bliss.',
  ],
});

/**
 * Pick an affection line for the context, avoiding an immediate repeat.
 * @param {{ species:string, name:string, indoor:boolean, night:boolean, random:() => number, last?:string|null }} opts
 * @returns {string}
 */
export function pickAffectionLine({ species, name, indoor, night, random, last = null }) {
  const templates = [...AFFECTION_LINES.any, ...(AFFECTION_LINES[species] ?? [])];
  if (indoor) templates.push(...AFFECTION_LINES.indoor);
  else if (night) templates.push(...AFFECTION_LINES.night, ...AFFECTION_LINES.night);
  const pool = templates.map((l) => l.replaceAll('{name}', name));
  const fresh = pool.filter((l) => l !== last);
  const options = fresh.length ? fresh : pool;
  return options[Math.floor(random() * options.length) % options.length];
}

/** How far (tiles, centre to centre) the a-button reaches. */
export const TALK_REACH = 1.45;
/** Half-angle (radians) of the "in front" cone. */
export const TALK_CONE = (60 * Math.PI) / 180;

/**
 * Is a point within reach and inside the cone in front of the player?
 * Returns a score (smaller = better) or null.
 * @param {{px:number, pz:number, yaw:number}} p
 * @param {number} x @param {number} z
 * @param {number} [reach]
 */
export function frontScore(p, x, z, reach = TALK_REACH) {
  const dx = x - p.px;
  const dz = z - p.pz;
  const dist = Math.hypot(dx, dz);
  if (dist > reach || dist < 1e-6) return null;
  const fx = Math.sin(p.yaw);
  const fz = Math.cos(p.yaw);
  const cos = (dx * fx + dz * fz) / dist;
  const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
  if (angle > TALK_CONE) return null;
  return dist + angle * 0.6;
}

/**
 * Create the interaction handler.
 * @param {any} ctx  session context (see world-session.js)
 */
export function createInteraction(ctx) {
  /** @type {string|null} */
  let lastLine = null;

  /** Resolve a script reference on the current map, or null. @param {unknown} id */
  function scriptFor(id) {
    if (typeof id !== 'string') return null;
    const fn = ctx.mapModel?.scripts?.[id];
    if (typeof fn === 'function') return fn;
    ctx.logger.warn(`[world] unknown script "${id}" on map "${ctx.mapModel?.id}"`);
    return null;
  }

  /** @param {any} npc */
  function talk(npc) {
    const p = ctx.player.actor.mover;
    const g = npc.mover.ground;
    ctx.player.faceToward(g.x, g.z);
    ctx.npcs.prepareTalk(npc, dirBetween(npc.mover.x, npc.mover.y, p.px, p.pz));
    const def = npc.def;
    const fn = def.script ? scriptFor(def.script) : null;
    const run = fn
      ? ctx.runScript(fn)
      : ctx.runScript((api) => api.say(def.text ?? '…', { speaker: npc.name }));
    return run.then(() => {
      if (!fn) ctx.npcs.afterTalk(npc);
    });
  }

  /** @param {any} obj */
  function read(obj) {
    const fn = obj.script ? scriptFor(obj.script) : null;
    if (fn) return ctx.runScript(fn);
    if (obj.text) return ctx.runScript((api) => api.say(obj.text));
    return Promise.resolve();
  }

  function affection() {
    const f = ctx.follower.actor;
    const p = ctx.player.actor.mover;
    const member = ctx.state.party?.[0];
    if (!f || !member) return Promise.resolve();
    ctx.player.faceToward(f.mover.px, f.mover.pz);
    const dx = p.px - f.mover.px;
    const dz = p.pz - f.mover.pz;
    if (Math.hypot(dx, dz) > 1e-6) f.mover.setYaw(Math.atan2(dx, dz));
    const line = pickAffectionLine({
      species: member.species,
      name: member.name,
      indoor: ctx.mapModel?.kind === 'indoor',
      night: !!ctx.dayNight?.isNight,
      random: ctx.random,
      last: lastLine,
    });
    lastLine = line;
    return ctx.runScript(async (api) => {
      ctx.follower.bounce();
      ctx.follower.emote('♥', 1000);
      api.cry(member.species);
      await api.wait(180);
      await api.say(line);
    });
  }

  /**
   * Tiles in front of the player, nearest first: the tile the facing ray
   * reaches, then the cardinal neighbour in the facing direction.
   * @param {any} p mover
   */
  function tilesAhead(p) {
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    const out = [];
    const push = (/** @type {number} */ x, /** @type {number} */ y) => {
      if (x === p.x && y === p.y) return;
      if (!out.some((t) => t.x === x && t.y === y)) out.push({ x, y });
    };
    push(Math.round(p.px + fx * 0.75), Math.round(p.pz + fz * 0.75));
    const d = DIRS[yawToDir(p.yaw)];
    push(p.x + d.dx, p.y + d.dy);
    return out;
  }

  return {
    /**
     * Interact with whatever is in front of the player.
     * @returns {boolean} whether something was found
     */
    tryInteract() {
      const actor = ctx.player.actor;
      const model = ctx.mapModel;
      if (!actor || !model || ctx.player.scripted) return false;
      const p = actor.mover;

      // 1. People first: the best-placed visible NPC in the cone.
      let best = null;
      let bestScore = Infinity;
      for (const npc of ctx.npcs.list) {
        if (!npc.visible) continue;
        const g = npc.mover.ground;
        const score = frontScore(p, g.x, g.z);
        if (score !== null && score < bestScore) {
          best = npc;
          bestScore = score;
        }
      }
      if (best) {
        talk(best);
        return true;
      }

      const flags = ctx.state.flags;
      const d = DIRS[yawToDir(p.yaw)];
      for (const tile of tilesAhead(p)) {
        const objects = model.objectsAt(tile.x, tile.y).filter((o) => isActive(o, flags));
        // 2. Across a counter or desk.
        if (objects.some((o) => ACROSS_TYPES.has(o.type))) {
          const far = ctx.npcs.at(tile.x + d.dx, tile.y + d.dy);
          if (far) {
            talk(far);
            return true;
          }
        }
        // 3. Signs, shelves, machines…
        const readable =
          objects.find((o) => o.solid && (o.text || o.script)) ?? objects.find((o) => o.text || o.script);
        if (readable) {
          read(readable);
          return true;
        }
      }

      // 4. Your partner.
      const f = ctx.follower.actor;
      if (f && f.visible && frontScore(p, f.mover.px, f.mover.pz, 1.3) !== null) {
        affection();
        return true;
      }
      return false;
    },

    affection,
  };
}
