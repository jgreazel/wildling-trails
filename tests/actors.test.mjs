import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHumanoid } from '../src/actors/humanoid.js';
import { createWildlingModel, WILDLING_MODEL_IDS } from '../src/actors/wildlings.js';
import { createEmoteBubble, EMOTE_KINDS, DEFAULT_EMOTE_MS, sanitizeMs } from '../src/actors/emote.js';
import { wrapAngle, hopSquash, HOP_END } from '../src/actors/actor-core.js';
import { toColor, toonVertexMaterial, outlineMaterial } from '../src/actors/actor-materials.js';
import { normalizeLook } from '../src/actors/humanoid-look.js';
import { FACING_ANGLE, PLAYER_LOOK, HOP_MS } from '../src/config.js';
import { WILDLINGS } from '../src/data/wildlings.js';

// Contract vocabulary, hard-coded from docs/ARCHITECTURE.md on purpose.
const HAIR_STYLES = ['short', 'long', 'ponytail', 'bun', 'spiky', 'bald', 'bob', 'cap', 'beanie'];
const OUTFITS = [null, 'labcoat', 'apron', 'overalls', 'jacket', 'dress'];
const BUILDS = ['adult', 'kid', 'elder'];
const ACCESSORIES = [null, 'glasses', 'scarf', 'backpack', 'fishing-rod', 'cane', 'watering-can'];
const DIRS = ['up', 'down', 'left', 'right'];
const HEIGHT_RANGE = { adult: [0.95, 1.25], kid: [0.7, 0.95], elder: [0.85, 1.2] };
const WILD_RANGE = [0.35, 0.75];
const SPECIES = ['emberkit', 'brookling', 'mossbun', 'pipwing', 'dewsnail'];

/** Box of the visible model (sprites included). */
function boxOf(model) {
  model.group.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(model.group);
}

/** Every node transform must stay finite. */
function assertFinite(model, label = '') {
  model.group.traverse((o) => {
    for (const v of [o.position.x, o.position.y, o.position.z, o.scale.x, o.scale.y, o.scale.z, o.rotation.x, o.rotation.y, o.rotation.z]) {
      assert.ok(Number.isFinite(v), `${label} non-finite transform on ${o.name || o.type}`);
    }
  });
}

/** Run `fn` while capturing console output; returns the captured calls. */
async function captureConsole(fn) {
  const calls = [];
  const saved = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    saved[level] = console[level];
    console[level] = (...args) => calls.push([level, ...args]);
  }
  try {
    await fn();
  } finally {
    Object.assign(console, saved);
  }
  return calls;
}

function run(model, seconds, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) model.update(dt);
}

function assertContract(model) {
  assert.ok(model.group instanceof THREE.Group, 'group is a THREE.Group');
  assert.equal(typeof model.height, 'number');
  assert.ok(model.height > 0);
  for (const fn of ['setFacing', 'setMoving', 'hop', 'emote', 'update', 'dispose']) {
    assert.equal(typeof model[fn], 'function', `${fn}()`);
  }
}

/** Walk, run, turn and hop for a while, checking heights stay sane. */
function exercise(model, [lo, hi], label) {
  const top = () => boxOf(model).max.y;
  const bottom = () => boxOf(model).min.y;
  assert.ok(top() >= lo && top() <= hi, `${label} rest height ${top().toFixed(3)} not in [${lo}, ${hi}]`);
  assert.ok(bottom() > -0.06, `${label} sinks below ground (${bottom().toFixed(3)})`);
  model.setMoving(true);
  for (const dir of DIRS) {
    model.setFacing(dir);
    run(model, 0.3);
  }
  model.setMoving(true, true);
  run(model, 0.5);
  model.hop();
  run(model, HOP_MS / 1000 / 2);
  assert.ok(top() <= hi * 1.25, `${label} too tall mid-hop (${top().toFixed(3)})`);
  run(model, 0.4);
  model.setMoving(false);
  run(model, 1);
  assertFinite(model, label);
  assert.ok(Math.abs(top() - model.height) < 0.12, `${label} settles near its rest height`);
}

