/**
 * Original wildling designs (see docs/ARCHITECTURE.md → actors): Emberkit,
 * Brookling, Mossbun, Pipwing, Dewsnail, plus a neutral fallback "puffling".
 *
 * Each design builds its body under `k.root` (pivot at the feet, facing +z)
 * and returns its signature animation. The shared gait (bouncy hop), breathing,
 * blinking and curious head tilts live in wildlings.js.
 *
 * Design contract: designs may animate `head.rotation.x` / `head.position`,
 * but not `head.rotation.y/z` (used for glances and head tilts).
 */
import * as THREE from 'three';
import { prim } from './actor-geometry.js';
import { shade, mixColor } from './actor-materials.js';

/**
 * @typedef {object} DesignKit
 * @property {THREE.Group} root
 * @property {number} outline
 * @property {() => number} rand
 * @property {import('./actor-kit.js').ActorKit['node']} node
 * @property {import('./actor-kit.js').ActorKit['piece']} piece
 * @property {(head: THREE.Object3D, o: { x: number, y: number, z: number, w: number, h: number, d: number, yaw?: number }) => THREE.Group} eyes
 * @property {(node: THREE.Object3D) => void} blink register a node whose scale.y follows blinking
 * @property {(color: string, emissive: string, intensity?: number) => THREE.MeshToonMaterial} glowMaterial
 * @property {(parent: THREE.Object3D, p: number[], color: string, size: number, opacity?: number) => THREE.Sprite} glow
 */

/**
 * @typedef {object} GaitInfo
 * @property {number} p    hop progress 0 … 1
 * @property {number} s    airborne-ness 0 (ground) … 1 (apex)
 */

/**
 * @typedef {object} Design
 * @property {THREE.Group} head
 * @property {number} shadowRadius
 * @property {number} [hopHeight] gait hop height multiplier (default 1)
 * @property {number} [pitch] gait pitch multiplier (default 1)
 * @property {(c: import('./actor-core.js').AnimContext, g: GaitInfo) => void} animate
 */

const INK = '#2b2024';

/**
 * Small repeating timer for "every few seconds, do a short burst".
 * @param {() => number} rand @param {number} min @param {number} max @param {number} length
 */
function burst(rand, min, max, length) {
  let wait = min + rand() * (max - min);
  let t = -1;
  return {
    /** @param {number} dt @returns {number} progress 0 … 1 while active, -1 otherwise */
    update(dt) {
      if (t < 0) {
        wait -= dt;
        if (wait <= 0) t = 0;
        return t;
      }
      t += dt;
      if (t >= length) {
        t = -1;
        wait = min + rand() * (max - min);
        return -1;
      }
      return t / length;
    },
  };
}

/** @param {number} t smooth flicker noise 0 … 1 */
function flicker(t) {
  return 0.5 + 0.22 * Math.sin(t * 13.1) + 0.15 * Math.sin(t * 23.7 + 1.3) + 0.13 * Math.sin(t * 7.3 + 0.4);
}

// ---------------------------------------------------------------------------
// Emberkit — fox kit with a glowing ember tail tip.
// ---------------------------------------------------------------------------

