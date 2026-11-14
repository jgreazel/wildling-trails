/**
 * Humanoid part builders: face, every hair style, every outfit and every
 * accessory. Each function adds primitives to the pieces/nodes of a
 * HumanoidBuild context (see humanoid.js) and may register secondary-motion
 * animators. Units are world units; head-relative sizes scale with `r`.
 */
import * as THREE from 'three';
import { prim } from './actor-geometry.js';
import { mixColor, shade } from './actor-materials.js';

/** Head ellipsoid proportions (x, y, z) relative to the head radius. */
export const HEAD_SCALE = Object.freeze([1.04, 0.96, 1]);

const EYE_YAW = 0.37;
const EYE_PITCH = -0.12;
const X_AXIS = new THREE.Vector3(1, 0, 0);
const _q = new THREE.Quaternion();
const _sway = new THREE.Quaternion();
const _e = new THREE.Euler();

/**
 * @typedef {object} HumanoidBuild
 * @property {import('./actor-kit.js').ActorKit} kit
 * @property {import('./humanoid-look.js').Look} L
 * @property {import('./humanoid-look.js').BuildParams} B
 * @property {number} r head radius
 * @property {Record<string, THREE.Group>} nodes hips, spine, neck, head, eyes, armL, armR, legL, legR
 * @property {Record<string, import('./actor-geometry.js').Piece>} pieces hips, torso, head, eyes, armL, armR, legL, legR
 * @property {{ torso: THREE.Color, sleeve: THREE.Color, legs: THREE.Color, hips: THREE.Color }} colors
 * @property {number} handY hand centre in arm space
 * @property {{ rest: number, swing: number }} holdArm pose of the right (−x) arm
 * @property {Array<(c: import('./actor-core.js').AnimContext, pose: Pose) => void>} animators
 */

/**
 * @typedef {object} Pose
 * @property {number} s      sin(gait phase)
 * @property {number} legAmp current leg swing amplitude (rad)
 */

/**
 * Point on the head ellipsoid surface (head space).
 * @param {number} r @param {number} yaw @param {number} pitch @param {number} [out] extra radial offset (× r)
 * @returns {number[]}
 */
export function onHead(r, yaw, pitch, out = 0) {
  const k = r * (1 + out);
  return [
    Math.sin(yaw) * Math.cos(pitch) * HEAD_SCALE[0] * k,
    Math.sin(pitch) * HEAD_SCALE[1] * k,
    Math.cos(yaw) * Math.cos(pitch) * HEAD_SCALE[2] * k,
  ];
}

/** Outward direction for (yaw, pitch). @param {number} yaw @param {number} pitch */
export function dirOn(yaw, pitch) {
  return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
}

/** Head-space height of the eye line. @param {number} r */
export function eyeLineY(r) {
  return onHead(r, 0, EYE_PITCH)[1];
}

/**
 * Base clothing colours before outfit details are added.
 * @param {import('./humanoid-look.js').Look} L
 */
export function baseColors(L) {
  const c = { torso: L.shirt, sleeve: L.shirt, legs: L.pants, hips: L.pants };
  if (L.outfit === 'labcoat' || L.outfit === 'jacket') {
    c.torso = L.outfitColor;
    c.sleeve = L.outfitColor;
  } else if (L.outfit === 'overalls') {
    c.legs = L.outfitColor;
    c.hips = L.outfitColor;
  } else if (L.outfit === 'dress') {
    c.torso = L.outfitColor;
    c.sleeve = L.outfitColor;
    c.hips = L.outfitColor;
  }
  return c;
}

// ---------------------------------------------------------------------------
// Face
// ---------------------------------------------------------------------------

/**
 * Head sphere, nose, mouth, blush, brows and the (unlit) eyes.
 * @param {HumanoidBuild} b
 */