// ---------------------------------------------------------------------------
// Humanoids
// ---------------------------------------------------------------------------

test('humanoid: contract shape and the player look', async () => {
  const calls = await captureConsole(() => {
    const player = createHumanoid(PLAYER_LOOK);
    assertContract(player);
    exercise(player, HEIGHT_RANGE.kid, 'player');
    player.dispose();
  });
  assert.deepEqual(calls, [], 'no console output in normal use');
});

test('humanoid: every hairStyle × build stays in its height range', async () => {
  const calls = await captureConsole(() => {
    for (const build of BUILDS) {
      for (const hairStyle of HAIR_STYLES) {
        const m = createHumanoid({ build, hairStyle, hair: '#7a5236', hat: '#4f6d8f' });
        assertContract(m);
        exercise(m, HEIGHT_RANGE[build], `${build}/${hairStyle}`);
        m.dispose();
      }
    }
  });
  assert.deepEqual(calls, []);
});

test('humanoid: every outfit and accessory on every build', async () => {
  const calls = await captureConsole(() => {
    for (const build of BUILDS) {
      for (const outfit of OUTFITS) {
        const m = createHumanoid({ build, outfit, outfitColor: '#7d5a7a', hairStyle: 'short' });
        exercise(m, HEIGHT_RANGE[build], `${build}/${outfit}`);
        m.dispose();
      }
      for (const accessory of ACCESSORIES) {
        const m = createHumanoid({ build, accessory, accessoryColor: '#c84b4b', hairStyle: 'bob' });
        exercise(m, HEIGHT_RANGE[build], `${build}/${accessory}`);
        m.dispose();
      }
    }
  });
  assert.deepEqual(calls, []);
});

test('humanoid: outfits and accessories actually add geometry', () => {
  const vertexCount = (m) => {
    let n = 0;
    m.group.traverse((o) => {
      if (o.isMesh) n += o.geometry.attributes.position.count;
    });
    return n;
  };
  const plain = createHumanoid({ hairStyle: 'short' });
  const base = vertexCount(plain);
  for (const outfit of OUTFITS.filter(Boolean)) {
    const m = createHumanoid({ hairStyle: 'short', outfit });
    assert.notEqual(vertexCount(m), base, `${outfit} changes the model`);
    m.dispose();
  }
  for (const accessory of ACCESSORIES.filter(Boolean)) {
    const m = createHumanoid({ hairStyle: 'short', accessory });
    assert.ok(vertexCount(m) > base, `${accessory} adds geometry`);
    m.dispose();
  }
  plain.dispose();
});

test('humanoid: builds have the right relative sizes', () => {
  const h = Object.fromEntries(BUILDS.map((b) => [b, createHumanoid({ build: b, hairStyle: 'short' })]));
  assert.ok(h.kid.height < h.elder.height && h.elder.height < h.adult.height, 'kid < elder < adult');
  assert.ok(Math.abs(h.adult.height - 1.05) < 0.08, `adult ≈ 1.05 (got ${h.adult.height.toFixed(3)})`);
  assert.ok(Math.abs(h.kid.height - 0.8) < 0.08, `kid ≈ 0.8 (got ${h.kid.height.toFixed(3)})`);
  const elderSpine = h.elder.group.getObjectByName('spine');
  assert.ok(elderSpine.rotation.x > 0.1, 'elder is hunched forward');
  Object.values(h).forEach((m) => m.dispose());
});

test('humanoid: bad or missing look values fall back quietly', async () => {
  const calls = await captureConsole(() => {
    for (const look of [undefined, null, {}, 42, 'nope', { skin: 'not-a-colour', hair: 12345678901, hairStyle: 'mohawk', outfit: 'spacesuit', build: 'giant', accessory: 'sword', outfitColor: {}, shoes: '#zzz' }]) {
      const m = createHumanoid(look);
      assertContract(m);
      exercise(m, HEIGHT_RANGE.adult, `look ${JSON.stringify(look)}`);
      m.dispose();
    }
  });
  assert.deepEqual(calls, []);
  const L = normalizeLook({ hairStyle: 'CAP', build: ' Kid ', outfit: 'Dress' });
  assert.equal(L.hairStyle, 'cap');
  assert.equal(L.build, 'kid');
  assert.equal(L.outfit, 'dress');
  const bad = normalizeLook({ hairStyle: 'mohawk', outfit: 'cape', accessory: 'sword', build: 'giant' });
  assert.deepEqual([bad.hairStyle, bad.outfit, bad.accessory, bad.build], ['short', null, null, 'adult']);
});

