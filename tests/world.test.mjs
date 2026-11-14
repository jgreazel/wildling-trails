import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildMap } from '../src/world/build-map.js';
import { createMapModel } from '../src/world/map-utils.js';
import { MAP_IDS, getMapDef } from '../src/world/map-registry.js';
import { TILE_TYPES } from '../src/world/tiles.js';
import { OBJECT_DEFAULTS } from '../src/world/map-utils.js';
import { getTimePhase, createDayNight, BLEND_SECONDS } from '../src/render/daynight.js';
import { createCameraRig, OUTDOOR_OFFSET } from '../src/render/camera-rig.js';
import { getToonGradient, toon, createMaterialKit, hash2, noise2, rng } from '../src/render/materials.js';
import { PALETTE } from '../src/render/palette.js';
import { KNOWN_OBJECT_TYPES } from '../src/world/builders/objects.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Rich outdoor map using every outdoor tile char and every outdoor object type. */
function outdoorFixture() {
  const W = 28;
  const H = 22;
  const g = Array.from({ length: H }, (_, y) =>
    Array.from({ length: W }, (_, x) => (x === 0 || y === 0 || x === W - 1 || y === H - 1 ? 'T' : '.')),
  );
  const hts = Array.from({ length: H }, () => Array(W).fill('0'));
  const set = (x, y, c) => (g[y][x] = c);
  const fill = (x0, y0, x1, y1, c) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c);
  };
  const lvl = (x0, y0, x1, y1, l) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) hts[y][x] = String(l);
  };
  fill(1, 10, 26, 10, ','); // main path
  fill(14, 11, 14, 21, ','); // south road leaving the map
  fill(3, 11, 8, 13, ':'); // cobble plaza
  fill(20, 18, 23, 19, '_'); // sand
  fill(2, 2, 5, 3, 'f'); // flowers
  fill(9, 2, 13, 4, '"'); // tall grass
  fill(3, 14, 5, 21, '~'); // river to the south edge
  fill(3, 17, 5, 17, '='); // bridge across it
  fill(16, 2, 20, 2, 'h'); // hedge row
  set(23, 3, 'R');
  set(24, 4, 'R');
  fill(16, 6, 20, 6, 'F'); // fence with a corner
  fill(16, 7, 16, 8, 'F');
  set(1, 1, '#');
  // Plateau (level 1) with a level-2 corner, stairs, ledges and a waterfall.
  lvl(21, 1, 26, 7, 1);
  lvl(25, 1, 26, 2, 2);
  set(23, 8, 'S');
  set(21, 4, '<');
  set(25, 7, 'v');
  set(26, 5, '~');
  set(26, 6, '~');
  set(26, 7, '~');
  set(26, 8, '~');
  set(26, 9, '~');
  set(12, 12, '>');
  // Building footprints.
  const buildings = [
    { variant: 'cottage', x: 2, y: 5, w: 4, h: 3, door: { x: 3, y: 7 } },
    { variant: 'house', x: 8, y: 5, w: 5, h: 3, door: { x: 10, y: 7 }, roof: '#7d5a7a' },
    { variant: 'greenhouse', x: 16, y: 13, w: 6, h: 4, door: { x: 18, y: 16 } },
    { variant: 'mill', x: 6, y: 14, w: 3, h: 3, door: { x: 7, y: 16 } },
  ];
  for (const b of buildings) {
    fill(b.x, b.y, b.x + b.w - 1, b.y + b.h - 1, '#');
    set(b.door.x, b.door.y, 'D');
  }
  const tiles = g.map((r) => r.join(''));
  return {
    id: 'fixture-town',
    name: 'Fixture Town',
    kind: 'outdoor',
    tiles,
    heights: hts.map((r) => r.join('')),
    spawn: { x: 14, y: 10, facing: 'down' },
    objects: [
      ...buildings.map((b, i) => ({ type: 'building', id: `b${i}`, ...b })),
      { type: 'bigtree', id: 'oak', x: 24, y: 15 },
      { type: 'sign', id: 'sign', x: 13, y: 8, text: 'Hello', hideIf: 'sign_gone' },
      { type: 'mailbox', id: 'mail', x: 7, y: 8 },
      { type: 'lamp', id: 'lamp1', x: 6, y: 9 },
      { type: 'lamp', id: 'lamp2', x: 15, y: 9 },
      { type: 'lamp', id: 'lamp3', x: 20, y: 11, showIf: 'lamps_on' },
      { type: 'barrel', id: 'barrel', x: 1, y: 8 },
      { type: 'crate', id: 'crate', x: 1, y: 9 },
      { type: 'flowerpot', id: 'pot', x: 12, y: 8 },
      { type: 'stump', id: 'stump', x: 20, y: 9 },
      { type: 'statue', id: 'statue', x: 9, y: 12, species: 'mossbun', showIf: '!has_partner' },
      { type: 'well', id: 'well', x: 10, y: 12 },
      { type: 'bench', id: 'bench', x: 4, y: 13, facing: 'up' },
      { type: 'logpile', id: 'logs', x: 9, y: 8 },
      { type: 'waterwheel', id: 'wheel', x: 5, y: 14 },
      { type: 'lilypad', id: 'lily1', x: 4, y: 19 },
      { type: 'lilypad', id: 'lily2', x: 3, y: 20, hideIf: 'pond_cleared' },
      { type: 'gizmo', id: 'mystery-outdoor', x: 19, y: 9 },
    ],
  };
}

