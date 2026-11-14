/**
 * Grid mover: one actor's tile position plus the step currently in progress.
 *
 * A step interpolates the model from its origin tile to its destination over
 * `durationMs`; y is lerped between the two tiles' surface heights, plus a
 * sin(πt) arc for ledge hops. `x`/`y` always hold the logical tile (the
 * destination while moving), `fromX`/`fromY` the origin — together they are the
 * tiles the actor reserves.
 *
 * `advance()` carries leftover time into a step begun by `onArrive`, so motion
 * chains seamlessly from tile to tile while a direction is held.
 */
import { FACING_ANGLE } from '../config.js';

/** Peak height (world units) of the ledge-hop arc. */
export const HOP_ARC = 0.55;

/** @typedef {import('../config.js').Dir} Dir */

/**
 * @typedef {object} StepOptions
 * @property {number} durationMs
 * @property {Dir} [dir]          facing during the step
 * @property {boolean} [hop]      ledge hop (arc, no walk cycle)
 * @property {boolean} [running]  run cycle instead of walk
 */

/**
 * @typedef {object} Mover
 * @property {any} model  ActorModel
 * @property {number} x  logical tile (destination while moving)
 * @property {number} y
 * @property {number} fromX  origin tile of the current step
 * @property {number} fromY
 * @property {Dir} facing
 * @property {boolean} moving
 * @property {boolean} hop
 * @property {boolean} running
 * @property {number} elapsedMs
 * @property {number} durationMs
 * @property {number} bounceY  extra y offset (scripted bounces)
 * @property {{x:number, y:number, z:number}} ground  world position on the ground (no arc/bounce)
 * @property {((m: Mover) => void)|null} onArrive  called after every arrival; may begin() again to chain
 * @property {(x:number, y:number, facing?:Dir) => void} place
 * @property {(dir:Dir, instant?:boolean) => void} face
 * @property {(tx:number, ty:number, opts:StepOptions) => void} begin
 * @property {(dtMs:number) => void} advance
 * @property {() => void} finish
 * @property {(moving:boolean, running?:boolean) => void} setAnim
 * @property {() => void} applyPose
 * @property {() => Promise<void>} arrival
 * @property {(x:number, y:number) => boolean} occupies
 * @property {number} progress
 */

/**
 * Create a mover for an actor model.
 * @param {object} opts
 * @param {any} opts.model  ActorModel ({ group, setFacing, setMoving, hop, ... })
 * @param {number} opts.x
 * @param {number} opts.y
 * @param {Dir} [opts.facing]
 * @param {(x:number, y:number) => number} opts.surfaceY  walking-surface height of a tile
 * @param {(m: Mover) => void} [opts.onArrive]
 * @returns {Mover}
 */
