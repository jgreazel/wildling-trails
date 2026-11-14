/**
 * Chunky chibi humanoid ActorModel (player and NPCs).
 *
 * Rig (origin at the feet, facing +z at rotation 0):
 *   group ─ rig (hop squash) ─ hips ─┬ legL / legR
 *                                     └ spine ─┬ armL / armR (held items on armR)
 *                                              └ neck ─ head ─ eyes (blink)
 * Each rigid node is one merged vertex-coloured toon mesh (+ outline hull on
 * head and body), so a whole character costs roughly a dozen draw calls.
 */
import { createKit } from './actor-kit.js';
import { prim } from './actor-geometry.js';
import { shade } from './actor-materials.js';
import { createActorShell, createActorController, measureTop } from './actor-core.js';
import { normalizeLook, BUILD_PARAMS } from './humanoid-look.js';
import { addFace, addHair, addOutfit, addAccessory, baseColors, eyeLineY } from './humanoid-parts.js';

const TAU = Math.PI * 2;

/**
 * Build the humanoid rig and meshes for a look.
 * @param {import('./humanoid-look.js').Look} L
 */
function buildHumanoid(L) {
  const B = BUILD_PARAMS[L.build] ?? BUILD_PARAMS.adult;
  const r = B.headR;
  const W = B.torsoW;
  const H = B.torsoH;
  const D = B.torsoD;
  const kit = createKit();
  const shell = createActorShell({ shadowRadius: W * 0.62 + 0.04, name: 'humanoid' });
  const { rig } = shell;

  const hips = kit.node(rig, [0, B.legH, 0], 'hips');
  const spine = kit.node(hips, [0, 0.06, 0], 'spine');
  const neck = kit.node(spine, [0, H + B.neck, 0], 'neck');
  const head = kit.node(neck, [0, r * 0.9, 0], 'head');
  const eyes = kit.node(head, [0, eyeLineY(r), 0], 'eyes');
  const shoulderY = H - B.armR * 1.5;
  const shoulderX = W / 2 + B.armR * 0.45;
  const armL = kit.node(spine, [shoulderX, shoulderY, 0], 'armL');
  const armR = kit.node(spine, [-shoulderX, shoulderY, 0], 'armR');
  const legX = B.hipW * 0.26;
  const legL = kit.node(hips, [legX, 0, 0], 'legL');
  const legR = kit.node(hips, [-legX, 0, 0], 'legR');

  const colors = baseColors(L);
  /** @type {import('./humanoid-parts.js').HumanoidBuild} */
  const b = {
    kit,
    L,
    B,
    r,
    nodes: { hips, spine, neck, head, eyes, armL, armR, legL, legR },
    pieces: {
      hips: kit.piece(hips, { outline: B.outline, name: 'pelvis' }),
      torso: kit.piece(spine, { outline: B.outline, name: 'torso' }),
      head: kit.piece(head, { outline: B.outline, name: 'head-mesh' }),
      eyes: kit.piece(eyes, { unlit: true, name: 'eyes-mesh' }),
      armL: kit.piece(armL, { name: 'armL-mesh' }),
      armR: kit.piece(armR, { name: 'armR-mesh' }),
      legL: kit.piece(legL, { name: 'legL-mesh' }),
      legR: kit.piece(legR, { name: 'legR-mesh' }),
    },
    colors,
    handY: -(B.armLen - B.armR * 0.6),
    holdArm: { rest: 0, swing: 1 },
    animators: [],
  };

  // --- body -----------------------------------------------------------------
  b.pieces.hips.add(prim.box(B.hipW, 0.115, D * 0.92, 0.035), colors.hips, { p: [0, 0.03, 0], outline: true });
  b.pieces.torso.add(prim.box(W, H, D, Math.min(W, D) * 0.3), colors.torso, { p: [0, H / 2, 0], outline: true });

  const sleeveLen = -b.handY - B.armR * 0.6;
  for (const arm of [b.pieces.armL, b.pieces.armR]) {
    arm
      .add(prim.sphere(0), colors.sleeve, { s: B.armR * 1.12 })
      .add(prim.capsule(B.armR, Math.max(0.01, sleeveLen - B.armR * 2)), colors.sleeve, { p: [0, -sleeveLen / 2, 0] })
      .add(prim.sphere(0), L.skin, { p: [0, b.handY, 0], s: B.armR * 1.18 });
  }

  const legLen = B.legH - B.shoeH * 0.8;
  for (const leg of [b.pieces.legL, b.pieces.legR]) {
    leg
      .add(prim.capsule(B.legR, Math.max(0.01, legLen - B.legR * 2)), colors.legs, { p: [0, -legLen / 2, 0] })
      .add(prim.box(B.legR * 2.3, B.shoeH, B.shoeL, 0.026), L.shoes, { p: [0, -B.legH + B.shoeH / 2 + 0.008, B.shoeL * 0.2] })
      .add(prim.box(B.legR * 2.4, 0.018, B.shoeL * 1.03, 0.006), shade(L.shoes, 0.7), { p: [0, -B.legH + 0.009, B.shoeL * 0.2] });
  }

  addFace(b);
  addHair(b);
  addOutfit(b);
  addAccessory(b);
  kit.bakeAll();

  return { ...shell, kit, b, B, height: measureTop(rig) };
}

