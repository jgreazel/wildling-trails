/**
 * Wildling ActorModels (partner and wild creatures).
 *
 * Wraps a species design from wildling-designs.js in the shared actor core and
 * adds what every wildling shares: a bouncy hop gait while moving, idle
 * breathing, blinking and the occasional curious head tilt / glance.
 */
import * as THREE from 'three';
import { createKit } from './actor-kit.js';
import { prim } from './actor-geometry.js';
import { createGlowToonMaterial, createGlowSpriteMaterial } from './actor-materials.js';
import { createActorShell, createActorController, measureTop } from './actor-core.js';
import { DESIGNS, FALLBACK_DESIGN } from './wildling-designs.js';

const TAU = Math.PI * 2;
const OUTLINE = 0.009;

/** Species ids with a bespoke design. */
export const WILDLING_MODEL_IDS = Object.freeze(Object.keys(DESIGNS));

/**
 * Create the model for a species id (see src/data/wildlings.js). Unknown ids
 * get a neutral round fallback creature; this never throws for bad input.
 * @param {string} speciesId
 * @returns {import('./actor-core.js').ActorModel}
 */
export function createWildlingModel(speciesId) {
  const id = typeof speciesId === 'string' ? speciesId.trim().toLowerCase() : '';
  const build = Object.prototype.hasOwnProperty.call(DESIGNS, id) ? DESIGNS[id] : FALLBACK_DESIGN;
  const rand = Math.random;
  const kit = createKit();
  const shell = createActorShell({ name: `wildling:${id || 'unknown'}` });
  const { group, rig, shadow } = shell;
  const root = kit.node(rig, [0, 0, 0], 'root');
  /** @type {THREE.Object3D[]} */
  const blinkNodes = [];

  /** @type {import('./wildling-designs.js').DesignKit} */
  const k = {
    root,
    outline: OUTLINE,
    rand,
    node: kit.node,
    piece: kit.piece,
    eyes(head, { x, y, z, w, h, d, yaw = 0.45 }) {
      const node = kit.node(head, [0, y, 0], 'eyes');
      const piece = kit.piece(node, { unlit: true, name: 'eyes-mesh' });
      for (const side of [-1, 1]) {
        const fx = side * Math.sin(yaw);
        const fz = Math.cos(yaw);
        const ex = side * x;
        piece
          .add(prim.sphere(0), '#251c22', { p: [ex, 0, z], face: [fx, 0, fz], s: [w, h, d] })
          .add(prim.sphere(0), '#ffffff', { p: [ex + fx * d * 0.7 + w * 0.3, h * 0.36, z + fz * d * 0.7], s: w * 0.36 })
          .add(prim.sphere(0), '#ffffff', { p: [ex + fx * d * 0.7 - w * 0.28, -h * 0.38, z + fz * d * 0.7], s: w * 0.17 });
      }
      blinkNodes.push(node);
      return node;
    },
    blink(node) {
      blinkNodes.push(node);
    },
    glowMaterial(color, emissive, intensity = 1) {
      return kit.own(createGlowToonMaterial(color, emissive, intensity));
    },
    glow(parent, p, color, size, opacity = 0.5) {
      const material = kit.own(createGlowSpriteMaterial(color, opacity));
      const sprite = new THREE.Sprite(material);
      sprite.name = 'glow';
      sprite.position.set(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
      sprite.scale.setScalar(size);
      sprite.renderOrder = 2;
      sprite.raycast = () => {};
      parent.add(sprite);
      return sprite;
    },
  };

  const design = build(k);
  kit.bakeAll();
  const height = measureTop(rig);
  shadow.scale.setScalar(design.shadowRadius * 2);

  const hopHeight = design.hopHeight ?? 1;
  const pitch = design.pitch ?? 1;
  const head = design.head;
  const look = { yaw: 0, yawTo: 0, tilt: 0, tiltTo: 0, timer: 1.5 + rand() * 3 };
  /** @type {import('./wildling-designs.js').GaitInfo} */
  const gait = { p: 0, s: 0 };

  /** @param {import('./actor-core.js').AnimContext} c */
  function animate(c) {
    const p = c.phase / TAU;
    const s = Math.sin(Math.PI * p);
    gait.p = p;
    gait.s = s;

    // Bouncy hop gait: rig rises, body squashes on landing and stretches in the air.
    rig.position.y = s * (0.048 + 0.028 * c.run) * hopHeight * c.move;
    const land = Math.pow(1 - s, 8);
    const breath = Math.sin(c.t * 2.6) * 0.02 * (1 - c.move);
    const sy = 1 + c.move * (0.07 * s - 0.12 * land) + breath;
    const sxz = 1 / Math.sqrt(sy);
    root.scale.set(sxz, sy, sxz);
    root.rotation.x = -Math.cos(Math.PI * p) * 0.12 * c.move * pitch;

    // Curious glances / head tilts while idle.
    if (c.move > 0.05 || c.turning) {
      look.yawTo = 0;
      look.tiltTo = 0;
      look.timer = Math.max(look.timer, 1 + rand() * 2);
    } else {
      look.timer -= c.dt;
      if (look.timer <= 0) {
        const roll = rand();
        look.yawTo = roll < 0.45 ? 0 : (rand() < 0.5 ? -1 : 1) * (0.2 + rand() * 0.25);
        look.tiltTo = rand() < 0.45 ? (rand() < 0.5 ? -1 : 1) * (0.18 + rand() * 0.12) : 0;
        look.timer = 2 + rand() * 4;
      }
    }
    const ease = 1 - Math.exp(-c.dt * 6);
    look.yaw += (look.yawTo - look.yaw) * ease;
    look.tilt += (look.tiltTo - look.tilt) * ease;
    head.rotation.y = look.yaw;
    head.rotation.z = look.tilt;

    for (const n of blinkNodes) n.scale.y = c.blink;
    design.animate(c, gait);
  }

  return createActorController({
    group,
    rig,
    shadow,
    height,
    shadowRadius: design.shadowRadius,
    kit,
    animate,
    gait: { walk: TAU * 4, run: TAU * 5.6 },
    hopStrength: 1.2,
    rand,
  });
}