test('humanoid: walking swings limbs and stopping returns to rest', () => {
  const m = createHumanoid({ hairStyle: 'short' });
  const legL = m.group.getObjectByName('legL');
  const armL = m.group.getObjectByName('armL');
  const hips = m.group.getObjectByName('hips');
  run(m, 0.5);
  assert.ok(Math.abs(legL.rotation.x) < 1e-3, 'legs still at rest');
  m.setMoving(true);
  let maxLeg = 0;
  let maxArm = 0;
  let minHip = Infinity;
  for (let i = 0; i < 60; i++) {
    m.update(1 / 60);
    maxLeg = Math.max(maxLeg, Math.abs(legL.rotation.x));
    maxArm = Math.max(maxArm, Math.abs(armL.rotation.x));
    minHip = Math.min(minHip, hips.position.y);
  }
  assert.ok(maxLeg > 0.3, `legs swing (${maxLeg.toFixed(2)})`);
  assert.ok(maxArm > 0.25, `arms swing (${maxArm.toFixed(2)})`);
  assert.ok(minHip < 0.27, 'body bobs while walking');
  let walkMax = maxLeg;
  m.setMoving(true, true);
  maxLeg = 0;
  for (let i = 0; i < 60; i++) {
    m.update(1 / 60);
    maxLeg = Math.max(maxLeg, Math.abs(legL.rotation.x));
  }
  assert.ok(maxLeg > walkMax, 'running swings further than walking');
  m.setMoving(false);
  run(m, 1.2);
  assert.ok(Math.abs(legL.rotation.x) < 0.01, 'legs settle after stopping');
  m.dispose();
});

test('humanoid: blinks every few seconds', () => {
  const m = createHumanoid({ hairStyle: 'short' });
  const eyes = m.group.getObjectByName('eyes');
  let minOpen = 1;
  for (let i = 0; i < 60 * 6; i++) {
    m.update(1 / 60);
    minOpen = Math.min(minOpen, eyes.scale.y);
  }
  assert.ok(minOpen < 0.5, 'eyes closed at least once in 6 s');
  assert.ok(eyes.scale.y > 0, 'eyes never invert');
  m.dispose();
});

// ---------------------------------------------------------------------------
// Facing, hop, robustness (shared core, exercised through both model kinds)
// ---------------------------------------------------------------------------

