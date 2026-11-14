/**
 * Headless end-to-end walkthrough with the REAL modules: world session, map
 * builder, humanoid + wildling models, map registry, game state, camera rig and
 * day/night. Only the browser edges are faked: UI elements (dialog, card,
 * banner, fade), audio, input (driven by a BFS path-finder over canStep) and
 * localStorage.
 *
 * Story (once per starter): title preview → new game in Home (intro) → out the
 * door → the north exit is blocked by the ranger → up the stairs to the lab →
 * choose a partner → Wren takes hers, Field Journal, Wren runs off → back outside
 * → Wren's challenge → Nana Bee in Wren's house → north exit end card → a wild
 * encounter in tall grass → ledge hop off the knoll → Continue from the save.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWorldSession } from '../src/systems/world-session.js';
import { buildMap } from '../src/world/build-map.js';
import { createHumanoid } from '../src/actors/humanoid.js';
import { createWildlingModel } from '../src/actors/wildlings.js';
import { getMapDef } from '../src/world/map-registry.js';
import { isActive } from '../src/world/map-utils.js';
import { state, resetState, loadState, hasSave } from '../src/core/state.js';
import { createCameraRig } from '../src/render/camera-rig.js';
import { createDayNight } from '../src/render/daynight.js';
import { DIR_NAMES, PLAYER_LOOK, PREVIEW_MAP } from '../src/config.js';
import { STARTERS, WILD_SPECIES, WILDLINGS } from '../src/data/wildlings.js';
import { WREN_PICK } from '../src/world/maps/lab.js';

const DT = 1 / 60;
/** Hard cap on frames for the whole walkthrough (≈ 11 game minutes). */
const TOTAL_FRAME_CAP = 40000;

/** In-memory localStorage so autosave / Continue run for real. */
function installStorage() {
  const data = new Map();
  const store = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
  };
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
  return () => {
    if (had) Object.defineProperty(globalThis, 'localStorage', had);
    else delete globalThis.localStorage;
  };
}

/** Scripted input: one held direction plus queued presses (same API as core/input.js). */
function createFakeInput() {
  /** @type {string|null} */
  let held = null;
  const presses = new Set();
  return {
    hold(dir) {
      held = dir ?? null;
    },
    release() {
      held = null;
    },
    press(action) {
      presses.add(action);
    },
    isDown: (action) => action === held,
    heldDirection: () => held,
    pressed(action) {
      if (!presses.has(action)) return false;
      presses.delete(action);
      return true;
    },
    onPress: () => () => {},
    setVirtual() {},
    clear() {
      held = null;
      presses.clear();
    },
    endFrame() {
      presses.clear();
    },
  };
}

/** Fake UI: dialogs resolve at once and record every page; choices pick the first option. */
function createFakeUi() {
  /** @type {{speaker?: string, text: string, options?: string[]}[]} */
  const pages = [];
  /** @type {any[]} */
  const cards = [];
  /** @type {string[]} */
  const banners = [];
  const noop = () => {};
  const ui = {
    dialog: {
      isOpen: false,
      say(p, { speaker } = {}) {
        for (const text of Array.isArray(p) ? p : [p]) pages.push({ speaker, text });
        return Promise.resolve();
      },
      choose(prompt, options, { speaker } = {}) {
        pages.push({ speaker, text: prompt, options });
        return Promise.resolve(0);
      },
    },
    banner: { show: (text) => void banners.push(text) },
    fade: { fadeOut: () => Promise.resolve(), fadeIn: () => Promise.resolve() },
    card: {
      show(c) {
        cards.push(c);
        return Promise.resolve();
      },
    },
    menu: { open: noop, close: noop, isOpen: false },
    title: { hide: noop, show: noop },
    touch: {},
  };
  return { ui, pages, cards, banners };
}