/** @param {DesignKit} k @returns {Design} */
function emberkit(k) {
  const ORANGE = '#e8873a';
  const CREAM = '#f7e6c8';
  const DARK = '#4a2c22';
  const outline = k.outline;

  const body = k.node(k.root, [0, 0.17, 0], 'body');
  k.piece(body, { outline, name: 'body-mesh' })
    .add(prim.sphere(1), ORANGE, { s: [0.15, 0.135, 0.19], outline: true })
    .add(prim.sphere(0), CREAM, { p: [0, -0.035, 0.08], s: [0.105, 0.09, 0.11] })
    .add(prim.sphere(0), CREAM, { p: [0, 0.035, 0.135], s: [0.09, 0.085, 0.07], outline: true });

  const legs = [];
  for (const [x, z] of [[0.085, 0.1], [-0.085, 0.1], [0.085, -0.1], [-0.085, -0.1]]) {
    const leg = k.node(body, [x, -0.06, z], 'leg');
    k.piece(leg)
      .add(prim.capsule(0.034, 0.04), ORANGE, { p: [0, -0.04, 0] })
      .add(prim.sphere(0), DARK, { p: [0, -0.084, 0.012], s: [0.038, 0.026, 0.046] });
    legs.push(leg);
  }

  const head = k.node(k.root, [0, 0.355, 0.085], 'head');
  const hp = k.piece(head, { outline, name: 'head-mesh' })
    .add(prim.sphere(1), ORANGE, { s: [0.155, 0.135, 0.14], outline: true })
    .add(prim.sphere(0), CREAM, { p: [0, -0.045, 0.105], s: [0.07, 0.05, 0.065] })
    .add(prim.sphere(0), INK, { p: [0, -0.025, 0.168], s: [0.024, 0.018, 0.018] });
  for (const side of [-1, 1]) {
    hp.add(prim.sphere(0), CREAM, { p: [side * 0.1, -0.05, 0.05], s: [0.07, 0.055, 0.065], outline: true });
    hp.add(prim.torus(0.016, 0.0045, Math.PI), INK, { p: [side * 0.016, -0.062, 0.163], r: [0, 0, Math.PI] });
    hp.add(prim.sphere(0), '#ff9c86', { p: [side * 0.098, -0.03, 0.098], face: [side * 0.7, 0, 0.7], s: [0.026, 0.014, 0.01] });
  }
  k.eyes(head, { x: 0.064, y: 0.012, z: 0.118, w: 0.032, h: 0.042, d: 0.02, yaw: 0.45 });

  const ears = [];
  for (const side of [-1, 1]) {
    const ear = k.node(head, [side * 0.09, 0.08, -0.015], 'ear');
    const base = -side * 0.36;
    ear.rotation.z = base;
    k.piece(ear, { outline })
      .add(prim.cone(8), ORANGE, { p: [0, 0.085, 0], s: [0.078, 0.17, 0.04], outline: true })
      .add(prim.cone(8), '#f2c9b0', { p: [0, 0.07, 0.019], s: [0.047, 0.12, 0.012] })
      .add(prim.cone(8), DARK, { p: [0, 0.146, 0.001], s: [0.04, 0.062, 0.026] });
    ears.push({ node: ear, base, side });
  }

  const tail = k.node(body, [0, 0.03, -0.165], 'tail');
  k.piece(tail, { outline })
    .add(prim.sphere(0), ORANGE, { p: [0, 0.03, -0.035], s: [0.055, 0.06, 0.07], outline: true })
    .add(prim.sphere(1), ORANGE, { p: [0, 0.1, -0.085], s: [0.075, 0.085, 0.075], outline: true })
    .add(prim.sphere(0), CREAM, { p: [0, 0.165, -0.095], s: [0.06, 0.055, 0.06], outline: true });
  const emberMat = k.glowMaterial('#ffd27a', '#ff6a1a', 1.2);
  const ember = k.node(tail, [0, 0.205, -0.09], 'ember');
  k.piece(ember, { material: emberMat, castShadow: false, name: 'ember-mesh' }).add(prim.sphere(0), '#ffffff', { s: [0.042, 0.05, 0.042] });
  const glow = k.glow(ember, [0, 0.012, 0], '#ff9a3c', 0.22, 0.5);

  const twitch = burst(k.rand, 1.4, 4, 0.32);
  let twitchEar = 0;

  return {
    head,
    shadowRadius: 0.2,
    animate(c, g) {
      const tw = twitch.update(c.dt);
      if (tw === 0) twitchEar = k.rand() < 0.5 ? 0 : 1;
      for (let i = 0; i < ears.length; i++) {
        const e = ears[i];
        const flick = tw >= 0 && i === twitchEar ? Math.sin(tw * Math.PI * 3) * (1 - tw) * 0.45 : 0;
        e.node.rotation.x = -flick - c.move * 0.25 - c.run * 0.15;
        e.node.rotation.z = e.base - e.side * flick * 0.4;
      }
      for (let i = 0; i < legs.length; i++) {
        legs[i].rotation.x = (i < 2 ? -1 : 1) * g.s * 0.6 * c.move;
      }
      tail.rotation.z = Math.sin(c.t * 2.2) * 0.14 * (1 - c.move) + Math.sin(c.phase) * 0.22 * c.move;
      tail.rotation.x = -0.3 * c.move + Math.sin(c.t * 1.3) * 0.05;
      const f = flicker(c.t);
      emberMat.emissiveIntensity = 0.85 + f * 0.95;
      ember.scale.setScalar(0.92 + f * 0.16);
      glow.material.opacity = 0.32 + f * 0.36;
      glow.scale.setScalar(0.18 + f * 0.07);
    },
  };
}

