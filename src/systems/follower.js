/**
 * The partner wildling that trails one tile behind the player.
 *
 * - Species = state.party[0]. Spawns behind the player (opposite of facing) if
 *   that tile is reachable and free, else on any free reachable neighbour, else
 *   stays hidden until the player's first step.
 * - Every player step queues the tile the player just left; the follower walks
 *   (or hops a ledge) into it with the same timing, catching up if it lags.
 * - Never blocks the player, but does block NPCs (it occupies its tile + queue).
 */
import { DIR_NAMES, HOP_MS, OPPOSITE, dirBetween } from '../config.js';
import { createMover } from './grid-mover.js';
import { buildModel, disposeModel, safeEmote } from './actor-utils.js';
import { easeOutBack } from './clock.js';

/** After this long idle next to an idle player, the follower turns to look at them. */
const LOOK_AT_PLAYER_MS = 650;
/** Queue length beyond which the follower simply teleports to catch up. */
const MAX_QUEUE = 4;

/** @typedef {import('../config.js').Dir} Dir */

/**
 * @typedef {object} FollowerController
 * @property {any} actor  { kind:'follower', species, model, mover, visible, reserved } | null
 * @property {(opts?: {animate?: boolean}) => any} spawn  (re)create for party[0] and place it
 * @property {(opts?: {animate?: boolean}) => void} sync  spawn/despawn if the party changed
 * @property {() => void} despawn
 * @property {(from:{x:number,y:number}, to:{x:number,y:number}, durationMs:number, hop:boolean, running:boolean) => void} onPlayerStep
 * @property {() => void} onPlayerArrive
 * @property {(dtMs:number) => void} update
 * @property {(kind:string, ms?:number) => Promise<void>} emote
 * @property {() => Promise<void>} bounce  hop accent with a small arc
 * @property {() => ({emote:(kind:string) => Promise<void>, hop:() => void})|null} handle
 */

/**
 * Create the follower controller.
 * @param {any} ctx  session context (see world-session.js)
 * @returns {FollowerController}
 */