/** Indoor map using every indoor char and every indoor object type. */
function indoorFixture() {
  return {
    id: 'fixture-room',
    name: 'Fixture Room',
    kind: 'indoor',
    tiles: [
      'WWWWWWWWWWWW',
      'WoooooottttW',
      'WoooooottttW',
      'WoooooottttW',
      'WoooooottttW',
      'WoooooottttW',
      'WoooooottttW',
      'WWWWWEWWWWWW',
      '            ',
    ],
    spawn: { x: 5, y: 6, facing: 'up' },
    objects: [
      { type: 'bed', id: 'bed', x: 1, y: 1, color: '#c8643b' },
      { type: 'bookshelf', id: 'books', x: 3, y: 1 },
      { type: 'fireplace', id: 'fire', x: 5, y: 1 },
      { type: 'desk', id: 'desk', x: 8, y: 1 },
      { type: 'stove', id: 'stove', x: 10, y: 1 },
      { type: 'table', id: 'table', x: 3, y: 3 },
      { type: 'sink', id: 'sink', x: 6, y: 3 },
      { type: 'counter', id: 'counter', x: 7, y: 3, w: 3 },
      { type: 'terminal', id: 'term', x: 10, y: 3 },
      { type: 'chair', id: 'chair', x: 3, y: 4, facing: 'right' },
      { type: 'cupboard', id: 'cup', x: 1, y: 4 },
      { type: 'stool', id: 'stool', x: 6, y: 5 },
      { type: 'planter', id: 'planter', x: 8, y: 5 },
      { type: 'machine', id: 'machine', x: 10, y: 5 },
      { type: 'rug', id: 'rug', x: 3, y: 5, w: 2, h: 2 },
      { type: 'plant', id: 'plant', x: 1, y: 6 },
      { type: 'radio', id: 'radio', x: 2, y: 6 },
      { type: 'pedestal', id: 'p1', x: 7, y: 6, species: 'emberkit', emptyIf: 'took_emberkit' },
      { type: 'pedestal', id: 'p2', x: 8, y: 6, species: 'brookling', emptyIf: ['took_brookling', 'all_taken'] },
      { type: 'pedestal', id: 'p3', x: 9, y: 6, species: 'mossbun', emptyIf: 'took_mossbun', hideIf: 'lab_closed' },
      { type: 'mystery-box', id: 'mystery-indoor', x: 10, y: 6 },
    ],
  };
}

