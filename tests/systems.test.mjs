import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWorldSession } from '../src/systems/world-session.js';
import { createClock } from '../src/systems/clock.js';
import { createMover } from '../src/systems/grid-mover.js';
import { FOLLOW_DISTANCE } from '../src/systems/follower.js';
import { pickAffectionLine } from '../src/systems/interaction.js';
import { createMapMusic } from '../src/systems/map-music.js';
import { state, resetState, addPartner, setFlag } from '../src/core/state.js';
import { PLAYER_LOOK, HOP_MS, WALK_SPEED, RUN_SPEED, PLAYER_RADIUS } from '../src/config.js';

// ── fixtures ──────────────────────────────────────────────────────────────

/** Fresh fixture map defs; scripts record into `log`. */
function makeMaps(log) {
  const town = {
    id: 'town',
    name: 'Testville',
    kind: 'outdoor',
    music: 'town',
    musicNight: 'town-night',
    tiles: [
      'TTTTTTTTTTTT', // 0
      'T..........T', // 1
      'T.##.......T', // 2
      'T.#D.......T', // 3  door (3,3)
      'T..........T', // 4
      'T..vvv.....T', // 5  ledges (3..5, 5)
      'T..........T', // 6  trigger (10,6), hidden ghost (8,6)
      'T.""""""...T', // 7  tall grass (2..7, 7..8)
      'T.""""""...T', // 8
      'T.......S..T', // 9  stairs (8,9) at level 0
      'T..........T', // 10 level 0
      'TTTTTTTTTTTT', // 11
    ],
    heights: [
      '111111111111',
      '111111111111',
      '111111111111',
      '111111111111',
      '111111111111',
      '111111111111',
      '111111111111',
      '111111111111',
      '111111111111',
      '111111110111',
      '000000000000',
      '000000000000',
    ],
    spawn: { x: 5, y: 1, facing: 'down' },
    objects: [
      { type: 'building', id: 'hut', x: 2, y: 2, w: 2, h: 2, door: { x: 3, y: 3 } },
      { type: 'sign', id: 'sign', x: 10, y: 2, text: 'Welcome to Testville!' },
    ],
    npcs: [
      { id: 'bea', name: 'Bea', x: 6, y: 3, facing: 'left', behavior: 'stand', text: ['Hello there!', 'Lovely day.'], look: { shirt: '#123456' } },
      { id: 'ghost', name: 'Ghost', x: 8, y: 6, facing: 'down', showIf: 'ghost_here', text: 'Boo.', look: { shirt: '#eeeeee' } },
    ],
    warps: [{ x: 3, y: 3, to: 'room', tx: 3, ty: 4, facing: 'up' }],
    triggers: [{ x: 10, y: 6, script: 'ping' }],
    scripts: {
      async ping(api) {
        log.ping += 1;
        await api.say('Ping!');
      },
    },
  };
  const room = {
    id: 'room',
    name: 'Cosy Room',
    kind: 'indoor',
    music: 'home',
    onEnter: 'hello',
    tiles: ['WWWWWWW', 'WoooooW', 'WoooooW', 'WoooooW', 'WoooooW', 'WWWEWWW'],
    spawn: { x: 3, y: 3, facing: 'up' },
    objects: [{ type: 'counter', id: 'counter', x: 1, y: 2, w: 3 }],
    npcs: [{ id: 'clerk', name: 'Clerk', x: 2, y: 1, facing: 'down', text: 'Welcome in!' }],
    warps: [{ x: 3, y: 5, to: 'town', tx: 3, ty: 4, facing: 'down' }],
    scripts: {
      hello() {
        log.enter += 1;
      },
    },
  };
  const field = {
    id: 'field',
    name: 'Field',
    kind: 'outdoor',
    music: 'town',
    tiles: ['TTTTTTT', 'T.....T', 'T.....T', 'T.....T', 'T.....T', 'T.....T', 'TTTTTTT'],
    spawn: { x: 1, y: 1, facing: 'down' },
    npcs: [
      { id: 'wanda', name: 'Wanda', x: 3, y: 3, behavior: 'wander', radius: 1, text: 'Hi!' },
      { id: 'tom', name: 'Tom', x: 5, y: 5, behavior: 'turn', text: 'Hm.' },
    ],
  };
  return { town, room, field };
}

// ── fakes ─────────────────────────────────────────────────────────────────

function fakeModel(kind, arg) {
  const group = new THREE.Group();
  const m = {
    kind,
    arg,
    group,
    height: 1,
    facing: null,
    moving: false,
    running: false,
    everRan: false,
    hops: 0,
    emotes: [],
    disposed: false,
    setFacing(dir) {
      m.facing = dir;
    },
    setMoving(v, r = false) {
      m.moving = v;
      m.running = r;
      if (v && r) m.everRan = true;
    },
    hop() {
      m.hops += 1;
    },
    emote(k) {
      m.emotes.push(k);
      return Promise.resolve();
    },
    update() {},
    dispose() {
      m.disposed = true;
    },
  };
  return m;
}

function fakeView(model) {
  return {
    model,
    group: new THREE.Group(),
    rustles: [],
    flagsApplied: 0,
    updates: 0,
    disposed: false,
    update() {
      this.updates += 1;
    },
    applyFlags() {
      this.flagsApplied += 1;
    },
    rustleGrass(x, y) {
      this.rustles.push([x, y]);
    },
    dispose() {
      this.disposed = true;
    },
  };
}