export function addFace(b) {
  const { r, L, B, pieces } = b;
  const head = pieces.head;
  head.add(prim.sphere(1), L.skin, { s: [HEAD_SCALE[0] * r, HEAD_SCALE[1] * r, HEAD_SCALE[2] * r], outline: true });

  const noseS = L.build === 'kid' ? 0.045 : 0.06;
  head.add(prim.sphere(0), shade(L.skin, 0.9), { p: onHead(r, 0, -0.25, -0.01), s: [noseS * r, noseS * 0.85 * r, noseS * r] });
  head.add(prim.torus(0.085 * r, 0.018 * r, Math.PI), '#6e3530', {
    p: onHead(r, 0, -0.42, -0.012),
    face: dirOn(0, -0.42),
    r: [0, 0, Math.PI],
  });
  const blush = mixColor(L.skin, '#ff6f7d', 0.42);
  for (const side of [-1, 1]) {
    head.add(prim.sphere(0), blush, {
      p: onHead(r, side * 0.66, -0.3, -0.005),
      face: dirOn(side * 0.66, -0.3),
      s: [0.13 * r, 0.075 * r, 0.03 * r],
    });
    if (L.build === 'elder') {
      head.add(prim.capsule(0.03 * r, 0.13 * r), L.hair, {
        p: onHead(r, side * EYE_YAW, 0.13, 0.02),
        face: dirOn(side * EYE_YAW, 0.13),
        r: [0, 0, Math.PI / 2 - side * 0.18],
      });
    }
  }

  // Eyes live in their own node so they can blink.
  const e = B.eye;
  const ey = eyeLineY(r);
  for (const side of [-1, 1]) {
    const [x, y, z] = onHead(r, side * EYE_YAW, EYE_PITCH);
    const d = dirOn(side * EYE_YAW, EYE_PITCH);
    const ly = y - ey;
    pieces.eyes.add(prim.sphere(0), '#2b2226', { p: [x, ly, z], face: d, s: [0.13 * e * r, 0.19 * e * r, 0.07 * r] });
    pieces.eyes.add(prim.sphere(0), '#ffffff', {
      p: [x + d[0] * 0.05 * r + 0.045 * e * r, ly + 0.07 * e * r, z + d[2] * 0.05 * r],
      s: 0.05 * e * r,
    });
    pieces.eyes.add(prim.sphere(0), '#ffffff', {
      p: [x + d[0] * 0.05 * r - 0.035 * e * r, ly - 0.08 * e * r, z + d[2] * 0.05 * r],
      s: 0.024 * e * r,
    });
  }
}

// ---------------------------------------------------------------------------
// Hair
// ---------------------------------------------------------------------------

/** @param {HumanoidBuild} b */
function hairCap(b) {
  const { r, L } = b;
  b.pieces.head.add(prim.dome(Math.PI * 0.56), L.hair, {
    p: [0, 0.02 * r, -0.02 * r],
    s: [HEAD_SCALE[0] * 1.08 * r, HEAD_SCALE[1] * 1.08 * r, 1.08 * r],
    r: [-0.38, 0, 0],
    outline: true,
  });
}

/** @param {HumanoidBuild} b @param {number} [pitch] @param {number[]} [yaws] */
function fringe(b, pitch = 0.3, yaws = [-0.36, 0, 0.36]) {
  const { r, L } = b;
  for (const yaw of yaws) {
    b.pieces.head.add(prim.sphere(0), L.hair, {
      p: onHead(r, yaw, pitch, 0.05),
      face: dirOn(yaw, pitch),
      r: [0, 0, -yaw * 0.6],
      s: [0.23 * r, 0.15 * r, 0.13 * r],
      outline: true,
    });
  }
}

/** @param {HumanoidBuild} b */
function sideburns(b) {
  const { r, L } = b;
  for (const side of [-1, 1]) {
    b.pieces.head.add(prim.sphere(0), L.hair, {
      p: onHead(r, side * 1.3, -0.1, 0.0),
      face: dirOn(side * 1.3, -0.1),
      s: [0.15 * r, 0.25 * r, 0.12 * r],
      outline: true,
    });
  }
}

/** Directions of the spikes for the spiky style (head space, normalised later). */
const SPIKES = [
  [0, 1, 0.1], [0.55, 0.8, 0.05], [-0.55, 0.8, 0.05], [0.35, 0.7, -0.6], [-0.35, 0.7, -0.6],
  [0, 0.55, -0.85], [0.85, 0.45, -0.25], [-0.85, 0.45, -0.25], [0.24, 0.72, 0.62], [-0.26, 0.68, 0.66],
];