/** Fake actor factory recording calls. */
function fakeWildlings() {
  const made = [];
  const create = (species) => {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 4), new THREE.MeshBasicMaterial());
    group.add(mesh);
    const model = {
      species,
      group,
      height: 0.5,
      updates: 0,
      disposed: false,
      update() {
        this.updates++;
      },
      dispose() {
        this.disposed = true;
        mesh.geometry.dispose();
        mesh.material.dispose();
      },
    };
    made.push(model);
    return model;
  };
  return { made, create };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Draw-call estimate: visible renderables (excluding injected actor models). */
function drawCalls(root, exclude = new Set()) {
  let n = 0;
  const walk = (o) => {
    if (!o.visible || exclude.has(o)) return;
    if (o.isMesh || o.isPoints || o.isLine || o.isSprite) n++;
    for (const c of o.children) walk(c);
  };
  walk(root);
  return n;
}

function triangles(root) {
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const count = g.index ? g.index.count : g.attributes.position.count;
    const inst = o.isInstancedMesh ? o.count : g.isInstancedBufferGeometry ? g.instanceCount : 1;
    n += (count / 3) * inst;
  });
  return n;
}

function assertFiniteGeometry(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position.array;
    for (let i = 0; i < pos.length; i++) assert.ok(Number.isFinite(pos[i]), `NaN in ${o.name}`);
  });
}

function findByName(root, name) {
  let found = null;
  root.traverse((o) => {
    if (!found && o.name === name) found = o;
  });
  return found;
}

/** Capture console.warn / console.error during fn. */
async function capture(fn) {
  const warn = console.warn;
  const error = console.error;
  const logs = { warn: [], error: [] };
  console.warn = (...a) => logs.warn.push(a.join(' '));
  console.error = (...a) => logs.error.push(a.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.warn = warn;
    console.error = error;
  }
  return logs;
}

const NIGHT = { nightFactor: 1, focus: new THREE.Vector3(14, 0, 10), playerPos: { x: 14, y: 0, z: 10 } };
const DAY = { nightFactor: 0, focus: new THREE.Vector3(14, 0, 10), playerPos: { x: 14, y: 0, z: 10 } };

// ---------------------------------------------------------------------------
// Fixture coverage sanity
// ---------------------------------------------------------------------------

test('fixtures cover every tile char and every object type', () => {
  const chars = new Set([...outdoorFixture().tiles.join(''), ...indoorFixture().tiles.join('')]);
  for (const ch of Object.keys(TILE_TYPES)) assert.ok(chars.has(ch), `tile "${ch}" missing from fixtures`);
  const types = new Set([...outdoorFixture().objects, ...indoorFixture().objects].map((o) => o.type));
  for (const t of Object.keys(OBJECT_DEFAULTS)) assert.ok(types.has(t), `object type "${t}" missing`);
  for (const t of Object.keys(OBJECT_DEFAULTS)) assert.ok(KNOWN_OBJECT_TYPES.includes(t), `no builder for "${t}"`);
});

// ---------------------------------------------------------------------------
// Map building
// ---------------------------------------------------------------------------

test('every registered map builds, updates and disposes', async () => {
  const logs = await capture(() => {
    for (const id of MAP_IDS) {
      const model = createMapModel(getMapDef(id));
      const { create } = fakeWildlings();
      const view = buildMap(model, { flags: {}, createWildlingModel: create });
      assert.ok(view.group instanceof THREE.Group);
      view.update(0.016, 1, DAY);
      view.update(0.016, 1.016, NIGHT);
      view.applyFlags({ has_partner: true });
      view.rustleGrass(model.spawn.x, model.spawn.y);
      assert.ok(drawCalls(view.group) < 150, `${id}: too many draw calls`);
      assertFiniteGeometry(view.group);
      view.dispose();
      view.dispose(); // idempotent
      view.update(0.016, 2, DAY); // no-op after dispose
    }
  });
  assert.deepEqual(logs.error, []);
});