function fakeInput() {
  let held = null;
  /** @type {{x:number, y:number}|null} */
  let stick = null;
  const down = new Set();
  let presses = new Set();
  return {
    hold(dir) {
      held = dir;
      stick = null;
    },
    /** Analog stick (x right, y down); magnitude ≤ 1. */
    steer(x, y) {
      stick = { x, y };
      held = null;
    },
    release() {
      held = null;
      stick = null;
    },
    press(action) {
      presses.add(action);
    },
    setDown(action, v) {
      if (v) down.add(action);
      else down.delete(action);
    },
    isDown: (a) => down.has(a) || held === a,
    heldDirection: () => held,
    moveVector() {
      if (stick) {
        const m = Math.hypot(stick.x, stick.y);
        if (m < 1e-9) return { x: 0, y: 0, magnitude: 0, analog: true };
        const mag = Math.min(1, m);
        return { x: (stick.x / m) * mag, y: (stick.y / m) * mag, magnitude: mag, analog: true };
      }
      const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[held];
      if (!d) return { x: 0, y: 0, magnitude: 0, analog: false };
      return { x: d[0], y: d[1], magnitude: 1, analog: false };
    },
    pressed(a) {
      if (!presses.has(a)) return false;
      presses.delete(a);
      return true;
    },
    onPress: () => () => {},
    endFrame() {
      presses = new Set();
    },
    clear() {
      held = null;
      stick = null;
      down.clear();
      presses = new Set();
    },
  };
}

function fakeUi(choices = []) {
  const said = [];
  const banners = [];
  const cards = [];
  const fade = { outs: 0, ins: 0 };
  return {
    said,
    banners,
    cards,
    fadeLog: fade,
    dialog: {
      isOpen: false,
      closed: 0,
      async say(pages, opts = {}) {
        said.push({ pages: [].concat(pages), speaker: opts.speaker });
      },
      async choose(prompt, options) {
        said.push({ prompt, options });
        return choices.length ? choices.shift() : 0;
      },
      close() {
        this.isOpen = false;
        this.closed += 1;
      },
    },
    banner: { show: (t) => banners.push(t) },
    fade: {
      async fadeOut() {
        fade.outs += 1;
      },
      async fadeIn() {
        fade.ins += 1;
      },
    },
    card: {
      async show(c) {
        cards.push(c);
      },
    },
  };
}

function fakeAudio() {
  const calls = [];
  return {
    calls,
    sfx: (id) => calls.push(['sfx', id]),
    cry: (s) => calls.push(['cry', s]),
    playMusic: (id) => calls.push(['music', id]),
    stopMusic: () => calls.push(['stop']),
    count(kind, id) {
      return calls.filter((c) => c[0] === kind && (id === undefined || c[1] === id)).length;
    },
  };
}

function fakeRig() {
  return {
    focus: new THREE.Vector3(),
    modes: [],
    snaps: 0,
    target: null,
    setMode(mode, opts) {
      this.modes.push([mode, opts]);
    },
    setTarget(t) {
      this.target = { x: t.x, y: t.y, z: t.z };
    },
    snap() {
      this.snaps += 1;
    },
    update() {},
  };
}

/** Deterministic PRNG for AI tests. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tick = () => new Promise((r) => setImmediate(r));
const DT = 1 / 60;

function harness(t, { random = () => 0.5, choices = [], deps = {} } = {}) {
  resetState();
  const log = { ping: 0, enter: 0 };
  const maps = makeMaps(log);
  const input = fakeInput();
  const ui = fakeUi(choices);
  const audio = fakeAudio();
  const rig = fakeRig();
  const dayNight = {
    isNight: false,
    nightFactor: 0,
    indoor: null,
    setIndoor(v) {
      this.indoor = v;
    },
  };
  const logs = { warn: [], error: [] };
  const logger = { log() {}, warn: (...a) => logs.warn.push(a), error: (...a) => logs.error.push(a) };
  const humans = [];
  const wild = [];
  const views = [];
  let saves = 0;
  const scene = new THREE.Scene();
  const session = createWorldSession({
    scene,
    cameraRig: rig,
    dayNight,
    ui,
    audio,
    input,
    deps: {
      getMapDef(id) {
        if (!maps[id]) throw new Error(`Unknown map "${id}"`);
        return maps[id];
      },
      buildMap(model) {
        const v = fakeView(model);
        views.push(v);
        return v;
      },
      createHumanoid(look) {
        const m = fakeModel('human', look);
        humans.push(m);
        return m;
      },
      createWildlingModel(species) {
        const m = fakeModel('wild', species);
        wild.push(m);
        return m;
      },
      random,
      logger,
      saveState: () => {
        saves += 1;
        return true;
      },
      ...deps,
    },
  });
  t.after(() => session.dispose());

  const h = {
    session,
    input,
    ui,
    audio,
    rig,
    dayNight,
    logs,
    humans,
    wild,
    views,
    log,
    scene,
    get saves() {
      return saves;
    },
    player: () => humans.filter((m) => m.arg === PLAYER_LOOK).at(-1),
    npcModel: (look) => humans.filter((m) => m.arg === look).at(-1),
    follower: () => wild.filter((m) => !m.disposed).find((m) => m.group.parent === scene && m.isFollower !== false),
    tile: () => ({ ...session.playerTile }),
    async frames(n, dt = DT) {
      for (let i = 0; i < n; i++) {
        session.update(dt);
        input.endFrame();
        await tick();
      }
    },
    /** Run frames until pred() holds (checked before each frame). */
    async until(pred, max = 900) {
      for (let i = 0; i < max; i++) {
        if (pred()) return i;
        session.update(DT);
        input.endFrame();
        await tick();
      }
      throw new Error('timed out waiting for condition');
    },
    async idle() {
      await h.until(() => !session.busy);
    },
    /** Player position (continuous) — never null once spawned. */
    pos: () => session.playerPos,
    /** Steer straight to the centre of tile (tx, ty), easing off near it, then stop. */
    async walkTo(tx, ty, max = 600) {
      for (let i = 0; i < max; i++) {
        const p = session.playerPos;
        if (session.busy || !p) break;
        const dx = tx - p.x;
        const dz = ty - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.04) break;
        const k = Math.min(1, Math.max(0.36, dist * 2.5)) / dist;
        input.steer(dx * k, dz * k);
        session.update(DT);
        input.endFrame();
        await tick();
      }
      input.release();
      await h.until(() => !session.playerPos?.moving || session.busy);
      await h.frames(2);
    },
  };
  return h;
}

