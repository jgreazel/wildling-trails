/**
 * Player controller: free, analog movement over the tile map.
 *
 * - The stick (or 8-way keys / d-pad) sets a direction and speed; partial tilt
 *   walks slower, `run` or `b` runs. Velocity eases in and out a little.
 * - The body is a circle that slides along walls (collision.js). Moving almost
 *   straight into a doorway nudges you onto its centre line ("corner assist").
 * - Ledges: push into one roughly head-on and you hop it (two tiles, one way).
 * - Entering a new tile runs the arrival rules (warps, triggers, tall grass);
 *   pushing against the map edge / an exit mat / a door while standing on a
 *   warp still leaves the map.
 * - Scripted walks (`walk(dirs)`) move tile to tile, ignoring collision.
 * - NPCs block; the follower never does.
 */
import { DIRS, HOP_MS, PLAYER_LOOK, PLAYER_RADIUS, RUN_SPEED, WALK_SPEED } from '../config.js';
import { createFreeMover } from './free-mover.js';
import { createCollider } from './collision.js';
import { HOP_ARC } from './grid-mover.js';
import { buildModel, disposeModel } from './actor-utils.js';

/** Minimum ms between two 'bump' sounds. */
export const BUMP_COOLDOWN_MS = 300;
/** Velocity easing rates (1/s): speeding up, slowing down. */
const ACCEL = 22;
const DECEL = 28;
/** Slowest analog walk, as a fraction of walking speed. */
const MIN_ANALOG_SPEED = 0.35;
/** Input within this ratio of an axis counts as "straight" for corner assist and ledges. */
const STRAIGHT_RATIO = 0.45;
/** Off-centre distance (tiles) still allowed to hop a ledge. */
const LEDGE_ALIGN = 0.38;

/** @typedef {import('../config.js').Dir} Dir */

/**
 * @typedef {object} PlayerController
 * @property {(x:number, y:number, facing:Dir) => void} spawn
 * @property {() => void} despawn
 * @property {any} actor  { kind:'player', model, mover, visible } | null
 * @property {(dtMs:number, allowInput:boolean) => void} update
 * @property {(dirs: Dir[]) => Promise<void>} walk  scripted walk
 * @property {(dir: Dir) => void} face
 * @property {(x:number, z:number) => void} faceToward  turn toward a world point
 * @property {() => void} halt  stop moving (a script or dialog took over)
 * @property {boolean} scripted  a scripted walk or a hop is in progress
 */

/**
 * Create the player controller.
 * @param {any} ctx  session context (see world-session.js)
 * @returns {PlayerController}
 */