test('rich outdoor fixture builds within budget', async () => {
  const model = createMapModel(outdoorFixture());
  let view;
  const t0 = performance.now();
  const logs = await capture(() => {
    view = buildMap(model, { flags: {} });
  });
  const ms = performance.now() - t0;
  assert.deepEqual(logs.error, [], 'no errors while building');
  assert.equal(logs.warn.filter((w) => w.includes('gizmo')).length, 1, 'one warning for the unknown type');
  assert.ok(ms < 3000, `build took ${ms.toFixed(0)} ms`);

  const calls = drawCalls(view.group);
  assert.ok(calls < 150, `draw calls ${calls}`);
  assert.ok(calls >= 8, `suspiciously few draw calls (${calls})`);
  const tris = triangles(view.group);
  assert.ok(tris < 600_000, `triangles ${tris}`);
  assertFiniteGeometry(view.group);

  // Key pieces exist.
  for (const name of ['water', 'tallgrass', 'halos', 'lilypads', 'flower-petals', 'fireflies', 'butterflies', 'chimney-smoke']) {
    assert.ok(findByName(view.group, name), `missing ${name}`);
  }
  assert.ok(view.group.children.some((c) => c.name.startsWith('trees')), 'trees');
  const lights = [];
  view.group.traverse((o) => o.isPointLight && lights.push(o));
  assert.ok(lights.length >= 1 && lights.length <= 3, `point lights ${lights.length}`);

  // Sensible bounds: map area covered, nothing flying off.
  const box = new THREE.Box3();
  view.group.traverse((o) => {
    if (o.isMesh && o.name === 'batch:solid') box.union(new THREE.Box3().setFromBufferAttribute(o.geometry.attributes.position));
  });
  assert.ok(box.min.x <= -10 && box.max.x >= 27 + 10, 'skirt extends ≥ 10 tiles west/east');
  assert.ok(box.min.z <= -10 && box.max.z >= 21 + 10, 'skirt extends ≥ 10 tiles north/south');
  assert.ok(box.min.y > -2 && box.max.y < 8, `height range ${box.min.y}..${box.max.y}`);

  // Day / night.
  view.update(0.016, 10, DAY);
  const glowMesh = findByName(view.group, 'batch:glow');
  assert.ok(glowMesh, 'window/lamp glow batch');
  assert.equal(glowMesh.material.emissiveIntensity, 0);
  for (let i = 0; i < 20; i++) view.update(0.05, 10.5 + i * 0.05, NIGHT); // lights fade in
  assert.ok(glowMesh.material.emissiveIntensity > 1, 'windows glow at night');
  assert.equal(findByName(view.group, 'fireflies').visible, true);
  assert.equal(findByName(view.group, 'butterflies').visible, false);
  assert.ok(lights.some((l) => l.intensity > 0), 'a lamp lights the ground at night');

  // Flags: conditional statue and lamp toggle, lily pad hides.
  const statue = findByName(view.group, 'object:statue');
  const lamp3 = findByName(view.group, 'object:lamp3');
  assert.equal(statue.visible, true);
  assert.equal(lamp3.visible, false);
  view.applyFlags({ has_partner: true, lamps_on: true, pond_cleared: true });
  assert.equal(statue.visible, false);
  assert.equal(lamp3.visible, true);
  const lilies = findByName(view.group, 'lilypads');
  const m = new THREE.Matrix4();
  lilies.getMatrixAt(1, m);
  assert.equal(new THREE.Vector3().setFromMatrixScale(m).x, 0, 'hidden lily pad');
  lilies.getMatrixAt(0, m);
  assert.ok(new THREE.Vector3().setFromMatrixScale(m).x > 0.5, 'visible lily pad');

  // Rustle: shake starts, then settles after ~0.45 s.
  const grass = findByName(view.group, 'tallgrass');
  const rustle = grass.geometry.getAttribute('aRustle');
  view.rustleGrass(10, 3);
  view.update(0.05, 11, DAY);
  assert.ok(Math.max(...rustle.array) > 0.5, 'rustling');
  for (let i = 0; i < 12; i++) view.update(0.05, 11 + i * 0.05, DAY);
  assert.equal(Math.max(...rustle.array), 0, 'settled');
  view.rustleGrass(1, 1); // not tall grass: ignored
  view.rustleGrass(-5, 999); // out of bounds: ignored

  // Waterwheel turns.
  const wheel = findByName(view.group, 'waterwheel:wheel');
  const before = wheel.rotation.x;
  view.update(0.1, 12, DAY);
  assert.notEqual(wheel.rotation.x, before);

  // Dispose frees geometry.
  const geos = new Set();
  view.group.traverse((o) => o.isMesh && geos.add(o.geometry));
  let freed = 0;
  for (const g of geos) g.addEventListener('dispose', () => freed++);
  let instancedFreed = 0;
  let instancedTotal = 0;
  view.group.traverse((o) => {
    if (!o.isInstancedMesh) return;
    instancedTotal++;
    o.addEventListener('dispose', () => instancedFreed++);
  });
  view.dispose();
  assert.equal(freed, geos.size, 'every geometry disposed');
  assert.equal(instancedFreed, instancedTotal, 'instance buffers freed');
  assert.equal(view.group.children.length, 0);
});

