/**
 * Flavour encounters in tall grass. With a partner, a wild Pipwing or Dewsnail
 * occasionally peeks out next to the player, cries, gets noted as seen and
 * wanders off toward Mistfern Path. No battles — just a friendly hello.
 */
import { DIR_NAMES, DIRS, OPPOSITE, dirBetween } from '../config.js';
import { WILDLINGS, WILD_SPECIES } from '../data/wildlings.js';
import { buildModel, disposeModel, safeEmote } from './actor-utils.js';
import { easeOutBack, smoothstep } from './clock.js';

/** Chance per tall-grass step (with a partner). */
export const ENCOUNTER_CHANCE = 1 / 9;
/** Minimum player steps between two encounters. */
export const ENCOUNTER_MIN_GAP = 5;
/** Steps after a map load before encounters may happen (never the first step). */
export const ENCOUNTER_MIN_STEPS_AFTER_LOAD = 2;

/**
 * Departure lines per species (present tense: shown before it leaves).
 * @type {Record<string, string>}
 */
const DEPARTURES = Object.freeze({
  pipwing: 'It puffs its yellow chest and flutters off toward Mistfern Path.',
  dewsnail: 'It blinks slowly, then scampers off toward Mistfern Path. Slowly.',
});

/**
 * Create the encounter system.
 * @param {any} ctx  session context (see world-session.js)
 */
export function createEncounters(ctx) {
  let stepsSinceLoad = 0;
  let stepsSinceEncounter = ENCOUNTER_MIN_GAP;

  /**
   * A free tall-grass tile next to the player, preferring the one in front.
   * @returns {{x:number, y:number}|null}
   */
  function pickTile() {
    const model = ctx.mapModel;
    const p = ctx.player.actor?.mover;
    if (!model || !p) return null;
    const order = [p.facing, ...DIR_NAMES.filter((d) => d !== p.facing && d !== OPPOSITE[p.facing]), OPPOSITE[p.facing]];
    for (const dir of order) {
      const d = DIRS[dir];
      const x = p.x + d.dx;
      const y = p.y + d.dy;
      if (!model.typeAt(x, y).tallGrass) continue;
      if (!model.isWalkableStatic(x, y, ctx.state.flags)) continue;
      if (ctx.occupancy.at(x, y)) continue;
      return { x, y };
    }
    return null;
  }

  /**
   * Play the whole peek-out moment. Runs as a script (busy, errors contained).
   * @param {string} species
   * @param {{x:number, y:number}} tile
   * @returns {Promise<void>}
   */
  function run(species, tile) {
    return ctx.runScript(async (api) => {
      const data = WILDLINGS[species];
      const name = data?.name ?? species;
      const p = ctx.player.actor?.mover;
      const model = buildModel(ctx.deps.createWildlingModel, species, ctx.logger, `wild ${species}`);
      ctx.transients.add(model);
      try {
        const baseY = ctx.surfaceY(tile.x, tile.y);
        const group = model.group;
        group.position.set(tile.x, baseY, tile.y);
        group.scale.setScalar(0.001);
        try {
          model.setFacing?.(p ? dirBetween(tile.x, tile.y, p.x, p.y) : 'down', true);
        } catch {
          /* ignore */
        }
        ctx.scene?.add?.(group);
        ctx.rustle(tile.x, tile.y);
        ctx.audio.sfx('encounter');

        // Pop out of the grass.
        await ctx.clock.tween(300, (t) => {
          group.scale.setScalar(Math.max(0.001, easeOutBack(t)));
          group.position.y = baseY + Math.sin(Math.PI * t) * 0.25;
        });
        group.scale.setScalar(1);
        group.position.y = baseY;
        try {
          model.hop?.();
        } catch {
          /* ignore */
        }

        const f = ctx.follower.actor;
        if (f) {
          f.mover.face(dirBetween(f.mover.x, f.mover.y, tile.x, tile.y));
          ctx.follower.emote('!', 900);
        }
        api.cry(species);
        if (ctx.player.actor) await safeEmote(ctx.player.actor.model, '!', 700, ctx.clock);

        await api.say(`A wild ${name} peeked out of the tall grass!`);
        api.markSeen(species);
        const pages = [DEPARTURES[species] ?? `It wanders off toward Mistfern Path.`];
        if (api.flag('has_journal')) pages.push(`Your Field Journal notes the ${name}. Neat!`);
        await api.say(pages);

        // Off it goes: hop away from the player while shrinking into the grass.
        const away = p ? dirBetween(p.x, p.y, tile.x, tile.y) : 'up';
        const d = DIRS[away];
        try {
          model.setFacing?.(away);
          model.setMoving?.(true, species === 'pipwing');
        } catch {
          /* ignore */
        }
        const hops = species === 'dewsnail' ? 0 : 2;
        const reach = species === 'dewsnail' ? 0.9 : 1.6;
        await ctx.clock.tween(species === 'dewsnail' ? 900 : 620, (t) => {
          group.position.x = tile.x + d.dx * reach * t;
          group.position.z = tile.y + d.dy * reach * t;
          const arc = hops ? Math.abs(Math.sin(Math.PI * hops * t)) * 0.32 : 0;
          group.position.y = baseY + arc;
          group.scale.setScalar(Math.max(0.001, 1 - smoothstep(0.35, 1, t)));
        });
      } finally {
        // A map change may already have disposed it (teardown clears transients).
        if (ctx.transients.delete(model)) disposeModel(ctx.scene, model, ctx.logger);
      }
    });
  }

  return {
    /** Call when a map finished loading. */
    onMapLoad() {
      stepsSinceLoad = 0;
    },

    /** Call on every player arrival (any tile). */
    noteStep() {
      stepsSinceLoad += 1;
      stepsSinceEncounter += 1;
    },

    /**
     * Roll for an encounter after stepping into tall grass.
     * @returns {boolean} whether an encounter started (the session is busy)
     */
    maybeStart() {
      if (!(ctx.state.party?.length > 0)) return false;
      if (stepsSinceLoad < ENCOUNTER_MIN_STEPS_AFTER_LOAD) return false;
      if (stepsSinceEncounter < ENCOUNTER_MIN_GAP) return false;
      if (!(ctx.random() < ENCOUNTER_CHANCE)) return false;
      const tile = pickTile();
      if (!tile) return false;
      const species = WILD_SPECIES[Math.floor(ctx.random() * WILD_SPECIES.length) % WILD_SPECIES.length];
      stepsSinceEncounter = 0;
      run(species, tile);
      return true;
    },

    run,
  };
}
