/**
 * The behaviour every ActorModel shares, independent of what it looks like:
 * facing + smooth shortest-path turning, walk/run blending, hop squash-and-
 * stretch, blinking, the blob shadow, emote bubbles and disposal.
 *
 * Model builders (humanoid.js, wildlings.js) create the visual rig and pass an
 * `animate(ctx)` callback that poses it every frame from the shared state.
 */
import * as THREE from 'three';
import { FACING_ANGLE, HOP_MS } from '../config.js';
import { blobShadowGeometry, blobShadowMaterial } from './actor-materials.js';
import { createEmoteBubble, sanitizeMs } from './emote.js';

const TAU = Math.PI * 2;
const HOP_S = HOP_MS / 1000;
const SHADOW_Y = 0.012;

/**
 * @typedef {object} AnimContext
 * @property {number} t      seconds since creation
 * @property {number} dt     clamped frame delta (s)
 * @property {number} phase  gait phase (radians, wraps at 2π)
 * @property {number} move   0 … 1 eased "is moving" blend
 * @property {number} run    0 … 1 eased "is running" blend (≤ move)
 * @property {number} blink  eye openness 1 (open) … ~0.08 (closed)
 * @property {number} hop    progress through the hop accent (0 … 1.3), -1 when not hopping
 * @property {boolean} turning
 * @property {number} lift   extra height above the ground that `animate` reports (for the shadow)
 */

/**
 * @typedef {object} ActorModel
 * @property {THREE.Group} group  origin at feet; faces +z at rotation 0
 * @property {number} height      approx. top of head (for emotes)
 * @property {(dir: string, instant?: boolean) => void} setFacing
 * @property {(yaw: number, instant?: boolean) => void} setYaw  free facing (radians, see FACING_ANGLE)
 * @property {(moving: boolean, running?: boolean) => void} setMoving
 * @property {() => void} hop
 * @property {(kind: string, ms?: number) => Promise<void>} emote
 * @property {(dt: number) => void} update
 * @property {() => void} dispose
 * @property {string} facing read-only current target facing
 */

