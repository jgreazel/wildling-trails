/**
 * Song compiler + lookahead music scheduler.
 *
 * compileSong() turns the readable song data (songs.js) into sorted, validated note
 * events. A song player schedules those events a little ahead of the audio clock
 * (classic "two clocks" pattern: a ~25 ms timer, ~0.12 s lookahead), loops the body
 * forever, owns its own output gain for crossfades, and catches up gracefully if the
 * timer was throttled instead of bursting late notes.
 */
import { parsePart, midiToFreq } from './notation.js';
import { INSTRUMENTS, DRUM_SET, tone, playDrum } from './synth.js';
import { clamp, disconnectAll, rampParam, warnOnce } from './util.js';

const EPS = 1e-6;
/** Section names, in playback order. `intro` plays once, `body` loops. */
export const SECTIONS = Object.freeze(['intro', 'body']);

/**
 * @typedef {object} VoiceConfig
 * @property {string} name
 * @property {'tone'|'drums'} kind
 * @property {string} [wave]
 * @property {number} [duty]
 * @property {import('./synth.js').Envelope} env
 * @property {number} vol   bus gain for this voice
 * @property {number} gate  fraction of the written length that sounds (articulation)
 * @property {number} pan   -1..1
 * @property {number} echo  0..1 send into the song's echo (if the song has one)
 * @property {{rate:number, depth:number, delay?:number}|null} vibrato
 * @property {number} detune cents
 * @property {number} transpose semitones
 */

/**
 * @typedef {object} CompiledSection
 * @property {number} beats
 * @property {number} bars
 * @property {Array<import('./notation.js').NoteEvent & { voice: string }>} events  sorted by beat
 * @property {number} lastEnd  beat at which the last note ends
 */

/**
 * @typedef {object} CompiledSong
 * @property {string} id
 * @property {number} bpm
 * @property {number} meter  beats per bar
 * @property {number} spb    seconds per beat
 * @property {number} swing  0..1 (1 = full triplet shuffle on off-beat eighths)
 * @property {boolean} loop
 * @property {Record<string, VoiceConfig>} voices
 * @property {CompiledSection|null} intro
 * @property {CompiledSection} body
 * @property {{ beats?: number, feedback?: number, mix?: number, cutoff?: number }|null} echo
 */

/**
 * Validate and compile a song definition.
 * @param {any} song see songs.js for the format
 * @returns {CompiledSong}
 * @throws {Error} describing the first problem found (bad note, wrong bar length, ...)
 */