/**
 * Create a humanoid ActorModel from an NPC/player `look`
 * (`{ skin, hair, hairStyle, hat?, shirt, pants, shoes, outfit?, outfitColor?,
 * build, accessory?, accessoryColor? }`). Missing or unknown values fall back
 * to sensible defaults; this never throws for bad input.
 * @param {object} [look]
 * @returns {import('./actor-core.js').ActorModel}
 */
export function createHumanoid(look = {}) {
  const L = normalizeLook(look);
  const { group, rig, shadow, kit, b, B, height } = buildHumanoid(L);
  const { hips, spine, neck, eyes, armL, armR, legL, legR } = b.nodes;
  const torsoMesh = spine.getObjectByName('torso');
  const neckY = neck.position.y;
  const rand = Math.random;
  const held = b.holdArm;
  /** @type {import('./humanoid-parts.js').Pose} */
  const pose = { s: 0, legAmp: 0 };
  const glance = { yaw: 0, yawTo: 0, tilt: 0, tiltTo: 0, timer: 2 + rand() * 4 };
  const kidPace = L.build === 'kid' ? 1.1 : 1;

  /** @param {import('./actor-core.js').AnimContext} c */
  function animate(c) {
    const s = Math.sin(c.phase);
    const co = Math.cos(c.phase);
    const still = 1 - c.move;
    const legAmp = (0.55 + 0.32 * c.run) * c.move * B.amp;
    const armAmp = (0.45 + 0.5 * c.run) * c.move * B.amp;
    pose.s = s;
    pose.legAmp = legAmp;

    // Legs and arms swing in opposition.
    legL.rotation.x = s * legAmp;
    legR.rotation.x = -s * legAmp;
    const hopK = c.hop >= 0 ? Math.sin(Math.min(1, c.hop) * Math.PI) : 0;
    const breath = Math.sin(c.t * 2.3);
    armL.rotation.x = -s * armAmp - hopK * 0.3;
    armR.rotation.x = held.rest + s * armAmp * held.swing - hopK * 0.3 * held.swing;
    const out = 0.09 + breath * 0.012 * still + c.run * 0.12 + hopK * 0.6;
    armL.rotation.z = out;
    armR.rotation.z = -(0.09 + breath * 0.012 * still + c.run * 0.12 * held.swing + hopK * 0.6 * held.swing);

    // Body bob keeps the planted foot on the ground; running adds bounce.
    const swing = Math.abs(s) * legAmp;
    hips.position.y = B.legH - B.legH * (1 - Math.cos(swing)) * 0.92 + c.run * Math.abs(co) * 0.022;
    hips.rotation.y = s * 0.07 * c.move;
    spine.rotation.y = -s * 0.1 * c.move;
    spine.rotation.x = B.hunch + c.move * 0.04 + c.run * 0.14;
    spine.rotation.z = Math.sin(c.t * 0.9) * 0.012 * still;

    // Idle breathing.
    const br = breath * 0.014 * (1 - 0.6 * c.move);
    if (torsoMesh) torsoMesh.scale.set(1 + br * 0.5, 1 + br, 1 + br * 0.5);
    neck.position.y = neckY * (1 + br * 0.6);

    // Idle glances (look around now and then while standing).
    if (c.move > 0.05 || c.turning) {
      glance.yawTo = 0;
      glance.tiltTo = 0;
      glance.timer = Math.max(glance.timer, 1.5 + rand() * 2);
    } else {
      glance.timer -= c.dt;
      if (glance.timer <= 0) {
        const roll = rand();
        glance.yawTo = roll < 0.4 ? 0 : (rand() < 0.5 ? -1 : 1) * (0.22 + rand() * 0.2);
        glance.tiltTo = rand() < 0.3 ? (rand() - 0.5) * 0.24 : 0;
        glance.timer = 2.5 + rand() * 4.5;
      }
    }
    const ease = 1 - Math.exp(-c.dt * 5);
    glance.yaw += (glance.yawTo - glance.yaw) * ease;
    glance.tilt += (glance.tiltTo - glance.tilt) * ease;
    neck.rotation.x = -B.hunch * 0.75 - c.run * 0.1 + Math.abs(co) * 0.035 * c.move;
    neck.rotation.y = glance.yaw;
    neck.rotation.z = glance.tilt + Math.sin(c.t * 1.1) * 0.015 * still;

    eyes.scale.y = c.blink;

    for (const a of b.animators) a(c, pose);
  }

  return createActorController({
    group,
    rig,
    shadow,
    height,
    shadowRadius: B.torsoW * 0.62 + 0.04,
    kit,
    animate,
    gait: { walk: TAU * 2.1 * kidPace, run: TAU * 3.6 * kidPace },
    hopStrength: 0.85,
    rand,
  });
}
