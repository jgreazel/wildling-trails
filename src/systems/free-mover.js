/**
 * Free mover: an actor at a continuous position with a free facing angle.
 *
 * It exposes the same surface the rest of the systems read from a grid mover
 * (`x`/`y` = the tile under the actor, `facing` = nearest cardinal, `ground`,
 * `moving`, `hop`, `bounceY`, `occupies`, `place`, `face`, `setAnim`,
 * `applyPose`, `arrival`), so NPC AI, scripts, encounters and occupancy keep
 * working unchanged while the controller steers `px`/`pz` and `yaw`.
 *
 * Height eases toward the surface of the tile underneath, so stairs and level
 * changes read as a smooth ramp rather than a snap.
 */
import { FACING_ANGLE, yawToDir } from '../config.js';
import { tilesUnder } from './collision.js';

/** How fast the actor's height follows the ground (1/s). */
const HEIGHT_EASE = 16;

/** @typedef {import('../config.js').Dir} Dir */

/**
 * @param {object} opts
 * @param {any} opts.model  ActorModel ({ group, setYaw?, setFacing, setMoving, hop })
 * @param {number} opts.x
 * @param {number} opts.y
 * @param {Dir} [opts.facing]
 * @param {number} [opts.radius]  occupancy footprint
 * @param {(x:number, y:number) => number} opts.surfaceY
 */
export function createFreeMover({ model, x, y, facing = 'down', radius = 0.3, surfaceY }) {
  const groundOf = typeof surfaceY === 'function' ? surfaceY : () => 0;
  /** @param {number} ax @param {number} ay */
  function safeSurface(ax, ay) {
    try {
      const v = groundOf(ax, ay);
      return Number.isFinite(v) ? v : 0;
    } catch {
      return 0;
    }
  }

  const m = {
    model,
    radius,
    /** continuous position (tile units) */
    px: x,
    pz: y,
    /** eased ground height */
    py: safeSurface(x, y),
    /** extra lift (ledge-hop arc) */
    arc: 0,
    yaw: FACING_ANGLE[facing] ?? 0,
    /** @type {Dir} */
    facing: FACING_ANGLE[facing] !== undefined ? facing : 'down',
    x,
    y,
    moving: false,
    hop: false,
    running: false,
    bounceY: 0,
    ground: { x, y: 0, z: y },
    /** @type {boolean|null} */ _animMoving: null,
    /** @type {boolean|null} */ _animRunning: null,

    /**
     * Snap to a tile centre (or any point) and stop.
     * @param {number} px @param {number} py @param {Dir} [dir]
     */
    place(px, py, dir) {
      m.setPosition(px, py);
      m.py = safeSurface(m.x, m.y);
      m.arc = 0;
      m.moving = false;
      m.hop = false;
      m.setAnim(false);
      if (dir && FACING_ANGLE[dir] !== undefined) m.face(dir, true);
      m.applyPose();
    },

    /** @param {number} px @param {number} pz */
    setPosition(px, pz) {
      m.px = px;
      m.pz = pz;
      m.x = Math.round(px);
      m.y = Math.round(pz);
    },

    /** @param {Dir} dir @param {boolean} [instant] */
    face(dir, instant = false) {
      if (FACING_ANGLE[dir] === undefined) return;
      m.setYaw(FACING_ANGLE[dir], instant);
    },

    /** @param {number} yaw @param {boolean} [instant] */
    setYaw(yaw, instant = false) {
      if (!Number.isFinite(yaw)) return;
      const dir = yawToDir(yaw);
      const changed = Math.abs(yaw - m.yaw) > 1e-6 || dir !== m.facing;
      m.yaw = yaw;
      m.facing = dir;
      if (!changed && !instant) return;
      try {
        if (typeof model?.setYaw === 'function') model.setYaw(yaw, instant);
        else model?.setFacing?.(dir, instant);
      } catch {
        /* a broken model must not stop movement */
      }
    },

    /** @param {boolean} moving @param {boolean} [running] */
    setAnim(moving, running = false) {
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

    /**
     * Ease height toward the ground and push the pose to the model.
     * @param {number} [dt] seconds; 0 snaps
     */
    applyPose(dt = 0) {
      const target = safeSurface(m.x, m.y);
      if (!m.hop) {
        m.py = dt > 0 ? m.py + (target - m.py) * (1 - Math.exp(-dt * HEIGHT_EASE)) : target;
        if (Math.abs(m.py - target) < 1e-4) m.py = target;
      }
      m.ground.x = m.px;
      m.ground.y = m.py;
      m.ground.z = m.pz;
      model?.group?.position?.set(m.px, m.py + m.arc + m.bounceY, m.pz);
    },

    /** Free movers never wait on a step. */
    arrival() {
      return Promise.resolve();
    },

    /** @param {number} tx @param {number} ty */
    occupies(tx, ty) {
      if (tx === m.x && ty === m.y) return true;
      return tilesUnder(m.px, m.pz, m.radius).some((t) => t.x === tx && t.y === ty);
    },

    get progress() {
      return 0;
    },
  };

  m.setYaw(m.yaw, true);
  m.applyPose();
  return m;
}