export function createFollowerController(ctx) {
  /** @type {any} */
  let actor = null;
  /** @type {{x:number, y:number, durationMs:number, running:boolean}[]} */
  let queue = [];
  /** @type {{x:number, y:number}|null} tile to appear on after the player's next arrival */
  let appearAt = null;
  let idleMs = 0;

  function partnerSpecies() {
    return ctx.state.party?.[0]?.species ?? null;
  }

  function updateReserved() {
    if (actor) actor.reserved = queue.map((q) => ({ x: q.x, y: q.y }));
  }

  /** @param {boolean} visible */
  function setVisible(visible) {
    actor.visible = visible;
    if (actor.model.group) actor.model.group.visible = visible;
  }

  function popIn() {
    const group = actor?.model?.group;
    if (!group) return;
    try {
      actor.model.hop?.();
    } catch {
      /* ignore */
    }
    const target = actor;
    ctx.clock
      .tween(320, (t) => {
        if (actor !== target) return;
        group.scale.setScalar(Math.max(0.001, easeOutBack(t)));
        target.mover.bounceY = Math.sin(Math.PI * t) * 0.3;
        target.mover.applyPose();
      })
      .then(() => {
        if (actor !== target) return;
        group.scale.setScalar(1);
        target.mover.bounceY = 0;
        target.mover.applyPose();
      });
  }

  /**
   * Find a free tile next to the player, preferring the one behind them.
   * @returns {{x:number, y:number}|null}
   */
  function findSpot() {
    const model = ctx.mapModel;
    const p = ctx.player.actor?.mover;
    if (!model || !p) return null;
    const behind = OPPOSITE[p.facing];
    const order = [behind, ...DIR_NAMES.filter((d) => d !== behind && d !== p.facing), p.facing];
    for (const dir of order) {
      const res = model.canStep(p.x, p.y, dir, ctx.state.flags);
      if (!res.ok || res.hop) continue;
      if (ctx.occupancy.at(res.x, res.y, { except: actor })) continue;
      return { x: res.x, y: res.y };
    }
    return null;
  }

  function place() {
    const p = ctx.player.actor?.mover;
    queue = [];
    updateReserved();
    appearAt = null;
    idleMs = 0;
    const spot = findSpot();
    if (!spot || !p) {
      setVisible(false);
      actor.mover.place(p?.x ?? 0, p?.y ?? 0, p?.facing ?? 'down');
      appearAt = null;
      actor.waitingToAppear = true;
      return;
    }
    actor.waitingToAppear = false;
    actor.mover.place(spot.x, spot.y, p.facing);
    setVisible(true);
  }

  /** @param {{x:number, y:number}} tile */
  function appear(tile) {
    actor.waitingToAppear = false;
    const p = ctx.player.actor?.mover;
    actor.mover.place(tile.x, tile.y, p?.facing ?? 'down');
    setVisible(true);
    popIn();
  }

  function onArrive() {
    const m = actor.mover;
    if (ctx.mapModel?.typeAt(m.x, m.y).tallGrass) ctx.rustle(m.x, m.y);
    startNext();
  }

  /** @returns {boolean} whether a step began */
  function startNext() {
    if (!actor) return false;
    const m = actor.mover;
    while (queue.length) {
      const next = queue.shift();
      const dx = next.x - m.x;
      const dy = next.y - m.y;
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist === 0) continue;
      // Lagging behind (e.g. after a hop): move a little quicker to catch up.
      const catchUp = queue.length > 0 ? 0.75 : 1;
      const dir = dirBetween(m.x, m.y, next.x, next.y);
      if (dist === 1) {
        m.begin(next.x, next.y, { dir, durationMs: next.durationMs * catchUp, running: next.running });
      } else if (dist === 2 && (dx === 0 || dy === 0)) {
        const mx = m.x + dx / 2;
        const my = m.y + dy / 2;
        const ledge = !!ctx.mapModel?.typeAt(mx, my).ledge;
        if (ledge) {
          m.begin(next.x, next.y, { dir, durationMs: Math.max(next.durationMs, HOP_MS * 0.85) * catchUp, hop: true });
        } else {
          m.begin(next.x, next.y, { dir, durationMs: next.durationMs * 1.5 * catchUp, running: true });
        }
      } else {
        // Too far to animate sensibly: snap there.
        m.place(next.x, next.y, dir);
        continue;
      }
      updateReserved();
      return true;
    }
    updateReserved();
    return false;
  }

  /** @param {{animate?: boolean}} [opts] */
  function spawn({ animate = false } = {}) {
    const species = partnerSpecies();
    if (!species || !ctx.player.actor || !ctx.mapModel) {
      despawn();
      return null;
    }
    if (!actor || actor.species !== species) {
      despawn();
      const model = buildModel(ctx.deps.createWildlingModel, species, ctx.logger, `follower ${species}`);
      ctx.scene?.add?.(model.group);
      const p = ctx.player.actor.mover;
      const mover = createMover({ model, x: p.x, y: p.y, facing: p.facing, surfaceY: ctx.surfaceY, onArrive });
      actor = { kind: 'follower', id: 'follower', species, model, mover, visible: false, reserved: [], waitingToAppear: false };
      ctx.occupancy.add(actor);
    }
    place();
    if (animate && actor.visible) popIn();
    return actor;
  }

  /** @param {string} kind @param {number} [ms] */
  function emote(kind, ms = 1100) {
    if (!actor) return Promise.resolve();
    return safeEmote(actor.model, kind, ms, ctx.clock);
  }

  /** Hop accent with a small systems-driven arc. */
  function bounce() {
    if (!actor) return Promise.resolve();
    const target = actor;
    try {
      target.model.hop?.();
    } catch {
      /* ignore */
    }
    return ctx.clock
      .tween(300, (t) => {
        if (actor !== target) return;
        target.mover.bounceY = Math.sin(Math.PI * t) * 0.32;
        target.mover.applyPose();
      })
      .then(() => {
        if (actor !== target) return;
        target.mover.bounceY = 0;
        target.mover.applyPose();
      });
  }

  function despawn() {
    if (!actor) return;
    ctx.occupancy.remove(actor);
    disposeModel(ctx.scene, actor.model, ctx.logger);
    actor = null;
    queue = [];
    appearAt = null;
  }

  return {
    get actor() {
      return actor;
    },

    spawn,

    sync({ animate = true } = {}) {
      const species = partnerSpecies();
      if (!species) {
        despawn();
        return;
      }
      if (actor && actor.species === species) return;
      spawn({ animate });
    },

    despawn,

    // `to` and `hop` are part of the hook signature; the trail only needs `from`.
    onPlayerStep(from, _to, durationMs, _hop, running) {
      if (!actor) return;
      if (!actor.visible) {
        if (actor.waitingToAppear) appearAt = { x: from.x, y: from.y };
        return;
      }
      queue.push({ x: from.x, y: from.y, durationMs, running: !!running });
      if (queue.length > MAX_QUEUE) {
        const last = queue[queue.length - 1];
        queue = [];
        actor.mover.place(last.x, last.y, actor.mover.facing);
      }
      updateReserved();
      if (!actor.mover.moving) startNext();
    },

    onPlayerArrive() {
      if (!actor || !appearAt) return;
      const tile = appearAt;
      appearAt = null;
      // Someone else stepped there first: try again after the next step.
      if (ctx.occupancy.at(tile.x, tile.y, { except: actor, ignoreFollower: true })) return;
      appear(tile);
    },

    update(dtMs) {
      if (!actor) return;
      const m = actor.mover;
      if (m.moving) m.advance(dtMs);
      else if (queue.length && startNext()) m.advance(dtMs);

      // Idle: glance at the player after a moment.
      const p = ctx.player.actor?.mover;
      if (!m.moving && actor.visible && p && !p.moving) {
        idleMs += dtMs;
        if (idleMs >= LOOK_AT_PLAYER_MS) {
          const dist = Math.abs(p.x - m.x) + Math.abs(p.y - m.y);
          if (dist === 1) m.face(dirBetween(m.x, m.y, p.x, p.y));
        }
      } else {
        idleMs = 0;
      }
    },

    emote,
    bounce,

    handle() {
      if (!actor) return null;
      // Resolves the live follower on every call, so a handle survives warps.
      return {
        emote: (kind) => emote(kind),
        hop: () => {
          bounce();
        },
        get species() {
          return actor?.species ?? null;
        },
      };
    },
  };
}