test('unknown object types warn only once per type', async () => {
  const logs = await capture(() => {
    buildMap(createMapModel(outdoorFixture()), {}).dispose();
  });
  assert.equal(logs.warn.filter((w) => w.includes('gizmo')).length, 0);
});

test('indoor fixture: walls, furniture, pedestal creatures and flags', async () => {
  const model = createMapModel(indoorFixture());
  const { made, create } = fakeWildlings();
  let view;
  const logs = await capture(() => {
    view = buildMap(model, { flags: { took_brookling: true }, createWildlingModel: create });
  });
  assert.deepEqual(logs.error, []);
  assert.equal(made.length, 3);
  const excluded = new Set(made.map((m) => m.group));
  const calls = drawCalls(view.group, excluded);
  assert.ok(calls < 60, `indoor draw calls ${calls}`);
  assertFiniteGeometry(view.group);

  const [ember, brook, moss] = made;
  assert.equal(ember.group.visible, true);
  assert.equal(brook.group.visible, false, 'emptyIf hides the taken partner');
  assert.ok(Math.abs(ember.group.position.y - 0.62) < 1e-6, 'creature stands on the plinth');
  assert.ok(Math.abs(ember.group.position.x - 7) < 1e-6 && Math.abs(ember.group.position.z - 6) < 1e-6);

  view.update(0.016, 1, { nightFactor: 0 });
  view.update(0.016, 1.1, { nightFactor: 1 });
  assert.ok(ember.updates >= 2, 'idle animation driven by update');
  assert.equal(brook.updates, 0, 'hidden creatures are not animated');

  view.applyFlags({ took_emberkit: true, lab_closed: true });
  assert.equal(ember.group.visible, false);
  assert.equal(brook.group.visible, true);
  assert.equal(moss.group.visible, false, 'hideIf on the pedestal hides its creature');
  assert.equal(findByName(view.group, 'object:p3').visible, false);

  // Back wall is tall, side walls are low.
  const solid = findByName(view.group, 'batch:solid');
  const bb = new THREE.Box3().setFromBufferAttribute(solid.geometry.attributes.position);
  assert.ok(bb.max.y >= 2.2 && bb.max.y < 3, `wall height ${bb.max.y}`);
  assert.ok(bb.min.y >= -0.61, 'slab bottom');
  // Fireplace flames flicker and a real light exists.
  const flames = findByName(view.group, 'flames:fire');
  const s0 = flames.scale.y;
  view.update(0.05, 2.3, { nightFactor: 0 });
  assert.notEqual(flames.scale.y, s0);
  const lights = [];
  view.group.traverse((o) => o.isPointLight && lights.push(o));
  assert.ok(lights.length > 0 && lights.length <= 2);
  assert.ok(lights.some((l) => l.intensity > 0), 'fireplace light on indoors by day');

  view.dispose();
  assert.ok(made.every((m) => m.disposed), 'pedestal models disposed');
});

test('pedestals without a model factory still build', async () => {
  const logs = await capture(() => {
    const view = buildMap(createMapModel(indoorFixture()), {});
    view.update(0.016, 1, {});
    view.update(NaN, undefined, undefined);
    view.dispose();
  });
  assert.deepEqual(logs.error, []);
});