/** Wrap an angle into [-π, π). @param {number} a */
export function wrapAngle(a) {
  return ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

/** @param {number} x */
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Squash keyframes for hop(): [progress (× HOP_MS), scale.y]. */
const HOP_KEYS = [
  [0, 1],
  [0.09, 0.8],
  [0.3, 1.15],
  [0.68, 1.02],
  [0.88, 0.84],
  [1.04, 1.06],
  [1.2, 0.99],
  [1.3, 1],
];
/** Hop accent length in units of HOP_MS. */
export const HOP_END = HOP_KEYS[HOP_KEYS.length - 1][0];

/**
 * Vertical squash factor at hop progress `p` (1 = rest).
 * @param {number} p
 */
export function hopSquash(p) {
  if (!(p >= 0) || p >= HOP_END) return 1;
  for (let i = 1; i < HOP_KEYS.length; i++) {
    const [p1, v1] = HOP_KEYS[i];
    if (p <= p1) {
      const [p0, v0] = HOP_KEYS[i - 1];
      return v0 + (v1 - v0) * smooth((p - p0) / (p1 - p0));
    }
  }
  return 1;
}

/**
 * Blink scheduler: eyes close for ~0.13 s every 2–5 s, sometimes twice.
 * @param {() => number} rand
 */
export function createBlinker(rand = Math.random) {
  let wait = 0.6 + rand() * 2.5;
  let t = -1;
  let twice = false;
  const D = 0.13;
  /** @param {number} p */
  const shut = (p) => 1 - 0.92 * Math.sin(Math.PI * Math.min(1, Math.max(0, p)));
  return {
    /** @param {number} dt @returns {number} openness */
    update(dt) {
      if (t < 0) {
        wait -= dt;
        if (wait > 0) return 1;
        t = 0;
        twice = rand() < 0.2;
        return 1;
      }
      t += dt;
      if (t < D) return shut(t / D);
      if (twice && t < D * 2.4) return t > D * 1.4 ? shut((t - D * 1.4) / D) : 1;
      t = -1;
      wait = 2 + rand() * 3;
      return 1;
    },
  };
}

/**
 * Create the outer group, the animated rig node and the blob shadow.
 * @param {{ shadowRadius?: number, name?: string }} [opts]
 * @returns {{ group: THREE.Group, rig: THREE.Group, shadow: THREE.Mesh }}
 */
export function createActorShell({ shadowRadius = 0.25, name = 'actor' } = {}) {
  const group = new THREE.Group();
  group.name = name;
  const rig = new THREE.Group();
  rig.name = 'rig';
  group.add(rig);
  const shadow = new THREE.Mesh(blobShadowGeometry(), blobShadowMaterial());
  shadow.name = 'blob-shadow';
  shadow.position.y = SHADOW_Y;
  shadow.scale.setScalar(shadowRadius * 2);
  shadow.renderOrder = 1;
  shadow.castShadow = false;
  shadow.receiveShadow = false;
  shadow.raycast = () => {};
  group.add(shadow);
  return { group, rig, shadow };
}

/**
 * Measure the rig's top (before any animation) to derive `height`.
 * @param {THREE.Object3D} rig
 */
export function measureTop(rig) {
  rig.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(rig);
  return box.isEmpty() ? 0.5 : box.max.y - (rig.parent ? rig.parent.position.y : 0);
}

/**
 * Wrap a rig into a full ActorModel.
 * @param {object} o
 * @param {THREE.Group} o.group
 * @param {THREE.Group} o.rig
 * @param {THREE.Mesh} o.shadow
 * @param {number} o.height
 * @param {number} o.shadowRadius
 * @param {{ dispose(): void }} o.kit
 * @param {(ctx: AnimContext) => void} o.animate
 * @param {{ walk: number, run: number }} [o.gait] gait phase rates (rad/s)
 * @param {number} [o.hopStrength] scales the hop squash (1 = default)
 * @param {() => number} [o.rand]
 * @returns {ActorModel}
 */
export function createActorController(o) {
  const { group, rig, shadow, height, shadowRadius, kit, animate } = o;
  const gait = o.gait ?? { walk: TAU * 2.1, run: TAU * 3.6 };
  const hopStrength = o.hopStrength ?? 1;
  const blinker = createBlinker(o.rand ?? Math.random);

  /** @type {string} */
  let facing = 'down';
  let targetYaw = 0;
  let turning = false;
  let moving = false;
  let running = false;
  let hopT = -1;
  let hopBaseY = 0;
  let shadowOffset = 0;
  let disposed = false;
  /** @type {ReturnType<typeof createEmoteBubble> | null} */
  let bubble = null;

  /** @type {AnimContext} */
  const ctx = { t: 0, dt: 0, phase: 0, move: 0, run: 0, blink: 1, hop: -1, turning: false, lift: 0 };

  function step(dt) {
    ctx.dt = dt;
    ctx.t += dt;

    // --- smooth shortest-path turning -----------------------------------
    if (turning) {
      const cur = group.rotation.y;
      const diff = wrapAngle(targetYaw - cur);
      if (Math.abs(diff) < 0.003) {
        group.rotation.y = targetYaw;
        turning = false;
      } else {
        const eased = diff * (1 - Math.exp(-dt * 16));
        const minStep = Math.sign(diff) * Math.min(Math.abs(diff), 6 * dt);
        group.rotation.y = cur + (Math.abs(eased) > Math.abs(minStep) ? eased : minStep);
      }
    }
    ctx.turning = turning;

    // --- walk / run blends ------------------------------------------------
    const wantMove = moving ? 1 : 0;
    const wantRun = moving && running ? 1 : 0;
    ctx.move += (wantMove - ctx.move) * (1 - Math.exp(-dt * (moving ? 14 : 9)));
    ctx.run += (wantRun - ctx.run) * (1 - Math.exp(-dt * 8));
    if (!moving && ctx.move < 0.003) {
      ctx.move = 0;
      ctx.run = 0;
      ctx.phase = 0;
    } else {
      ctx.phase = (ctx.phase + dt * (gait.walk + (gait.run - gait.walk) * ctx.run)) % TAU;
    }

    // --- blink ------------------------------------------------------------
    ctx.blink = blinker.update(dt);

    // --- hop squash & stretch --------------------------------------------
    let squash = 1;
    if (hopT >= 0) {
      hopT += dt;
      const p = hopT / HOP_S;
      if (p >= HOP_END) {
        hopT = -1;
        ctx.hop = -1;
      } else {
        ctx.hop = p;
        squash = 1 + (hopSquash(p) - 1) * hopStrength;
      }
    }
    const wide = 1 / Math.sqrt(squash);
    rig.scale.set(wide, squash, wide);

    // --- pose -------------------------------------------------------------
    ctx.lift = 0;
    animate(ctx);

    // --- blob shadow: stay on the ground while systems lift us in a hop ----
    let air = Math.max(0, rig.position.y) + Math.max(0, ctx.lift);
    if (hopT >= 0) {
      const p = hopT / HOP_S;
      const lifted = Math.max(0, Math.min(1.5, group.position.y - hopBaseY));
      const w = p < 0.5 ? 1 : 1 - smooth((p - 0.5) / 0.5);
      shadowOffset = -lifted * w;
    } else {
      shadowOffset *= Math.exp(-dt * 14);
      if (Math.abs(shadowOffset) < 1e-4) shadowOffset = 0;
    }
    air += -shadowOffset;
    shadow.position.y = SHADOW_Y + shadowOffset;
    shadow.scale.setScalar(shadowRadius * 2 * (1 - Math.min(0.45, air * 1.1)));

    bubble?.update();
  }

  /** @type {ActorModel} */
  const model = {
    group,
    height,

    get facing() {
      return facing;
    },

    setFacing(dir, instant = false) {
      if (disposed || !Object.prototype.hasOwnProperty.call(FACING_ANGLE, dir)) return;
      facing = dir;
      targetYaw = FACING_ANGLE[/** @type {keyof typeof FACING_ANGLE} */ (dir)];
      if (instant) {
        group.rotation.y = targetYaw;
        turning = false;
      } else {
        turning = Math.abs(wrapAngle(targetYaw - group.rotation.y)) > 1e-4;
        if (!turning) group.rotation.y = targetYaw;
      }
    },

    setYaw(yaw, instant = false) {
      if (disposed || !Number.isFinite(yaw)) return;
      targetYaw = wrapAngle(yaw);
      const x = Math.sin(targetYaw);
      const z = Math.cos(targetYaw);
      facing = Math.abs(x) > Math.abs(z) ? (x > 0 ? 'right' : 'left') : z >= 0 ? 'down' : 'up';
      if (instant) {
        group.rotation.y = targetYaw;
        turning = false;
      } else {
        turning = Math.abs(wrapAngle(targetYaw - group.rotation.y)) > 1e-4;
        if (!turning) group.rotation.y = targetYaw;
      }
    },

    setMoving(isMoving, isRunning = false) {
      moving = !!isMoving;
      running = !!isMoving && !!isRunning;
    },

    hop() {
      if (disposed) return;
      hopT = 0;
      ctx.hop = 0;
      hopBaseY = group.position.y;
    },

    emote(kind, ms) {
      const duration = sanitizeMs(ms);
      if (disposed) return Promise.resolve();
      if (!bubble) bubble = createEmoteBubble(group, height + 0.05);
      return bubble.show(String(kind ?? '!'), duration);
    },

    update(dt) {
      if (disposed) return;
      const d = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
      try {
        step(d);
      } catch (err) {
        // One bad frame must never take the game down; report once.
        if (!model._warned) {
          model._warned = true;
          console.error('[actors] animation update failed', err);
        }
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      bubble?.dispose();
      bubble = null;
      group.removeFromParent();
      kit.dispose();
    },
  };
  Object.defineProperty(model, '_warned', { value: false, writable: true, enumerable: false });
  // Apply the rest pose immediately so a model looks right even before its first update().
  step(0);
  return model;
}