// ── unit-ish pieces ───────────────────────────────────────────────────────

test('clock: waits and tweens advance only with update()', async () => {
  const clock = createClock();
  let done = false;
  const seen = [];
  clock.wait(100).then(() => {
    done = true;
  });
  const tw = clock.tween(200, (t) => seen.push(Number(t.toFixed(2))));
  clock.update(50);
  await tick();
  assert.equal(done, false);
  clock.update(60);
  await tick();
  assert.equal(done, true);
  clock.update(200);
  await tw;
  assert.equal(seen[0], 0);
  assert.equal(seen.at(-1), 1);
  assert.equal(clock.pending, 0);
});

test('grid mover: chains steps without losing time', () => {
  const model = fakeModel('x');
  let arrivals = 0;
  const m = createMover({
    model,
    x: 0,
    y: 0,
    facing: 'right',
    surfaceY: () => 0,
    onArrive(mv) {
      arrivals += 1;
      if (arrivals < 3) mv.begin(mv.x + 1, mv.y, { dir: 'right', durationMs: 100 });
    },
  });
  m.begin(1, 0, { dir: 'right', durationMs: 100 });
  assert.equal(model.moving, true);
  m.advance(150); // arrive at 1, 50 ms into the next step
  assert.equal(m.x, 2);
  assert.ok(Math.abs(model.group.position.x - 1.5) < 1e-9);
  assert.equal(model.moving, true, 'walk cycle never switched off between chained steps');
  m.advance(200);
  assert.equal(m.x, 3);
  assert.equal(m.moving, false);
  assert.equal(model.moving, false);
  assert.equal(model.group.position.x, 3);
});

test('affection lines vary and use the partner name', () => {
  let i = 0;
  const seq = [0, 0, 0.99];
  const random = () => seq[i++ % seq.length];
  const a = pickAffectionLine({ species: 'emberkit', name: 'Emberkit', indoor: false, night: false, random });
  const b = pickAffectionLine({ species: 'emberkit', name: 'Emberkit', indoor: false, night: false, random, last: a });
  assert.match(a, /Emberkit/);
  assert.notEqual(a, b);
});

// ── session: movement ─────────────────────────────────────────────────────

test('free movement: continuous walking at WALK_SPEED, stops flush at walls, one bump per contact', async (t) => {
  const h = harness(t);
  await h.session.loadMap('town', 5, 1, 'right');
  assert.deepEqual(h.tile(), { x: 5, y: 1, facing: 'right' });

  h.input.hold('right');
  await h.frames(30);
  const halfSecond = h.pos().x - 5;
  assert.ok(halfSecond > WALK_SPEED * 0.5 * 0.85 && halfSecond <= WALK_SPEED * 0.5 + 1e-6, `≈ walk speed (${halfSecond.toFixed(2)} tiles in 0.5 s)`);
  assert.ok(!Number.isInteger(h.player().group.position.x), 'positions are continuous');
  const xs = [];
  for (let i = 0; i < 90; i++) {
    await h.frames(1);
    if (xs.at(-1) !== state.x) xs.push(state.x);
  }
  h.input.release();
  await h.frames(10);
  assert.deepEqual(xs.slice(-1), [10], 'state tracks the tile under the player');
  assert.ok(Math.abs(h.pos().x - (10.5 - PLAYER_RADIUS)) < 1e-3, `flush against the tree line (${h.pos().x})`);
  assert.equal(h.player().moving, false);
  assert.equal(h.audio.count('sfx', 'bump'), 1, 'one bump for one contact, not a stream');
  assert.equal(h.player().facing, 'right');
});