test('a throwing wildling factory is contained', async () => {
  const logs = await capture(() => {
    const view = buildMap(createMapModel(indoorFixture()), {
      createWildlingModel: () => {
        throw new Error('boom');
      },
    });
    view.update(0.016, 1, {});
    view.dispose();
  });
  assert.equal(logs.error.length, 3);
});

test('shader patches hit their anchors in the real three.js shaders', () => {
  const view = buildMap(createMapModel(outdoorFixture()), {});
  const fakeShader = (lib) => ({
    uniforms: {},
    vertexShader: THREE.ShaderLib[lib].vertexShader,
    fragmentShader: THREE.ShaderLib[lib].fragmentShader,
  });
  const water = findByName(view.group, 'water').material;
  const ws = fakeShader('lambert');
  water.onBeforeCompile(ws);
  assert.ok(ws.vertexShader.includes('attribute float aShore'));
  assert.ok(ws.vertexShader.includes('vWtShore = aShore'));
  assert.ok(ws.fragmentShader.includes('wtFoam'));
  assert.ok(ws.fragmentShader.includes('totalEmissiveRadiance += vec3(0.16'));
  assert.ok(ws.uniforms.uTime && ws.uniforms.uFoam);

  const grass = findByName(view.group, 'tallgrass').material;
  const gs = fakeShader('toon');
  grass.onBeforeCompile(gs);
  assert.ok(gs.vertexShader.includes('attribute float aRustle'));
  assert.ok(gs.vertexShader.includes('wtWind'));
  assert.ok(gs.fragmentShader.includes('wtCloud(vWtCloud)'));

  const solid = findByName(view.group, 'batch:solid').material;
  const ss = fakeShader('toon');
  solid.onBeforeCompile(ss);
  assert.ok(ss.fragmentShader.includes('diffuseColor.rgb *= 1.0 - wtCloud'));
  assert.notEqual(solid.customProgramCacheKey(), grass.customProgramCacheKey());

  const bf = findByName(view.group, 'butterflies').material;
  const bs = fakeShader('toon');
  bf.onBeforeCompile(bs);
  assert.ok(bs.vertexShader.includes('attribute float aFlap'));

  const halo = findByName(view.group, 'halos').material;
  assert.ok(halo.fragmentShader.includes('#include <colorspace_fragment>'));
  assert.ok(THREE.ShaderChunk.colorspace_fragment && THREE.ShaderChunk.tonemapping_fragment);
  view.dispose();
});

test('builds are deterministic', () => {
  const a = buildMap(createMapModel(outdoorFixture()), {});
  const b = buildMap(createMapModel(outdoorFixture()), {});
  const pa = findByName(a.group, 'batch:solid').geometry.attributes.position.array;
  const pb = findByName(b.group, 'batch:solid').geometry.attributes.position.array;
  assert.equal(pa.length, pb.length);
  assert.deepEqual(pa.slice(0, 600), pb.slice(0, 600));
  a.dispose();
  b.dispose();
});

// ---------------------------------------------------------------------------
// Day / night
// ---------------------------------------------------------------------------

test('getTimePhase follows the contract boundaries', () => {
  const at = (h, m = 0) => new Date(2026, 10, 8, h, m);
  assert.equal(getTimePhase(at(4, 59)), 'night');
  assert.equal(getTimePhase(at(5)), 'morning');
  assert.equal(getTimePhase(at(9, 59)), 'morning');
  assert.equal(getTimePhase(at(10)), 'day');
  assert.equal(getTimePhase(at(16, 59)), 'day');
  assert.equal(getTimePhase(at(17)), 'evening');
  assert.equal(getTimePhase(at(19, 59)), 'evening');
  assert.equal(getTimePhase(at(20)), 'night');
  assert.equal(getTimePhase(at(0)), 'night');
  assert.ok(['morning', 'day', 'evening', 'night'].includes(getTimePhase()));
  assert.ok(['morning', 'day', 'evening', 'night'].includes(getTimePhase(new Date('invalid'))));
});