export function createPlayerController(ctx) {
  /** @type {any} */
  let actor = null;
  let vx = 0;
  let vz = 0;
  let bumpCooldown = 0;
  let pressing = false;
  /** @type {{x:number, y:number}} */
  let lastTile = { x: 0, y: 0 };
  /** @type {null|{fromX:number, fromZ:number, toX:number, toZ:number, fromY:number, toY:number, ms:number, dur:number, done:() => void}} */
  let hop = null;
  /** @type {null|{points:{x:number, z:number, hop:boolean, dir:Dir}[], done:() => void}} */
  let plan = null;

  function isRunning() {
    try {
      return !!(ctx.input?.isDown?.('run') || ctx.input?.isDown?.('b'));
    } catch {
      return false;
    }
  }

  /** @returns {{x:number, y:number, magnitude:number, analog:boolean}} */
  function readMove() {
    const input = ctx.input;
    try {
      if (typeof input?.moveVector === 'function') return input.moveVector();
      const dir = input?.heldDirection?.() ?? null;
      const d = dir ? DIRS[dir] : null;
      if (d) return { x: d.dx, y: d.dy, magnitude: 1, analog: false };
    } catch {
      /* fall through */
    }
    return { x: 0, y: 0, magnitude: 0, analog: false };
  }

  function syncState() {
    const m = actor.mover;
    ctx.state.x = m.x;
    ctx.state.y = m.y;
    ctx.state.facing = m.facing;
  }

  /** @param {Dir} dir */
  function face(dir) {
    if (!actor || !DIRS[dir]) return;
    actor.mover.face(dir);
    ctx.state.facing = dir;
  }

  function collider() {
    return createCollider({
      model: ctx.mapModel,
      flags: ctx.state.flags,
      radius: PLAYER_RADIUS,
      isBlocked: (x, y) => !!ctx.occupancy.at(x, y, { except: actor, ignoreFollower: true }),
    });
  }

  function stop() {
    vx = 0;
    vz = 0;
    if (!actor) return;
    actor.mover.moving = false;
    actor.mover.setAnim(false);
  }

  function bump() {
    if (bumpCooldown > 0) return;
    ctx.audio.sfx('bump');
    bumpCooldown = BUMP_COOLDOWN_MS;
  }

  /** Run the arrival rules when the tile under the player changes. */
  function checkTile() {
    const m = actor.mover;
    if (m.x === lastTile.x && m.y === lastTile.y) return;
    lastTile = { x: m.x, y: m.y };
    syncState();
    const tookOver = ctx.onPlayerArrive?.(m.x, m.y) ?? false;
    if (tookOver) stop();
  }

  /**
   * Hop from where we stand to the centre of (tx, ty).
   * @param {number} tx @param {number} ty @param {Dir} dir @param {() => void} done
   */
  function startHop(tx, ty, dir, done) {
    const m = actor.mover;
    hop = {
      fromX: m.px,
      fromZ: m.pz,
      toX: tx,
      toZ: ty,
      fromY: m.py,
      toY: ctx.surfaceY(tx, ty),
      ms: 0,
      dur: HOP_MS,
      done,
    };
    vx = 0;
    vz = 0;
    m.hop = true;
    m.moving = true;
    m.face(dir);
    ctx.state.facing = dir;
    m.setAnim(false);
    try {
      m.model?.hop?.();
    } catch {
      /* ignore */
    }
    ctx.audio.sfx('ledge');
  }

  /** @param {number} dtMs */
  function advanceHop(dtMs) {
    const m = actor.mover;
    const h = /** @type {NonNullable<typeof hop>} */ (hop);
    h.ms += dtMs;
    const t = Math.min(1, h.ms / h.dur);
    m.setPosition(h.fromX + (h.toX - h.fromX) * t, h.fromZ + (h.toZ - h.fromZ) * t);
    m.py = h.fromY + (h.toY - h.fromY) * t;
    m.arc = Math.sin(Math.PI * t) * HOP_ARC;
    m.applyPose();
    if (t < 1) return;
    hop = null;
    m.hop = false;
    m.moving = false;
    m.arc = 0;
    m.place(h.toX, h.toZ);
    h.done();
  }

  /** @param {number} dt seconds */
  function advancePlan(dt) {
    const m = actor.mover;
    const p = /** @type {NonNullable<typeof plan>} */ (plan);
    let budget = WALK_SPEED * dt;
    while (p.points.length && budget > 0) {
      const next = p.points[0];
      if (next.hop) {
        p.points.shift();
        startHop(next.x, next.z, next.dir, () => afterPlanPoint());
        return;
      }
      const dx = next.x - m.px;
      const dz = next.z - m.pz;
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-6) m.setYaw(Math.atan2(dx, dz));
      m.moving = true;
      m.setAnim(true, false);
      if (dist <= budget) {
        m.setPosition(next.x, next.z);
        budget -= dist;
        p.points.shift();
        afterPlanPoint();
        if (!plan) return;
      } else {
        m.setPosition(m.px + (dx / dist) * budget, m.pz + (dz / dist) * budget);
        budget = 0;
      }
    }
    m.applyPose(dt);
  }

  function afterPlanPoint() {
    const m = actor.mover;
    m.applyPose();
    if (ctx.mapModel?.typeAt(m.x, m.y).tallGrass) ctx.rustle(m.x, m.y);
    lastTile = { x: m.x, y: m.y };
    syncState();
    if (plan && !plan.points.length) finishPlan();
  }

  function finishPlan() {
    const done = plan?.done;
    plan = null;
    if (actor) {
      actor.mover.moving = false;
      actor.mover.setAnim(false);
      syncState();
    }
    done?.();
  }

  /**
   * Blocked while pushing in a near-cardinal direction: hop a ledge, slide onto
   * a doorway's centre line, or leave the map through a warp.
   * @param {any} col @param {{x:number, z:number}} next @param {Dir} dir @param {number} speed @param {number} dt
   * @returns {'hop'|'warp'|{x:number, z:number}|null}
   */
  function assist(col, next, dir, speed, dt) {
    const m = actor.mover;
    const model = ctx.mapModel;
    const cx = Math.round(next.x);
    const cy = Math.round(next.z);
    const res = model.canStep(cx, cy, dir, ctx.state.flags);
    const horizontal = dir === 'left' || dir === 'right';
    const offset = horizontal ? next.z - cy : next.x - cx;
    if (res.ok && res.hop) {
      if (Math.abs(offset) <= LEDGE_ALIGN && !ctx.occupancy.at(res.x, res.y, { except: actor, ignoreFollower: true })) {
        startHop(res.x, res.y, dir, () => checkTile());
        return 'hop';
      }
      return null;
    }
    if (!res.ok) {
      if (ctx.onPlayerBlocked?.(cx, cy, dir, res)) {
        stop();
        return 'warp';
      }
      return null;
    }
    // The tile ahead is open: we're catching a corner. Slide toward the centre line.
    if (Math.abs(offset) < 0.01) return null;
    const nudge = -Math.sign(offset) * Math.min(Math.abs(offset), speed * dt);
    const slid = col.move(next.x, next.z, horizontal ? 0 : nudge, horizontal ? nudge : 0);
    return Math.hypot(slid.x - next.x, slid.z - next.z) > 1e-6 ? slid : null;
  }

  /** @param {number} dtMs @param {boolean} allowInput */
  function steer(dtMs, allowInput) {
    const m = actor.mover;
    const dt = dtMs / 1000;
    const v = allowInput ? readMove() : { x: 0, y: 0, magnitude: 0, analog: false };
    const running = allowInput && v.magnitude > 0 && isRunning();
    const mag = v.magnitude;
    const dirX = mag > 0 ? v.x / mag : 0;
    const dirZ = mag > 0 ? v.y / mag : 0;
    const speed = mag > 0 ? (running ? RUN_SPEED : WALK_SPEED) * (v.analog ? Math.max(MIN_ANALOG_SPEED, mag) : 1) : 0;

    const k = 1 - Math.exp(-dt * (speed > 0 ? ACCEL : DECEL));
    vx += (dirX * speed - vx) * k;
    vz += (dirZ * speed - vz) * k;
    if (speed === 0 && Math.hypot(vx, vz) < 0.05) {
      vx = 0;
      vz = 0;
    }
    if (mag > 0) m.setYaw(Math.atan2(dirX, dirZ));

    const dx = vx * dt;
    const dz = vz * dt;
    const intended = Math.hypot(dx, dz);
    let moved = 0;
    if (intended > 1e-9 && ctx.mapModel) {
      const col = collider();
      let next = col.move(m.px, m.pz, dx, dz);
      moved = Math.hypot(next.x - m.px, next.z - m.pz);
      if (mag > 0 && moved < intended * 0.5) {
        const ax = Math.abs(dirX);
        const az = Math.abs(dirZ);
        const straight = Math.min(ax, az) <= STRAIGHT_RATIO * Math.max(ax, az);
        if (straight) {
          /** @type {Dir} */
          const dir = ax > az ? (dirX > 0 ? 'right' : 'left') : dirZ > 0 ? 'down' : 'up';
          const out = assist(col, next, dir, speed, dt);
          if (out === 'hop' || out === 'warp') return;
          if (out) {
            next = out;
            moved = Math.hypot(next.x - m.px, next.z - m.pz);
          }
        }
        if (moved < intended * 0.1) {
          if (!pressing) bump();
          pressing = true;
        } else {
          pressing = false;
        }
      } else {
        pressing = false;
      }
      m.setPosition(next.x, next.z);
    } else {
      pressing = false;
    }

    const walking = moved / Math.max(dt, 1e-6) > 0.3;
    m.moving = walking;
    m.running = running;
    m.setAnim(walking, running);
    m.applyPose(dt);
    checkTile();
  }

  function despawn() {
    if (!actor) return;
    ctx.occupancy.remove(actor);
    disposeModel(ctx.scene, actor.model, ctx.logger);
    actor = null;
    hop = null;
    finishPlan();
  }

  return {
    spawn(x, y, facing) {
      despawn();
      const model = buildModel(ctx.deps.createHumanoid, ctx.deps.PLAYER_LOOK ?? PLAYER_LOOK, ctx.logger, 'player');
      ctx.scene?.add?.(model.group);
      const mover = createFreeMover({ model, x, y, facing, radius: PLAYER_RADIUS, surfaceY: ctx.surfaceY });
      actor = { kind: 'player', id: 'player', model, mover, visible: true };
      ctx.occupancy.add(actor);
      vx = 0;
      vz = 0;
      bumpCooldown = 0;
      pressing = false;
      lastTile = { x, y };
      syncState();
    },

    despawn,

    get actor() {
      return actor;
    },

    get scripted() {
      return !!(hop || plan);
    },

    update(dtMs, allowInput) {
      if (!actor) return;
      if (bumpCooldown > 0) bumpCooldown -= dtMs;
      if (hop) {
        advanceHop(dtMs);
        return;
      }
      if (plan) {
        advancePlan(dtMs / 1000);
        return;
      }
      steer(dtMs, allowInput);
    },

    walk(dirs) {
      if (!actor) return Promise.resolve();
      const list = (Array.isArray(dirs) ? dirs : [dirs]).filter((d) => DIRS[d]);
      if (!list.length) return Promise.resolve();
      finishPlan();
      stop();
      const m = actor.mover;
      let cur = { x: m.x, y: m.y };
      const points = list.map((dir) => {
        const d = DIRS[dir];
        const res = ctx.mapModel?.canStep(cur.x, cur.y, dir, ctx.state.flags);
        const point = res?.ok && res.hop
          ? { x: res.x, z: res.y, hop: true, dir }
          : { x: cur.x + d.dx, z: cur.y + d.dy, hop: false, dir };
        cur = { x: point.x, y: point.z };
        return point;
      });
      return new Promise((resolve) => {
        plan = { points, done: resolve };
      });
    },

    face,

    faceToward(x, z) {
      if (!actor) return;
      const m = actor.mover;
      const dx = x - m.px;
      const dz = z - m.pz;
      if (Math.hypot(dx, dz) < 1e-6) return;
      m.setYaw(Math.atan2(dx, dz));
      ctx.state.facing = m.facing;
    },

    halt() {
      vx = 0;
      vz = 0;
      pressing = false;
      if (actor && !hop && !plan) {
        actor.mover.moving = false;
        actor.mover.setAnim(false);
      }
    },
  };
}
