/**
 * The partner wildling that trails behind the player.
 *
 * - Species = state.party[0]. Spawns behind the player (opposite of facing) if
 *   that tile is reachable and free, else on any free reachable neighbour, else
 *   stays hidden until the player has walked a little.
 * - The player's path is recorded as a breadcrumb trail; the follower stands on
 *   that trail FOLLOW_DISTANCE behind, so it rounds the same corners, climbs the
 *   same stairs and hops the same ledges (it copies the arc too).
 * - Never blocks the player, but does block NPCs (it occupies its tile).
 */
import { DIR_NAMES, OPPOSITE } from '../config.js';
import { createFreeMover } from './free-mover.js';
import { buildModel, disposeModel, safeEmote } from './actor-utils.js';
import { easeOutBack } from './clock.js';

/** Path distance (tiles) the follower keeps behind the player. */
export const FOLLOW_DISTANCE = 1.05;
/** After this long idle next to an idle player, the follower turns to look at them. */
const LOOK_AT_PLAYER_MS = 650;
/** Trail points closer than this are merged. */
const TRAIL_SPACING = 0.04;
/** Trail kept beyond the follow distance (tiles). */
const TRAIL_SLACK = 1.5;
/** A jump larger than this (warp, teleport) snaps instead of walking. */
const SNAP_DISTANCE = 2.5;

/** @typedef {import('../config.js').Dir} Dir */

/**
 * @typedef {object} FollowerController
 * @property {any} actor  { kind:'follower', species, model, mover, visible } | null
 * @property {(opts?: {animate?: boolean}) => any} spawn  (re)create for party[0] and place it
 * @property {(opts?: {animate?: boolean}) => void} sync  spawn/despawn if the party changed
 * @property {() => void} despawn
 * @property {(dtMs:number) => void} update
 * @property {(kind:string, ms?:number) => Promise<void>} emote
 * @property {() => Promise<void>} bounce  hop accent with a small arc
 * @property {() => ({emote:(kind:string) => Promise<void>, hop:() => void})|null} handle
 */

/**
 * Point on a polyline at `dist` measured back from its last point.
 * @param {{x:number, y:number, z:number}[]} trail  oldest → newest
 * @param {number} dist
 * @returns {{x:number, y:number, z:number, index:number}|null} null when the trail is shorter
 */
export function pointBehind(trail, dist) {
  let left = dist;
  for (let i = trail.length - 1; i > 0; i--) {
    const a = trail[i];
    const b = trail[i - 1];
    const seg = Math.hypot(a.x - b.x, a.z - b.z);
    if (seg >= left && seg > 0) {
      const t = left / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, index: i - 1 };
    }
    left -= seg;
  }
  return null;
}

/**
 * Create the follower controller.
 * @param {any} ctx  session context (see world-session.js)
 * @returns {FollowerController}
 */