test('day/night blends smoothly, follows focus and handles indoor mode', () => {
  const scene = new THREE.Scene();
  const renderer = { toneMappingExposure: 1 }; // plain object, as in tests
  const dn = createDayNight({ scene, renderer });
  assert.ok(scene.background instanceof THREE.Color);
  assert.ok(scene.fog instanceof THREE.Fog);
  assert.equal(dn.override, null);

  dn.setOverride('day');
  for (let i = 0; i < 40; i++) dn.update(0.1, new THREE.Vector3(0, 0, 0));
  assert.equal(dn.phase, 'day');
  assert.equal(dn.nightFactor, 0);
  assert.equal(dn.isNight, false);
  const dayBg = scene.background.clone();

  dn.setOverride('night');
  assert.equal(dn.override, 'night');
  assert.equal(dn.isNight, true);
  for (let i = 0; i < Math.round((BLEND_SECONDS / 2) / 0.1); i++) dn.update(0.1, new THREE.Vector3(5, 0, 5));
  assert.ok(dn.nightFactor > 0.2 && dn.nightFactor < 0.8, `mid-blend ${dn.nightFactor}`);
  for (let i = 0; i < 30; i++) dn.update(0.1, new THREE.Vector3(5, 0, 5));
  assert.ok(Math.abs(dn.nightFactor - 1) < 1e-6);
  assert.ok(scene.background.r < dayBg.r, 'night sky is darker');
  assert.ok(renderer.toneMappingExposure > 1, 'renderer exposure tuned');

  // Sun / shadow camera follows the focus.
  const sun = dn.sun;
  assert.equal(sun.castShadow, true);
  assert.ok(sun.target.position.distanceTo(new THREE.Vector3(5, 0, 5)) < 0.1);
  assert.ok(sun.position.y > sun.target.position.y + 10);
  assert.ok(sun.shadow.camera.right >= 14 && sun.shadow.camera.right <= 18);

  dn.setIndoor(true);
  assert.equal(scene.fog, null, 'no fog indoors');
  assert.ok(scene.background.r < 0.05 && scene.background.r >= scene.background.b, 'dark warm backdrop');
  assert.equal(dn.isNight, true, 'phase still tracks the clock indoors');
  dn.update(0.1, new THREE.Vector3(0, 0, 0));
  assert.equal(scene.fog, null);
  dn.setIndoor(false);
  dn.update(0.1, new THREE.Vector3(0, 0, 0));
  assert.ok(scene.fog instanceof THREE.Fog);

  dn.setOverride('bogus');
  assert.equal(dn.override, null, 'invalid override means live clock');
  dn.update(NaN, undefined);
  dn.dispose();
  assert.ok(!scene.children.includes(sun));
});

test('createDayNight tolerates a missing renderer', () => {
  const dn = createDayNight({ scene: new THREE.Scene() });
  dn.update(0.016, { x: 1, y: 2, z: 3 });
  dn.setOverride('evening');
  for (let i = 0; i < 30; i++) dn.update(0.1);
  assert.ok(dn.nightFactor > 0.3 && dn.nightFactor < 0.6);
});

// ---------------------------------------------------------------------------
// Camera rig
// ---------------------------------------------------------------------------

test('camera rig follows its target with damping and snaps', () => {
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  const rig = createCameraRig(camera);
  const focusRef = rig.focus;
  rig.setMode('outdoor');
  rig.setTarget({ x: 0, y: 0, z: 0 });
  rig.snap();
  const startDist = rig.focus.distanceTo(new THREE.Vector3(10, 0, 5));
  rig.setTarget({ x: 10, y: 0, z: 5 });
  rig.update(0.016);
  const d1 = rig.focus.distanceTo(new THREE.Vector3(10, 0, 5));
  assert.ok(d1 < startDist, 'moves toward target');
  assert.ok(d1 > startDist * 0.5, 'but smoothly');
  for (let i = 0; i < 120; i++) rig.update(1 / 60);
  assert.ok(Math.abs(rig.focus.x - 10) < 0.05 && Math.abs(rig.focus.z - (5 - 0.45)) < 0.05, 'settles slightly ahead');
  assert.equal(rig.focus, focusRef, 'focus object is never replaced');
  const off = camera.position.clone().sub(rig.focus);
  assert.ok(Math.abs(off.y - OUTDOOR_OFFSET.y) < 0.05 && Math.abs(off.z - OUTDOOR_OFFSET.z) < 0.05);
  // Camera looks at the focus.
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  assert.ok(dir.dot(rig.focus.clone().sub(camera.position).normalize()) > 0.999);

  rig.setTarget({ x: -4, y: 1, z: 2 });
  rig.snap();
  assert.ok(Math.abs(rig.focus.x + 4) < 1e-9);
  rig.update(NaN);
  rig.setTarget(null);
  rig.setTarget({ x: NaN, y: 0, z: 0 });
  assert.ok(Number.isFinite(camera.position.x));
});

