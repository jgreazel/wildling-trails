/**
 * Audio facade: one AudioContext, the mix (music / sfx buses -> gentle compressor ->
 * master), music crossfades, sfx, species cries, mute and tab-visibility handling.
 *
 * Every method is a safe no-op when Web Audio is unavailable (e.g. Node) or before
 * unlock(). playMusic() before unlock() remembers the request and starts it on unlock.
 * Nothing here touches window/document/AudioContext at import time.
 *
 * Contract (docs/ARCHITECTURE.md → audio):
 *   audio.unlock() → Promise<void>
 *   audio.playMusic(id, { fadeMs = 600 } = {})
 *   audio.stopMusic({ fadeMs })
 *   audio.sfx(id)
 *   audio.cry(speciesId)
 *   audio.setMuted(bool); audio.muted
 */
import { SONGS } from './songs.js';
import { compileSong, createSongPlayer, createScheduler, defaultTimers } from './sequencer.js';
import { playSfx, hasSfx, SFX_THROTTLE } from './sfx.js';
import { playCry } from './cries.js';
import { glideParam, holdParam, warnOnce } from './util.js';

/** Bus levels. */
export const MIX = Object.freeze({ master: 0.6, music: 0.32, sfx: 0.55 });

const DEFAULT_FADE_MS = 600;
const MUTE_SECONDS = 0.12;
const RESUME_TIMEOUT_MS = 400;

/**
 * @typedef {object} AudioDeps  Injection points (tests); all optional.
 * @property {(new (opts?: any) => AudioContext)|null} [AudioContext]  constructor; null = force "no Web Audio"
 * @property {{ hidden?: boolean, addEventListener: Function, removeEventListener: Function }|null} [document]
 * @property {{ addEventListener: Function, removeEventListener: Function }|null} [window]
 * @property {import('./sequencer.js').Timers} [timers]
 * @property {() => number} [random]
 * @property {number} [resumeTimeoutMs]  how long unlock() waits for resume() before resolving anyway
 */

/**
 * @typedef {object} AudioApi
 * @property {() => Promise<void>} unlock
 * @property {(id: string, opts?: { fadeMs?: number }) => void} playMusic
 * @property {(opts?: { fadeMs?: number }) => void} stopMusic
 * @property {(id: string) => void} sfx
 * @property {(speciesId: string) => void} cry
 * @property {(muted: boolean) => void} setMuted
 * @property {boolean} muted
 * @property {string|null} currentMusic  id of the song playing (or requested before unlock)
 * @property {boolean} unlocked
 * @property {() => void} dispose  tear everything down (tests / hot reload)
 * @property {object} _internals  read-only view for tests and devtools
 */

/**
 * Create an audio engine. The game uses the `audio` singleton below; tests create
 * their own instances with a fake AudioContext.
 * @param {AudioDeps} [deps]
 * @returns {AudioApi}
 */