/** Fake audio that records every call. */
function createFakeAudio() {
  /** @type {[string, string|undefined][]} */
  const calls = [];
  return {
    calls,
    audio: {
      unlock: async () => {},
      playMusic: (id) => void calls.push(['music', id]),
      stopMusic: () => void calls.push(['stop', undefined]),
      sfx: (id) => void calls.push(['sfx', id]),
      cry: (id) => void calls.push(['cry', id]),
      setMuted() {},
      muted: false,
    },
  };
}

/**
 * Shortest path (as directions) over the authoritative movement rules.
 * Warp and active trigger tiles are only entered when they are the goal.
 * @returns {string[]|null}
 */
function findPath(model, from, goal, flags, blocked = () => false) {
  const key = (x, y) => y * model.width + x;
  const startKey = key(from.x, from.y);
  const goalKey = key(goal.x, goal.y);
  if (startKey === goalKey) return [];
  const prev = new Map([[startKey, null]]);
  const queue = [{ x: from.x, y: from.y }];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    for (const dir of DIR_NAMES) {
      const res = model.canStep(cur.x, cur.y, dir, flags);
      if (!res.ok) continue;
      const k = key(res.x, res.y);
      if (prev.has(k) || blocked(res.x, res.y)) continue;
      if (k !== goalKey && (model.warpAt(res.x, res.y, flags) || model.triggerAt(res.x, res.y, flags))) continue;
      prev.set(k, { from: key(cur.x, cur.y), dir });
      if (k === goalKey) {
        const dirs = [];
        for (let at = k; at !== startKey; at = prev.get(at).from) dirs.unshift(prev.get(at).dir);
        return dirs;
      }
      queue.push({ x: res.x, y: res.y });
    }
  }
  return null;
}

/**
 * Play the whole story with one starter; the tall-grass visitor is `wild`.
 * @param {import('node:test').TestContext} t @param {string} mine @param {string} wild
 */