for (const [label, make] of [
  ['humanoid', () => createHumanoid({})],
  ['wildling', () => createWildlingModel('emberkit')],
]) {
  test(`${label}: setFacing(dir, true) snaps; smooth turns take the short way`, () => {
    const m = make();
    for (const dir of DIRS) {
      m.setFacing(dir, true);
      assert.equal(m.group.rotation.y, FACING_ANGLE[dir], `instant ${dir}`);
    }
    m.setFacing('left', true);
    m.setFacing('up');
    m.update(1 / 60);
    assert.ok(m.group.rotation.y < FACING_ANGLE.left, 'left → up turns through −π (shortest path)');
    run(m, 0.6);
    assert.equal(wrapAngle(m.group.rotation.y - FACING_ANGLE.up), wrapAngle(0), 'arrives facing up');
    assert.equal(m.group.rotation.y, FACING_ANGLE.up, 'snaps exactly on arrival');
    m.setFacing('down');
    run(m, 0.6);
    assert.equal(m.group.rotation.y, 0);
    m.setFacing('sideways');
    m.setFacing(undefined);
    run(m, 0.2);
    assert.equal(m.group.rotation.y, 0, 'unknown directions are ignored');
    m.dispose();
  });

  test(`${label}: does not fight an externally set rotation until told to turn`, () => {
    const m = make();
    m.group.rotation.y = 1.234;
    run(m, 0.5);
    assert.equal(m.group.rotation.y, 1.234);
    m.dispose();
  });

  test(`${label}: hop squashes then settles, shadow stays on the ground`, () => {
    const m = make();
    const rig = m.group.getObjectByName('rig');
    const shadow = m.group.getObjectByName('blob-shadow');
    m.group.position.y = 0;
    m.hop();
    const scales = [];
    const steps = Math.ceil(((HOP_MS / 1000) * HOP_END) / (1 / 60)) + 10;
    for (let i = 0; i < steps; i++) {
      const p = (i / 60) / (HOP_MS / 1000);
      m.group.position.y = p < 1 ? Math.sin(Math.PI * p) * 0.4 : 0; // systems drive the arc
      m.update(1 / 60);
      scales.push(rig.scale.y);
      if (p > 0.1 && p < 0.45) {
        const worldShadowY = m.group.position.y + shadow.position.y;
        assert.ok(worldShadowY < 0.05, `shadow stays near the ground mid-hop (${worldShadowY.toFixed(3)})`);
      }
    }
    assert.ok(Math.min(...scales) < 0.9, 'squash');
    assert.ok(Math.max(...scales) > 1.08, 'stretch');
    run(m, 0.3);
    assert.ok(Math.abs(rig.scale.y - 1) < 1e-6, 'back to rest');
    assert.ok(Math.abs(shadow.position.y - 0.012) < 0.01, 'shadow back at the feet');
    m.dispose();
  });

  test(`${label}: survives junk dt values`, () => {
    const m = make();
    m.setMoving(true, true);
    for (const dt of [NaN, -1, 0, Infinity, 10, undefined, '0.016', 1 / 60]) m.update(dt);
    assertFinite(m, label);
    m.dispose();
  });
}

test('core helpers: wrapAngle and hopSquash', () => {
  assert.ok(Math.abs(wrapAngle(Math.PI * 3) - -Math.PI) < 1e-9);
  assert.ok(Math.abs(wrapAngle(-Math.PI / 2 - Math.PI * 2) + Math.PI / 2) < 1e-9);
  assert.equal(hopSquash(-1), 1);
  assert.equal(hopSquash(0), 1);
  assert.equal(hopSquash(HOP_END), 1);
  assert.ok(hopSquash(0.09) < 0.85);
});

// ---------------------------------------------------------------------------
// Wildlings
// ---------------------------------------------------------------------------

test('wildlings: every species in the data has a bespoke model', () => {
  for (const id of Object.keys(WILDLINGS)) assert.ok(WILDLING_MODEL_IDS.includes(id), id);
});

test('wildlings: every species (and unknown ids) builds, animates and stays in range', async () => {
  const calls = await captureConsole(() => {
    for (const id of [...SPECIES, 'not-a-wildling', '', undefined, null, 7, 'EMBERKIT']) {
      const m = createWildlingModel(/** @type {any} */ (id));
      assertContract(m);
      assert.ok(m.height >= WILD_RANGE[0] && m.height <= WILD_RANGE[1], `${id} height ${m.height.toFixed(3)}`);
      exercise(m, WILD_RANGE, `wildling ${String(id)}`);
      m.dispose();
    }
  });
  assert.deepEqual(calls, []);
});

test('wildlings: designs are distinct and the fallback is neutral', () => {
  const sizes = SPECIES.map((id) => {
    const m = createWildlingModel(id);
    const b = boxOf(m);
    const key = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map((v) => v.toFixed(2)).join('×');
    m.dispose();
    return key;
  });
  assert.equal(new Set(sizes).size, SPECIES.length, `silhouettes differ: ${sizes.join(', ')}`);
  const a = createWildlingModel('who-knows');
  const b = createWildlingModel('emberkit');
  assert.notEqual(boxOf(a).max.y.toFixed(3), boxOf(b).max.y.toFixed(3));
  assert.ok(a.group.name.includes('who-knows'));
  a.dispose();
  b.dispose();
});