test('analog: partial tilt walks slower; any angle, and the body faces it', async (t) => {
  const h = harness(t);
  await h.session.loadMap('town', 5, 4, 'down');
  h.input.steer(0.5, 0);
  await h.frames(60);
  h.input.release();
  const slow = h.pos().x - 5;
  assert.ok(slow > WALK_SPEED * 0.5 * 0.85 && slow < WALK_SPEED * 0.5 * 1.05, `half tilt ≈ half speed (${slow.toFixed(2)})`);

  await h.session.loadMap('town', 7, 4, 'down');
  h.input.steer(Math.SQRT1_2, Math.SQRT1_2);
  await h.frames(20);
  h.input.release();
  const p = h.pos();
  assert.ok(p.x - 7 > 0.4 && Math.abs(p.x - 7 - (p.z - 4)) < 1e-6, 'moves diagonally');
  assert.ok(Math.abs(p.yaw - Math.PI / 4) < 1e-9, 'faces the diagonal');
  assert.ok(['down', 'right'].includes(h.player().facing));
});

test('sliding: pushing diagonally into a wall keeps moving along it', async (t) => {
  const h = harness(t);
  await h.session.loadMap('town', 5, 1, 'up');
  h.input.steer(0.7, -0.7);
  await h.frames(40);
  h.input.release();
  const p = h.pos();
  assert.ok(Math.abs(p.z - (0.5 + PLAYER_RADIUS)) < 1e-3, `against the top wall (${p.z})`);
  assert.ok(p.x > 6, `slid along it (${p.x.toFixed(2)})`);
  assert.equal(h.audio.count('sfx', 'bump'), 0, 'sliding is not bumping');
});

test('corner assist: heading straight for a doorway off-centre slides onto its line', async (t) => {
  const h = harness(t);
  await h.session.loadMap('room', 3, 4, 'down');
  await h.idle();
  h.input.steer(1, 0);
  await h.frames(7);
  assert.ok(h.pos().x > 3.25, `off-centre (${h.pos().x.toFixed(2)})`);
  h.input.hold('down');
  await h.until(() => h.session.mapModel?.id === 'town', 120);
  h.input.release();
  await h.idle();
  assert.deepEqual(h.tile(), { x: 3, y: 4, facing: 'down' }, 'slipped through the one-tile exit');
});

test('running uses the run cycle and the b button', async (t) => {
  const h = harness(t);
  await h.session.loadMap('town', 1, 1, 'right');
  h.input.setDown('b', true);
  h.input.hold('right');
  const frames = await h.until(() => state.x === 3);
  h.input.release();
  h.input.setDown('b', false);
  assert.ok(h.player().everRan, 'run cycle requested from the model');
  // 1.5 tiles at RUN_SPEED ≈ 0.2 s (≈12 frames) vs ≈ 0.375 s walking.
  assert.ok(frames < 17, `ran quickly (${frames} frames)`);
  await h.frames(30);
  h.input.setDown('run', true);
  h.input.hold('right');
  const runFrames = await h.until(() => state.x === 6);
  h.input.release();
  assert.ok(runFrames < 30, `ran with the run key (${runFrames} frames)`);
});

test('ledge: pushing into one hops two tiles with an arc and a sound; one way only', async (t) => {
  const h = harness(t);
  await h.session.loadMap('town', 3, 4, 'down');
  const ys = [];
  let peak = 0;
  h.input.hold('down');
  for (let i = 0; i < 45; i++) {
    await h.frames(1);
    peak = Math.max(peak, h.player().group.position.y);
    if (ys.at(-1) !== state.y) ys.push(state.y);
  }
  h.input.release();
  assert.deepEqual(ys.slice(0, 2), [4, 6], 'landed 2 tiles down in one hop');
  assert.equal(h.audio.count('sfx', 'ledge'), 1);
  assert.ok(peak > 0.5 + 0.4, `hop arc rises above the ground (peak ${peak.toFixed(2)})`);
  assert.ok(h.player().hops >= 1);
  assert.equal(h.audio.count('sfx', 'bump'), 0, 'a hop is not a bump');

  await h.frames(30);
  await h.session.loadMap('town', 3, 6, 'up');
  h.input.hold('up');
  await h.frames(40);
  h.input.release();
  await h.frames(20);
  assert.deepEqual([state.x, state.y], [3, 6], 'ledges are one-way');
  assert.equal(h.audio.count('sfx', 'ledge'), 1);
});

test('stairs change level smoothly; cliffs block', async (t) => {
  const h = harness(t);
  await h.session.loadMap('town', 8, 8, 'down');
  assert.equal(h.player().group.position.y, 0.5);
  const heights = [];
  h.input.hold('down');
  await h.until(() => {
    heights.push(h.player().group.position.y);
    return state.y === 10;
  });
  h.input.release();
  await h.frames(40);
  assert.equal(h.player().group.position.y, 0, 'down on level 0');
  assert.ok(heights.some((y) => y > 0.05 && y < 0.45), 'passed through in-between heights');
  for (let i = 1; i < heights.length; i++) assert.ok(heights[i] <= heights[i - 1] + 1e-9, 'never bounces up');

  await h.session.loadMap('town', 2, 9, 'down');
  await h.frames(20);
  h.input.hold('down');
  await h.frames(30);
  h.input.release();
  assert.deepEqual([state.x, state.y], [2, 9], 'cliff edge blocks');
  assert.ok(h.audio.count('sfx', 'bump') >= 1);
});

// ── session: warps, triggers, loading ─────────────────────────────────────

