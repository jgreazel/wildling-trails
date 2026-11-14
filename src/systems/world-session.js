/**
 * World session: owns the live map and everything walking around on it.
 *
 * Wires together the grid movers, player/NPC/follower controllers, interaction,
 * arrival rules (warps, triggers, tall grass), flavour encounters, map music and
 * the Script API. See docs/ARCHITECTURE.md → "systems".
 */
import * as THREE from 'three';
import { DIRS, PLAYER_LOOK, START_MAP } from '../config.js';
import { bus as globalBus } from '../core/events.js';
import {
  state as globalState,
  saveState,
  addPartner,
  markSeen,
  setFlag,
  getFlag,
} from '../core/state.js';
import { createMapModel } from '../world/map-utils.js';
import { getMapDef } from '../world/map-registry.js';
import { buildMap } from '../world/build-map.js';
import { createHumanoid } from '../actors/humanoid.js';
import { createWildlingModel } from '../actors/wildlings.js';
import { createClock } from './clock.js';
import { createOccupancy } from './occupancy.js';
import { disposeModel, updateModel } from './actor-utils.js';
import { createPlayerController } from './player-controller.js';
import { createFollowerController } from './follower.js';
import { createNpcController } from './npc-controller.js';
import { createInteraction } from './interaction.js';
import { createEncounters } from './encounters.js';
import { createArrival } from './arrival.js';
import { createMapMusic } from './map-music.js';
import { createScriptApi } from './script-api.js';

/** After any script/warp ends, ignore the a-button this long (no accidental re-talk). */
const INTERACT_COOLDOWN_MS = 160;
/** An a-press during the last moments of a step is remembered this long. */
const INTERACT_BUFFER_MS = 150;
/** A fade that never settles must not freeze the game. */
const FADE_TIMEOUT_MS = 1500;

/** @typedef {import('../config.js').Dir} Dir */

/**
 * @typedef {object} WorldSessionDeps
 * @property {typeof buildMap} [buildMap]
 * @property {typeof createHumanoid} [createHumanoid]
 * @property {typeof createWildlingModel} [createWildlingModel]
 * @property {typeof getMapDef} [getMapDef]
 * @property {typeof createMapModel} [createMapModel]
 * @property {() => number} [random]
 * @property {typeof saveState} [saveState]
 * @property {typeof addPartner} [addPartner]
 * @property {typeof markSeen} [markSeen]
 * @property {typeof setFlag} [setFlag]
 * @property {typeof getFlag} [getFlag]
 * @property {any} [state]   defaults to the shared game state
 * @property {any} [bus]     defaults to the app bus
 * @property {Pick<Console, 'log'|'warn'|'error'>} [logger]
 */

/**
 * @typedef {object} WorldSession
 * @property {(mapId: string) => Promise<void>} preview  map + wandering NPCs, title camera, no player
 * @property {() => Promise<void>} start  load state.mapId at state.x/y (spawn when null)
 * @property {(mapId: string, x?: number, y?: number, facing?: Dir, opts?: {fade?: boolean}) => Promise<void>} loadMap
 * @property {(dt: number, elapsed?: number) => void} update
 * @property {(paused: boolean) => void} setPaused
 * @property {(idOrFn: string|((api: any) => any)) => Promise<any>} runScript
 * @property {boolean} busy
 * @property {boolean} paused
 * @property {any} mapModel
 * @property {{x:number, y:number, facing:Dir}} playerTile
 * @property {() => void} dispose  detach bus listeners and free the map (tests / hot reload)
 */

/**
 * Create the world session.
 * @param {object} opts
 * @param {any} opts.scene        THREE.Scene
 * @param {any} opts.cameraRig    see render/camera-rig.js
 * @param {any} opts.dayNight     see render/daynight.js
 * @param {any} opts.ui           { dialog, banner, fade, card, menu, title, touch }
 * @param {any} opts.audio        audio facade
 * @param {any} opts.input        input singleton
 * @param {WorldSessionDeps} [opts.deps]
 * @returns {WorldSession}
 */
