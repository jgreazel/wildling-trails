/**
 * NPCs: spawning from map defs, visibility (showIf/hideIf + script overrides),
 * idle AI (stand / turn / wander) and the handles scripts use to direct them.
 */
import { DIR_NAMES, DIRS, HOP_MS, WALK_STEP_MS, dirBetween } from '../config.js';
import { isActive } from '../world/map-utils.js';
import { createMover } from './grid-mover.js';
import { buildModel, disposeModel, safeEmote } from './actor-utils.js';

/** NPCs amble a touch slower than the player walks. */
export const NPC_STEP_MS = Math.round(WALK_STEP_MS * 1.25);
/** 'turn' NPCs pick a new facing every 2–5 s. */
const TURN_RANGE = [2000, 5000];
/** 'wander' NPCs consider a step every 1.5–4 s. */
const WANDER_RANGE = [1500, 4000];
/** After a plain chat, 'stand' NPCs turn back to their usual facing. */
const RESTORE_FACING_MS = 1500;

/** @typedef {import('../config.js').Dir} Dir */

/**
 * @typedef {object} NpcActor
 * @property {'npc'} kind
 * @property {string} id
 * @property {any} def
 * @property {string|undefined} name
 * @property {any} model
 * @property {import('./grid-mover.js').Mover} mover
 * @property {boolean} visible
 * @property {boolean|null} forced  script override of flag visibility
 * @property {{x:number, y:number}} home
 * @property {Dir} restFacing
 * @property {number} timer
 * @property {number} restoreMs
 * @property {Dir[]} plan
 * @property {(() => void)|null} planDone
 * @property {boolean} alive
 */

/**
 * @typedef {object} NpcHandle
 * @property {(dir: Dir) => void} face
 * @property {() => void} facePlayer
 * @property {(dirs: Dir[]) => Promise<void>} walk
 * @property {(kind: string) => Promise<void>} emote
 * @property {() => void} hide
 * @property {() => void} show
 * @property {number} x
 * @property {number} y
 */

/**
 * Handle returned for unknown ids: every call is a harmless no-op, and x/y are
 * NaN so position checks (Number.isInteger) fall back instead of using a bogus tile.
 */
const NULL_HANDLE = Object.freeze({
  face() {},
  facePlayer() {},
  walk: () => Promise.resolve(),
  emote: () => Promise.resolve(),
  hide() {},
  show() {},
  x: Number.NaN,
  y: Number.NaN,
});

/**
 * Create the NPC controller.
 * @param {any} ctx  session context (see world-session.js)
 */