/**
 * Hair (and hats) for every style in the contract.
 * @param {HumanoidBuild} b
 */
export function addHair(b) {
  const { r, L, kit, nodes, animators } = b;
  const head = b.pieces.head;
  const outline = b.B.outline;

  switch (L.hairStyle) {
    case 'bald': {
      if (L.build !== 'kid') {
        // A soft horseshoe of hair from ear to ear around the back of the head.
        head.add(prim.torus(0.95 * r, 0.15 * r, Math.PI * 1.16), L.hair, {
          p: [0, -0.02 * r, -0.03 * r],
          r: [-Math.PI / 2 - 0.32, 0, -Math.PI * 0.08],
          s: [HEAD_SCALE[0], 1, 1.6],
          outline: true,
        });
      }
      break;
    }
    case 'spiky': {
      hairCap(b);
      const v = new THREE.Vector3();
      for (const s of SPIKES) {
        v.set(s[0], s[1], s[2]).normalize();
        head.add(prim.cone(7), L.hair, {
          p: [v.x * HEAD_SCALE[0] * 1.1 * r, v.y * HEAD_SCALE[1] * 1.1 * r, v.z * 1.1 * r],
          dir: [v.x, v.y, v.z],
          s: [0.27 * r, 0.56 * r, 0.27 * r],
          outline: true,
        });
      }
      break;
    }
    case 'long': {
      hairCap(b);
      fringe(b);
      head.add(prim.box(1.75 * r, 1.45 * r, 0.5 * r, 0.22 * r), L.hair, { p: [0, -0.42 * r, -0.6 * r], r: [0.12, 0, 0], outline: true });
      for (const side of [-1, 1]) {
        head.add(prim.capsule(0.17 * r, 0.7 * r), L.hair, { p: [side * 0.95 * r, -0.42 * r, 0], r: [0, 0, side * 0.08], outline: true });
      }
      break;
    }
    case 'ponytail': {
      hairCap(b);
      fringe(b);
      const tie = onHead(r, Math.PI, 0.12, 0.02);
      head.add(prim.sphere(0), L.hat, { p: tie, s: 0.13 * r });
      const tail = kit.node(nodes.head, tie, 'ponytail');
      kit.piece(tail, { outline })
        .add(prim.sphere(0), L.hair, { p: [0, -0.06 * r, -0.07 * r], s: 0.17 * r, outline: true })
        .add(prim.capsule(0.13 * r, 0.5 * r), L.hair, { p: [0, -0.36 * r, -0.12 * r], r: [0.35, 0, 0], outline: true })
        .add(prim.sphere(0), L.hair, { p: [0, -0.68 * r, -0.24 * r], s: 0.15 * r, outline: true });
      animators.push((c, pose) => {
        tail.rotation.x = 0.06 + c.move * (0.12 + 0.28 * c.run) + Math.sin(c.phase * 2) * 0.06 * c.move + Math.sin(c.t * 1.4) * 0.03;
        tail.rotation.z = pose.s * 0.14 * c.move + Math.sin(c.t * 1.1) * 0.03;
      });
      break;
    }
    case 'bun': {
      hairCap(b);
      fringe(b);
      head.add(prim.sphere(1), L.hair, { p: [0, 0.9 * r, -0.38 * r], s: 0.36 * r, outline: true });
      head.add(prim.torus(0.29 * r, 0.05 * r), L.hat, { p: [0, 0.7 * r, -0.29 * r], face: [0, 0.92, -0.39] });
      break;
    }
    case 'bob': {
      hairCap(b);
      head.add(prim.sphere(1), L.hair, { p: [0, -0.07 * r, -0.18 * r], s: [1.13 * r, 0.87 * r, 1.03 * r], outline: true });
      head.add(prim.box(1.25 * r, 0.27 * r, 0.4 * r, 0.1 * r), L.hair, { p: onHead(r, 0, 0.36, -0.08), r: [-0.38, 0, 0], outline: true });
      break;
    }
    case 'cap': {
      hairCap(b);
      sideburns(b);
      head.add(prim.dome(Math.PI / 2), L.hat, {
        p: [0, 0.16 * r, -0.02 * r],
        s: [HEAD_SCALE[0] * 1.12 * r, 0.98 * r, 1.12 * r],
        r: [-0.22, 0, 0],
        outline: true,
      });
      head.add(prim.cylinder(1, 18), shade(L.hat, 0.8), {
        p: [0, 0.4 * r, 0.84 * r],
        s: [0.6 * r, 0.06 * r, 0.52 * r],
        r: [-0.08, 0, 0],
        outline: true,
      });
      head.add(prim.sphere(0), shade(L.hat, 0.82), { p: [0, 1.13 * r, -0.12 * r], s: 0.08 * r });
      break;
    }
    case 'beanie': {
      hairCap(b);
      fringe(b, 0.2, [-0.3, 0.05, 0.36]);
      const tilt = -0.18;
      head.add(prim.dome(Math.PI / 2), L.hat, {
        p: [0, 0.1 * r, -0.02 * r],
        s: [HEAD_SCALE[0] * 1.12 * r, 1.06 * r, 1.12 * r],
        r: [tilt, 0, 0],
        outline: true,
      });
      head.add(prim.torus(1.07 * r, 0.155 * r), shade(L.hat, 0.76), {
        p: [0, 0.1 * r + 0.04 * r * Math.cos(tilt), -0.02 * r + 0.04 * r * Math.sin(tilt)],
        r: [Math.PI / 2 + tilt, 0, 0],
        s: [HEAD_SCALE[0], 1, 1],
        outline: true,
      });
      const pom = kit.node(nodes.head, [0, 1.1 * r, -0.2 * r], 'pompom');
      kit.piece(pom, { outline }).add(prim.sphere(0), mixColor(L.hat, '#fff7e6', 0.5), { p: [0, 0.11 * r, 0], s: 0.25 * r, outline: true });
      animators.push((c) => {
        pom.rotation.x = -c.move * (0.15 + 0.2 * c.run) + Math.sin(c.phase * 2) * 0.16 * c.move + Math.sin(c.t * 2.1) * 0.04;
        pom.rotation.z = Math.sin(c.phase) * 0.12 * c.move + Math.sin(c.t * 1.6) * 0.04;
        if (c.hop >= 0) pom.rotation.x += Math.sin(Math.min(1, c.hop) * Math.PI * 2) * 0.35;
      });
      break;
    }
    case 'short':
    default: {
      hairCap(b);
      fringe(b);
      sideburns(b);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Outfits
// ---------------------------------------------------------------------------

/**
 * Outfit details (base colours are already applied by baseColors()).
 * @param {HumanoidBuild} b
 */
export function addOutfit(b) {
  const { L, B, kit, nodes, animators } = b;
  const torso = b.pieces.torso;
  const W = B.torsoW;
  const H = B.torsoH;
  const D = B.torsoD;
  const front = D / 2;

  switch (L.outfit) {
    case 'labcoat': {
      const coat = L.outfitColor;
      torso.add(prim.box(W * 0.28, H * 0.6, 0.03, 0.01), L.inner, { p: [0, H * 0.63, front + 0.002] });
      for (const side of [-1, 1]) {
        torso.add(prim.box(W * 0.13, H * 0.5, 0.025, 0.01), shade(coat, 0.9), { p: [side * W * 0.15, H * 0.68, front + 0.008], r: [0, 0, side * 0.32] });
      }
      torso.add(prim.box(W * 0.22, H * 0.17, 0.02, 0.006), shade(coat, 0.93), { p: [W * 0.24, H * 0.5, front + 0.006] });
      torso.add(prim.cylinder(1, 6), '#4f6d8f', { p: [W * 0.19, H * 0.62, front + 0.016], s: [0.008, 0.07, 0.008] });
      torso.add(prim.sphere(0), shade(coat, 0.82), { p: [-W * 0.13, H * 0.3, front + 0.006], s: 0.012 });
      torso.add(prim.sphere(0), shade(coat, 0.82), { p: [-W * 0.13, H * 0.14, front + 0.006], s: 0.012 });
      const L2 = B.legH * 0.62;
      const tails = kit.node(nodes.spine, [0, 0.03, 0], 'coat-tails');
      kit.piece(tails, { outline: B.outline })
        .add(prim.box(W * 0.98, L2, 0.03, 0.012), coat, { p: [0, -L2 / 2, -D * 0.42], r: [0.06, 0, 0], outline: true })
        .add(prim.box(0.03, L2, D * 0.7, 0.012), coat, { p: [W * 0.48, -L2 / 2, -0.02], r: [0, 0, 0.07], outline: true })
        .add(prim.box(0.03, L2, D * 0.7, 0.012), coat, { p: [-W * 0.48, -L2 / 2, -0.02], r: [0, 0, -0.07], outline: true });
      animators.push((c, pose) => {
        tails.rotation.x = -nodes.spine.rotation.x * 0.9 + 0.04 + c.move * (0.1 + 0.22 * c.run) + Math.abs(pose.s) * 0.06 * c.move;
        tails.rotation.z = pose.s * 0.04 * c.move;
      });
      break;
    }
    case 'apron': {
      const ap = L.outfitColor;
      torso.add(prim.box(W * 0.66, H * 0.62, 0.025, 0.01), ap, { p: [0, H * 0.5, front + 0.004] });
      torso.add(prim.box(W * 1.04, 0.03, D * 1.05, 0.012), shade(ap, 0.88), { p: [0, 0.035, 0] });
      for (const side of [-1, 1]) {
        torso.add(prim.box(0.03, 0.02, D * 1.02, 0.008), shade(ap, 0.9), { p: [side * W * 0.27, H + 0.002, 0] });
        torso.add(prim.box(0.03, H * 0.24, 0.02, 0.008), shade(ap, 0.9), { p: [side * W * 0.27, H * 0.87, front + 0.004] });
        torso.add(prim.sphere(0), shade(ap, 0.88), { p: [side * 0.035, 0.035, -front - 0.02], s: [0.04, 0.026, 0.018] });
      }
      const L2 = B.legH * 0.6;
      const skirt = kit.node(nodes.spine, [0, 0.03, front + 0.006], 'apron-skirt');
      kit.piece(skirt, { outline: B.outline })
        .add(prim.box(W * 0.82, L2, 0.025, 0.01), ap, { p: [0, -L2 / 2, 0], outline: true })
        .add(prim.box(W * 0.36, L2 * 0.3, 0.018, 0.006), shade(ap, 0.9), { p: [0, -L2 * 0.5, 0.014] });
      animators.push((c, pose) => {
        skirt.rotation.x = -nodes.spine.rotation.x * 0.9 - Math.abs(pose.s) * pose.legAmp * 0.8 - 0.04 - c.run * 0.1;
      });
      break;
    }
    case 'overalls': {
      const ov = L.outfitColor;
      torso.add(prim.box(W * 1.03, H * 0.26, D * 1.03, 0.03), ov, { p: [0, H * 0.11, 0] });
      torso.add(prim.box(W * 0.6, H * 0.5, 0.03, 0.012), ov, { p: [0, H * 0.33, front + 0.004] });
      torso.add(prim.box(W * 0.26, H * 0.15, 0.02, 0.006), shade(ov, 0.86), { p: [0, H * 0.36, front + 0.021] });
      for (const side of [-1, 1]) {
        torso.add(prim.box(0.045, H * 0.4, 0.02, 0.008), ov, { p: [side * W * 0.23, H * 0.75, front + 0.004] });
        torso.add(prim.box(0.045, 0.02, D * 1.03, 0.008), ov, { p: [side * W * 0.23, H + 0.003, 0] });
        torso.add(prim.box(0.045, H * 0.72, 0.02, 0.008), ov, { p: [side * W * 0.2, H * 0.6, -front - 0.004] });
        torso.add(prim.sphere(0), '#e8c55a', { p: [side * W * 0.23, H * 0.57, front + 0.02], s: 0.018 });
      }
      break;
    }
    case 'jacket': {
      const jk = L.outfitColor;
      torso.add(prim.box(W * 0.34, H * 0.9, 0.03, 0.01), L.inner, { p: [0, H * 0.47, front + 0.003] });
      for (const side of [-1, 1]) {
        torso.add(prim.box(0.024, H * 0.92, 0.035, 0.008), shade(jk, 0.78), { p: [side * W * 0.18, H * 0.47, front + 0.006] });
        torso.add(prim.box(W * 0.24, H * 0.16, 0.02, 0.006), shade(jk, 0.88), { p: [side * W * 0.31, H * 0.2, front + 0.006] });
      }
      torso.add(prim.box(W * 1.04, 0.04, D * 1.04, 0.015), shade(jk, 0.85), { p: [0, 0.025, 0] });
      torso.add(prim.torus(W * 0.3, 0.032), shade(jk, 0.92), { p: [0, H - 0.004, 0], r: [Math.PI / 2, 0, 0], s: [1, (D / W) * 1.2, 1] });
      if (L.accessory !== 'backpack') {
        torso.add(prim.sphere(0), jk, { p: [0, H * 0.9, -front - 0.01], s: [W * 0.38, H * 0.2, D * 0.3], outline: true });
      }
      break;
    }
    case 'dress': {
      const dr = L.outfitColor;
      const L2 = B.legH * 0.62 + 0.07;
      const skirt = kit.node(nodes.spine, [0, 0.06, 0], 'skirt');
      kit.piece(skirt, { outline: B.outline }).add(prim.cylinder(0.66, 16), dr, {
        p: [0, -L2 / 2, 0],
        s: [W * 0.8, L2, D * 1.02],
        outline: true,
      });
      torso.add(prim.box(W * 1.03, 0.035, D * 1.03, 0.012), shade(dr, 0.78), { p: [0, 0.06, 0] });
      for (const side of [-1, 1]) {
        torso.add(prim.sphere(0), '#fbf6ec', { p: [side * W * 0.13, H - 0.012, D * 0.36], s: [W * 0.17, 0.028, D * 0.2], r: [0, 0, -side * 0.3] });
      }
      animators.push((c, pose) => {
        skirt.rotation.x = -nodes.spine.rotation.x * 0.9 + c.move * (0.05 + 0.08 * c.run);
        skirt.rotation.z = pose.s * 0.05 * c.move + Math.sin(c.t * 1.3) * 0.012;
        const flare = 1 + Math.abs(pose.s) * 0.06 * c.move;
        skirt.scale.set(flare, 1, flare);
      });
      break;
    }
    default: {
      torso.add(prim.box(W * 1.03, 0.04, D * 1.03, 0.015), shade(b.colors.torso, 0.86), { p: [0, 0.022, 0] });
      torso.add(prim.torus(W * 0.27, 0.022), shade(b.colors.torso, 0.88), { p: [0, H - 0.004, 0], r: [Math.PI / 2, 0, 0], s: [1, (D / W) * 1.25, 1] });
    }
  }
}

// ---------------------------------------------------------------------------
// Accessories
// ---------------------------------------------------------------------------

/**
 * Keep `node` (a child of the right arm) upright relative to the body, then
 * apply a small sway.
 * @param {HumanoidBuild} b @param {THREE.Object3D} node @param {number} swayX @param {number} swayZ
 */
function counterRotate(b, node, swayX, swayZ) {
  const { hips, spine, armR } = b.nodes;
  _q.copy(hips.quaternion).multiply(spine.quaternion).multiply(armR.quaternion).invert();
  node.quaternion.copy(_q).multiply(_sway.setFromEuler(_e.set(swayX, 0, swayZ)));
}

/**
 * Accessory for the look (glasses, scarf, backpack or a held item).
 * @param {HumanoidBuild} b
 */
export function addAccessory(b) {
  const { L, B, r, kit, nodes, animators } = b;
  const col = L.accessoryColor;
  const W = B.torsoW;
  const H = B.torsoH;
  const D = B.torsoD;
  const k = B.item;

  switch (L.accessory) {
    case 'glasses': {
      const head = b.pieces.head;
      for (const side of [-1, 1]) {
        const p = onHead(r, side * EYE_YAW, EYE_PITCH, 0.075);
        head.add(prim.torus(0.2 * r, 0.026 * r), col, { p, face: dirOn(side * EYE_YAW, EYE_PITCH) });
        const [, y] = onHead(r, 0, EYE_PITCH);
        head.add(prim.box(0.026 * r, 0.026 * r, 0.72 * r, 0.006 * r), col, { p: [side * 0.99 * r, y + 0.03 * r, 0.43 * r], r: [0, side * 0.12, 0] });
      }
      const [, y, z] = onHead(r, 0, EYE_PITCH, 0.06);
      b.pieces.head.add(prim.cylinder(1, 6), col, { p: [0, y + 0.04 * r, z], r: [0, 0, Math.PI / 2], s: [0.02 * r, 0.2 * r, 0.02 * r] });
      break;
    }
    case 'scarf': {
      const torso = b.pieces.torso;
      torso.add(prim.torus(0.6 * r, 0.17 * r), col, { p: [0, H + 0.012, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.86, 1], outline: true });
      const tail = kit.node(nodes.spine, [0.32 * r, H, 0.5 * r], 'scarf-tail');
      kit.piece(tail, { outline: B.outline })
        .add(prim.box(0.07, H * 0.52, 0.028, 0.012), col, { p: [0, -H * 0.26, 0], outline: true })
        .add(prim.box(0.072, 0.024, 0.03, 0.006), shade(col, 1.35), { p: [0, -H * 0.32, 0] })
        .add(prim.box(0.072, 0.024, 0.03, 0.006), shade(col, 1.35), { p: [0, -H * 0.42, 0] });
      animators.push((c, pose) => {
        tail.rotation.z = pose.s * 0.16 * c.move + Math.sin(c.t * 1.2) * 0.04;
        tail.rotation.x = -0.12 - c.run * 0.25 - (c.hop >= 0 ? Math.sin(Math.min(1, c.hop) * Math.PI) * 0.4 : 0);
      });
      break;
    }
    case 'backpack': {
      const torso = b.pieces.torso;
      const bz = -(D / 2 + D * 0.22);
      torso.add(prim.box(W * 0.8, H * 0.84, D * 0.5, 0.035), col, { p: [0, H * 0.5, bz], outline: true });
      torso.add(prim.box(W * 0.84, H * 0.3, D * 0.54, 0.03), shade(col, 0.84), { p: [0, H * 0.8, bz], outline: true });
      torso.add(prim.box(W * 0.52, H * 0.3, D * 0.2, 0.02), shade(col, 0.92), { p: [0, H * 0.3, bz - D * 0.27], outline: true });
      torso.add(prim.sphere(0), '#e9e2cf', { p: [0, H * 0.66, bz - D * 0.28], s: 0.016 });
      const strap = shade(col, 0.68);
      for (const side of [-1, 1]) {
        torso.add(prim.box(0.04, H * 0.72, 0.02, 0.008), strap, { p: [side * W * 0.27, H * 0.55, D / 2 + 0.006] });
        torso.add(prim.box(0.04, 0.022, D * 1.02, 0.008), strap, { p: [side * W * 0.27, H + 0.004, -0.01] });
      }
      break;
    }
    case 'fishing-rod': {
      b.holdArm = { rest: -0.5, swing: 0.3 };
      const d = new THREE.Vector3(0, 0.77, 0.64).normalize().applyAxisAngle(X_AXIS, 0.5);
      const hand = [0, b.handY, B.armR * 0.3];
      const at = (t) => [hand[0] + d.x * t * k, hand[1] + d.y * t * k, hand[2] + d.z * t * k];
      const dir = [d.x, d.y, d.z];
      b.pieces.armR
        .add(prim.cylinder(1, 8), '#c9a06a', { p: at(0.03), dir, s: [0.017 * k, 0.14 * k, 0.017 * k] })
        .add(prim.cylinder(0.35, 8), col, { p: at(0.43), dir, s: [0.011 * k, 0.8 * k, 0.011 * k] })
        .add(prim.cylinder(1, 10), '#8f949e', { p: at(0.09).map((v, i) => v + [-0.024 * k, -0.012 * k, 0][i]), r: [0, 0, Math.PI / 2], s: [0.028 * k, 0.022 * k, 0.028 * k] });
      const line = kit.node(nodes.armR, at(0.83), 'fishing-line');
      kit.piece(line, { castShadow: false })
        .add(prim.cylinder(1, 5), '#f4f4f4', { p: [0, -0.16 * k, 0], s: [0.0035, 0.32 * k, 0.0035] })
        .add(prim.dome(Math.PI / 2), '#e0533d', { p: [0, -0.32 * k, 0], s: 0.026 * k })
        .add(prim.dome(Math.PI / 2), '#fbf6ec', { p: [0, -0.32 * k, 0], r: [Math.PI, 0, 0], s: 0.026 * k });
      animators.push((c, pose) => {
        counterRotate(b, line, Math.sin(c.t * 2.1) * 0.12 + c.move * (0.25 + 0.2 * c.run) + pose.s * 0.1 * c.move, Math.sin(c.t * 1.7) * 0.08);
      });
      break;
    }
    case 'cane': {
      b.holdArm = { rest: -0.18, swing: 0.4 };
      const shoulderY = B.legH + 0.06 + (H - B.armR * 1.5) * Math.cos(B.hunch);
      const handWorldY = shoulderY + b.handY * Math.cos(B.hunch - 0.18);
      const len = Math.max(0.1, handWorldY - 0.01);
      const R = 0.034 * k;
      const cane = kit.node(nodes.armR, [0, b.handY, 0], 'cane');
      kit.piece(cane)
        .add(prim.torus(R, 0.011 * k, Math.PI), col, { p: [0, -0.01, 0], r: [0, Math.PI / 2, 0] })
        .add(prim.cylinder(1, 8), col, { p: [0, -0.01 - len / 2, -R], s: [0.012 * k, len, 0.012 * k] })
        .add(prim.cylinder(1, 8), '#3a2a22', { p: [0, -len + 0.002, -R], s: [0.015 * k, 0.025, 0.015 * k] })
        .add(prim.sphere(0), col, { p: [0, -0.01, R], s: 0.013 * k });
      animators.push((c, pose) => counterRotate(b, cane, pose.s * 0.08 * c.move, 0));
      break;
    }
    case 'watering-can': {
      b.holdArm = { rest: -0.12, swing: 0.35 };
      const k = B.item * 1.3;
      const can = kit.node(nodes.armR, [0, b.handY, 0], 'watering-can');
      const spoutDir = [0, 0.6, 0.8];
      const sp = (t) => [0, -0.1 * k + 0.6 * t * k, 0.06 * k + 0.8 * t * k];
      kit.piece(can, { outline: B.outline })
        .add(prim.torus(0.045 * k, 0.011 * k, Math.PI), shade(col, 0.85), { p: [0, -0.035 * k, 0], r: [0, Math.PI / 2, 0] })
        .add(prim.cylinder(0.9, 14), col, { p: [0, -0.115 * k, 0], s: [0.075 * k, 0.11 * k, 0.075 * k], outline: true })
        .add(prim.torus(0.068 * k, 0.009 * k), shade(col, 0.82), { p: [0, -0.06 * k, 0], r: [Math.PI / 2, 0, 0] })
        .add(prim.cylinder(0.55, 8), col, { p: sp(0.08), dir: spoutDir, s: [0.013 * k, 0.17 * k, 0.013 * k] })
        .add(prim.cylinder(1.8, 10), shade(col, 0.82), { p: sp(0.17), dir: spoutDir, s: [0.014 * k, 0.026 * k, 0.014 * k] });
      animators.push((c, pose) => counterRotate(b, can, pose.s * 0.18 * c.move + Math.sin(c.t * 1.5) * 0.03, 0));
      break;
    }
    default:
      break;
  }
}