export function createWorldSession({ scene, cameraRig, dayNight, ui = {}, audio, input, deps = {} } = /** @type {any} */ ({})) {
  const logger = deps.logger ?? console;
  const d = {
    buildMap,
    createHumanoid,
    createWildlingModel,
    getMapDef,
    createMapModel,
    saveState,
    addPartner,
    markSeen,
    setFlag,
    getFlag,
    PLAYER_LOOK,
    ...deps,
  };
  const random = typeof deps.random === 'function' ? deps.random : Math.random;
  const bus = deps.bus ?? globalBus;
  const state = deps.state ?? globalState;
  const sound = wrapAudio(audio, logger);
  const previewPos = new THREE.Vector3(-9999, 0, -9999);
  /** @type {Set<string>} */
  const loggedErrors = new Set();

  let busyCount = 0;
  let scriptDepth = 0;
  let paused = false;
  let loadSeq = 0;
  let interactCooldown = 0;
  let interactBuffer = 0;
  let ownElapsed = 0;
  let disposed = false;
  /** @type {string|null} name of the previous playable map (for the location banner) */
  let lastPlayName = null;

  /** Shared context handed to every systems module. */
  const ctx = {
    scene,
    cameraRig,
    dayNight,
    ui,
    input,
    audio: sound,
    deps: d,
    state,
    random,
    logger,
    clock: createClock({ logger }),
    occupancy: createOccupancy(),
    /** @type {Set<any>} short-lived models (encounters) */
    transients: new Set(),
    /** @type {any} */ mapModel: null,
    /** @type {any} */ mapView: null,
    preview: false,
    /** @param {number} x @param {number} y */
    surfaceY: (x, y) => (ctx.mapModel ? ctx.mapModel.surfaceY(x, y) : 0),
    isBusy: () => busyCount > 0,
    isPaused: () => paused,
    /** @param {number} x @param {number} y */
    rustle(x, y) {
      try {
        ctx.mapView?.rustleGrass?.(x, y);
      } catch (err) {
        logOnce('rustle', err);
      }
    },
    runScript,
    warpTo,
    /** @param {number} x @param {number} y */
    onPlayerArrive: (x, y) => ctx.arrival.onPlayerArrive(x, y),
    /** @param {number} x @param {number} y @param {Dir} dir @param {any} res */
    onPlayerBlocked: (x, y, dir, res) => ctx.arrival.onPlayerBlocked(x, y, dir, res),
    /** @type {any} */ player: null,
    /** @type {any} */ follower: null,
    /** @type {any} */ npcs: null,
    /** @type {any} */ interaction: null,
    /** @type {any} */ encounters: null,
    /** @type {any} */ arrival: null,
    music: createMapMusic({ audio: sound, dayNight }),
  };
  ctx.player = createPlayerController(ctx);
  ctx.follower = createFollowerController(ctx);
  ctx.npcs = createNpcController(ctx);
  ctx.interaction = createInteraction(ctx);
  ctx.encounters = createEncounters(ctx);
  ctx.arrival = createArrival(ctx);
  const api = createScriptApi(ctx);

  /** @param {string} key @param {unknown} err */
  function logOnce(key, err) {
    const msg = `${key}:${/** @type {any} */ (err)?.message ?? err}`;
    if (loggedErrors.has(msg)) return;
    loggedErrors.add(msg);
    logger.error(`[world] ${key} failed`, err);
  }

  // ── busy bookkeeping ────────────────────────────────────────────────────

  function busyInc() {
    busyCount += 1;
    if (busyCount === 1) ctx.player.halt();
  }

  function busyDec() {
    busyCount = Math.max(0, busyCount - 1);
    if (busyCount === 0) {
      interactCooldown = INTERACT_COOLDOWN_MS;
      interactBuffer = 0;
    }
  }

  function closeDialog() {
    const dlg = ui?.dialog;
    try {
      if (dlg?.isOpen) (dlg.close ?? dlg.hide)?.call(dlg);
    } catch (err) {
      logger.error('[world] could not close the dialog', err);
    }
  }

  // ── scripts ─────────────────────────────────────────────────────────────

  /**
   * Run a map script (by id on the current map) or a function, with the player frozen.
   * Errors are logged and swallowed; busy is always released.
   * @param {string|((api:any) => any)} idOrFn
   */
  async function runScript(idOrFn) {
    let fn = idOrFn;
    let label = 'inline';
    if (typeof idOrFn === 'string') {
      label = idOrFn;
      fn = ctx.mapModel?.scripts?.[idOrFn];
    }
    if (typeof fn !== 'function') {
      logger.warn(`[world] unknown script "${String(idOrFn)}" on map "${ctx.mapModel?.id ?? '-'}"`);
      return undefined;
    }
    busyInc();
    scriptDepth += 1;
    try {
      return await fn(api);
    } catch (err) {
      logger.error(`[world] script "${label}" failed`, err);
      return undefined;
    } finally {
      scriptDepth -= 1;
      if (scriptDepth === 0) closeDialog();
      busyDec();
    }
  }

  /**
   * Door-style warp: door sound, then a faded map load. Never throws.
   * @param {string} mapId @param {number} [x] @param {number} [y] @param {Dir} [facing]
   */
  async function warpTo(mapId, x, y, facing) {
    sound.sfx('door');
    try {
      await loadMap(mapId, x, y, facing);
    } catch (err) {
      logger.error(`[world] warp to "${mapId}" failed`, err);
    }
  }

  // ── loading ─────────────────────────────────────────────────────────────

  /** @param {'fadeOut'|'fadeIn'} kind */
  async function runFade(kind) {
    const el = ui?.fade;
    if (!el || typeof el[kind] !== 'function') return;
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let timer;
    try {
      const timeout = new Promise((resolve) => {
        timer = setTimeout(resolve, FADE_TIMEOUT_MS);
      });
      await Promise.race([Promise.resolve(el[kind]()), timeout]);
    } catch (err) {
      logger.error(`[world] ${kind} failed`, err);
    } finally {
      clearTimeout(timer);
    }
  }

  function emptyView() {
    return { group: new THREE.Group(), update() {}, applyFlags() {}, rustleGrass() {}, dispose() {} };
  }

  /** @param {any} model */
  function buildView(model) {
    let view = null;
    try {
      view = d.buildMap(model, { flags: state.flags, createWildlingModel: d.createWildlingModel });
      if (!view?.group) {
        logger.error(`[world] buildMap returned no group for "${model.id}"`);
        view = null;
      }
    } catch (err) {
      logger.error(`[world] buildMap failed for "${model.id}"`, err);
    }
    view = view ?? emptyView();
    scene?.add?.(view.group);
    return view;
  }

  function teardown() {
    ctx.clock.flush();
    for (const model of ctx.transients) disposeModel(scene, model, logger);
    ctx.transients.clear();
    ctx.player.despawn();
    ctx.follower.despawn();
    ctx.npcs.despawnAll();
    ctx.occupancy.clear();
    if (ctx.mapView) {
      try {
        scene?.remove?.(ctx.mapView.group);
        ctx.mapView.dispose?.();
      } catch (err) {
        logger.error('[world] map dispose failed', err);
      }
    }
    ctx.mapView = null;
    ctx.mapModel = null;
    ctx.music.leave();
  }

  /**
   * Where the player should appear: the requested tile if it is walkable,
   * else the map spawn (else the first walkable tile).
   * @param {any} model @param {number|undefined} x @param {number|undefined} y @param {Dir|undefined} facing
   */
  function resolveSpot(model, x, y, facing) {
    const flags = state.flags;
    /** @param {any} px @param {any} py */
    const valid = (px, py) => Number.isInteger(px) && Number.isInteger(py) && model.isWalkableStatic(px, py, flags);
    if (x != null || y != null) {
      if (valid(x, y)) {
        const dir = DIRS[facing] ? facing : DIRS[state.facing] ? state.facing : 'down';
        return { x: /** @type {number} */ (x), y: /** @type {number} */ (y), facing: dir };
      }
      logger.warn(`[world] (${x}, ${y}) is not walkable on "${model.id}"; using its spawn`);
    }
    const spawn = model.spawn ?? {};
    const dir = DIRS[facing] ? facing : DIRS[spawn.facing] ? spawn.facing : 'down';
    if (valid(spawn.x, spawn.y)) return { x: spawn.x, y: spawn.y, facing: dir };
    for (let ty = 0; ty < model.height; ty++) {
      for (let tx = 0; tx < model.width; tx++) {
        if (valid(tx, ty)) return { x: tx, y: ty, facing: dir };
      }
    }
    return { x: 0, y: 0, facing: dir };
  }

  /** @param {any} model */
  function cameraBounds(model) {
    return { minX: -0.5, maxX: model.width - 0.5, minZ: -0.5, maxZ: model.height - 0.5 };
  }

  /**
   * @param {string} mapId
   * @param {{x?: number, y?: number, facing?: Dir, fade?: boolean, preview?: boolean}} opts
   */
  async function doLoad(mapId, { x, y, facing, fade = true, preview = false }) {
    if (disposed) return;
    const def = d.getMapDef(mapId);
    if (!def) throw new Error(`Unknown map "${mapId}"`);
    const seq = ++loadSeq;
    busyInc();
    let fadedOut = false;
    try {
      if (fade && ctx.mapModel) {
        await runFade('fadeOut');
        fadedOut = true;
      }
      if (seq !== loadSeq || disposed) return;

      // Build the model first: if the definition is broken, the old map stays.
      const model = d.createMapModel(def);
      teardown();
      ctx.mapModel = model;
      ctx.preview = preview;
      ctx.mapView = buildView(model);
      try {
        dayNight?.setIndoor?.(model.kind === 'indoor');
      } catch (err) {
        logger.error('[world] dayNight.setIndoor failed', err);
      }
      ctx.npcs.spawnAll();

      if (preview) {
        lastPlayName = null;
        const center = new THREE.Vector3((model.width - 1) / 2, 0, (model.height - 1) / 2);
        callRig('setMode', 'title', { center });
        callRig('snap');
      } else {
        const spot = resolveSpot(model, x, y, facing);
        ctx.player.spawn(spot.x, spot.y, spot.facing);
        state.mapId = model.id;
        ctx.follower.spawn();
        callRig('setMode', model.kind, { bounds: cameraBounds(model) });
        callRig('setTarget', ctx.player.actor.mover.ground);
        callRig('snap');
        ctx.music.enter(model);
        if (model.kind === 'outdoor' && model.name !== lastPlayName) {
          try {
            ui?.banner?.show?.(model.name);
          } catch (err) {
            logger.error('[world] banner failed', err);
          }
        }
        lastPlayName = model.name;
        ctx.encounters.onMapLoad();
        bus.emit('map', { id: model.id });
      }

      if (fadedOut) {
        fadedOut = false;
        await runFade('fadeIn');
      }
      if (preview || seq !== loadSeq || disposed) return;

      const onEnter = model.def.onEnter;
      if (onEnter) await runScript(onEnter);
      if (seq === loadSeq && !disposed) {
        try {
          d.saveState();
        } catch (err) {
          logger.error('[world] autosave failed', err);
        }
      }
    } finally {
      // Never leave the screen black, whatever went wrong above.
      if (fadedOut && seq === loadSeq) await runFade('fadeIn');
      busyDec();
    }
  }

  /** @param {string} method @param {...any} args */
  function callRig(method, ...args) {
    try {
      cameraRig?.[method]?.(...args);
    } catch (err) {
      logOnce(`cameraRig.${method}`, err);
    }
  }

  /**
   * Load a playable map and place the player.
   * @param {string} mapId @param {number} [x] @param {number} [y] @param {Dir} [facing]
   * @param {{fade?: boolean}} [opts]
   */
  function loadMap(mapId, x, y, facing, { fade = true } = {}) {
    return doLoad(mapId, { x, y, facing, fade, preview: false });
  }

  // ── per-frame ───────────────────────────────────────────────────────────

  /** @param {number} dtMs */
  function pollInteract(dtMs) {
    if (interactCooldown > 0) {
      interactCooldown -= dtMs;
      return;
    }
    const p = ctx.player.actor;
    if (!p) return;
    let wants = false;
    try {
      wants = !!input?.pressed?.('a');
    } catch {
      wants = false;
    }
    if (wants && p.mover.moving) {
      interactBuffer = INTERACT_BUFFER_MS;
      return;
    }
    if (interactBuffer > 0) {
      interactBuffer -= dtMs;
      if (!p.mover.moving) {
        interactBuffer = 0;
        wants = true;
      }
    }
    if (wants && !p.mover.moving) ctx.interaction.tryInteract();
  }

  /** @param {number} dt seconds */
  function animateActors(dt) {
    const p = ctx.player.actor;
    if (p) updateModel(p.model, dt, logger);
    for (const npc of ctx.npcs.list) updateModel(npc.model, dt, logger);
    const f = ctx.follower.actor;
    if (f) updateModel(f.model, dt, logger);
    for (const model of ctx.transients) updateModel(model, dt, logger);
  }

  /**
   * Advance the world one frame.
   * @param {number} dt seconds (clamped to 0.1)
   * @param {number} [elapsed] seconds since start (for ambient animation)
   */
  function update(dt, elapsed) {
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    ownElapsed += step;
    const time = Number.isFinite(elapsed) ? /** @type {number} */ (elapsed) : ownElapsed;
    if (!ctx.mapModel || disposed) return;
    const dtMs = step * 1000;

    if (!paused) {
      try {
        ctx.clock.update(dtMs);
        ctx.player.update(dtMs, busyCount === 0 && !ctx.preview);
        if (busyCount === 0 && !ctx.preview) pollInteract(dtMs);
        ctx.npcs.update(dtMs, busyCount === 0);
        ctx.follower.update(dtMs);
        if (!ctx.preview) ctx.music.update(dtMs);
      } catch (err) {
        logOnce('update', err);
      }
    }

    animateActors(step);
    const p = ctx.player.actor;
    try {
      ctx.mapView?.update?.(step, time, {
        nightFactor: dayNight?.nightFactor ?? 0,
        focus: cameraRig?.focus,
        playerPos: p ? p.model.group.position : previewPos,
      });
    } catch (err) {
      logOnce('mapView.update', err);
    }
    if (p) callRig('setTarget', p.mover.ground);
  }

  /** @param {boolean} value */
  function setPaused(value) {
    const next = !!value;
    if (next === paused) return;
    paused = next;
    const actors = [ctx.player.actor, ctx.follower.actor, ...ctx.npcs.list].filter(Boolean);
    for (const a of actors) {
      const m = a.mover;
      if (m.moving && !m.hop) m.setAnim(!paused, m.running);
    }
    if (!paused) interactCooldown = INTERACT_COOLDOWN_MS;
  }

  // ── bus ─────────────────────────────────────────────────────────────────

  const offs = [
    bus.on('flag', () => {
      if (!ctx.mapModel) return;
      try {
        ctx.mapView?.applyFlags?.(state.flags);
      } catch (err) {
        logOnce('applyFlags', err);
      }
      ctx.npcs.refreshVisibility();
    }),
    bus.on('party', () => {
      if (!ctx.mapModel || ctx.preview || !ctx.player.actor) return;
      ctx.follower.sync({ animate: true });
    }),
  ];

  return {
    preview(mapId) {
      return doLoad(mapId, { fade: false, preview: true });
    },

    async start() {
      const known = Number.isInteger(state.x) && Number.isInteger(state.y);
      const mapId = state.mapId || START_MAP;
      try {
        await loadMap(mapId, known ? state.x : undefined, known ? state.y : undefined, known ? state.facing : undefined);
      } catch (err) {
        if (mapId === START_MAP) throw err;
        logger.error(`[world] could not load "${mapId}"; starting at "${START_MAP}"`, err);
        await loadMap(START_MAP);
      }
    },

    loadMap,
    update,
    setPaused,
    runScript,

    get busy() {
      return busyCount > 0;
    },
    get paused() {
      return paused;
    },
    get mapModel() {
      return ctx.mapModel;
    },
    get playerTile() {
      const m = ctx.player.actor?.mover;
      if (m) return { x: m.x, y: m.y, facing: m.facing };
      return { x: state.x ?? 0, y: state.y ?? 0, facing: state.facing ?? 'down' };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const off of offs) off();
      teardown();
    },
  };
}

/**
 * Audio facade that can never throw into game logic.
 * @param {any} audio
 * @param {Pick<Console, 'error'>} logger
 */
function wrapAudio(audio, logger) {
  /** @type {Set<string>} */
  const failed = new Set();
  /** @param {string} name @param {any[]} args */
  function call(name, args) {
    try {
      return audio?.[name]?.(...args);
    } catch (err) {
      if (!failed.has(name)) {
        failed.add(name);
        logger.error(`[world] audio.${name} failed`, err);
      }
      return undefined;
    }
  }
  return {
    /** @param {string} id */
    sfx: (id) => call('sfx', [id]),
    /** @param {string} species */
    cry: (species) => call('cry', [species]),
    /** @param {string} id @param {any} [opts] */
    playMusic: (id, opts) => call('playMusic', opts ? [id, opts] : [id]),
    /** @param {any} [opts] */
    stopMusic: (opts) => call('stopMusic', [opts]),
  };
}
