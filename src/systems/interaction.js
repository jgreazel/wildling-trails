/**
 * The a-button in the overworld: talk to whoever / read whatever is in front.
 *
 * Priority for the tile in front of the player:
 *   1. a visible NPC (turns to face the player unless noTurn)
 *   2. a counter/desk with an NPC on the far side → talk across it
 *   3. an active object with `text` or `script` (solid ones first)
 *   4. the follower → a little moment of affection
 */
import { DIRS, OPPOSITE } from '../config.js';
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
    ctx.npcs.prepareTalk(npc, OPPOSITE[p.facing]);
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
    f.mover.face(OPPOSITE[p.facing]);
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

  return {
    /**
     * Interact with whatever is in front of the player.
     * @returns {boolean} whether something was found
     */
    tryInteract() {
      const actor = ctx.player.actor;
      const model = ctx.mapModel;
      if (!actor || !model || actor.mover.moving) return false;
      const m = actor.mover;
      const d = DIRS[m.facing];
      const fx = m.x + d.dx;
      const fy = m.y + d.dy;

      const npc = ctx.npcs.at(fx, fy);
      if (npc) {
        talk(npc);
        return true;
      }

      const flags = ctx.state.flags;
      const objects = model.objectsAt(fx, fy).filter((o) => isActive(o, flags));
      if (objects.some((o) => ACROSS_TYPES.has(o.type))) {
        const far = ctx.npcs.at(fx + d.dx, fy + d.dy);
        if (far) {
          talk(far);
          return true;
        }
      }

      const readable =
        objects.find((o) => o.solid && (o.text || o.script)) ?? objects.find((o) => o.text || o.script);
      if (readable) {
        read(readable);
        return true;
      }

      const f = ctx.follower.actor;
      if (f && f.visible && f.mover.x === fx && f.mover.y === fy) {
        affection();
        return true;
      }
      return false;
    },

    affection,
  };
}