export function createMover({ model, x, y, facing = 'down', surfaceY, onArrive }) {
  const groundOf = typeof surfaceY === 'function' ? surfaceY : () => 0;
  /** @type {(() => void)[]} */
  let waiters = [];

  function releaseWaiters() {
    if (!waiters.length) return;
    const list = waiters;
    waiters = [];
    for (const fn of list) fn();
  }

  /** @param {number} ax @param {number} ay */
  function safeSurface(ax, ay) {
    try {
      const v = groundOf(ax, ay);
      return Number.isFinite(v) ? v : 0;
    } catch {
      return 0;
    }
  }

  /** @type {Mover} */
  const m = {
    model,
    x,
    y,
    fromX: x,
    fromY: y,
    facing: FACING_ANGLE[facing] !== undefined ? facing : 'down',
    moving: false,
    hop: false,
    running: false,
    elapsedMs: 0,
    durationMs: 0,
    bounceY: 0,
    ground: { x, y: 0, z: y },
    onArrive: onArrive ?? null,

    place(px, py, dir) {
      m.x = px;
      m.y = py;
      m.fromX = px;
      m.fromY = py;
      m.moving = false;
      m.hop = false;
      m.elapsedMs = 0;
      m.durationMs = 0;
      m.setAnim(false);
      if (dir && FACING_ANGLE[dir] !== undefined) m.face(dir, true);
      m.applyPose();
      releaseWaiters();
    },

    face(dir, instant = false) {
      if (FACING_ANGLE[dir] === undefined) return;
      if (dir === m.facing && !instant) return;
      m.facing = dir;
      try {
        model?.setFacing?.(dir, instant);
      } catch {
        /* a broken model must not stop movement */
      }
    },

    begin(tx, ty, opts) {
      if (m.moving) {
        // Never start a step from mid-air: settle the current one first (no chaining).
        const cb = m.onArrive;
        m.onArrive = null;
        m.finish();
        m.onArrive = cb;
      }
      m.fromX = m.x;
      m.fromY = m.y;
      m.x = tx;
      m.y = ty;
      m.durationMs = Math.max(1, Number(opts?.durationMs) || 1);
      m.elapsedMs = 0;
      m.hop = !!opts?.hop;
      m.running = !!opts?.running;
      m.moving = true;
      if (opts?.dir) m.face(opts.dir);
      if (m.hop) {
        m.setAnim(false);
        try {
          model?.hop?.();
        } catch {
          /* ignore */
        }
      } else {
        m.setAnim(true, m.running);
      }
      m.applyPose();
    },

    advance(dtMs) {
      if (!m.moving) return;
      let budget = Math.max(0, Number(dtMs) || 0);
      // A handful of chained arrivals per frame at most (dt is clamped upstream).
      for (let i = 0; i < 6 && m.moving; i++) {
        m.elapsedMs += budget;
        if (m.elapsedMs < m.durationMs) {
          m.applyPose();
          return;
        }
        budget = m.elapsedMs - m.durationMs;
        m.moving = false;
        m.hop = false;
        m.elapsedMs = 0;
        m.fromX = m.x;
        m.fromY = m.y;
        m.applyPose();
        releaseWaiters();
        m.onArrive?.(m);
        if (!m.moving) {
          m.setAnim(false);
          return;
        }
      }
      m.applyPose();
    },

    finish() {
      if (!m.moving) return;
      m.advance(m.durationMs - m.elapsedMs);
    },

    setAnim(moving, running = false) {
      // Only forward changes, so chained steps never restart the walk cycle.
      const r = !!moving && !!running;
      if (m._animMoving === !!moving && m._animRunning === r) return;
      m._animMoving = !!moving;
      m._animRunning = r;
      try {
        model?.setMoving?.(!!moving, r);
      } catch {
        /* ignore */
      }
    },

    applyPose() {
      const t = m.moving ? Math.min(1, m.elapsedMs / m.durationMs) : 1;
      const gx = m.fromX + (m.x - m.fromX) * t;
      const gz = m.fromY + (m.y - m.fromY) * t;
      const ya = safeSurface(m.fromX, m.fromY);
      const yb = m.fromX === m.x && m.fromY === m.y ? ya : safeSurface(m.x, m.y);
      const gy = ya + (yb - ya) * t;
      m.ground.x = gx;
      m.ground.y = gy;
      m.ground.z = gz;
      const arc = m.moving && m.hop ? Math.sin(Math.PI * t) * HOP_ARC : 0;
      model?.group?.position?.set(gx, gy + arc + m.bounceY, gz);
    },

    arrival() {
      if (!m.moving) return Promise.resolve();
      return new Promise((resolve) => waiters.push(resolve));
    },

    occupies(tx, ty) {
      if (m.x === tx && m.y === ty) return true;
      return m.moving && m.fromX === tx && m.fromY === ty;
    },

    get progress() {
      return m.moving ? Math.min(1, m.elapsedMs / m.durationMs) : 0;
    },
  };

  // Internal anim bookkeeping (not part of the typedef on purpose).
  /** @type {any} */ (m)._animMoving = null;
  /** @type {any} */ (m)._animRunning = null;

  m.face(m.facing, true);
  m.applyPose();
  return m;
}