export function compileSong(song) {
  if (!song || typeof song !== 'object') throw new Error('Song must be an object');
  const id = String(song.id ?? 'song');
  const bpm = Number(song.bpm);
  if (!(bpm >= 30 && bpm <= 300)) throw new Error(`${id}: bpm must be 30..300`);
  const meter = Number(song.meter ?? 4);
  if (!(meter > 0 && meter <= 16)) throw new Error(`${id}: meter must be 1..16 beats`);
  const swing = clamp(Number(song.swing ?? 0) || 0, 0, 1);

  /** @type {Record<string, VoiceConfig>} */
  const voices = {};
  for (const [name, cfg] of Object.entries(song.voices ?? {})) {
    const inst = INSTRUMENTS[cfg?.inst];
    if (!inst) throw new Error(`${id}: voice "${name}" uses unknown instrument "${cfg?.inst}"`);
    voices[name] = {
      name,
      kind: inst.kind === 'drums' ? 'drums' : 'tone',
      wave: inst.wave,
      duty: inst.duty,
      env: { ...(inst.env ?? {}), ...(cfg.env ?? {}) },
      vol: clamp(Number(cfg.vol ?? 0.3), 0, 2),
      gate: clamp(Number(cfg.gate ?? 0.9), 0.05, 1),
      pan: clamp(Number(cfg.pan ?? 0), -1, 1),
      echo: clamp(Number(cfg.echo ?? 0), 0, 1),
      vibrato: cfg.vibrato ?? null,
      detune: Number(cfg.detune ?? 0) || 0,
      transpose: Number(cfg.transpose ?? 0) || 0,
    };
  }
  if (!Object.keys(voices).length) throw new Error(`${id}: no voices`);

  /** @type {Record<string, CompiledSection>} */
  const sections = {};
  for (const sectionName of SECTIONS) {
    const parts = song[sectionName];
    if (!parts) continue;
    /** @type {number|null} */
    let beats = null;
    /** @type {CompiledSection['events']} */
    const events = [];
    for (const [voiceName, part] of Object.entries(parts)) {
      const voice = voices[voiceName];
      const where = `${id}.${sectionName}.${voiceName}`;
      if (!voice) throw new Error(`${where}: no such voice`);
      let parsed;
      try {
        parsed = parsePart(part, { drums: voice.kind === 'drums' ? DRUM_SET : null });
      } catch (err) {
        throw new Error(`${where}: ${/** @type {Error} */ (err).message}`);
      }
      parsed.barLengths.forEach((len, i) => {
        if (Math.abs(len - meter) > EPS) {
          throw new Error(`${where}: bar ${i + 1} has ${+len.toFixed(4)} beats, expected ${meter}`);
        }
      });
      if (beats === null) beats = parsed.totalBeats;
      else if (Math.abs(beats - parsed.totalBeats) > EPS) {
        throw new Error(`${where}: ${parsed.totalBeats} beats, other voices have ${beats}`);
      }
      for (const ev of parsed.events) events.push({ ...ev, voice: voiceName });
    }
    if (!(beats && beats > 0)) throw new Error(`${id}.${sectionName}: section is empty`);
    events.sort((a, b) => a.beat - b.beat);
    const lastEnd = events.reduce((m, e) => Math.max(m, e.beat + e.dur), 0);
    sections[sectionName] = { beats, bars: Math.round(beats / meter), events, lastEnd };
  }
  if (!sections.body) throw new Error(`${id}: missing body section`);

  return Object.freeze({
    id,
    bpm,
    meter,
    spb: 60 / bpm,
    swing,
    loop: song.loop !== false,
    voices,
    intro: sections.intro ?? null,
    body: sections.body,
    echo: song.echo ?? null,
  });
}

/**
 * Map a straight beat position to a swung one. Off-beat eighths are delayed by up to
 * 1/6 beat (full triplet feel at swing = 1); the mapping is monotonic, so note order
 * is preserved for any subdivision.
 * @param {number} beat
 * @param {number} swing 0..1
 */
export function swingBeat(beat, swing) {
  if (!swing) return beat;
  const whole = Math.floor(beat);
  const f = beat - whole;
  const mid = 0.5 + swing / 6;
  return whole + (f < 0.5 ? f * (mid / 0.5) : mid + (f - 0.5) * ((1 - mid) / 0.5));
}

/**
 * Length of a non-looping song (intro + body up to its last note), in seconds.
 * @param {CompiledSong} song
 */
export function oneShotSeconds(song) {
  return ((song.intro?.beats ?? 0) + song.body.lastEnd) * song.spb;
}

/**
 * Length of one pass of the looping body, in seconds.
 * @param {CompiledSong} song
 */
export function loopSeconds(song) {
  return song.body.beats * song.spb;
}

/**
 * @typedef {object} SongPlayer
 * @property {string} id
 * @property {GainNode} output         per-song gain (crossfades act on this)
 * @property {(until: number) => void} schedule  schedule every event starting before `until`
 * @property {(target: number, seconds: number) => void} fadeTo
 * @property {(time: number) => void} stopAt     no events at/after `time`
 * @property {() => void} cancelStop
 * @property {() => void} dispose
 * @property {boolean} done
 * @property {boolean} stopping  set by the owner while fading out
 * @property {number} startTime
 */

/**
 * Create a player for a compiled song, connected to `destination`.
 * @param {BaseAudioContext} ctx
 * @param {CompiledSong} song
 * @param {AudioNode} destination
 * @param {{ startTime?: number, fadeIn?: number, loop?: boolean }} [opts]
 * @returns {SongPlayer}
 */