test('warps change maps, place the player and come back', async (t) => {
  const h = harness(t);
  await h.session.loadMap('town', 3, 4, 'up');
  assert.equal(h.ui.banners.at(-1), 'Testville');
  const savesBefore = h.saves;
  h.input.hold('up');
  await h.until(() => h.session.mapModel?.id === 'room');
  h.input.release();
  await h.idle();
  assert.equal(h.audio.count('sfx', 'door'), 1);
  assert.ok(h.ui.fadeLog.outs >= 1 && h.ui.fadeLog.ins >= 1, 'faded out and in');
  assert.deepEqual(h.tile(), { x: 3, y: 4, facing: 'up' });
  assert.equal(state.mapId, 'room');
  assert.deepEqual([state.x, state.y, state.facing], [3, 4, 'up']);
  assert.equal(h.dayNight.indoor, true);
  assert.equal(h.rig.modes.at(-1)[0], 'indoor');
  assert.deepEqual(h.rig.modes.at(-1)[1].bounds, { minX: -0.5, maxX: 6.5, minZ: -0.5, maxZ: 5.5 });
  assert.equal(h.log.enter, 1, 'onEnter ran');
  assert.ok(h.saves > savesBefore, 'autosaved after the load');
  assert.equal(h.views[0].disposed, true, 'old map view disposed');
  assert.ok(h.audio.calls.some((c) => c[0] === 'music' && c[1] === 'home'));

  // Back out over the exit mat.
  h.input.hold('down');
  await h.until(() => h.session.mapModel?.id === 'town');
  h.input.release();
  await h.idle();
  assert.equal(h.session.mapModel.id, 'town');
  assert.deepEqual(h.tile(), { x: 3, y: 4, facing: 'down' });
  assert.equal(h.ui.banners.at(-1), 'Testville', 'banner on outdoor entry');
  assert.equal(h.ui.banners.length, 2);
});

test('pushing down while standing on an exit mat leaves the room', async (t) => {
  const h = harness(t);
  await h.session.loadMap('room', 3, 5, 'down');
  await h.frames(15);
  h.input.hold('down');
  await h.until(() => h.session.mapModel?.id === 'town');
  h.input.release();
  await h.idle();
  assert.deepEqual(h.tile(), { x: 3, y: 4, facing: 'down' });
});

test('triggers fire once per arrival', async (t) => {
  const h = harness(t);
  await h.session.loadMap('town', 10, 4, 'down');
  h.input.hold('down');
  await h.until(() => h.log.ping === 1);
  h.input.release();
  await h.idle();
  assert.deepEqual([state.x, state.y], [10, 6]);
  assert.deepEqual(h.ui.said.at(-1).pages, ['Ping!']);
  await h.frames(60);
  assert.equal(h.log.ping, 1, 'standing still does not re-fire');
  await h.walkTo(10, 5);
  assert.equal(state.y, 5);
  assert.equal(h.log.ping, 1);
  h.input.hold('down');
  await h.until(() => h.log.ping === 2);
  h.input.release();
  await h.idle();
  assert.equal(h.log.ping, 2, 'fires again on the next arrival');
});

test('start() uses the map spawn for a new game and the saved tile otherwise', async (t) => {
  const h = harness(t);
  state.mapId = 'town';
  await h.session.start();
  assert.deepEqual(h.tile(), { x: 5, y: 1, facing: 'down' });
  state.mapId = 'town';
  state.x = 9;
  state.y = 4;
  state.facing = 'left';
  await h.session.start();
  assert.deepEqual(h.tile(), { x: 9, y: 4, facing: 'left' });
  // Unknown map in a save → falls back to the start map without crashing.
  state.mapId = 'nowhere';
  await assert.rejects(h.session.loadMap('nowhere'));
  assert.equal(h.session.mapModel.id, 'town', 'a failed load keeps the old map');
});

test('preview shows the map and NPCs with the title camera, no player', async (t) => {
  const h = harness(t);
  await h.session.preview('field');
  assert.equal(h.player(), undefined);
  assert.equal(h.rig.modes.at(-1)[0], 'title');
  assert.ok(h.rig.modes.at(-1)[1].center instanceof THREE.Vector3);
  assert.equal(h.humans.length, 2, 'two NPCs');
  await h.frames(10);
  assert.ok(h.views[0].updates >= 10);
  assert.equal(h.saves, 0, 'previews never autosave');
  assert.equal(h.ui.banners.length, 0);
});

// ── session: interaction ──────────────────────────────────────────────────

test('talking to an NPC shows its text with the speaker name and turns them', async (t) => {
  const h = harness(t);
  await h.session.loadMap('town', 6, 4, 'up');
  await h.frames(15);
  const bea = h.npcModel(h.session.mapModel.npcs[0].look);
  assert.equal(bea.facing, 'left');
  h.input.press('a');
  await h.frames(1);
  await h.idle();
  assert.deepEqual(h.ui.said.at(-1), { pages: ['Hello there!', 'Lovely day.'], speaker: 'Bea' });
  assert.equal(bea.facing, 'down', 'faced the player');
  await h.frames(120);
  assert.equal(bea.facing, 'left', 'stand NPC turns back to its usual facing');
});

test('NPCs block the player', async (t) => {
  const h = harness(t);
  await h.session.loadMap('town', 6, 4, 'up');
  h.input.hold('up');
  await h.frames(30);
  h.input.release();
  assert.deepEqual([state.x, state.y], [6, 4]);
  assert.ok(h.audio.count('sfx', 'bump') >= 1);
});