// ---------------------------------------------------------------------------
// Brookling — axolotl-like newt with coral gill fronds.
// ---------------------------------------------------------------------------

/** @param {DesignKit} k @returns {Design} */
function brookling(k) {
  const AQUA = '#9fd8d0';
  const BELLY = '#d6f2ec';
  const CORAL = '#f2837f';
  const CORAL_TIP = '#ffb3a7';
  const FIN = '#86c9c0';
  const TOE = '#f2c4c0';
  const outline = k.outline;

  const body = k.node(k.root, [0, 0.14, -0.03], 'body');
  k.piece(body, { outline, name: 'body-mesh' })
    .add(prim.capsule(0.1, 0.13), AQUA, { r: [Math.PI / 2, 0, 0], s: [1.15, 1, 0.9], outline: true })
    .add(prim.sphere(0), BELLY, { p: [0, -0.045, 0.02], s: [0.1, 0.055, 0.15] })
    .add(prim.sphere(0), FIN, { p: [0, 0.085, -0.05], s: [0.014, 0.04, 0.12], outline: true });

  const legs = [];
  for (const [x, z] of [[0.1, 0.08], [-0.1, 0.08], [0.1, -0.08], [-0.1, -0.08]]) {
    const side = Math.sign(x);
    const leg = k.node(body, [x, -0.07, z], 'leg');
    k.piece(leg)
      .add(prim.capsule(0.028, 0.03), AQUA, { p: [side * 0.015, -0.025, 0], r: [0, 0, side * 0.5] })
      .add(prim.sphere(0), TOE, { p: [side * 0.03, -0.055, 0.01], s: [0.03, 0.016, 0.034] });
    legs.push(leg);
  }

  const tail = k.node(body, [0, 0.01, -0.2], 'tail');
  k.piece(tail, { outline })
    .add(prim.sphere(0), AQUA, { p: [0, 0, -0.06], s: [0.045, 0.06, 0.1], outline: true })
    .add(prim.sphere(0), FIN, { p: [0, 0.01, -0.13], s: [0.012, 0.075, 0.12], outline: true });

  const head = k.node(k.root, [0, 0.3, 0.11], 'head');
  const hp = k.piece(head, { outline, name: 'head-mesh' })
    .add(prim.sphere(1), AQUA, { s: [0.165, 0.12, 0.135], outline: true })
    .add(prim.sphere(0), BELLY, { p: [0, -0.05, 0.05], s: [0.12, 0.06, 0.08] })
    .add(prim.torus(0.05, 0.007, Math.PI * 0.8), '#3b4a4f', { p: [0, -0.03, 0.118], r: [0, 0, Math.PI * 1.1] });
  for (const side of [-1, 1]) {
    hp.add(prim.sphere(0), '#f5a3a0', { p: [side * 0.1, -0.03, 0.098], face: [side * 0.6, 0, 0.8], s: [0.03, 0.017, 0.012] });
  }
  k.eyes(head, { x: 0.085, y: 0.02, z: 0.105, w: 0.03, h: 0.034, d: 0.018, yaw: 0.6 });

  /** @type {{ node: THREE.Group, side: number, i: number }[]} */
  const fronds = [];
  const dir = new THREE.Vector3();
  const perp = new THREE.Vector3();
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const node = k.node(head, [side * 0.135, 0.045 - i * 0.04, -0.03 - i * 0.012], 'frond');
      const elev = 0.95 - i * 0.5;
      dir.set(side * Math.cos(elev), Math.sin(elev), -0.25).normalize();
      perp.set(0, 0, 1).cross(dir).normalize();
      const fp = k.piece(node);
      fp.add(prim.capsule(0.016, 0.09), CORAL, { p: [dir.x * 0.06, dir.y * 0.06, dir.z * 0.06], dir: [dir.x, dir.y, dir.z] });
      for (let j = 0; j < 3; j++) {
        const t = 0.045 + j * 0.035;
        const o = (j % 2 ? -1 : 1) * 0.014;
        fp.add(prim.sphere(0), j === 2 ? CORAL_TIP : CORAL, {
          p: [dir.x * t + perp.x * o, dir.y * t + perp.y * o, dir.z * t + perp.z * o],
          s: 0.022 - j * 0.002,
        });
      }
      fronds.push({ node, side, i });
    }
  }

  return {
    head,
    shadowRadius: 0.21,
    hopHeight: 0.8,
    animate(c, g) {
      for (const f of fronds) {
        const speed = 3 + c.move * 3;
        f.node.rotation.x = Math.sin(c.t * speed + f.i * 0.9 + f.side * 0.5) * (0.22 + 0.1 * c.move) + c.move * 0.25;
        f.node.rotation.z = f.side * Math.sin(c.t * 2.4 + f.i * 1.3) * 0.14;
      }
      tail.rotation.y = Math.sin(c.t * 2.2) * 0.22 * (1 - c.move) + Math.sin(c.phase) * 0.35 * c.move;
      for (let i = 0; i < legs.length; i++) {
        const side = i % 2 ? -1 : 1;
        legs[i].rotation.z = side * g.s * 0.5 * c.move;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Mossbun — round sage rabbit with a fern sprout and a tiny flower.
// ---------------------------------------------------------------------------

/** @param {DesignKit} k @returns {Design} */
function mossbun(k) {
  const SAGE = '#9cc08a';
  const PALE = '#eef3dc';
  const PINK = '#f3c4c2';
  const LEAF = '#5d9a4a';
  const LEAF_L = '#86c46a';
  const outline = k.outline;

  const body = k.node(k.root, [0, 0.18, 0], 'body');
  k.piece(body, { outline, name: 'body-mesh' })
    .add(prim.sphere(1), SAGE, { s: [0.19, 0.17, 0.185], outline: true })
    .add(prim.sphere(0), PALE, { p: [0, -0.035, 0.12], s: [0.12, 0.1, 0.08] })
    .add(prim.sphere(0), '#fffaf0', { p: [0, -0.03, -0.18], s: 0.06, outline: true });

  const backFeet = [];
  const paws = k.piece(body);
  for (const side of [-1, 1]) {
    const foot = k.node(body, [side * 0.1, -0.15, 0.02], 'foot');
    k.piece(foot).add(prim.sphere(0), shade(SAGE, 0.9), { p: [0, 0, 0.03], s: [0.05, 0.03, 0.085] });
    backFeet.push(foot);
    paws.add(prim.sphere(0), PALE, { p: [side * 0.06, -0.14, 0.14], s: 0.036 });
  }

  const head = k.node(k.root, [0, 0.33, 0.07], 'head');
  const hp = k.piece(head, { outline, name: 'head-mesh' }).add(prim.sphere(1), SAGE, { s: [0.15, 0.13, 0.135], outline: true });
  for (const side of [-1, 1]) {
    hp.add(prim.sphere(0), PALE, { p: [side * 0.075, -0.05, 0.085], s: [0.06, 0.045, 0.05], outline: true });
    hp.add(prim.torus(0.012, 0.004, Math.PI), INK, { p: [side * 0.012, -0.05, 0.128], r: [0, 0, Math.PI] });
    hp.add(prim.sphere(0), '#f7a7b0', { p: [side * 0.092, -0.025, 0.095], face: [side * 0.7, 0, 0.7], s: [0.024, 0.013, 0.008] });
  }
  k.eyes(head, { x: 0.068, y: 0.015, z: 0.108, w: 0.03, h: 0.04, d: 0.018, yaw: 0.5 });

  // Tiny flower by the right ear (character's right = −x).
  const fc = new THREE.Vector3(-0.1, 0.085, 0.035);
  const fn = new THREE.Vector3(-0.55, 0.35, 0.75).normalize();
  const fu = new THREE.Vector3(0, 1, 0).cross(fn).normalize();
  const fv = new THREE.Vector3().crossVectors(fn, fu).normalize();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const p = fc.clone().addScaledVector(fu, Math.cos(a) * 0.021).addScaledVector(fv, Math.sin(a) * 0.021);
    hp.add(prim.sphere(0), '#f6a8c4', { p: [p.x, p.y, p.z], face: [fn.x, fn.y, fn.z], s: [0.015, 0.015, 0.007] });
  }
  hp.add(prim.sphere(0), '#f7d65a', { p: [fc.x + fn.x * 0.005, fc.y + fn.y * 0.005, fc.z + fn.z * 0.005], s: 0.011 });

  const nose = k.node(head, [0, -0.015, 0.132], 'nose');
  k.piece(nose).add(prim.sphere(0), '#e98a96', { s: [0.02, 0.015, 0.014] });

  const ears = [];
  for (const side of [-1, 1]) {
    const ear = k.node(head, [side * 0.055, 0.095, -0.02], 'ear');
    k.piece(ear, { outline })
      .add(prim.capsule(0.038, 0.105), SAGE, { p: [0, 0.09, 0], s: [1, 1, 0.6], outline: true })
      .add(prim.capsule(0.024, 0.088), PINK, { p: [0, 0.09, 0.016], s: [1, 1, 0.4] });
    ears.push({ node: ear, side });
  }

  const sprout = k.node(body, [0, 0.15, -0.07], 'sprout');
  const sp = k.piece(sprout)
    .add(prim.cylinder(0.8, 6), LEAF, { p: [0, 0.035, 0], s: [0.011, 0.07, 0.011] })
    .add(prim.torus(0.014, 0.006, Math.PI * 1.5), LEAF, { p: [0, 0.084, 0], r: [0, Math.PI / 2, 0] });
  for (const a of [0.3, 2.4, 4.4]) {
    const d = new THREE.Vector3(Math.cos(a) * 0.8, 0.6, Math.sin(a) * 0.8).normalize();
    sp.add(prim.sphere(0), LEAF_L, { p: [d.x * 0.045, 0.065 + d.y * 0.045, d.z * 0.045], face: [d.x, d.y, d.z], s: [0.022, 0.009, 0.06] });
  }

  const wiggle = burst(k.rand, 1, 3.2, 0.6);

  return {
    head,
    shadowRadius: 0.22,
    hopHeight: 1.25,
    animate(c, g) {
      const w = wiggle.update(c.dt);
      const wig = w >= 0 ? Math.sin(w * Math.PI * 10) * Math.sin(w * Math.PI) : 0;
      nose.position.y = -0.015 + wig * 0.004;
      nose.scale.set(1 + wig * 0.15, 1 - wig * 0.1, 1);
      sprout.rotation.z = Math.sin(c.t * 1.7) * 0.18;
      sprout.rotation.x = Math.sin(c.t * 1.3) * 0.08 - c.move * 0.25 - g.s * 0.2 * c.move;
      for (const e of ears) {
        e.node.rotation.z = -e.side * 0.16 + Math.sin(c.t * 1.5 + e.side) * 0.04;
        e.node.rotation.x = -0.12 - c.move * 0.3 - g.s * 0.25 * c.move + Math.sin(c.t * 1.2 + e.side * 0.7) * 0.03;
      }
      for (const f of backFeet) f.rotation.x = g.s * 0.7 * c.move;
    },
  };
}

// ---------------------------------------------------------------------------
// Pipwing — plump blue-grey songbird with a butter-yellow chest.
// ---------------------------------------------------------------------------

/** @param {DesignKit} k @returns {Design} */
function pipwing(k) {
  const BLUE = '#7f93ad';
  const WING = '#5f7390';
  const CHEST = '#f3d779';
  const BEAK = '#e89a3c';
  const LEGS = '#d98a3a';
  const outline = k.outline;

  const body = k.node(k.root, [0, 0.2, 0], 'body');
  k.piece(body, { outline, name: 'body-mesh' })
    .add(prim.sphere(1), BLUE, { s: [0.155, 0.16, 0.17], outline: true })
    .add(prim.sphere(0), CHEST, { p: [0, -0.02, 0.1], s: [0.12, 0.12, 0.085], outline: true });

  const legs = [];
  for (const side of [-1, 1]) {
    const leg = k.node(body, [side * 0.05, -0.15, 0], 'leg');
    k.piece(leg)
      .add(prim.cylinder(1, 6), LEGS, { p: [0, -0.02, 0], s: [0.012, 0.045, 0.012] })
      .add(prim.sphere(0), LEGS, { p: [0, -0.04, 0.015], s: [0.022, 0.01, 0.03] });
    legs.push(leg);
  }

  const wings = [];
  for (const side of [-1, 1]) {
    const wing = k.node(body, [side * 0.145, 0.03, -0.01], 'wing');
    k.piece(wing, { outline }).add(prim.sphere(0), WING, {
      p: [side * 0.012, -0.035, -0.015],
      s: [0.028, 0.075, 0.1],
      r: [0.25, 0, -side * 0.15],
      outline: true,
    });
    wings.push({ node: wing, side });
  }

  const tail = k.node(body, [0, 0.03, -0.15], 'tail');
  k.piece(tail, { outline }).add(prim.sphere(0), WING, { p: [0, 0.03, -0.05], s: [0.06, 0.014, 0.085], r: [-0.6, 0, 0], outline: true });

  const headY = 0.355;
  const head = k.node(k.root, [0, headY, 0.035], 'head');
  const hp = k.piece(head, { outline, name: 'head-mesh' })
    .add(prim.sphere(1), BLUE, { s: [0.12, 0.115, 0.115], outline: true })
    .add(prim.cone(8), BEAK, { p: [0, -0.015, 0.125], dir: [0, 0, 1], s: [0.03, 0.065, 0.024], outline: true })
    .add(prim.cone(6), shade(BLUE, 0.85), { p: [0, 0.11, -0.005], dir: [0, 1, -0.5], s: [0.025, 0.06, 0.018], outline: true })
    .add(prim.cone(6), shade(BLUE, 0.85), { p: [0, 0.1, -0.035], dir: [0, 0.8, -0.9], s: [0.02, 0.05, 0.015], outline: true });
  for (const side of [-1, 1]) {
    hp.add(prim.sphere(0), mixColor(CHEST, '#ff9c86', 0.5), { p: [side * 0.075, -0.03, 0.075], face: [side * 0.7, 0, 0.7], s: [0.022, 0.012, 0.008] });
  }
  k.eyes(head, { x: 0.058, y: 0.02, z: 0.093, w: 0.024, h: 0.03, d: 0.015, yaw: 0.55 });

  const flutter = burst(k.rand, 2, 5, 0.5);
  const peck = burst(k.rand, 1, 3, 0.35);

  return {
    head,
    shadowRadius: 0.19,
    hopHeight: 1.1,
    animate(c, g) {
      const f = flutter.update(c.dt);
      let flap = f >= 0 ? (0.5 + 0.5 * Math.sin(f * Math.PI * 18)) * Math.sin(f * Math.PI) * 0.9 : 0;
      flap = Math.max(flap, g.s * 0.7 * c.move);
      for (const w of wings) w.node.rotation.z = w.side * (0.05 + flap);
      const pk = peck.update(c.dt);
      const bob = pk >= 0 ? Math.sin(pk * Math.PI) : 0;
      head.position.y = headY - bob * 0.022 + Math.sin(c.phase * 2) * 0.006 * c.move;
      head.rotation.x = bob * 0.35 * (1 - c.move);
      tail.rotation.x = Math.sin(c.t * 3.1) * 0.08 - g.s * 0.3 * c.move;
      for (const leg of legs) leg.rotation.x = -g.s * 0.6 * c.move;
    },
  };
}

// ---------------------------------------------------------------------------
// Dewsnail — lavender snail with a softly glowing glassy teal shell.
// ---------------------------------------------------------------------------

/** @param {DesignKit} k @returns {Design} */
function dewsnail(k) {
  const LAV = '#b9a3d6';
  const LAV_L = '#d8cbea';
  const SPIRAL = '#3a9a98';
  const outline = k.outline;

  const body = k.node(k.root, [0, 0.06, 0], 'body');
  k.piece(body, { outline, name: 'body-mesh' })
    .add(prim.capsule(0.075, 0.2), LAV, { r: [Math.PI / 2, 0, 0], s: [1.05, 1, 0.75], outline: true })
    .add(prim.sphere(0), LAV_L, { p: [0, -0.04, 0], s: [0.085, 0.022, 0.17] })
    .add(prim.capsule(0.055, 0.1), LAV, { p: [0, 0.08, 0.13], r: [0.35, 0, 0], outline: true });

  const shellNode = k.node(body, [0, 0.16, -0.05], 'shell');
  const shellMat = k.glowMaterial('#6fd0c8', '#2fb3a8', 0.35);
  k.piece(shellNode, { material: shellMat, outline, name: 'shell-mesh' }).add(prim.sphere(1), '#ffffff', { s: [0.13, 0.17, 0.17], outline: true });
  const spiral = k.piece(shellNode);
  for (const side of [-1, 1]) {
    spiral
      .add(prim.torus(0.1, 0.016), SPIRAL, { p: [side * 0.1, 0, 0], face: [side, 0, 0] })
      .add(prim.torus(0.05, 0.013), SPIRAL, { p: [side * 0.115, 0.015, -0.01], face: [side, 0, 0] })
      .add(prim.sphere(0), SPIRAL, { p: [side * 0.12, 0.02, -0.015], s: 0.016 });
  }
  k.piece(shellNode, { unlit: true, castShadow: false }).add(prim.sphere(0), '#f4fffd', { p: [0.04, 0.13, 0.08], s: [0.024, 0.014, 0.02], face: [0.2, 0.75, 0.6] });
  const glow = k.glow(shellNode, [0, 0, 0], '#7ff0e4', 0.42, 0.2);

  const head = k.node(k.root, [0, 0.22, 0.155], 'head');
  const hp = k.piece(head, { outline, name: 'head-mesh' })
    .add(prim.sphere(1), LAV, { s: [0.075, 0.07, 0.07], outline: true })
    .add(prim.torus(0.02, 0.005, Math.PI), INK, { p: [0, -0.025, 0.066], r: [0, 0, Math.PI] });
  for (const side of [-1, 1]) {
    hp.add(prim.sphere(0), '#f1a9c0', { p: [side * 0.045, -0.015, 0.055], face: [side * 0.6, 0, 0.8], s: [0.016, 0.01, 0.006] });
  }

  const stalks = [];
  for (const side of [-1, 1]) {
    const stalk = k.node(head, [side * 0.035, 0.045, 0.01], 'eye-stalk');
    k.piece(stalk, { outline })
      .add(prim.cylinder(0.8, 6), LAV, { p: [0, 0.065, 0], s: [0.012, 0.13, 0.012] })
      .add(prim.sphere(0), LAV_L, { p: [0, 0.135, 0], s: 0.03, outline: true });
    const eye = k.node(stalk, [0, 0.135, 0], 'eyes');
    k.piece(eye, { unlit: true })
      .add(prim.sphere(0), '#251c22', { p: [0, 0, 0.02], s: [0.017, 0.021, 0.013] })
      .add(prim.sphere(0), '#ffffff', { p: [0.006, 0.008, 0.031], s: 0.006 });
    k.blink(eye);
    stalks.push({ node: stalk, side });
  }

  return {
    head,
    shadowRadius: 0.2,
    hopHeight: 0.3,
    pitch: 0.4,
    animate(c, g) {
      const pulse = 0.5 + 0.5 * Math.sin(c.t * 1.6);
      shellMat.emissiveIntensity = 0.25 + pulse * 0.35;
      glow.material.opacity = 0.1 + pulse * 0.18;
      glow.scale.setScalar(0.38 + pulse * 0.05);
      for (const s of stalks) {
        s.node.rotation.z = -s.side * 0.25 + Math.sin(c.t * 1.3 + s.side * 0.8) * 0.18;
        s.node.rotation.x = Math.sin(c.t * 1.1 + s.side) * 0.12 - c.move * 0.2;
      }
      body.scale.z = 1 + g.s * 0.14 * c.move;
      shellNode.rotation.x = Math.sin(c.t * 0.9) * 0.04 - g.s * 0.08 * c.move;
      head.position.z = 0.155 + g.s * 0.02 * c.move;
    },
  };
}

// ---------------------------------------------------------------------------
// Fallback — a neutral round "puffling" for unknown species ids.
// ---------------------------------------------------------------------------

/** @param {DesignKit} k @returns {Design} */
function puffling(k) {
  const FUR = '#c9bfb2';
  const BELLY = '#efe8dc';
  const DARK = '#8f8477';
  const outline = k.outline;

  const body = k.node(k.root, [0, 0.18, 0], 'body');
  k.piece(body, { outline, name: 'body-mesh' })
    .add(prim.sphere(1), FUR, { s: [0.18, 0.17, 0.17], outline: true })
    .add(prim.sphere(0), BELLY, { p: [0, -0.04, 0.1], s: [0.12, 0.1, 0.08] });
  const feet = [];
  for (const side of [-1, 1]) {
    const foot = k.node(body, [side * 0.07, -0.16, 0.06], 'foot');
    k.piece(foot).add(prim.sphere(0), DARK, { s: [0.045, 0.025, 0.055] });
    feet.push(foot);
  }

  const head = k.node(k.root, [0, 0.24, 0], 'head');
  const hp = k.piece(head, { outline, name: 'head-mesh' })
    .add(prim.cone(8), DARK, { p: [0, 0.135, -0.01], s: [0.03, 0.06, 0.03], outline: true })
    .add(prim.torus(0.016, 0.005, Math.PI), INK, { p: [0, -0.035, 0.155], r: [0, 0, Math.PI] });
  for (const side of [-1, 1]) {
    hp.add(prim.sphere(0), FUR, { p: [side * 0.1, 0.09, -0.02], s: [0.05, 0.06, 0.04], outline: true });
    hp.add(prim.sphere(0), '#efb1a8', { p: [side * 0.1, -0.02, 0.125], face: [side * 0.6, 0, 0.8], s: [0.025, 0.014, 0.008] });
  }
  k.eyes(head, { x: 0.06, y: 0.0, z: 0.14, w: 0.03, h: 0.038, d: 0.018, yaw: 0.4 });

  return {
    head,
    shadowRadius: 0.2,
    animate(c, g) {
      for (const f of feet) f.rotation.x = g.s * 0.6 * c.move;
    },
  };
}

/** @type {Readonly<Record<string, (k: DesignKit) => Design>>} */
export const DESIGNS = Object.freeze({ emberkit, brookling, mossbun, pipwing, dewsnail });

/** Builder used for unknown species ids. */
export const FALLBACK_DESIGN = puffling;