test('wildlings: hop gait lifts the body while moving', () => {
  for (const id of SPECIES) {
    const m = createWildlingModel(id);
    const rig = m.group.getObjectByName('rig');
    m.setMoving(true);
    let maxLift = 0;
    for (let i = 0; i < 60; i++) {
      m.update(1 / 60);
      maxLift = Math.max(maxLift, rig.position.y);
    }
    assert.ok(maxLift > 0.01, `${id} bounces (${maxLift.toFixed(3)})`);
    m.setMoving(false);
    run(m, 1);
    assert.ok(rig.position.y < 1e-3, `${id} lands when stopped`);
    m.dispose();
  }
});

test('wildlings: signature glows animate (ember flicker, shell pulse)', () => {
  for (const [id, meshName] of [['emberkit', 'ember-mesh'], ['dewsnail', 'shell-mesh']]) {
    const m = createWildlingModel(id);
    const mesh = m.group.getObjectByName(meshName);
    assert.ok(mesh, `${id} has ${meshName}`);
    const seen = new Set();
    for (let i = 0; i < 90; i++) {
      m.update(1 / 30);
      seen.add(mesh.material.emissiveIntensity.toFixed(3));
    }
    assert.ok(seen.size > 10, `${id} glow varies over time`);
    m.dispose();
  }
});

// ---------------------------------------------------------------------------
// Emotes
// ---------------------------------------------------------------------------

test('emote: resolves after ms in Node for every kind', async () => {
  const m = createHumanoid({});
  for (const kind of EMOTE_KINDS) {
    const t0 = Date.now();
    await m.emote(kind, 40);
    assert.ok(Date.now() - t0 >= 35, `${kind} waited`);
  }
  const t0 = Date.now();
  await m.emote('!', 0);
  assert.ok(Date.now() - t0 < 30, 'ms = 0 resolves right away');
  m.dispose();
});

test('emote: a new emote resolves the previous one; dispose resolves pending ones', async () => {
  const w = createWildlingModel('mossbun');
  let firstDone = false;
  const first = w.emote('?', 5000).then(() => (firstDone = true));
  await new Promise((r) => setTimeout(r, 5));
  const second = w.emote('♥', 5000);
  await first;
  assert.ok(firstDone);
  const t0 = Date.now();
  w.dispose();
  await second;
  assert.ok(Date.now() - t0 < 50, 'dispose releases waiting scripts');
  const t1 = Date.now();
  await w.emote('!', 3000);
  assert.ok(Date.now() - t1 < 50, 'emote after dispose resolves immediately');
});

test('emote: invalid ms falls back to the default', async () => {
  assert.equal(sanitizeMs(undefined), DEFAULT_EMOTE_MS);
  assert.equal(sanitizeMs('soon'), DEFAULT_EMOTE_MS);
  assert.equal(sanitizeMs(-5), DEFAULT_EMOTE_MS);
  assert.equal(sanitizeMs(NaN), DEFAULT_EMOTE_MS);
  assert.equal(sanitizeMs(250), 250);
  assert.equal(sanitizeMs(0), 0);
  const bubble = createEmoteBubble(new THREE.Group(), 1);
  const t0 = Date.now();
  const p = bubble.show('!', /** @type {any} */ ('soon'));
  bubble.dispose();
  await p;
  assert.ok(Date.now() - t0 < DEFAULT_EMOTE_MS, 'dispose short-circuits the default wait');
});