test('talk across a counter; read signs', async (t) => {
  const h = harness(t);
  await h.session.loadMap('room', 2, 3, 'up');
  await h.idle();
  await h.frames(15);
  h.input.press('a');
  await h.frames(1);
  await h.idle();
  assert.deepEqual(h.ui.said.at(-1), { pages: ['Welcome in!'], speaker: 'Clerk' });

  await h.session.loadMap('town', 10, 3, 'up');
  await h.frames(15);
  h.input.press('a');
  await h.frames(1);
  await h.idle();
  assert.deepEqual(h.ui.said.at(-1), { pages: ['Welcome to Testville!'], speaker: undefined });
});

test('flags show/hide NPCs and re-apply map flags', async (t) => {
  const h = harness(t);
  await h.session.loadMap('town', 8, 4, 'down');
  // The ghost at (8,6) is hidden (showIf ghost_here): it neither shows nor blocks.
  const ghostLook = h.session.mapModel.npcs[1].look;
  assert.equal(h.npcModel(ghostLook).group.visible, false);
  await h.walkTo(8, 6);
  assert.deepEqual([state.x, state.y], [8, 6], 'walked through the hidden ghost tile');

  await h.session.loadMap('town', 8, 4, 'down');
  const view = h.views.at(-1);
  const before = view.flagsApplied;
  setFlag('ghost_here');
  assert.ok(view.flagsApplied > before, 'MapView.applyFlags on every flag change');
  assert.equal(h.npcModel(ghostLook).group.visible, true, 'ghost appears');
  await h.frames(15);
  await h.walkTo(8, 5);
  h.input.hold('down');
  await h.frames(30);
  h.input.release();
  assert.deepEqual([state.x, state.y], [8, 5], 'visible ghost blocks');
});

// ── session: partner & follower ───────────────────────────────────────────

test('givePartner spawns a follower that trails behind along the player path', async (t) => {
  const h = harness(t);
  await h.session.loadMap('town', 5, 1, 'right');
  const member = await h.session.runScript((api) => api.givePartner('emberkit'));
  assert.equal(member?.species, 'emberkit');
  assert.equal(state.party[0].species, 'emberkit');
  assert.equal(h.audio.count('sfx', 'fanfare'), 1);
  assert.ok(h.saves >= 2, 'saved after receiving the partner');
  const f = h.wild.find((m) => m.arg === 'emberkit' && !m.disposed);
  assert.ok(f, 'follower model exists');
  await h.frames(30);
  assert.deepEqual([f.group.position.x, f.group.position.z], [4, 1], 'appears behind the player');

  await h.walkTo(8, 1);
  await h.frames(10);
  const gap = h.pos().x - f.group.position.x;
  assert.ok(Math.abs(gap - FOLLOW_DISTANCE) < 0.05, `trails FOLLOW_DISTANCE behind (${gap.toFixed(3)})`);
  assert.equal(f.group.position.z, 1);
  assert.equal(f.moving, false, 'stops when you stop');

  // Round a corner: the follower takes the same corner instead of cutting it.
  await h.walkTo(8, 4);
  let cut = false;
  h.input.hold('left');
  for (let i = 0; i < 20; i++) {
    await h.frames(1);
    const { x, z } = f.group.position;
    if (x < 7.9 && z < 3.9) cut = true;
  }
  h.input.release();
  assert.equal(cut, false, 'follows the path, not a straight line');

  // The follower never blocks: walk straight back through it.
  await h.walkTo(8, 4);
  await h.walkTo(5, 4);
  assert.equal(h.tile().x, 5, 'walked through the partner');
});

test('follower reappears behind the player after a warp and hops ledges', async (t) => {
  const h = harness(t);
  addPartner('mossbun');
  await h.session.loadMap('town', 3, 4, 'down');
  let f = h.wild.find((m) => m.arg === 'mossbun' && !m.disposed);
  assert.deepEqual([f.group.position.x, f.group.position.z], [3, 3], 'behind (on the door tile)');

  const hopsBefore = f.hops;
  let peak = 0;
  h.input.hold('down');
  await h.until(() => state.y === 6);
  for (let i = 0; i < 40; i++) {
    await h.frames(1);
    peak = Math.max(peak, f.group.position.y);
  }
  h.input.release();
  await h.frames(30);
  assert.ok(f.hops > hopsBefore, 'follower hopped the ledge too');
  assert.ok(peak > 0.5 + 0.2, `with an arc (peak ${peak.toFixed(2)})`);
  assert.ok(f.group.position.z > 5.5, 'and landed below it');
  assert.ok(Math.abs(f.group.position.y - 0.5) < 1e-3, 'back on the ground');

  await h.session.loadMap('room', 3, 4, 'up');
  f = h.wild.find((m) => m.arg === 'mossbun' && !m.disposed);
  assert.deepEqual([f.group.position.x, f.group.position.z], [3, 5], 'placed behind after the warp');
});

test('facing the follower and pressing a shows affection', async (t) => {
  const h = harness(t, { random: () => 0.2 });
  addPartner('brookling');
  await h.session.loadMap('town', 5, 1, 'right');
  await h.frames(15);
  h.input.hold('left');
  await h.frames(1);
  h.input.release();
  await h.frames(15);
  assert.deepEqual(h.tile(), { x: 5, y: 1, facing: 'left' });
  h.input.press('a');
  await h.frames(1);
  await h.idle();
  const f = h.wild.find((m) => m.arg === 'brookling' && !m.disposed);
  assert.ok(f.emotes.includes('♥'));
  assert.equal(h.audio.count('cry', 'brookling'), 1);
  assert.match(h.ui.said.at(-1).pages[0], /Brookling/);
});