async function walkthrough(t, mine, wild) {
  const restoreStorage = installStorage();
  const consoleLog = { warn: [], error: [] };
  const origWarn = console.warn;
  const origError = console.error;
  console.warn = (...args) => void consoleLog.warn.push(args.map(String).join(' '));
  console.error = (...args) => void consoleLog.error.push(args.map((a) => a?.stack ?? String(a)).join(' '));
  t.after(() => {
    console.warn = origWarn;
    console.error = origError;
    restoreStorage();
  });

  const sessionLog = { warn: [], error: [] };
  const logger = {
    log() {},
    warn: (...args) => void sessionLog.warn.push(args.map(String).join(' ')),
    error: (...args) => void sessionLog.error.push(args.map((a) => a?.stack ?? String(a)).join(' ')),
  };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  const cameraRig = createCameraRig(camera);
  const fakeRenderer = { toneMappingExposure: 1 };
  const dayNight = createDayNight({ scene, renderer: fakeRenderer });
  dayNight.setOverride('day'); // deterministic music + lighting
  const input = createFakeInput();
  const { ui, pages, cards, banners } = createFakeUi();
  const { audio, calls } = createFakeAudio();

  // 'never': no encounters, long NPC idle timers. In the grass test every roll
  // succeeds; for the second wild species, rolls alternate low/high so the call
  // right after a successful roll (the species pick) lands on WILD_SPECIES[1].
  /** @type {'never'|'first'|'second'} */
  let luck = 'never';
  let flip = false;
  const random = () => {
    if (luck === 'never') return 0.99;
    if (luck === 'first') return 0.05;
    flip = !flip;
    return flip ? 0.05 : 0.95;
  };
  /** @type {any} */
  let playerModel = null;
  const session = createWorldSession({
    scene,
    cameraRig,
    dayNight,
    ui,
    audio,
    input,
    deps: {
      buildMap,
      getMapDef,
      createWildlingModel,
      createHumanoid(look) {
        const model = createHumanoid(look);
        if (look === PLAYER_LOOK) playerModel = model;
        return model;
      },
      random,
      logger,
    },
  });
  t.after(() => session.dispose());

  // ── frame pump ───────────────────────────────────────────────────────────
  let frames = 0;
  let elapsed = 0;
  async function frame() {
    if (++frames > TOTAL_FRAME_CAP) throw new Error(`walkthrough exceeded ${TOTAL_FRAME_CAP} frames`);
    elapsed += DT;
    session.update(DT, elapsed);
    cameraRig.update(DT);
    dayNight.update(DT, cameraRig.focus);
    input.endFrame();
    await new Promise((resolve) => setImmediate(resolve));
  }

  const where = () =>
    `map=${session.mapModel?.id} tile=${JSON.stringify(session.playerTile)} busy=${session.busy} frame=${frames}`;

  async function until(cond, max, label) {
    for (let i = 0; i < max; i++) {
      if (cond()) return i;
      await frame();
    }
    if (cond()) return max;
    throw new Error(`timed out: ${label} (${where()})`);
  }

  async function settle(promise, max, label) {
    let done = false;
    let failure = null;
    promise.then(
      () => (done = true),
      (err) => {
        failure = err;
        done = true;
      },
    );
    await until(() => done, max, label);
    if (failure) throw failure;
  }

  // Exact on purpose: on the last frame of a step t can be 0.9999…, and a
  // tolerance would report "stopped" one frame before the arrival.
  const stopped = () => {
    if (!playerModel) return false;
    const p = playerModel.group.position;
    const tile = session.playerTile;
    return p.x === tile.x && p.z === tile.y;
  };
  const idle = () => !session.busy && stopped();
  const flag = (name) => !!state.flags[name];
  const spoke = (re, speaker) => pages.some((p) => re.test(p.text) && (speaker === undefined || p.speaker === speaker));

  // Live NPC handles (via the Script API) so the path-finder can route around them.
  /** @type {{model: any, list: {def: any, h: any}[]}} */
  let npcs = { model: null, list: [] };
  async function refreshNpcs() {
    const model = session.mapModel;
    const list = await session.runScript((api) => model.npcs.map((def) => ({ def, h: api.npc(def.id) })));
    npcs = { model, list };
  }
  const npcAt = (x, y) =>
    npcs.list.some(({ def, h }) => isActive(def, state.flags) && h.x === x && h.y === y);

  /**
   * Walk on the current map toward (gx, gy), re-planning every frame around NPCs,
   * until `done()` holds.
   */
  async function travel(mapId, gx, gy, { done, max = 3000, label }) {
    const isDone = done ?? (() => session.mapModel?.id === mapId && session.playerTile.x === gx && session.playerTile.y === gy && idle());
    for (let i = 0; i < max; i++) {
      if (isDone()) {
        input.release();
        return;
      }
      const model = session.mapModel;
      if (!session.busy && model?.id === mapId) {
        if (npcs.model !== model) await refreshNpcs();
        const from = session.playerTile;
        const path =
          findPath(model, from, { x: gx, y: gy }, state.flags, npcAt) ??
          findPath(model, from, { x: gx, y: gy }, state.flags);
        assert.ok(path, `no path to (${gx}, ${gy}) for ${label} (${where()})`);
        input.hold(path[0] ?? null);
      } else {
        input.release();
      }
      await frame();
    }
    input.release();
    throw new Error(`timed out: ${label} (${where()})`);
  }

  /** Face `dir` (a one-frame tap turns in place) and press a until something starts. */
  async function interact(dir, label) {
    await until(idle, 240, `idle before ${label}`);
    if (session.playerTile.facing !== dir) {
      input.hold(dir);
      await frame();
      input.release();
      await frame();
    }
    assert.equal(session.playerTile.facing, dir, `facing for ${label}`);
    // A script without game-time waits can start and finish within one frame,
    // so new dialogue counts as "started" just like a busy session.
    const before = pages.length + cards.length;
    await until(
      () => {
        if (session.busy || pages.length + cards.length > before) return true;
        input.press('a');
        return false;
      },
      60,
      `interaction starts: ${label}`,
    );
    await until(() => !session.busy, 4000, `interaction ends: ${label}`);
  }

  // ── title preview (as main.js does before the title screen) ──────────────
  await settle(session.preview(PREVIEW_MAP), 30, 'preview');
  assert.equal(session.mapModel.id, PREVIEW_MAP);
  assert.equal(cameraRig.mode, 'title');
  for (let i = 0; i < 90; i++) await frame();
  assert.equal(session.busy, false);

  // ── new game: Home, Mom's wake-up scene ──────────────────────────────────
  resetState();
  await settle(session.start(), 3000, 'start + intro');
  assert.equal(session.mapModel.id, 'home');
  assert.equal(cameraRig.mode, 'indoor');
  assert.ok(flag('intro_done'), 'intro sets intro_done');
  assert.ok(spoke(/Rise and shine/, 'Mom'), 'Mom wakes you up');
  assert.ok(calls.some(([k, id]) => k === 'music' && id === 'home'), 'home music');
  assert.ok(hasSave(), 'autosave after the first load');

  // ── out the door ─────────────────────────────────────────────────────────
  await travel('home', 5, 7, {
    label: 'home exit',
    done: () => session.mapModel?.id === 'fernhollow' && idle(),
  });
  assert.deepEqual([session.playerTile.x, session.playerTile.y], [5, 12]);
  assert.equal(cameraRig.mode, 'outdoor');
  assert.ok(banners.includes('Fernhollow'), 'location banner on entering the village');
  assert.ok(calls.some(([k, id]) => k === 'music' && id === 'town'), 'town music');
  assert.ok(calls.some(([k, id]) => k === 'sfx' && id === 'door'), 'door sound');

  // ── the north exit is closed without a partner ───────────────────────────
  await travel('fernhollow', 15, 2, { label: 'north exit (blocked)', done: () => flag('tamsin_warned') && idle() });
  assert.ok(spoke(/Whoa there!/, 'Ranger Tamsin'), 'Tamsin turns you back');
  assert.deepEqual([session.playerTile.x, session.playerTile.y], [15, 3], 'walked back down');
  {
    const model = session.mapModel;
    const tamsin = model.npcs.find((n) => n.id === 'tamsin');
    assert.ok(isActive(tamsin, state.flags), 'Tamsin stands in the gap');
    const blocked = (x, y) => (x === tamsin.x && y === tamsin.y) || !!model.triggerAt(x, y, state.flags);
    for (const x of [15, 16, 17]) {
      assert.equal(findPath(model, session.playerTile, { x, y: 0 }, state.flags, blocked), null, `row 0 at x=${x} unreachable`);
    }
  }

  // ── up the switchback stairs to the lab ──────────────────────────────────
  let maxLevel = 0;
  await travel('fernhollow', 26, 7, {
    label: 'lab door',
    max: 4000,
    done: () => {
      const m = session.mapModel;
      if (m?.id === 'fernhollow') maxLevel = Math.max(maxLevel, m.levelAt(session.playerTile.x, session.playerTile.y));
      return m?.id === 'lab' && idle();
    },
  });
  assert.equal(maxLevel, 2, 'climbed to the plateau');
  assert.ok(flag('met_marrow'), 'Dr. Marrow greets you');
  assert.ok(spoke(/Ah, there you are!/, 'Dr. Marrow'));
  for (const id of STARTERS) assert.ok(state.seen.includes(id), `${id} seen`);
  assert.ok(calls.some(([k, id]) => k === 'music' && id === 'lab'), 'lab music');

  // ── choose a partner at its pedestal ─────────────────────────────────────
  const theirs = WREN_PICK[mine];
  const pedestal = session.mapModel.objects.find((o) => o.type === 'pedestal' && o.species === mine);
  await travel('lab', pedestal.x, pedestal.y + 1, { label: 'pedestal' });
  await interact('up', 'pedestal');
  assert.ok(pages.some((p) => p.text === `Partner with ${WILDLINGS[mine].name}?`), 'confirm prompt');
  assert.equal(state.party.length, 1, 'one partner');
  assert.equal(state.party[0].species, mine);
  assert.ok(flag(`chose_${mine}`) && flag('has_partner'));
  assert.ok(flag(`wren_took_${theirs}`), `Wren took ${theirs}`);
  assert.ok(flag('has_journal'), 'Field Journal received');
  assert.ok(flag('wren_left_lab'), 'Wren ran outside');
  assert.ok(calls.some(([k, id]) => k === 'sfx' && id === 'fanfare'), 'fanfare');
  {
    const follower = await session.runScript((api) => api.follower);
    assert.ok(follower, 'follower exists');
    assert.equal(follower.species, mine);
    const followerGroups = scene.children.filter((o) => o.name === `wildling:${mine}`);
    assert.equal(followerGroups.length, 1, 'follower model is in the scene');
    assert.equal(followerGroups[0].visible, true);
    // The emptied pedestals no longer show their hatchlings.
    const mapGroup = scene.children.find((o) => o.name === 'map:lab');
    const onPedestal = (id) => {
      let found = null;
      mapGroup.traverse((o) => {
        if (o.name === `wildling:${id}`) found = o;
      });
      return found;
    };
    assert.equal(onPedestal(mine)?.visible, false, 'your pedestal is empty');
    assert.equal(onPedestal(theirs)?.visible, false, "Wren's pedestal is empty");
    const left = STARTERS.find((id) => id !== mine && id !== theirs);
    assert.equal(onPedestal(left)?.visible, true, 'the third hatchling stays');
    // Wren really walked: to her pedestal, then out onto the exit mat.
    const wren = npcs.list.find(({ def }) => def.id === 'wren').h;
    const exitMat = session.mapModel.warps[0];
    assert.deepEqual([wren.x, wren.y], [exitMat.x, exitMat.y], 'Wren walked to the exit mat');
  }

  // ── back outside; Wren waits in the plaza with a challenge ───────────────
  const exit = session.mapModel.warps[0];
  await travel('lab', exit.x, exit.y, {
    label: 'lab exit',
    done: () => session.mapModel?.id === 'fernhollow' && idle(),
  });
  assert.deepEqual([session.playerTile.x, session.playerTile.y], [26, 8]);
  assert.ok(await session.runScript((api) => api.follower), 'follower re-appears after the warp');
  await travel('fernhollow', 12, 11, { label: 'next to Wren', max: 4000 });
  await interact('right', 'Wren');
  assert.ok(flag('wren_challenge'), 'challenge accepted');
  assert.ok(spoke(/compare Field Journals/, 'Wren'));

  // ── visit Wren's house and say hello to Nana Bee ─────────────────────────
  await travel('fernhollow', 24, 20, {
    label: "Wren's door",
    max: 4000,
    done: () => session.mapModel?.id === 'wren-house' && idle(),
  });
  assert.equal(cameraRig.mode, 'indoor');
  const nana = session.mapModel.npcs.find((n) => n.id === 'nana-bee');
  await travel('wren-house', nana.x, nana.y + 1, { label: 'Nana Bee' });
  const nanaPages = pages.length;
  await interact('up', 'Nana Bee');
  assert.ok(pages.slice(nanaPages).some((p) => p.speaker === nana.name), 'Nana Bee talks');
  const houseExit = session.mapModel.warps[0];
  await travel('wren-house', houseExit.x, houseExit.y, {
    label: "Wren's house exit",
    done: () => session.mapModel?.id === 'fernhollow' && idle(),
  });
  assert.deepEqual([session.playerTile.x, session.playerTile.y], [houseExit.tx, houseExit.ty]);

  // ── the north exit is open now: end-of-demo card ─────────────────────────
  await travel('fernhollow', 16, 0, { label: 'north exit (open)', max: 4000, done: () => cards.length > 0 && idle() });
  assert.equal(cards[0].title, 'Thanks for playing!');
  assert.deepEqual([session.playerTile.x, session.playerTile.y], [16, 1], 'walked back from the edge');

  // ── tall grass: a wild wildling peeks out ────────────────────────────────
  const seenBefore = state.seen.length;
  luck = WILD_SPECIES.indexOf(wild) === 0 ? 'first' : 'second';
  await travel('fernhollow', 5, 4, {
    label: 'meadow encounter',
    done: () => state.seen.length > seenBefore && idle(),
  });
  luck = 'never';
  const wildName = WILDLINGS[wild].name;
  assert.ok(state.seen.includes(wild), `${wild} seen`);
  assert.ok(pages.some((p) => p.text === `A wild ${wildName} peeked out of the tall grass!`), 'encounter text');
  assert.ok(pages.some((p) => p.text === `Your Field Journal notes the ${wildName}. Neat!`), 'journal note');
  assert.ok(calls.some(([k, id]) => k === 'sfx' && id === 'encounter'));
  assert.ok(calls.some(([k, id]) => k === 'cry' && id === wild));
  for (let i = 0; i < 120; i++) await frame();
  assert.equal(scene.children.filter((o) => o.name === `wildling:${wild}`).length, 0, 'wild visitor cleaned up');

  // ── knoll stairs, then hop the ledge down to the pond shore ──────────────
  await travel('fernhollow', 5, 17, { label: 'knoll top', max: 4000 });
  assert.equal(session.mapModel.levelAt(5, 17), 1, 'on the knoll');
  const ledgeSfx = calls.filter(([k, id]) => k === 'sfx' && id === 'ledge').length;
  await travel('fernhollow', 5, 19, { label: 'ledge hop' });
  assert.equal(calls.filter(([k, id]) => k === 'sfx' && id === 'ledge').length, ledgeSfx + 1, 'one hop');
  // The follower trails one step behind: it hops the ledge on the player's next step.
  await travel('fernhollow', 4, 19, { label: 'step after the hop' });
  for (let i = 0; i < 60; i++) await frame();
  {
    const follower = scene.children.find((o) => o.name === `wildling:${mine}`);
    const p = playerModel.group.position;
    assert.ok(follower?.visible, 'follower visible after the hop');
    assert.ok(Math.hypot(follower.position.x - p.x, follower.position.z - p.z) <= 1.01, 'follower caught up');
    assert.ok(Math.abs(follower.position.y - p.y) < 1e-6, 'follower landed on the shore level');
  }

  // ── camera + state bookkeeping ───────────────────────────────────────────
  const tile = session.playerTile;
  assert.deepEqual([state.mapId, state.x, state.y], ['fernhollow', tile.x, tile.y]);
  assert.ok(Math.hypot(cameraRig.focus.x - tile.x, cameraRig.focus.z - tile.y) < 1.5, 'camera follows the player');

  // ── Continue from the autosave ───────────────────────────────────────────
  const saved = JSON.parse(globalThis.localStorage.getItem('wildling-trails:save:v1'));
  resetState();
  assert.equal(state.party.length, 0);
  assert.equal(loadState(), true);
  assert.equal(state.party[0]?.species, mine);
  await settle(session.start(), 600, 'continue');
  assert.equal(session.mapModel.id, saved.mapId);
  assert.deepEqual([session.playerTile.x, session.playerTile.y], [saved.x, saved.y]);
  assert.ok(await session.runScript((api) => api.follower), 'follower after Continue');

  // ── nothing logged along the way ─────────────────────────────────────────
  assert.equal(calls.filter(([k, id]) => k === 'sfx' && id === 'bump').length, 0, 'no bumps on planned routes');
  assert.deepEqual(sessionLog.error, [], 'session errors');
  assert.deepEqual(sessionLog.warn, [], 'session warnings');
  assert.deepEqual(consoleLog.error, [], 'console errors');
  assert.deepEqual(consoleLog.warn, [], 'console warnings');
}

STARTERS.forEach((mine, i) => {
  const wild = WILD_SPECIES[i % WILD_SPECIES.length];
  test(`walkthrough with ${mine}: intro → blocked exit → lab → end card → ${wild} in the grass → continue`, { timeout: 120_000 }, (t) =>
    walkthrough(t, mine, wild),
  );
});