export function createAudio(deps = {}) {
  const timers = deps.timers ?? defaultTimers();
  const random = deps.random ?? Math.random;
  const resumeTimeoutMs = deps.resumeTimeoutMs ?? RESUME_TIMEOUT_MS;

  let muted = false;
  /** @type {AudioContext|null} */
  let ctx = null;
  /** @type {{ master: GainNode, music: GainNode, duck: GainNode, sfx: GainNode, compressor: DynamicsCompressorNode|null, nodes: AudioNode[] }|null} */
  let graph = null;
  /** @type {ReturnType<typeof createScheduler>|null} */
  let scheduler = null;
  /** @type {Promise<void>|null} */
  let unlockPromise = null;
  let unavailable = false;
  let suspendedForHidden = false;

  /** @type {import('./sequencer.js').SongPlayer|null} */
  let current = null;
  /** @type {Map<import('./sequencer.js').SongPlayer, any>} player → dispose timer */
  const fading = new Map();
  /** @type {string|null} */
  let pendingMusic = null;
  /** @type {Map<string, import('./sequencer.js').CompiledSong|null>} */
  const compiled = new Map();
  /** @type {Map<string, number>} */
  const lastPlayed = new Map();
  let duckLevel = 1;
  let duckEnd = 0;

  /** @type {Array<() => void>} */
  const detach = [];

  // -- helpers ---------------------------------------------------------------

  function resolveCtor() {
    if (deps.AudioContext !== undefined) return deps.AudioContext;
    const g = /** @type {any} */ (globalThis);
    return g.AudioContext ?? g.webkitAudioContext ?? null;
  }

  function getDocument() {
    if (deps.document !== undefined) return deps.document;
    return /** @type {any} */ (globalThis).document ?? null;
  }

  function getWindow() {
    if (deps.window !== undefined) return deps.window;
    return /** @type {any} */ (globalThis).window ?? null;
  }

  function isHidden() {
    return !!getDocument()?.hidden;
  }

  /** @returns {Promise<void>} */
  function safeResume() {
    if (!ctx || ctx.state === 'closed') return Promise.resolve();
    try {
      const p = ctx.resume?.();
      return p && typeof p.then === 'function' ? p.then(() => {}, () => {}) : Promise.resolve();
    } catch {
      return Promise.resolve();
    }
  }

  function safeSuspend() {
    if (!ctx || ctx.state !== 'running') return;
    try {
      const p = ctx.suspend?.();
      if (p && typeof p.then === 'function') p.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  /** @param {string} id */
  function getSong(id) {
    if (compiled.has(id)) return compiled.get(id) ?? null;
    const def = Object.prototype.hasOwnProperty.call(SONGS, id) ? SONGS[/** @type {keyof typeof SONGS} */ (id)] : null;
    /** @type {import('./sequencer.js').CompiledSong|null} */
    let song = null;
    if (!def) warnOnce(`music:${id}`, `Unknown music id "${id}"`);
    else {
      try {
        song = compileSong(def);
      } catch (err) {
        warnOnce(`music:${id}`, `Music "${id}" could not be compiled`, err);
      }
    }
    compiled.set(id, song);
    return song;
  }

  /** Is the context able to make sound right now? */
  function live() {
    return !!(ctx && graph && ctx.state === 'running' && !muted && !isHidden());
  }

  function buildGraph() {
    if (!ctx) return;
    const c = ctx;
    const now = c.currentTime;
    /** @type {AudioNode[]} */
    const nodes = [];
    const master = c.createGain();
    master.gain.setValueAtTime(muted ? 0 : MIX.master, now);
    master.connect(c.destination);
    nodes.push(master);

    /** @type {DynamicsCompressorNode|null} */
    let compressor = null;
    if (typeof c.createDynamicsCompressor === 'function') {
      try {
        compressor = c.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-18, now);
        compressor.knee.setValueAtTime(14, now);
        compressor.ratio.setValueAtTime(3, now);
        compressor.attack.setValueAtTime(0.006, now);
        compressor.release.setValueAtTime(0.25, now);
        compressor.connect(master);
        nodes.push(compressor);
      } catch (err) {
        warnOnce('compressor', 'Compressor unavailable', err);
        compressor = null;
      }
    }
    const mixIn = compressor ?? master;

    const music = c.createGain();
    music.gain.setValueAtTime(MIX.music, now);
    const duck = c.createGain();
    duck.gain.setValueAtTime(1, now);
    // Soften the top end of the pulse voices a touch so long sessions stay easy on the ears.
    const warmth = c.createBiquadFilter();
    warmth.type = 'lowpass';
    warmth.frequency.setValueAtTime(9000, now);
    warmth.Q.setValueAtTime(0.5, now);
    music.connect(warmth);
    warmth.connect(duck);
    duck.connect(mixIn);

    const sfx = c.createGain();
    sfx.gain.setValueAtTime(MIX.sfx, now);
    sfx.connect(mixIn);
    nodes.push(music, warmth, duck, sfx);

    graph = { master, music, duck, sfx, compressor, nodes };
  }

  /** Quietly play one silent sample — older iOS only unlocks after a real start(). */
  function primeOutput() {
    if (!ctx) return;
    try {
      const buf = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
      src.onended = () => {
        try {
          src.disconnect();
        } catch {
          /* ignore */
        }
      };
    } catch {
      /* not essential */
    }
  }

  function attachListeners() {
    const doc = getDocument();
    if (doc?.addEventListener) {
      const onVisibility = () => {
        if (!ctx) return;
        if (doc.hidden) {
          scheduler?.pause();
          if (ctx.state === 'running') {
            suspendedForHidden = true;
            safeSuspend();
          }
        } else {
          if (suspendedForHidden || ctx.state !== 'running') {
            suspendedForHidden = false;
            safeResume();
          }
          scheduler?.resume();
        }
      };
      doc.addEventListener('visibilitychange', onVisibility);
      detach.push(() => doc.removeEventListener('visibilitychange', onVisibility));
    }
    // Some browsers (notably iOS) can drop the context into 'suspended'/'interrupted'
    // later on; any later user gesture brings it back.
    const win = getWindow();
    if (win?.addEventListener) {
      const onGesture = () => {
        if (ctx && ctx.state !== 'running' && ctx.state !== 'closed' && !isHidden()) safeResume();
      };
      const opts = { capture: true, passive: true };
      for (const type of ['pointerdown', 'keydown', 'touchend']) {
        win.addEventListener(type, onGesture, opts);
        detach.push(() => win.removeEventListener(type, onGesture, opts));
      }
    }
  }

  /**
   * Lower the music under a jingle or cry, then bring it back.
   * @param {number} level 0..1
   * @param {number} holdSeconds
   * @param {number} [releaseSeconds]
   */
  function duck(level, holdSeconds, releaseSeconds = 0.6) {
    if (!ctx || !graph) return;
    const now = ctx.currentTime;
    // Don't let a light duck (a cry) cut a deeper one (the fanfare) short.
    if (now < duckEnd && level > duckLevel) return;
    const g = graph.duck.gain;
    try {
      holdParam(g, now);
      g.linearRampToValueAtTime(level, now + 0.06);
      g.setValueAtTime(level, now + 0.06 + holdSeconds);
      g.linearRampToValueAtTime(1, now + 0.06 + holdSeconds + releaseSeconds);
      duckLevel = level;
      duckEnd = now + 0.06 + holdSeconds;
    } catch (err) {
      warnOnce('duck', 'Music ducking failed', err);
    }
  }

  /**
   * @param {import('./sequencer.js').SongPlayer} player
   * @param {number} fade seconds
   */
  function fadeOut(player, fade) {
    if (!ctx) return;
    player.stopping = true;
    player.fadeTo(0, fade);
    player.stopAt(ctx.currentTime + fade + 0.05);
    const prev = fading.get(player);
    if (prev !== undefined) timers.clearTimeout(prev);
    const handle = timers.setTimeout(() => {
      fading.delete(player);
      scheduler?.remove(player);
      player.dispose();
    }, Math.ceil((fade + 0.6) * 1000));
    handle?.unref?.();
    fading.set(player, handle);
  }

  /**
   * Bring a fading player back to full volume (same song requested again).
   * @param {import('./sequencer.js').SongPlayer} player
   * @param {number} fade
   */
  function revive(player, fade) {
    const handle = fading.get(player);
    if (handle !== undefined) timers.clearTimeout(handle);
    fading.delete(player);
    player.stopping = false;
    player.cancelStop();
    player.fadeTo(1, Math.max(0.05, fade));
  }

  /** @param {any} opts */
  function fadeSeconds(opts) {
    const ms = Number(opts?.fadeMs);
    return (Number.isFinite(ms) ? Math.max(0, ms) : DEFAULT_FADE_MS) / 1000;
  }

  /**
   * @param {string} id
   * @param {number} fade seconds
   */
  function startMusic(id, fade) {
    if (!ctx || !graph || !scheduler) return;
    const song = getSong(id);
    if (!song) return;

    if (current && current.id === id && !current.done) {
      if (current.stopping) revive(current, fade);
      return;
    }
    // The same song may still be fading out from a quick back-and-forth: bring it back.
    const fadingSame = [...fading.keys()].find((p) => p.id === id && !p.done && scheduler?.has(p));
    if (fadingSame) {
      if (current) fadeOut(current, fade);
      revive(fadingSame, fade);
      current = fadingSame;
      return;
    }

    const now = ctx.currentTime;
    const hadMusic = !!current;
    if (current) fadeOut(current, fade);
    // Crossfade: the new song enters while the old one is ~1/3 of the way down.
    const startTime = now + 0.06 + (hadMusic ? fade * 0.35 : 0);
    const fadeIn = hadMusic ? Math.max(0.05, fade * 0.65) : 0.03;
    try {
      const player = createSongPlayer(ctx, song, graph.music, { startTime, fadeIn });
      current = player;
      scheduler.add(player);
    } catch (err) {
      warnOnce(`start:${id}`, `Music "${id}" failed to start`, err);
      current = null;
    }
  }

  // -- public API ------------------------------------------------------------

  /** @type {AudioApi} */
  const api = {
    unlock() {
      if (unlockPromise) {
        // Already created: a fresh user gesture is a good moment to resume if needed.
        if (ctx && ctx.state !== 'running' && ctx.state !== 'closed' && !isHidden()) safeResume();
        return unlockPromise;
      }
      if (unavailable) return Promise.resolve();
      const Ctor = resolveCtor();
      if (typeof Ctor !== 'function') {
        unavailable = true;
        return Promise.resolve();
      }
      try {
        try {
          ctx = new Ctor({ latencyHint: 'interactive' });
        } catch {
          ctx = new Ctor();
        }
        buildGraph();
        scheduler = createScheduler(/** @type {AudioContext} */ (ctx), { timers });
      } catch (err) {
        warnOnce('unlock', 'Web Audio could not start; continuing without sound', err);
        try {
          ctx?.close?.();
        } catch {
          /* ignore */
        }
        ctx = null;
        graph = null;
        scheduler = null;
        unavailable = true;
        return Promise.resolve();
      }
      primeOutput();
      attachListeners();

      if (pendingMusic) {
        const id = pendingMusic;
        pendingMusic = null;
        startMusic(id, 0);
      }

      // resume() can stay pending forever without a gesture; never block the game on it.
      const resumed = isHidden() ? Promise.resolve() : safeResume();
      unlockPromise = new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        resumed.then(finish);
        // Deliberately not unref'd: the caller is awaiting this promise.
        timers.setTimeout(finish, resumeTimeoutMs);
      });
      return unlockPromise;
    },

    playMusic(id, opts = {}) {
      if (typeof id !== 'string' || !id) return;
      if (!ctx) {
        if (!unavailable) pendingMusic = id;
        return;
      }
      startMusic(id, fadeSeconds(opts));
    },

    stopMusic(opts = {}) {
      pendingMusic = null;
      if (!ctx || !current) return;
      fadeOut(current, fadeSeconds(opts));
      current = null;
    },

    sfx(id) {
      if (typeof id !== 'string' || !live()) return;
      const c = /** @type {AudioContext} */ (ctx);
      if (!hasSfx(id)) {
        warnOnce(`sfx:${id}`, `Unknown sfx id "${id}"`);
        return;
      }
      const now = c.currentTime;
      const gap = SFX_THROTTLE[id];
      if (gap) {
        const last = lastPlayed.get(id);
        if (last !== undefined && now - last < gap && now >= last) return;
        lastPlayed.set(id, now);
      }
      try {
        const length = playSfx(c, /** @type {NonNullable<typeof graph>} */ (graph).sfx, id, now, random) ?? 0;
        if (id === 'fanfare') duck(0.14, Math.max(0.5, length - 0.1), 0.7);
        else if (id === 'encounter') duck(0.5, length * 0.7, 0.4);
      } catch (err) {
        warnOnce(`sfx-fail:${id}`, `Sfx "${id}" failed`, err);
      }
    },

    cry(speciesId) {
      if (!live()) return;
      const c = /** @type {AudioContext} */ (ctx);
      try {
        const length = playCry(c, /** @type {NonNullable<typeof graph>} */ (graph).sfx, String(speciesId ?? ''), c.currentTime, random);
        duck(0.55, Math.max(0.1, length * 0.8), 0.35);
      } catch (err) {
        warnOnce(`cry-fail:${speciesId}`, `Cry "${speciesId}" failed`, err);
      }
    },

    setMuted(value) {
      muted = !!value;
      if (!ctx || !graph) return;
      try {
        glideParam(graph.master.gain, muted ? 0 : MIX.master, ctx.currentTime, MUTE_SECONDS);
      } catch (err) {
        warnOnce('mute', 'Mute ramp failed', err);
      }
    },

    get muted() {
      return muted;
    },

    get currentMusic() {
      if (!ctx) return pendingMusic;
      return current && !current.stopping ? current.id : null;
    },

    get unlocked() {
      return !!ctx;
    },

    dispose() {
      for (const off of detach.splice(0)) {
        try {
          off();
        } catch {
          /* ignore */
        }
      }
      for (const handle of fading.values()) timers.clearTimeout(handle);
      for (const player of fading.keys()) player.dispose();
      fading.clear();
      current?.dispose();
      current = null;
      scheduler?.dispose();
      scheduler = null;
      if (graph) {
        for (const node of graph.nodes) {
          try {
            node.disconnect();
          } catch {
            /* ignore */
          }
        }
      }
      graph = null;
      try {
        ctx?.close?.()?.catch?.(() => {});
      } catch {
        /* ignore */
      }
      ctx = null;
      unlockPromise = null;
      pendingMusic = null;
      lastPlayed.clear();
    },

    get _internals() {
      return {
        context: ctx,
        graph,
        scheduler,
        current,
        fading: [...fading.keys()],
        tick: () => scheduler?.tick(),
      };
    },
  };

  return api;
}

/** The game's audio engine (see the contract at the top of this file). */
export const audio = createAudio();