test('forced-RNG encounter peeks out, shows its dialog and marks seen', async (t) => {
  const h = harness(t, { random: () => 0 });
  addPartner('mossbun');
  setFlag('has_journal');
  await h.session.loadMap('town', 2, 6, 'down');
  h.input.hold('down');
  await h.until(() => h.session.busy || state.y >= 9);
  h.input.release();
  assert.equal(state.y, 8, 'not on the first grass step after a load, but on the second');
  await h.idle();
  const said = h.ui.said.map((s) => s.pages.join(' | '));
  assert.ok(said.includes('A wild Pipwing peeked out of the tall grass!'), said.join('\n'));
  assert.ok(said.some((s) => /Mistfern Path/.test(s)));
  assert.ok(said.some((s) => /Field Journal/.test(s)));
  assert.ok(state.seen.includes('pipwing'));
  assert.equal(h.audio.count('cry', 'pipwing'), 1);
  assert.ok(h.player().emotes.includes('!'));
  const wildModel = h.wild.find((m) => m.arg === 'pipwing');
  assert.ok(wildModel.disposed, 'the wild visitor left and was disposed');
  assert.ok(h.views.at(-1).rustles.length >= 2, 'grass rustled');
  assert.ok(h.audio.count('sfx', 'grass') >= 2);
  assert.equal(h.session.busy, false);

  // At least 5 steps before the next one.
  const before = h.ui.said.length;
  await h.walkTo(3, 8); // grass
  assert.equal(h.ui.said.length, before, 'no back-to-back encounters');
});

test('no encounters without a partner', async (t) => {
  const h = harness(t, { random: () => 0 });
  await h.session.loadMap('town', 2, 6, 'down');
  h.input.hold('down');
  await h.until(() => state.y === 8);
  h.input.release();
  await h.frames(30);
  assert.equal(h.ui.said.length, 0);
  assert.equal(state.seen.length, 0);
});

// ── session: scripts ──────────────────────────────────────────────────────

test('a throwing script leaves the session playable and the dialog closed', async (t) => {
  const h = harness(t);
  await h.session.loadMap('town', 5, 1, 'down');
  await h.session.runScript(() => {
    throw new Error('boom');
  });
  assert.equal(h.session.busy, false);
  await h.session.runScript(async (api) => {
    h.ui.dialog.isOpen = true;
    await api.wait(0);
    throw new Error('async boom');
  });
  assert.equal(h.session.busy, false);
  assert.equal(h.ui.dialog.isOpen, false, 'dialog closed after the failure');
  assert.equal(h.logs.error.length, 2);
  await h.session.runScript('does-not-exist');
  assert.equal(h.session.busy, false);
  assert.ok(h.logs.warn.length >= 1);
  // Still walks.
  await h.walkTo(5, 2);
  assert.equal(state.y, 2);
});

test('script API: npc/player walks, waits, choices, cards, music, warp', async (t) => {
  const h = harness(t, { choices: [1, 0] });
  await h.session.loadMap('town', 6, 5, 'up');
  await h.frames(15);
  const run = h.session.runScript(async (api) => {
    const bea = api.npc('bea');
    assert.deepEqual([bea.x, bea.y], [6, 3]);
    await bea.walk(['right', 'right']);
    assert.deepEqual([bea.x, bea.y], [8, 3]);
    bea.facePlayer();
    await bea.emote('!');
    await api.player.walk(['up']);
    assert.deepEqual([api.player.x, api.player.y, api.player.facing], [6, 4, 'up']);
    await api.wait(500);
    assert.equal(await api.confirm('Sure?'), false);
    assert.equal(await api.choose('Pick', ['a', 'b']), 0);
    await api.card({ title: 'Hi', body: 'There' });
    api.music('lab');
    api.npc('nobody').face('up');
    assert.ok(Number.isNaN(api.npc('nobody').x), 'unknown NPC handles have no tile');
    api.setFlag('met_bea');
    assert.equal(api.flag('met_bea'), true);
    assert.equal(api.hasPartner(), false);
    assert.equal(api.partner(), null);
    assert.equal(api.follower, null);
    await api.warp('room', 2, 3, 'up');
    return 'done';
  });
  let frames = 0;
  while (h.session.busy && frames < 600) {
    await h.frames(1);
    frames += 1;
  }
  assert.equal(await run, 'done');
  assert.ok(frames >= 30, 'walks and waits took game time');
  assert.equal(h.session.mapModel.id, 'room');
  assert.deepEqual(h.tile(), { x: 2, y: 3, facing: 'up' });
  assert.equal(h.ui.cards[0].title, 'Hi');
  assert.ok(h.audio.calls.some((c) => c[0] === 'music' && c[1] === 'lab'));
  assert.equal(state.flags.met_bea, true);
});

