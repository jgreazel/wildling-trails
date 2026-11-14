/**
 * Game-time scheduler. Waits and tweens advance only when the world session
 * updates, so scripted timing pauses with the game, never drifts from the
 * animation it drives, and is fully deterministic in Node tests.
 */

/**
 * @typedef {object} ClockTask
 * @property {number} remaining  ms left
 * @property {number} total      ms overall
 * @property {((t:number) => void)|null} onUpdate  tween callback, t ∈ [0, 1]
 * @property {() => void} resolve
 */

/**
 * @typedef {object} Clock
 * @property {(ms:number) => Promise<void>} wait  resolve after `ms` of game time
 * @property {(ms:number, onUpdate:(t:number) => void) => Promise<void>} tween
 *   call `onUpdate(t)` every update (t = 0 immediately, t = 1 on the last call), then resolve
 * @property {(dtMs:number) => void} update  advance every pending task
 * @property {() => void} flush  finish every pending task right now (t = 1, resolved)
 * @property {number} pending  number of pending tasks
 */

/**
 * Create a game-time clock.
 * @param {{ logger?: Pick<Console, 'error'> }} [opts]
 * @returns {Clock}
 */
export function createClock({ logger = console } = {}) {
  /** @type {ClockTask[]} */
  let tasks = [];

  /** @param {ClockTask} task @param {number} t */
  function step(task, t) {
    if (!task.onUpdate) return;
    try {
      task.onUpdate(t);
    } catch (err) {
      logger.error('[clock] tween callback failed', err);
      task.onUpdate = null;
    }
  }

  return {
    wait(ms) {
      const total = Number(ms);
      if (!(total > 0)) return Promise.resolve();
      return new Promise((resolve) => {
        tasks.push({ remaining: total, total, onUpdate: null, resolve });
      });
    },

    tween(ms, onUpdate) {
      const total = Math.max(1, Number(ms) || 0);
      /** @type {ClockTask} */
      const task = { remaining: total, total, onUpdate: typeof onUpdate === 'function' ? onUpdate : null, resolve: () => {} };
      const promise = new Promise((resolve) => {
        task.resolve = resolve;
      });
      step(task, 0);
      tasks.push(task);
      return promise;
    },

    update(dtMs) {
      if (!tasks.length || !(dtMs > 0)) return;
      const current = tasks;
      tasks = [];
      /** @type {ClockTask[]} */
      const keep = [];
      for (const task of current) {
        task.remaining -= dtMs;
        if (task.remaining <= 0) {
          step(task, 1);
          task.resolve();
        } else {
          step(task, 1 - task.remaining / task.total);
          keep.push(task);
        }
      }
      // Tasks created by callbacks during this update land in `tasks`.
      tasks = keep.concat(tasks);
    },

    flush() {
      // Loop: resolving may not add tasks synchronously, but callbacks can.
      for (let guard = 0; tasks.length && guard < 8; guard++) {
        const current = tasks;
        tasks = [];
        for (const task of current) {
          step(task, 1);
          task.resolve();
        }
      }
    },

    get pending() {
      return tasks.length;
    },
  };
}

/**
 * Overshooting ease used for pop-in scales.
 * @param {number} t 0..1
 */
export function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

/**
 * Smooth 0..1 ramp between edges a and b.
 * @param {number} a @param {number} b @param {number} t
 */
export function smoothstep(a, b, t) {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
}