test('indoor framing centres small rooms and clamps big ones', () => {
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  const rig = createCameraRig(camera);
  rig.setMode('indoor', { bounds: { minX: -0.5, maxX: 7.5, minZ: -0.5, maxZ: 5.5 } });
  rig.setTarget({ x: 1, y: 0, z: 4 });
  rig.snap();
  assert.ok(Math.abs(rig.focus.x - 3.5) < 1e-6, 'small room centred on x');
  rig.setMode('indoor', { bounds: { minX: -0.5, maxX: 40.5, minZ: -0.5, maxZ: 5.5 } });
  rig.setTarget({ x: 0, y: 0, z: 3 });
  rig.snap();
  assert.ok(rig.focus.x > 0 && rig.focus.x < 20, `clamped near the west wall (${rig.focus.x})`);
  rig.setTarget({ x: 40, y: 0, z: 3 });
  rig.snap();
  assert.ok(rig.focus.x < 40 && rig.focus.x > 20, `clamped near the east wall (${rig.focus.x})`);
  const off = camera.position.clone().sub(rig.focus);
  assert.ok(off.length() < Math.hypot(OUTDOOR_OFFSET.y, OUTDOOR_OFFSET.z), 'closer than outdoors');
});

test('title mode orbits slowly around the centre', () => {
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  const rig = createCameraRig(camera);
  const center = new THREE.Vector3(12, 0, 9);
  rig.setMode('title', { center });
  rig.snap();
  const p0 = camera.position.clone();
  assert.ok(Math.abs(p0.clone().sub(center).setY(0).length() - 16) < 0.01);
  assert.ok(Math.abs(p0.y - 11) < 0.01);
  for (let i = 0; i < 60; i++) rig.update(1 / 30);
  assert.ok(camera.position.distanceTo(p0) > 0.5, 'orbiting');
  assert.ok(camera.position.distanceTo(p0) < 5, 'slowly');
  assert.ok(rig.focus.distanceTo(center) < 0.01);
});

// ---------------------------------------------------------------------------
// Materials helpers
// ---------------------------------------------------------------------------

test('material helpers are cached, disposable and deterministic', () => {
  const g = getToonGradient();
  assert.equal(g, getToonGradient());
  assert.equal(g.magFilter, THREE.NearestFilter);
  assert.equal(toon(PALETTE.meadow), toon(PALETTE.meadow));
  assert.notEqual(toon(PALETTE.meadow), toon(PALETTE.meadow, { vertexColors: true }));
  const kit = createMaterialKit();
  const a = kit.toon('#ff0000');
  assert.equal(a, kit.toon('#ff0000'));
  kit.glow(PALETTE.lampGlow, 2);
  kit.basic('#00ff00');
  let disposed = 0;
  a.addEventListener('dispose', () => disposed++);
  kit.dispose();
  assert.equal(disposed, 1);
  assert.equal(kit.size, 0);
  assert.equal(hash2(3, 4, 5), hash2(3, 4, 5));
  assert.notEqual(hash2(3, 4, 5), hash2(4, 3, 5));
  for (let i = 0; i < 50; i++) {
    const v = noise2(i * 0.37, i * 0.21, 9);
    assert.ok(v >= 0 && v < 1);
  }
  const r1 = rng(42);
  const r2 = rng(42);
  assert.equal(r1(), r2());
});