export function createFollowerController(ctx) {
  /** @type {any} */
  let actor = null;
  /** @type {{x:number, y:number, z:number}[]} player positions, oldest → newest */
  let trail = [];
  let idleMs = 0;
  let wasAirborne = false;
  /** @type {{x:number, y:number}} */
  let lastTile = { x: 0, y: 0 };

  function partnerSpecies() {
    return ctx.state.party?.[0]?.species ?? null;
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

  /** Player model position (includes the hop arc), or null. */
  function playerPoint() {
    const p = ctx.player.actor?.mover;
    if (!p) return null;
    return { x: p.px, y: p.py + (p.arc ?? 0), z: p.pz };
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

  /** Seed the trail so the follower's spot is already "on the path". */
  function seedTrail() {
    const m = actor.mover;
    const pp = playerPoint();
    trail = pp ? [{ x: m.px, y: m.py, z: m.pz }, pp] : [];
  }

  function place() {
    const p = ctx.player.actor?.mover;
    idleMs = 0;
    wasAirborne = false;
    const spot = findSpot();
    if (!spot || !p) {
      setVisible(false);
      actor.mover.place(p?.px ?? 0, p?.pz ?? 0, p?.facing ?? 'down');
      actor.waitingToAppear = true;
      const pp = playerPoint();
      trail = pp ? [pp] : [];
    } else {
      actor.waitingToAppear = false;
      actor.mover.place(spot.x, spot.y, p.facing);
      setVisible(true);
      seedTrail();
    }
    lastTile = { x: actor.mover.x, y: actor.mover.y };
  }

  function recordTrail() {
    const pp = playerPoint();
    if (!pp) return;
    const last = trail[trail.length - 1];
    if (last && Math.hypot(pp.x - last.x, pp.z - last.z) < TRAIL_SPACING && Math.abs(pp.y - last.y) < 0.02) {
      trail[trail.length - 1] = pp; // keep the newest point exact
      return;
    }
    if (last && Math.hypot(pp.x - last.x, pp.z - last.z) > SNAP_DISTANCE) {
      trail = [pp]; // the player teleported: start over
      return;
    }
    trail.push(pp);
    // Drop points well beyond the follow distance.
    let total = 0;
    for (let i = trail.length - 1; i > 0; i--) {
      total += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].z - trail[i - 1].z);
      if (total > FOLLOW_DISTANCE + TRAIL_SLACK) {
        trail = trail.slice(i - 1);
        break;
      }
    }
  }

  /** @param {number} dtMs */
  function follow(dtMs) {
    const m = actor.mover;
    const target = pointBehind(trail, FOLLOW_DISTANCE);
    if (!target) {
      m.moving = false;
      m.setAnim(false);
      return false;
    }
    if (actor.waitingToAppear) {
      actor.waitingToAppear = false;
      m.place(target.x, target.z, ctx.player.actor?.mover.facing ?? 'down');
      setVisible(true);
      popIn();
      return true;
    }
    const dx = target.x - m.px;
    const dz = target.z - m.pz;
    const dist = Math.hypot(dx, dz);
    if (dist > SNAP_DISTANCE) {
      m.place(target.x, target.z, m.facing);
      return true;
    }
    const moved = dist > 1e-4;
    if (moved) {
      m.setYaw(Math.atan2(dx, dz));
      m.setPosition(target.x, target.z);
    }
    // Copy the player's height along the trail (stairs, hop arcs).
    const ground = ctx.surfaceY(m.x, m.y);
    const airborne = target.y - ground > 0.12;
    if (airborne && !wasAirborne) {
      try {
        m.model?.hop?.();
      } catch {
        /* ignore */
      }
    }
    wasAirborne = airborne;
    m.hop = airborne;
    if (airborne) {
      m.py = ground;
      m.arc = target.y - ground;
    } else {
      m.arc = 0;
    }
    const speed = dist / Math.max(dtMs / 1000, 1e-6);
    const walking = moved && speed > 0.3 && !airborne;
    const running = !!ctx.player.actor?.mover.running;
    m.moving = walking || airborne;
    m.running = running;
    m.setAnim(walking, running);
    m.applyPose(dtMs / 1000);
    if (m.x !== lastTile.x || m.y !== lastTile.y) {
      lastTile = { x: m.x, y: m.y };
      if (ctx.mapModel?.typeAt(m.x, m.y).tallGrass) ctx.rustle(m.x, m.y);
    }
    return moved;
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
      const mover = createFreeMover({ model, x: p.x, y: p.y, facing: p.facing, radius: 0.25, surfaceY: ctx.surfaceY });
      actor = { kind: 'follower', id: 'follower', species, model, mover, visible: false, waitingToAppear: false };
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
    trail = [];
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

    update(dtMs) {
      if (!actor) return;
      recordTrail();
      const moved = follow(dtMs);

      // Idle: glance at the player after a moment.
      const m = actor.mover;
      const p = ctx.player.actor?.mover;
      if (!moved && actor.visible && p && !p.moving) {
        idleMs += dtMs;
        if (idleMs >= LOOK_AT_PLAYER_MS) {
          const dx = p.px - m.px;
          const dz = p.pz - m.pz;
          if (Math.hypot(dx, dz) < 1.6 && Math.hypot(dx, dz) > 1e-3) m.setYaw(Math.atan2(dx, dz));
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
