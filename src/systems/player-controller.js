/**
 * Player controller: turns held input into grid steps.
 *
 * - A short tap of a new direction only turns (TURN_DELAY_MS); holding walks.
 * - Run while `run` or `b` is held. Steps chain seamlessly while a direction stays held.
 * - Blocked: face that way, 'bump' at most every BUMP_COOLDOWN_MS.
 * - NPCs block; the follower never does.
 * - Scripted walks (`walk(dirs)`) ignore collision but animate and keep occupancy.
 */
import { DIRS, HOP_MS, RUN_STEP_MS, TURN_DELAY_MS, WALK_STEP_MS, PLAYER_LOOK } from '../config.js';
import { createMover } from './grid-mover.js';
import { buildModel, disposeModel } from './actor-utils.js';

/** Minimum ms between two 'bump' sounds while pushing against something. */
export const BUMP_COOLDOWN_MS = 300;

/** @typedef {import('../config.js').Dir} Dir */

/**
 * @typedef {object} PlayerController
 * @property {(x:number, y:number, facing:Dir) => void} spawn
 * @property {() => void} despawn
 * @property {any} actor  { kind:'player', model, mover, visible } | null
 * @property {(dtMs:number, allowInput:boolean) => void} update
 * @property {(dirs: Dir[]) => Promise<void>} walk  scripted walk
 * @property {(dir: Dir) => void} face
 * @property {() => void} halt  cancel a pending turn and stop the walk cycle when idle
 */

/**
 * Create the player controller.
 * @param {any} ctx  session context (see world-session.js)
 * @returns {PlayerController}
 */
export function createPlayerController(ctx) {
  /** @type {any} */
  let actor = null;
  /** @type {{dir: Dir, ms: number}|null} */
  let turning = null;
  let bumpCooldown = 0;
  /** @type {Dir[]} */
  let plan = [];
  /** @type {(() => void)|null} */
  let planDone = null;

  function isRunning() {
    const input = ctx.input;
    try {
      return !!(input?.isDown?.('run') || input?.isDown?.('b'));
    } catch {
      return false;
    }
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

  /**
   * Start a step and let the follower trail into the tile we leave.
   * @param {number} tx @param {number} ty @param {Dir} dir
   * @param {{hop?: boolean, running?: boolean}} opts
   */
  function beginStep(tx, ty, dir, { hop = false, running = false }) {
    const m = actor.mover;
    const from = { x: m.x, y: m.y };
    const durationMs = hop ? HOP_MS : running ? RUN_STEP_MS : WALK_STEP_MS;
    m.begin(tx, ty, { dir, durationMs, hop, running });
    ctx.state.facing = dir;
    if (hop) ctx.audio.sfx('ledge');
    ctx.follower?.onPlayerStep(from, { x: tx, y: ty }, durationMs, hop, running);
  }

  function bump() {
    actor.mover.setAnim(false);
    if (bumpCooldown <= 0) {
      ctx.audio.sfx('bump');
      bumpCooldown = BUMP_COOLDOWN_MS;
    }
  }

  /**
   * Try to step in `dir` under the movement rules. Always faces `dir`.
   * @param {Dir} dir
   * @returns {boolean} whether a step began
   */
  function tryStep(dir) {
    const model = ctx.mapModel;
    if (!model) return false;
    const m = actor.mover;
    face(dir);
    const res = model.canStep(m.x, m.y, dir, ctx.state.flags);
    const blocker = res.ok ? ctx.occupancy.at(res.x, res.y, { except: actor, ignoreFollower: true }) : null;
    if (!res.ok || blocker) {
      if (!res.ok && ctx.onPlayerBlocked?.(m.x, m.y, dir, res)) return false;
      bump();
      return false;
    }
    beginStep(res.x, res.y, dir, { hop: res.hop, running: isRunning() });
    return true;
  }

  function startPlanned() {
    const model = ctx.mapModel;
    const m = actor.mover;
    while (plan.length) {
      const dir = plan.shift();
      const d = DIRS[dir];
      if (!d) continue;
      const res = model?.canStep(m.x, m.y, dir, ctx.state.flags);
      if (res?.ok && res.hop) beginStep(res.x, res.y, dir, { hop: true });
      else beginStep(m.x + d.dx, m.y + d.dy, dir, {});
      return true;
    }
    return false;
  }

  function finishPlan() {
    const done = planDone;
    plan = [];
    planDone = null;
    done?.();
  }

  /** Mover callback: runs inside mover.advance() on every arrival. */
  function handleArrive() {
    syncState();
    const m = actor.mover;
    ctx.follower?.onPlayerArrive?.();

    if (plan.length || planDone) {
      if (ctx.mapModel?.typeAt(m.x, m.y).tallGrass) ctx.rustle(m.x, m.y);
      if (!startPlanned()) finishPlan();
      return;
    }

    const tookOver = ctx.onPlayerArrive?.(m.x, m.y) ?? false;
    if (tookOver || ctx.isBusy() || ctx.isPaused()) return;

    // Chain into the next step while a direction is still held — no stutter.
    const dir = ctx.input?.heldDirection?.() ?? null;
    if (dir && DIRS[dir]) {
      turning = null;
      tryStep(dir);
    }
  }

  function despawn() {
    if (!actor) return;
    ctx.occupancy.remove(actor);
    disposeModel(ctx.scene, actor.model, ctx.logger);
    actor = null;
    turning = null;
    finishPlan();
  }

  return {
    spawn(x, y, facing) {
      despawn();
      const model = buildModel(ctx.deps.createHumanoid, ctx.deps.PLAYER_LOOK ?? PLAYER_LOOK, ctx.logger, 'player');
      ctx.scene?.add?.(model.group);
      const mover = createMover({ model, x, y, facing, surfaceY: ctx.surfaceY, onArrive: handleArrive });
      actor = { kind: 'player', id: 'player', model, mover, visible: true };
      ctx.occupancy.add(actor);
      turning = null;
      bumpCooldown = 0;
      syncState();
    },

    despawn,

    get actor() {
      return actor;
    },

    update(dtMs, allowInput) {
      if (!actor) return;
      if (bumpCooldown > 0) bumpCooldown -= dtMs;
      const m = actor.mover;
      if (m.moving) {
        m.advance(dtMs);
        return;
      }
      if (plan.length) {
        if (startPlanned()) m.advance(dtMs);
        return;
      }
      if (!allowInput) {
        turning = null;
        return;
      }

      const dir = ctx.input?.heldDirection?.() ?? null;
      if (!dir || !DIRS[dir]) {
        turning = null;
        return;
      }
      if (dir !== m.facing) {
        // A new direction: turn in place first; walking needs a short hold.
        face(dir);
        turning = { dir, ms: 0 };
        return;
      }
      if (turning && turning.dir === dir) {
        turning.ms += dtMs;
        if (turning.ms < TURN_DELAY_MS) return;
      }
      turning = null;
      if (tryStep(dir)) m.advance(dtMs);
    },

    walk(dirs) {
      if (!actor) return Promise.resolve();
      const list = (Array.isArray(dirs) ? dirs : [dirs]).filter((d) => DIRS[d]);
      if (!list.length) return Promise.resolve();
      finishPlan();
      turning = null;
      return new Promise((resolve) => {
        plan = list;
        planDone = resolve;
        if (!actor.mover.moving && !startPlanned()) finishPlan();
      });
    },

    face,

    halt() {
      turning = null;
      if (actor && !actor.mover.moving) actor.mover.setAnim(false);
    },
  };
}