export function createSongPlayer(ctx, song, destination, opts = {}) {
  const now = ctx.currentTime;
  const startTime = Math.max(now, Number.isFinite(opts.startTime) ? /** @type {number} */ (opts.startTime) : now + 0.05);
  const fadeIn = Math.max(0, Number(opts.fadeIn) || 0);
  const loop = opts.loop ?? song.loop;

  const output = ctx.createGain();
  if (fadeIn > 0) {
    output.gain.setValueAtTime(0, now);
    output.gain.setValueAtTime(0, startTime);
    output.gain.linearRampToValueAtTime(1, startTime + fadeIn);
  } else {
    output.gain.setValueAtTime(1, now);
  }
  output.connect(destination);
  /** @type {AudioNode[]} */
  const nodes = [output];

  const echoIn = buildEcho();
  /** @type {Record<string, AudioNode>} */
  const buses = {};
  for (const voice of Object.values(song.voices)) {
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(voice.vol, now);
    nodes.push(bus);
    if (voice.pan && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(voice.pan, now);
      bus.connect(panner);
      panner.connect(output);
      nodes.push(panner);
    } else {
      bus.connect(output);
    }
    if (echoIn && voice.echo > 0) {
      const send = ctx.createGain();
      send.gain.setValueAtTime(voice.echo, now);
      bus.connect(send);
      send.connect(echoIn);
      nodes.push(send);
    }
    buses[voice.name] = bus;
  }

  /** @type {'intro'|'body'} */
  let section = song.intro ? 'intro' : 'body';
  let sectionStart = startTime;
  let index = 0;
  /** @type {number|null} */
  let stopTime = null;
  let done = false;
  let failures = 0;

  /** @returns {AudioNode|null} */
  function buildEcho() {
    if (!song.echo || typeof ctx.createDelay !== 'function') return null;
    try {
      const { beats = 0.75, feedback = 0.3, mix = 0.35, cutoff = 2400 } = song.echo;
      const input = ctx.createGain();
      const delay = ctx.createDelay(2);
      delay.delayTime.setValueAtTime(clamp(beats * song.spb, 0.02, 1.9), now);
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(cutoff, now);
      const fb = ctx.createGain();
      fb.gain.setValueAtTime(clamp(feedback, 0, 0.85), now);
      const wet = ctx.createGain();
      wet.gain.setValueAtTime(clamp(mix, 0, 1), now);
      input.connect(delay);
      delay.connect(lowpass);
      lowpass.connect(fb);
      fb.connect(delay);
      lowpass.connect(wet);
      wet.connect(output);
      nodes.push(input, delay, lowpass, fb, wet);
      return input;
    } catch (err) {
      warnOnce('echo', 'Echo unavailable', err);
      return null;
    }
  }

  /** @param {number} beat */
  function timeOf(beat) {
    return sectionStart + swingBeat(beat, song.swing) * song.spb;
  }

  /**
   * @param {CompiledSection['events'][number]} ev
   * @param {number} t
   * @param {number} tEnd
   */
  function play(ev, t, tEnd) {
    const voice = song.voices[ev.voice];
    const bus = buses[ev.voice];
    if (!voice || !bus) return;
    try {
      if (voice.kind === 'drums') {
        playDrum(ctx, bus, /** @type {string} */ (ev.note), t, ev.vel);
      } else {
        const len = Math.max(0.03, (tEnd - t) * voice.gate);
        tone(ctx, bus, {
          t,
          dur: len,
          freq: midiToFreq(/** @type {number} */ (ev.note) + voice.transpose),
          wave: voice.wave,
          duty: voice.duty,
          vol: ev.vel,
          env: voice.env,
          detune: voice.detune,
          vibrato: voice.vibrato && len >= 0.28 ? voice.vibrato : null,
        });
      }
    } catch (err) {
      if (failures++ === 0) warnOnce(`play:${song.id}`, `A note failed to play in "${song.id}"`, err);
    }
  }

  /** @param {number} until */
  function schedule(until) {
    if (done) return;
    const nowT = ctx.currentTime;
    for (let guard = 0; guard < 4096; guard++) {
      const sec = /** @type {CompiledSection} */ (section === 'intro' ? song.intro : song.body);
      if (index >= sec.events.length) {
        const nextStart = sectionStart + sec.beats * song.spb;
        if (section === 'intro') section = 'body';
        else if (!loop) {
          done = true;
          return;
        }
        sectionStart = nextStart;
        index = 0;
        if (stopTime !== null && sectionStart >= stopTime) {
          done = true;
          return;
        }
        if (sectionStart >= until) return;
        continue;
      }
      const ev = sec.events[index];
      let t = timeOf(ev.beat);
      if (stopTime !== null && t >= stopTime) {
        done = true;
        return;
      }
      if (t >= until) return;
      if (t < nowT - 0.015) {
        // The timer stalled (background tab, long frame): slide the timeline forward
        // so the music resumes cleanly instead of firing a burst of late notes.
        const shift = nowT + 0.03 - t;
        sectionStart += shift;
        t += shift;
        if (t >= until) return;
      }
      play(ev, t, timeOf(ev.beat + ev.dur));
      index++;
    }
  }

  return {
    id: song.id,
    output,
    startTime,
    stopping: false,
    get done() {
      return done;
    },
    schedule,
    fadeTo(target, seconds) {
      try {
        rampParam(output.gain, target, ctx.currentTime, seconds);
      } catch (err) {
        warnOnce('fade', 'Music fade failed', err);
      }
    },
    stopAt(time) {
      stopTime = time;
    },
    cancelStop() {
      stopTime = null;
    },
    dispose() {
      done = true;
      disconnectAll(nodes);
    },
  };
}