export function createNpcController(ctx) {
  /** @type {Map<string, NpcActor>} */
  const npcs = new Map();
  /** @type {Set<string>} */
  const warned = new Set();

  /** @param {[number, number]} range */
  function between([lo, hi]) {
    return lo + ctx.random() * (hi - lo);
  }

  /** @param {NpcActor} npc */
  function applyVisibility(npc) {
    const visible = npc.forced ?? isActive(npc.def, ctx.state.flags);
    if (visible === npc.visible) return;
    if (!visible && npc.mover.moving && !npc.plan.length) npc.mover.finish();
    npc.visible = visible;
    if (npc.model.group) npc.model.group.visible = visible;
  }

  /** @param {NpcActor} npc */
  function startPlanned(npc) {
    const model = ctx.mapModel;
    while (npc.plan.length) {
      const dir = npc.plan.shift();
      const d = DIRS[dir];
      if (!d) continue;
      const m = npc.mover;
      const res = model?.canStep(m.x, m.y, dir, ctx.state.flags);
      if (res?.ok && res.hop) m.begin(res.x, res.y, { dir, durationMs: HOP_MS, hop: true });
      else m.begin(m.x + d.dx, m.y + d.dy, { dir, durationMs: WALK_STEP_MS });
      return true;
    }
    return false;
  }

  /** @param {NpcActor} npc */
  function finishPlan(npc) {
    const done = npc.planDone;
    npc.plan = [];
    npc.planDone = null;
    if (done) {
      // A scripted move relocates the NPC: wander around its new spot from now on.
      npc.home = { x: npc.mover.x, y: npc.mover.y };
      npc.restFacing = npc.mover.facing;
      done();
    }
  }

  /** @param {NpcActor} npc */
  function onArrive(npc) {
    if (ctx.mapModel?.typeAt(npc.mover.x, npc.mover.y).tallGrass) ctx.rustle(npc.mover.x, npc.mover.y);
    if (npc.plan.length || npc.planDone) {
      if (!startPlanned(npc)) finishPlan(npc);
    }
  }

  /**
   * Tiles wandering NPCs must never step onto.
   * @param {number} x @param {number} y
   */
  function isForbidden(x, y) {
    const model = ctx.mapModel;
    if (!model) return true;
    if (model.warps.some((w) => w.x === x && w.y === y)) return true;
    if (model.triggers.some((t) => t.x === x && t.y === y)) return true;
    const type = model.typeAt(x, y);
    if (type.door || type.exit) return true;
    if (model.doorBuildingAt(x, y)) return true;
    // Keep the doorstep clear: that's where the player appears when leaving a building.
    return model.objects.some((o) => o.type === 'building' && o.door && o.door.x === x && o.door.y + 1 === y);
  }

  /** @param {NpcActor} npc */
  function tryWander(npc) {
    const model = ctx.mapModel;
    const m = npc.mover;
    const dir = DIR_NAMES[Math.floor(ctx.random() * DIR_NAMES.length) % DIR_NAMES.length];
    const res = model.canStep(m.x, m.y, dir, ctx.state.flags);
    const radius = Math.max(0, Number(npc.def.radius ?? 2));
    const ok =
      res.ok &&
      !res.hop &&
      Math.abs(res.x - npc.home.x) <= radius &&
      Math.abs(res.y - npc.home.y) <= radius &&
      !isForbidden(res.x, res.y) &&
      !ctx.occupancy.at(res.x, res.y, { except: npc });
    if (ok) m.begin(res.x, res.y, { dir, durationMs: NPC_STEP_MS });
    else m.face(dir); // can't go that way: just look around
  }

  /** @param {NpcActor} npc @param {number} dtMs */
  function think(npc, dtMs) {
    if (npc.restoreMs > 0) {
      npc.restoreMs -= dtMs;
      if (npc.restoreMs <= 0) npc.mover.face(npc.restFacing);
    }
    const behavior = npc.def.behavior;
    if (behavior !== 'turn' && behavior !== 'wander') return;
    npc.timer -= dtMs;
    if (npc.timer > 0) return;
    if (behavior === 'turn') {
      const options = DIR_NAMES.filter((d) => d !== npc.mover.facing);
      npc.mover.face(options[Math.floor(ctx.random() * options.length) % options.length]);
      npc.timer = between(TURN_RANGE);
    } else {
      tryWander(npc);
      npc.timer = between(WANDER_RANGE);
    }
  }

  /** @param {any} def @param {number} index */
  function spawnOne(def, index) {
    const id = String(def.id ?? `npc-${index}`);
    if (npcs.has(id)) {
      ctx.logger.warn(`[world] duplicate NPC id "${id}" on map "${ctx.mapModel?.id}" — skipped`);
      return;
    }
    const model = buildModel(ctx.deps.createHumanoid, def.look ?? {}, ctx.logger, `npc ${id}`);
    ctx.scene?.add?.(model.group);
    const facing = DIRS[def.facing] ? def.facing : 'down';
    /** @type {NpcActor} */
    const npc = {
      kind: 'npc',
      id,
      def,
      name: def.name,
      model,
      mover: /** @type {any} */ (null),
      visible: true,
      forced: null,
      home: { x: def.x, y: def.y },
      restFacing: facing,
      timer: 0,
      restoreMs: 0,
      plan: [],
      planDone: null,
      alive: true,
    };
    npc.mover = createMover({ model, x: def.x, y: def.y, facing, surfaceY: ctx.surfaceY, onArrive: () => onArrive(npc) });
    npc.timer = def.behavior === 'wander' ? between([800, 3500]) : between([1000, 4000]);
    npc.visible = isActive(def, ctx.state.flags);
    model.group.visible = npc.visible;
    npcs.set(id, npc);
    ctx.occupancy.add(npc);
  }

  /** @param {NpcActor} npc @param {Dir[]} dirs */
  function walkScripted(npc, dirs) {
    const list = (Array.isArray(dirs) ? dirs : [dirs]).filter((d) => DIRS[d]);
    if (!npc.alive || !list.length) return Promise.resolve();
    finishPlan(npc);
    npc.restoreMs = 0;
    return new Promise((resolve) => {
      npc.plan = list;
      npc.planDone = resolve;
      if (!npc.mover.moving && !startPlanned(npc)) finishPlan(npc);
    });
  }

  return {
    /** Spawn every NPC of the current map. */
    spawnAll() {
      const model = ctx.mapModel;
      if (!model) return;
      model.npcs.forEach((def, i) => {
        try {
          spawnOne(def, i);
        } catch (err) {
          ctx.logger.error(`[world] NPC "${def?.id}" failed to spawn`, err);
        }
      });
    },

    /** Remove and dispose every NPC; pending scripted walks resolve. */
    despawnAll() {
      for (const npc of npcs.values()) {
        npc.alive = false;
        ctx.occupancy.remove(npc);
        disposeModel(ctx.scene, npc.model, ctx.logger);
        finishPlan(npc);
      }
      npcs.clear();
    },

    /** Re-evaluate showIf/hideIf for every NPC (after a flag change). */
    refreshVisibility() {
      for (const npc of npcs.values()) applyVisibility(npc);
    },

    /**
     * Advance movement, and idle AI when `ai` is true.
     * @param {number} dtMs @param {boolean} ai
     */
    update(dtMs, ai) {
      for (const npc of npcs.values()) {
        const m = npc.mover;
        if (m.moving) {
          m.advance(dtMs);
          continue;
        }
        if (npc.plan.length) {
          if (startPlanned(npc)) m.advance(dtMs);
          continue;
        }
        if (ai && npc.visible) think(npc, dtMs);
      }
    },

    /**
     * Visible NPC standing on (or arriving at) a tile.
     * @param {number} x @param {number} y
     * @returns {NpcActor|null}
     */
    at(x, y) {
      for (const npc of npcs.values()) {
        if (npc.visible && npc.mover.x === x && npc.mover.y === y) return npc;
      }
      return null;
    },

    /** @param {string} id @returns {NpcActor|null} */
    get(id) {
      return npcs.get(id) ?? null;
    },

    /** @returns {NpcActor[]} */
    get list() {
      return [...npcs.values()];
    },

    /**
     * Settle the NPC and (unless noTurn) face the talker.
     * @param {NpcActor} npc @param {Dir} towards
     */
    prepareTalk(npc, towards) {
      if (npc.mover.moving) npc.mover.finish();
      if (!npc.def.noTurn) npc.mover.face(towards);
      npc.restoreMs = 0;
      npc.timer = Math.max(npc.timer, 1200);
    },

    /** @param {NpcActor} npc */
    afterTalk(npc) {
      if (!npc.alive || npc.def.noTurn) return;
      if ((npc.def.behavior ?? 'stand') === 'stand' && npc.mover.facing !== npc.restFacing) {
        npc.restoreMs = RESTORE_FACING_MS;
      }
    },

    /**
     * Script handle for an NPC (a no-op handle for unknown ids).
     * @param {string} id
     * @returns {NpcHandle}
     */
    handle(id) {
      const npc = npcs.get(id);
      if (!npc) {
        const key = `${ctx.mapModel?.id}:${id}`;
        if (!warned.has(key)) {
          warned.add(key);
          ctx.logger.warn(`[world] script asked for unknown NPC "${id}"`);
        }
        return NULL_HANDLE;
      }
      /** @param {Dir} dir */
      const face = (dir) => {
        if (!npc.alive || !DIRS[dir]) return;
        npc.mover.face(dir);
        npc.restFacing = dir;
        npc.restoreMs = 0;
      };
      return {
        face,
        facePlayer() {
          const p = ctx.player.actor?.mover;
          if (!npc.alive || !p) return;
          if (p.x === npc.mover.x && p.y === npc.mover.y) return;
          face(dirBetween(npc.mover.x, npc.mover.y, p.x, p.y));
        },
        walk: (dirs) => walkScripted(npc, dirs),
        emote: (kind) => (npc.alive ? safeEmote(npc.model, kind, 1100, ctx.clock) : Promise.resolve()),
        hide() {
          if (!npc.alive) return;
          npc.forced = false;
          applyVisibility(npc);
        },
        show() {
          if (!npc.alive) return;
          npc.forced = true;
          applyVisibility(npc);
        },
        get x() {
          return npc.mover.x;
        },
        get y() {
          return npc.mover.y;
        },
      };
    },
  };
}