test('scripted NPC walks keep occupancy consistent (moved NPC blocks its new tile)', async (t) => {
  const h = harness(t);
  await h.session.loadMap('town', 8, 4, 'up');
  let midWalkTiles = null;
  const run = h.session.runScript(async (api) => {
    const walk = api.npc('bea').walk(['right', 'right']);
    // Mid-step, the NPC reserves both its origin and its destination.
    await api.wait(100);
    midWalkTiles = [api.npc('bea').x, api.npc('bea').y];
    await walk;
  });
  // Scripted walks advance with game time: pump frames until the script ends.
  await h.idle();
  await run;
  assert.deepEqual(midWalkTiles, [7, 3]);
  h.input.hold('up');
  await h.frames(30);
  h.input.release();
  assert.deepEqual([state.x, state.y], [8, 4], 'bea now stands at (8,3)');
});

test('wandering NPCs stay near home and never overlap the player; turners turn', async (t) => {
  const h = harness(t, { random: mulberry32(7) });
  await h.session.loadMap('field', 2, 3, 'right');
  const wanda = h.humans[0];
  const tom = h.humans[1];
  const tomFacings = new Set();
  const spots = new Set();
  for (let i = 0; i < 1500; i++) {
    await h.frames(1);
    const { x, z } = wanda.group.position;
    assert.ok(x >= 2 - 1e-9 && x <= 4 + 1e-9 && z >= 2 - 1e-9 && z <= 4 + 1e-9, 'within radius 1 of home');
    assert.ok(!(Math.round(x) === 2 && Math.round(z) === 3 && Number.isInteger(x) && Number.isInteger(z)), 'never on the player');
    if (Number.isInteger(x) && Number.isInteger(z)) spots.add(`${x},${z}`);
    tomFacings.add(tom.facing);
  }
  assert.ok(spots.size >= 2, `wandered around (${[...spots].join(' ')})`);
  assert.ok(tomFacings.size >= 2, 'turning NPC changed facing');
});

test('AI and movement freeze while paused; music follows the night', async (t) => {
  const h = harness(t);
  await h.session.loadMap('town', 5, 1, 'down');
  assert.ok(h.audio.calls.some((c) => c[0] === 'music' && c[1] === 'town'));
  h.session.setPaused(true);
  h.input.hold('down');
  await h.frames(40);
  assert.deepEqual([state.x, state.y], [5, 1]);
  h.input.release();
  h.session.setPaused(false);
  h.dayNight.isNight = true;
  await h.frames(70);
  assert.ok(h.audio.calls.some((c) => c[0] === 'music' && c[1] === 'town-night'));
});

test('broken model factories never crash the session', async (t) => {
  const h = harness(t, {
    deps: {
      createHumanoid() {
        throw new Error('no humans today');
      },
      buildMap() {
        throw new Error('no map today');
      },
    },
  });
  await h.session.loadMap('town', 5, 1, 'down');
  assert.ok(h.logs.error.length >= 1);
  h.input.hold('down');
  await h.until(() => state.y === 2);
  h.input.release();
  assert.equal(state.y, 2);
});

test('real factories (whatever their state) integrate without crashing', async (t) => {
  const real = await Promise.all([
    import('../src/world/build-map.js'),
    import('../src/actors/humanoid.js'),
    import('../src/actors/wildlings.js'),
  ]).catch(() => null);
  if (!real) {
    t.skip('real factories failed to import');
    return;
  }
  const [{ buildMap }, { createHumanoid }, { createWildlingModel }] = real;
  const h = harness(t, { deps: { buildMap, createHumanoid, createWildlingModel } });
  addPartner('emberkit');
  await h.session.loadMap('town', 5, 1, 'down');
  h.input.hold('down');
  // playerTile is the destination as soon as a step starts: release right then.
  await h.until(() => h.session.playerTile.y === 2);
  h.input.release();
  await h.frames(30);
  assert.equal(state.y, 2);
  assert.ok(h.scene.children.length > 0);
});

test('speeds and hop timing match the config constants', async (t) => {
  const h = harness(t);
  await h.session.loadMap('town', 1, 1, 'right');
  h.input.hold('right');
  const walkFrames = await h.until(() => state.x === 3);
  h.input.release();
  // 1.5 tiles at WALK_SPEED, plus a little ease-in.
  const walkMs = walkFrames * DT * 1000;
  const ideal = (1.5 / WALK_SPEED) * 1000;
  assert.ok(walkMs >= ideal - DT * 1000 && walkMs <= ideal + 80, `walk ${walkFrames} frames`);
  assert.ok(RUN_SPEED > WALK_SPEED * 1.6);
  await h.frames(30);
  await h.session.loadMap('town', 3, 4, 'down');
  h.input.hold('down');
  const hopFrames = await h.until(() => state.y === 6);
  h.input.release();
  const hopMs = hopFrames * DT * 1000;
  assert.ok(hopMs >= HOP_MS && hopMs <= HOP_MS + 120, `hop ${hopFrames} frames`);
});

test('map music: a map without a track stops the previous song', () => {
  const calls = [];
  const audio = { playMusic: (id) => calls.push(['music', id]), stopMusic: () => calls.push(['stop']) };
  const music = createMapMusic({ audio, dayNight: { isNight: false } });
  music.enter({ kind: 'outdoor', def: { music: 'town' } });
  music.enter({ kind: 'indoor', def: {} });
  assert.deepEqual(calls, [['music', 'town'], ['stop']]);
  music.enter({ kind: 'indoor', def: { music: 'home' } });
  assert.deepEqual(calls.at(-1), ['music', 'home']);
});