/**
 * @typedef {object} Timers
 * @property {(fn: () => void, ms: number) => any} setInterval
 * @property {(handle: any) => void} clearInterval
 * @property {(fn: () => void, ms: number) => any} setTimeout
 * @property {(handle: any) => void} clearTimeout
 */

/** @returns {Timers} wrappers resolved at call time (safe in Node and browsers) */
export function defaultTimers() {
  return {
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (h) => globalThis.clearInterval(h),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h),
  };
}

/**
 * @typedef {object} Scheduler
 * @property {(player: SongPlayer) => void} add
 * @property {(player: SongPlayer) => void} remove
 * @property {(player: SongPlayer) => boolean} has
 * @property {() => void} tick     schedule every active player up to now + lookahead
 * @property {() => void} pause    stop the timer (tab hidden)
 * @property {() => void} resume
 * @property {() => void} dispose
 * @property {number} size
 */

/**
 * One shared lookahead timer for all active song players.
 * The timer only runs while at least one player is active and not paused.
 * @param {BaseAudioContext} ctx
 * @param {{ lookahead?: number, intervalMs?: number, timers?: Timers }} [opts]
 * @returns {Scheduler}
 */
export function createScheduler(ctx, { lookahead = 0.12, intervalMs = 25, timers = defaultTimers() } = {}) {
  /** @type {Set<SongPlayer>} */
  const players = new Set();
  /** @type {any} */
  let handle = null;
  let paused = false;

  function tick() {
    const until = ctx.currentTime + lookahead;
    for (const player of [...players]) {
      try {
        player.schedule(until);
      } catch (err) {
        warnOnce(`sched:${player.id}`, `Scheduling failed for "${player.id}"`, err);
        players.delete(player);
        continue;
      }
      if (player.done) players.delete(player);
    }
    if (!players.size) stopTimer();
  }

  function startTimer() {
    if (handle !== null || paused || !players.size) return;
    handle = timers.setInterval(tick, intervalMs);
    handle?.unref?.();
  }

  function stopTimer() {
    if (handle === null) return;
    timers.clearInterval(handle);
    handle = null;
  }

  return {
    add(player) {
      players.add(player);
      try {
        player.schedule(ctx.currentTime + lookahead);
      } catch (err) {
        warnOnce(`sched:${player.id}`, `Scheduling failed for "${player.id}"`, err);
        players.delete(player);
        return;
      }
      startTimer();
    },
    remove(player) {
      players.delete(player);
      if (!players.size) stopTimer();
    },
    has(player) {
      return players.has(player);
    },
    tick,
    pause() {
      paused = true;
      stopTimer();
    },
    resume() {
      paused = false;
      if (players.size) {
        tick();
        startTimer();
      }
    },
    dispose() {
      stopTimer();
      players.clear();
    },
    get size() {
      return players.size;
    },
  };
}

/**
 * Schedule a whole non-looping song (a jingle) right away.
 * @param {BaseAudioContext} ctx
 * @param {CompiledSong} song
 * @param {AudioNode} destination
 * @param {number} [startTime]
 * @returns {number} seconds until the last note ends
 */
export function playOnce(ctx, song, destination, startTime = ctx.currentTime + 0.02) {
  const player = createSongPlayer(ctx, song, destination, { startTime, loop: false });
  player.schedule(Infinity);
  return oneShotSeconds(song);
}