test('emote: draws a cached canvas bubble sprite when a DOM exists', async () => {
  const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) });
  let canvases = 0;
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      canvases++;
      return { width: 0, height: 0, getContext: () => ctx2d };
    },
  };
  try {
    const m = createHumanoid({});
    const p = m.emote('♪', 120);
    const sprite = m.group.getObjectByName('emote');
    assert.ok(sprite?.isSprite, 'sprite attached to the actor group');
    assert.ok(sprite.visible);
    assert.ok(sprite.position.y > m.height, 'bubble floats above the head');
    await new Promise((r) => setTimeout(r, 60));
    m.update(1 / 60);
    assert.ok(sprite.scale.x > 0.2, 'popped in');
    await p;
    assert.equal(sprite.visible, false, 'hidden once resolved');
    await m.emote('♪', 10);
    assert.equal(canvases, 1, 'texture cached per kind');
    await m.emote('!', 10);
    assert.equal(canvases, 2);
    m.dispose();
    assert.equal(m.group.getObjectByName('emote'), undefined, 'sprite removed on dispose');
  } finally {
    delete globalThis.document;
  }
});

// ---------------------------------------------------------------------------
// Disposal and budgets
// ---------------------------------------------------------------------------

test('dispose: frees per-instance geometry, keeps shared materials, is idempotent', () => {
  for (const make of [() => createHumanoid(PLAYER_LOOK), () => createWildlingModel('emberkit'), () => createWildlingModel('dewsnail')]) {
    const m = make();
    const parent = new THREE.Group();
    parent.add(m.group);
    const geos = new Set();
    const perInstance = new Set();
    m.group.traverse((o) => {
      if (o.isMesh && o.name !== 'blob-shadow') geos.add(o.geometry);
      if ((o.isMesh || o.isSprite) && o.material && o.material !== toonVertexMaterial() && o.material !== outlineMaterial() && !['actor-unlit', 'actor-blob-shadow'].includes(o.material.name)) {
        perInstance.add(o.material);
      }
    });
    let freed = 0;
    geos.forEach((g) => g.addEventListener('dispose', () => freed++));
    let freedMats = 0;
    perInstance.forEach((mat) => mat.addEventListener('dispose', () => freedMats++));
    let sharedFreed = false;
    toonVertexMaterial().addEventListener('dispose', () => (sharedFreed = true));
    m.dispose();
    assert.equal(freed, geos.size, 'every baked geometry disposed');
    assert.equal(freedMats, perInstance.size, 'per-instance materials disposed');
    assert.equal(sharedFreed, false, 'shared toon material kept');
    assert.equal(m.group.parent, null, 'removed from its parent');
    assert.doesNotThrow(() => m.dispose());
    assert.doesNotThrow(() => m.update(1 / 60));
    assert.doesNotThrow(() => m.setFacing('up'));
    assert.doesNotThrow(() => m.hop());
  }
});

test('budgets: actors stay cheap to draw', () => {
  const count = (m) => {
    let draws = 0;
    let verts = 0;
    m.group.traverse((o) => {
      if (o.isMesh || o.isSprite) {
        draws++;
        verts += o.geometry.attributes.position.count;
      }
    });
    return { draws, verts };
  };
  for (const look of [PLAYER_LOOK, { hairStyle: 'beanie', outfit: 'labcoat', accessory: 'fishing-rod', build: 'elder' }]) {
    const m = createHumanoid(look);
    const { draws, verts } = count(m);
    assert.ok(draws <= 20, `humanoid draw calls ${draws}`);
    assert.ok(verts <= 12000, `humanoid vertices ${verts}`);
    m.dispose();
  }
  for (const id of SPECIES) {
    const m = createWildlingModel(id);
    const { draws, verts } = count(m);
    assert.ok(draws <= 22, `${id} draw calls ${draws}`);
    assert.ok(verts <= 12000, `${id} vertices ${verts}`);
    m.dispose();
  }
});

test('colours: lenient parsing never warns', async () => {
  const calls = await captureConsole(() => {
    assert.equal(toColor('#fff').getHexString(), 'ffffff');
    assert.equal(toColor('abc').getHexString(), toColor('#aabbcc').getHexString());
    assert.equal(toColor('Red').getHexString(), 'ff0000');
    assert.equal(toColor(0x00ff00).getHexString(), '00ff00');
    assert.equal(toColor('garbage', '#000000').getHexString(), '000000');
    assert.equal(toColor(undefined, 'also-garbage').getHexString(), 'ff00ff');
  });
  assert.deepEqual(calls, []);
});
