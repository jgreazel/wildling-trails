import test from 'node:test';
import assert from 'node:assert/strict';

import { audio, createAudio, MIX } from '../src/audio/audio.js';
import { SONGS, JINGLES, MUSIC_IDS } from '../src/audio/songs.js';
import {
  compileSong,
  createScheduler,
  createSongPlayer,
  loopSeconds,
  oneShotSeconds,
  swingBeat,
} from '../src/audio/sequencer.js';
import { noteToMidi, midiToFreq, parseDuration, parsePart, noteFreq } from '../src/audio/notation.js';
import { INSTRUMENTS, DRUM_IDS, DRUM_SET, PULSE_DUTIES, envelope, pulseWave, tone, noise, playDrum } from '../src/audio/synth.js';
import { SFX_IDS, SFX_THROTTLE, playSfx } from '../src/audio/sfx.js';
import { CRY_IDS, playCry } from '../src/audio/cries.js';
import { WILDLINGS } from '../src/data/wildlings.js';

// ---------------------------------------------------------------------------
// A small but strict fake Web Audio implementation. It validates arguments the
// way browsers do (non-finite values throw, exponential ramps can't reach 0,
// sources can't start twice) and records what was scheduled.
// ---------------------------------------------------------------------------

class FakeParam {
  /** @param {FakeAudioContext} ctx @param {number} value */
  constructor(ctx, value = 0) {
    this.ctx = ctx;
    this.value = value;
    /** @type {Array<{name:string, v?:number, t:number, tc?:number}>} */
    this.events = [];
  }
  _rec(name, v, t, extra = {}) {
    if (!Number.isFinite(v)) throw new TypeError(`${name}: non-finite value ${v}`);
    if (!Number.isFinite(t) || t < 0) throw new RangeError(`${name}: bad time ${t}`);
    this.events.push({ name, v, t, ...extra });
    return this;
  }
  setValueAtTime(v, t) {
    this._rec('set', v, t);
    if (t <= this.ctx.currentTime) this.value = v;
    return this;
  }
  linearRampToValueAtTime(v, t) {
    return this._rec('linear', v, t);
  }
  exponentialRampToValueAtTime(v, t) {
    if (!(v > 0)) throw new RangeError(`exponentialRamp: value must be > 0, got ${v}`);
    return this._rec('exp', v, t);
  }
  setTargetAtTime(v, t, tc) {
    if (!Number.isFinite(tc) || tc < 0) throw new RangeError(`setTarget: bad time constant ${tc}`);
    return this._rec('target', v, t, { tc });
  }
  cancelScheduledValues(t) {
    if (!Number.isFinite(t) || t < 0) throw new RangeError(`cancel: bad time ${t}`);
    this.events.push({ name: 'cancel', t });
    return this;
  }
  cancelAndHoldAtTime(t) {
    if (!Number.isFinite(t) || t < 0) throw new RangeError(`cancelAndHold: bad time ${t}`);
    this.events.push({ name: 'hold', t });
    return this;
  }
}

class FakeNode {
  /** @param {FakeAudioContext} ctx @param {string} kind */
  constructor(ctx, kind) {
    this.ctx = ctx;
    this.kind = kind;
    this.outputs = new Set();
    ctx.created[kind] = (ctx.created[kind] ?? 0) + 1;
    ctx.nodeCount++;
  }
  connect(dest) {
    if (!(dest instanceof FakeNode) && !(dest instanceof FakeParam)) throw new TypeError('connect: invalid destination');
    if (dest.ctx !== this.ctx) throw new Error('connect: node from another context');
    this.outputs.add(dest);
    return dest;
  }
  disconnect() {
    this.outputs.clear();
  }
}

class FakeScheduledSource extends FakeNode {
  start(t = 0, offset = 0) {
    if (this.startedAt !== undefined) throw new Error('InvalidStateError: start() called twice');
    if (!Number.isFinite(t) || t < 0) throw new RangeError(`start: bad time ${t}`);
    if (!Number.isFinite(offset) || offset < 0) throw new RangeError(`start: bad offset ${offset}`);
    this.startedAt = t;
    if (t < this.ctx.currentTime - 1e-9) this.ctx.lateStarts++;
    this.ctx.starts.push({ kind: this.kind, t, node: this, at: this.ctx.currentTime });
  }
  stop(t = 0) {
    if (this.startedAt === undefined) throw new Error('InvalidStateError: stop() before start()');
    if (!Number.isFinite(t) || t < 0) throw new RangeError(`stop: bad time ${t}`);
    this.stoppedAt = t;
  }
}

class FakePeriodicWave {}

class FakeOscillator extends FakeScheduledSource {
  constructor(ctx) {
    super(ctx, 'oscillator');
    this._type = 'sine';
    this.frequency = new FakeParam(ctx, 440);
    this.detune = new FakeParam(ctx, 0);
    this.onended = null;
    this.wave = null;
  }
  get type() {
    return this._type;
  }
  set type(v) {
    if (v === 'custom') throw new Error('InvalidStateError: set type "custom" directly');
    if (!['sine', 'square', 'sawtooth', 'triangle'].includes(v)) throw new TypeError(`bad type ${v}`);
    this._type = v;
  }
  setPeriodicWave(w) {
    if (!(w instanceof FakePeriodicWave)) throw new TypeError('setPeriodicWave: not a PeriodicWave');
    this._type = 'custom';
    this.wave = w;
  }
}

class FakeBufferSource extends FakeScheduledSource {
  constructor(ctx) {
    super(ctx, 'bufferSource');
    this.buffer = null;
    this.loop = false;
    this.playbackRate = new FakeParam(ctx, 1);
    this.onended = null;
  }
}

class FakeBuffer {
  constructor(channels, length, sampleRate) {
    if (!(length > 0) || !(sampleRate > 0)) throw new RangeError('createBuffer: bad size');
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this._data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(i) {
    return this._data[i];
  }
}

class FakeAudioContext {
  static instances = [];
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.state = 'suspended';
    this.created = {};
    this.nodeCount = 0;
    this.starts = [];
    this.lateStarts = 0;
    this.resumeCalls = 0;
    this.suspendCalls = 0;
    this.destination = new FakeNode(this, 'destination');
    FakeAudioContext.instances.push(this);
  }
  createOscillator() {
    return new FakeOscillator(this);
  }
  createGain() {
    const n = new FakeNode(this, 'gain');
    n.gain = new FakeParam(this, 1);
    return n;
  }
  createBiquadFilter() {
    const n = new FakeNode(this, 'biquad');
    n.type = 'lowpass';
    n.frequency = new FakeParam(this, 350);
    n.Q = new FakeParam(this, 1);
    n.gain = new FakeParam(this, 0);
    n.detune = new FakeParam(this, 0);
    return n;
  }
  createBufferSource() {
    return new FakeBufferSource(this);
  }
  createBuffer(ch, len, sr) {
    return new FakeBuffer(ch, len, sr);
  }
  createDynamicsCompressor() {
    const n = new FakeNode(this, 'compressor');
    for (const p of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[p] = new FakeParam(this, 0);
    return n;
  }
  createStereoPanner() {
    const n = new FakeNode(this, 'panner');
    n.pan = new FakeParam(this, 0);
    return n;
  }
  createDelay() {
    const n = new FakeNode(this, 'delay');
    n.delayTime = new FakeParam(this, 0);
    return n;
  }
  createPeriodicWave(real, imag) {
    if (real.length !== imag.length) throw new Error('IndexSizeError');
    for (const v of [...real, ...imag]) if (!Number.isFinite(v)) throw new TypeError('non-finite coefficient');
    return new FakePeriodicWave();
  }
  resume() {
    this.resumeCalls++;
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.suspendCalls++;
    this.state = 'suspended';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

/** Context without the optional nodes (very old / stripped-down implementations). */
class BareAudioContext extends FakeAudioContext {}
BareAudioContext.prototype.createPeriodicWave = undefined;
BareAudioContext.prototype.createStereoPanner = undefined;
BareAudioContext.prototype.createDelay = undefined;
BareAudioContext.prototype.createDynamicsCompressor = undefined;

/** Context whose resume() never settles (autoplay policy without a gesture). */
class StubbornAudioContext extends FakeAudioContext {
  resume() {
    this.resumeCalls++;
    return new Promise(() => {});
  }
}

/** Manually driven timers so tests are deterministic and leave nothing running. */
function fakeTimers() {
  let next = 1;
  const intervals = new Map();
  const timeouts = new Map();
  return {
    intervals,
    timeouts,
    setInterval(fn, ms) {
      intervals.set(next, { fn, ms });
      return next++;
    },
    clearInterval(h) {
      intervals.delete(h);
    },
    setTimeout(fn, ms) {
      timeouts.set(next, { fn, ms });
      return next++;
    },
    clearTimeout(h) {
      timeouts.delete(h);
    },
    /** Run every pending timeout (they may schedule more; those wait for the next call). */
    flushTimeouts() {
      const due = [...timeouts.entries()];
      for (const [h, { fn }] of due) {
        timeouts.delete(h);
        fn();
      }
    },
  };
}

class FakeDocument extends EventTarget {
  hidden = false;
}

function setup(extra = {}) {
  const timers = fakeTimers();
  const document = new FakeDocument();
  const window = new EventTarget();
  const engine = createAudio({
    AudioContext: FakeAudioContext,
    timers,
    document,
    window,
    random: () => 0.5,
    ...extra,
  });
  return { engine, timers, document, window };
}

/** Advance the fake clock in scheduler-sized steps, ticking as the real timer would. */
function advance(engine, seconds, step = 0.025) {
  const ctx = engine._internals.context;
  const end = ctx.currentTime + seconds;
  while (ctx.currentTime < end - 1e-9) {
    ctx.currentTime = Math.min(end, ctx.currentTime + step);
    engine._internals.tick();
  }
}

function allParamsFinite(ctx) {
  // Every recorded automation already passed the finiteness checks in FakeParam;
  // this is a cheap extra sanity check that start times are finite and not late.
  return ctx.starts.every((s) => Number.isFinite(s.t)) && ctx.lateStarts === 0;
}

// ---------------------------------------------------------------------------
// Module import / no-op behaviour without Web Audio
// ---------------------------------------------------------------------------

test('imports in Node and every method is a safe no-op without Web Audio', async () => {
  assert.equal(typeof globalThis.AudioContext, 'undefined', 'Node should not provide AudioContext');
  await audio.unlock();
  await audio.unlock();
  audio.playMusic('town');
  audio.playMusic('town', { fadeMs: 0 });
  audio.playMusic(undefined);
  audio.stopMusic();
  audio.stopMusic({ fadeMs: 100 });
  for (const id of SFX_IDS) audio.sfx(id);
  audio.sfx('not-a-sound');
  audio.sfx(undefined);
  for (const id of [...CRY_IDS, 'unknown', undefined]) audio.cry(id);
  audio.setMuted(true);
  assert.equal(audio.muted, true);
  audio.setMuted(false);
  assert.equal(audio.muted, false);
  assert.equal(audio.unlocked, false);
});

test('engine forced without AudioContext stays silent and never throws', async () => {
  const engine = createAudio({ AudioContext: null });
  await engine.unlock();
  engine.playMusic('lab');
  engine.sfx('confirm');
  engine.cry('mossbun');
  engine.setMuted(true);
  assert.equal(engine.muted, true);
  assert.equal(engine.unlocked, false);
  engine.dispose();
});

// ---------------------------------------------------------------------------
// Notation
// ---------------------------------------------------------------------------

test('note names and durations parse', () => {
  assert.equal(noteToMidi('A4'), 69);
  assert.equal(noteToMidi('C4'), 60);
  assert.equal(noteToMidi('F#5'), 78);
  assert.equal(noteToMidi('Bb3'), 58);
  assert.equal(noteToMidi('Db6'), 85);
  assert.equal(noteToMidi('H2'), null);
  assert.equal(noteToMidi('C#'), null);
  assert.ok(Math.abs(midiToFreq(69) - 440) < 1e-9);
  assert.ok(Math.abs(noteFreq('A5') - 880) < 1e-9);
  assert.equal(parseDuration('q'), 1);
  assert.equal(parseDuration('h.'), 3);
  assert.equal(parseDuration('e.'), 0.75);
  assert.ok(Math.abs(parseDuration('qt') - 2 / 3) < 1e-12);
  assert.ok(Number.isNaN(parseDuration('z')));
});

test('parsePart handles default durations, rests, ties and velocities', () => {
  const p = parsePart('C5:e D5 r E5:q | ~:h G5:q@0.5 r');
  assert.deepEqual(p.barLengths, [2.5, 4]);
  assert.equal(p.totalBeats, 6.5);
  assert.deepEqual(
    p.events.map((e) => [e.beat, e.dur, e.note, e.vel]),
    [
      [0, 0.5, 72, 1],
      [0.5, 0.5, 74, 1],
      [1.5, 3, 76, 1], // E5:q tied across the bar line by ~:h
      [4.5, 1, 79, 0.5],
    ],
  );
  const drums = parsePart(['bd:e hh sn hh'], { drums: DRUM_SET });
  assert.deepEqual(drums.events.map((e) => e.note), ['bd', 'hh', 'sn', 'hh']);
  assert.throws(() => parsePart('C5:q X9'), /Invalid note name/);
  assert.throws(() => parsePart('C5:z'), /Invalid duration/);
  assert.throws(() => parsePart('C5:q@2'), /Velocity/);
  assert.throws(() => parsePart('zz:q', { drums: DRUM_SET }), /Unknown drum/);
});

test('swing mapping is monotonic and leaves beats in place', () => {
  assert.equal(swingBeat(2, 0.5), 2);
  assert.ok(swingBeat(2.5, 0.5) > 2.5);
  let prev = -1;
  for (let b = 0; b < 4; b += 0.125) {
    const s = swingBeat(b, 1);
    assert.ok(s > prev, `swing must preserve order at beat ${b}`);
    prev = s;
  }
});

// ---------------------------------------------------------------------------
// Song data validation
// ---------------------------------------------------------------------------

const REQUIRED_MUSIC = ['title', 'town', 'town-night', 'home', 'lab'];
const RANGES = {
  pulse: [52, 96], // E3 .. C7
  triangle: [33, 84], // A1 .. C6
  sine: [40, 100],
};

test('all required music ids exist and compile', () => {
  for (const id of REQUIRED_MUSIC) {
    assert.ok(SONGS[id], `missing song "${id}"`);
    assert.equal(SONGS[id].id, id, `song key/id mismatch for "${id}"`);
    assert.ok(MUSIC_IDS.includes(id));
    const song = compileSong(SONGS[id]);
    assert.ok(song.loop, `${id} should loop`);
    assert.ok(song.body.events.length > 20, `${id} has too few notes`);
  }
  assert.ok(JINGLES.fanfare, 'missing fanfare jingle');
});

test('every voice of every song parses with consistent bar lengths and sane ranges', () => {
  for (const def of [...Object.values(SONGS), ...Object.values(JINGLES)]) {
    const meter = def.meter ?? 4;
    for (const section of ['intro', 'body']) {
      const parts = def[section];
      if (!parts) continue;
      let total = null;
      for (const [voiceName, part] of Object.entries(parts)) {
        const voice = def.voices[voiceName];
        assert.ok(voice, `${def.id}.${section}: unknown voice ${voiceName}`);
        const inst = INSTRUMENTS[voice.inst];
        assert.ok(inst, `${def.id}.${voiceName}: unknown instrument ${voice.inst}`);
        const parsed = parsePart(part, { drums: inst.kind === 'drums' ? DRUM_SET : null });
        parsed.barLengths.forEach((len, i) =>
          assert.ok(Math.abs(len - meter) < 1e-6, `${def.id}.${section}.${voiceName} bar ${i + 1}: ${len} beats (want ${meter})`),
        );
        if (total === null) total = parsed.totalBeats;
        assert.ok(Math.abs(total - parsed.totalBeats) < 1e-6, `${def.id}.${section}.${voiceName}: length mismatch`);
        for (const ev of parsed.events) {
          assert.ok(ev.dur > 0, `${def.id}.${voiceName}: non-positive duration`);
          assert.ok(ev.vel > 0 && ev.vel <= 1, `${def.id}.${voiceName}: bad velocity`);
          if (inst.kind !== 'drums') {
            const [lo, hi] = RANGES[inst.wave];
            assert.ok(ev.note >= lo && ev.note <= hi, `${def.id}.${voiceName}: note ${ev.note} outside ${lo}..${hi}`);
          }
        }
      }
    }
  }
});

test('songs match their briefs (tempo, length, meter)', () => {
  const title = compileSong(SONGS.title);
  assert.ok(title.intro, 'title has an intro');
  assert.ok(title.body.bars >= 16 && title.body.bars <= 24, 'title loop is 16–24 bars');

  const town = compileSong(SONGS.town);
  assert.ok(town.bpm >= 100 && town.bpm <= 110, 'town tempo 100–110');
  assert.ok(town.body.bars >= 16 && town.body.bars <= 32, 'town loop 16–32 bars');
  assert.ok(new Set(Object.values(town.voices).map((v) => v.kind)).has('drums'));
  assert.ok(Object.keys(town.voices).length >= 4, 'lead + counter + bass + percussion');

  const night = compileSong(SONGS['town-night']);
  assert.ok(night.bpm >= 66 && night.bpm <= 78, 'night is ~72 bpm');
  assert.ok(night.body.events.length < town.body.events.length / 2, 'night is sparse');
  const nightLead = SONGS['town-night'].voices.lead.inst;
  assert.ok(nightLead === 'pulse12' || nightLead === 'triangle', 'night lead is soft');

  const home = compileSong(SONGS.home);
  assert.equal(home.meter, 3, 'home is a waltz');
  const lab = compileSong(SONGS.lab);
  assert.ok(lab.swing > 0, 'lab bounces');

  for (const id of REQUIRED_MUSIC) {
    const s = compileSong(SONGS[id]);
    const secs = loopSeconds(s);
    assert.ok(secs >= 25 && secs <= 90, `${id} loop length ${secs.toFixed(1)}s`);
  }

  const fanfare = compileSong(JINGLES.fanfare);
  assert.equal(fanfare.loop, false);
  const len = oneShotSeconds(fanfare);
  assert.ok(len >= 1.5 && len <= 2.8, `fanfare is ~2 s (got ${len.toFixed(2)})`);
});

test('compileSong reports helpful errors', () => {
  const base = { id: 'x', bpm: 100, meter: 4, voices: { a: { inst: 'pulse25' } } };
  assert.throws(() => compileSong({ ...base, body: { a: ['C5:q D5 E5'] } }), /bar 1 has 3 beats/);
  assert.throws(() => compileSong({ ...base, body: { b: ['C5:w'] } }), /no such voice/);
  assert.throws(() => compileSong({ ...base, voices: { a: { inst: 'kazoo' } }, body: { a: ['C5:w'] } }), /unknown instrument/);
  assert.throws(() => compileSong({ ...base }), /missing body/);
  assert.throws(() => compileSong({ ...base, bpm: 0, body: { a: ['C5:w'] } }), /bpm/);
});

// ---------------------------------------------------------------------------
// Synth primitives against the fake context
// ---------------------------------------------------------------------------

test('synth voices schedule valid automation', () => {
  const ctx = new FakeAudioContext();
  const out = ctx.createGain();
  for (const duty of PULSE_DUTIES) assert.ok(pulseWave(ctx, duty) instanceof FakePeriodicWave);
  assert.equal(pulseWave(ctx, 0.25), pulseWave(ctx, 0.25), 'waves are cached');
  const end = tone(ctx, out, { t: 0.1, dur: 0.5, freq: 440, vibrato: { rate: 5, depth: 10, delay: 0.1 }, slide: [[0.2, 660]] });
  assert.ok(end > 0.6);
  assert.ok(noise(ctx, out, { t: 0, decay: 0.1, filter: { type: 'bandpass', freq: 1000, to: 3000, time: 0.1 } }) > 0.1);
  for (const id of DRUM_IDS) playDrum(ctx, out, id, 0.2, 0.8);
  // Zero / invalid input is ignored, never thrown.
  tone(ctx, out, { dur: 0.1, freq: 0 });
  tone(ctx, out, { dur: 0.1, freq: 440, vol: 0 });
  // Envelope never schedules before t.
  const g = ctx.createGain();
  const relEnd = envelope(g.gain, 1, 0.01, { a: 0.05, d: 0.1, s: 0.5, r: 0.1 }, 0.3);
  assert.ok(relEnd >= 1.05);
  assert.ok(g.gain.events.every((e) => e.t >= 1));
  assert.ok(allParamsFinite(ctx));
});

// ---------------------------------------------------------------------------
// Engine behaviour with a fake AudioContext
// ---------------------------------------------------------------------------

test('unlock is idempotent and builds the mix', async () => {
  const before = FakeAudioContext.instances.length;
  const { engine } = setup();
  await engine.unlock();
  await engine.unlock();
  assert.equal(FakeAudioContext.instances.length - before, 1, 'only one context is created');
  const { context, graph } = engine._internals;
  assert.equal(context.state, 'running');
  assert.equal(graph.master.gain.value, MIX.master);
  assert.equal(graph.music.gain.value, MIX.music);
  assert.equal(graph.sfx.gain.value, MIX.sfx);
  assert.ok(graph.compressor, 'master has a compressor');
  assert.ok(graph.master.outputs.has(context.destination));
  engine.dispose();
  assert.equal(context.state, 'closed');
});

test('playMusic before unlock is remembered and starts on unlock', async () => {
  const { engine } = setup();
  engine.playMusic('town');
  assert.equal(engine.currentMusic, 'town');
  await engine.unlock();
  assert.equal(engine.currentMusic, 'town');
  assert.ok(engine._internals.current, 'a player is running');
  advance(engine, 1);
  assert.ok(engine._internals.context.created.oscillator > 0, 'notes were scheduled');
  engine.dispose();

  const second = setup().engine;
  second.playMusic('lab');
  second.stopMusic();
  await second.unlock();
  assert.equal(second._internals.current, null, 'stopMusic cancels the pending song');
  second.dispose();
});

test('scheduler plays ahead, loops the song and never schedules late notes', async () => {
  const { engine, timers } = setup();
  await engine.unlock();
  engine.playMusic('town-night');
  assert.equal(timers.intervals.size, 1, 'lookahead timer is running');
  const ctx = engine._internals.context;
  const song = compileSong(SONGS['town-night']);
  const loop = loopSeconds(song);

  advance(engine, loop + 4);
  assert.ok(allParamsFinite(ctx), 'no late or invalid starts');
  for (const s of ctx.starts) {
    assert.ok(s.t <= s.at + 0.12 + 0.2, `scheduled too far ahead (${s.t} at ${s.at})`);
  }
  const notes = ctx.starts.filter((s) => s.kind === 'oscillator');
  assert.ok(
    notes.some((s) => s.t > loop + 0.5),
    'the body loops after its last bar',
  );
  engine.dispose();
  assert.equal(timers.intervals.size, 0, 'timer cleared on dispose');
});

test('title plays its intro once and then loops the body', async () => {
  const { engine } = setup();
  await engine.unlock();
  engine.playMusic('title');
  const song = compileSong(SONGS.title);
  const intro = song.intro.beats * song.spb;
  const body = loopSeconds(song);
  advance(engine, intro + body * 2 + 1, 0.05);
  const ctx = engine._internals.context;
  assert.ok(allParamsFinite(ctx));
  assert.ok(ctx.starts.some((s) => s.t > intro + body + 0.5), 'second pass of the body plays');
  engine.dispose();
});

test('same id keeps playing; a new id crossfades; stopMusic fades out', async () => {
  const { engine, timers } = setup();
  await engine.unlock();
  engine.playMusic('town');
  advance(engine, 2);
  const first = engine._internals.current;
  engine.playMusic('town');
  assert.equal(engine._internals.current, first, 'same id does not restart');

  engine.playMusic('lab', { fadeMs: 800 });
  const second = engine._internals.current;
  assert.notEqual(second, first);
  assert.equal(second.id, 'lab');
  assert.deepEqual(engine._internals.fading, [first], 'old song is fading');
  const fadeEvents = first.output.gain.events;
  assert.ok(fadeEvents.some((e) => e.name === 'linear' && e.v === 0), 'old song ramps to silence');
  assert.ok(second.output.gain.events.some((e) => e.name === 'linear' && e.v === 1), 'new song ramps in');

  // Both play during the crossfade, then the old one stops scheduling.
  const ctx = engine._internals.context;
  advance(engine, 1.2);
  assert.equal(first.done, true, 'old song stopped after the fade');
  timers.flushTimeouts();
  assert.deepEqual(engine._internals.fading, []);
  assert.equal(engine._internals.scheduler.has(first), false);

  // Quick back-and-forth revives the fading song instead of restarting it.
  engine.playMusic('home', { fadeMs: 600 });
  const home = engine._internals.current;
  engine.playMusic('lab', { fadeMs: 600 });
  assert.equal(engine._internals.current, second, 'fading song is revived');
  assert.ok(engine._internals.fading.includes(home));

  engine.stopMusic({ fadeMs: 300 });
  assert.equal(engine.currentMusic, null);
  advance(engine, 0.5);
  timers.flushTimeouts();
  const startsAfter = ctx.starts.length;
  advance(engine, 3);
  assert.equal(ctx.starts.length, startsAfter, 'nothing plays after stopMusic');
  assert.equal(engine._internals.scheduler.size, 0);
  assert.equal(timers.intervals.size, 0, 'timer idles when no music is playing');
  assert.ok(allParamsFinite(ctx));
  engine.dispose();
});

test('fadeMs = 0 switches songs immediately', async () => {
  const { engine } = setup();
  await engine.unlock();
  engine.playMusic('home');
  advance(engine, 0.5);
  engine.playMusic('lab', { fadeMs: 0 });
  const old = engine._internals.fading[0];
  assert.ok(old.output.gain.events.some((e) => e.name === 'set' && e.v === 0));
  advance(engine, 0.2);
  assert.equal(old.done, true);
  engine.dispose();
});

test('setMuted ramps the master gain smoothly and silences effects', async () => {
  const { engine } = setup();
  engine.setMuted(true);
  await engine.unlock();
  const { graph, context } = engine._internals;
  assert.equal(graph.master.gain.value, 0, 'starts muted when muted before unlock');
  engine.setMuted(false);
  const unmute = graph.master.gain.events.at(-1);
  assert.equal(unmute.name, 'target');
  assert.equal(unmute.v, MIX.master);
  assert.ok(unmute.tc > 0, 'glide, not a jump');
  context.currentTime = 1;
  engine.setMuted(true);
  const events = graph.master.gain.events;
  assert.equal(events.at(-2).name, 'hold', 'holds the current level first');
  assert.equal(events.at(-1).name, 'target');
  assert.equal(events.at(-1).v, 0);
  assert.equal(engine.muted, true);
  const nodes = context.nodeCount;
  engine.sfx('confirm');
  engine.cry('emberkit');
  assert.equal(context.nodeCount, nodes, 'muted sfx/cries create no nodes');
  engine.dispose();
});

test('every sfx id plays; text and bump are throttled; unknown ids are ignored', async () => {
  const { engine } = setup();
  await engine.unlock();
  const ctx = engine._internals.context;
  for (const id of SFX_IDS) {
    ctx.currentTime += 1;
    const before = ctx.nodeCount;
    engine.sfx(id);
    assert.ok(ctx.nodeCount > before, `sfx "${id}" made sound`);
  }
  ctx.currentTime += 1;
  let before = ctx.nodeCount;
  engine.sfx('text');
  const one = ctx.nodeCount - before;
  assert.ok(one > 0);
  before = ctx.nodeCount;
  engine.sfx('text');
  ctx.currentTime += 0.02;
  engine.sfx('text');
  assert.equal(ctx.nodeCount, before, 'text within 40 ms is dropped');
  ctx.currentTime += SFX_THROTTLE.text;
  engine.sfx('text');
  assert.ok(ctx.nodeCount > before, 'text plays again after the gap');

  before = ctx.nodeCount;
  engine.sfx('bump');
  engine.sfx('bump');
  const bumpOnce = ctx.nodeCount - before;
  ctx.currentTime += 0.5;
  engine.sfx('bump');
  assert.equal(ctx.nodeCount - before, bumpOnce * 2, 'bump repeats are throttled');

  before = ctx.nodeCount;
  engine.sfx('definitely-not-a-sound');
  engine.sfx(42);
  assert.equal(ctx.nodeCount, before);
  assert.ok(allParamsFinite(ctx));
  engine.dispose();
});

test('fanfare ducks the music and restores it', async () => {
  const { engine } = setup();
  await engine.unlock();
  engine.playMusic('lab');
  advance(engine, 1);
  engine.sfx('fanfare');
  const duck = engine._internals.graph.duck.gain.events;
  const low = duck.find((e) => e.name === 'linear' && e.v < 0.3);
  assert.ok(low, 'music ducks under the fanfare');
  const restore = duck.at(-1);
  assert.equal(restore.name, 'linear');
  assert.equal(restore.v, 1, 'music comes back');
  assert.ok(restore.t - low.t >= 1.5, 'duck lasts about as long as the jingle');
  // A cry during the fanfare must not lift the duck early.
  const count = duck.length;
  engine.cry('pipwing');
  assert.equal(duck.length, count);
  advance(engine, 3);
  assert.ok(allParamsFinite(engine._internals.context));
  engine.dispose();
});

test('cries play for every species, are distinct, and unknown species chirp', async () => {
  const { engine } = setup();
  await engine.unlock();
  const ctx = engine._internals.context;
  const signatures = new Map();
  for (const id of [...Object.keys(WILDLINGS), 'nobody']) {
    ctx.currentTime += 2;
    const from = ctx.starts.length;
    engine.cry(id);
    const started = ctx.starts.slice(from);
    assert.ok(started.length > 0, `cry "${id}" made sound`);
    const sig = started
      .filter((s) => s.kind === 'oscillator')
      .map((s) => `${s.node.type}:${Math.round(s.node.frequency.events[0]?.v ?? 0)}`)
      .join(',');
    signatures.set(id, sig);
  }
  assert.equal(new Set(signatures.values()).size, signatures.size, 'each species sounds different');
  for (const id of CRY_IDS) assert.ok(WILDLINGS[id], `cry for unknown species ${id}`);
  assert.ok(allParamsFinite(ctx));
  engine.dispose();
});

test('visibility changes suspend and resume the context', async () => {
  const { engine, document, timers } = setup();
  await engine.unlock();
  engine.playMusic('town');
  const ctx = engine._internals.context;
  document.hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(ctx.state, 'suspended');
  assert.equal(timers.intervals.size, 0, 'scheduler timer paused while hidden');
  const nodes = ctx.nodeCount;
  engine.sfx('confirm');
  assert.equal(ctx.nodeCount, nodes, 'no sfx while hidden');
  document.hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(ctx.state, 'running');
  assert.equal(timers.intervals.size, 1, 'scheduler resumed');
  engine.dispose();
});

test('a later user gesture resumes an interrupted context', async () => {
  const { engine, window } = setup();
  await engine.unlock();
  const ctx = engine._internals.context;
  ctx.state = 'interrupted';
  window.dispatchEvent(new Event('pointerdown'));
  assert.equal(ctx.state, 'running');
  engine.dispose();
});

test('unlock resolves even when resume() never settles', async () => {
  const engine = createAudio({
    AudioContext: StubbornAudioContext,
    document: new FakeDocument(),
    window: new EventTarget(),
    resumeTimeoutMs: 30,
  });
  const started = Date.now();
  await engine.unlock();
  assert.ok(Date.now() - started < 2000);
  engine.playMusic('home');
  engine.sfx('confirm'); // context not running: ignored, no throw
  engine.dispose();
});

test('scheduler catches up after a stall instead of bursting late notes', async () => {
  const { engine } = setup();
  await engine.unlock();
  engine.playMusic('lab');
  advance(engine, 2);
  const ctx = engine._internals.context;
  const from = ctx.starts.length;
  ctx.currentTime += 5; // timer was throttled for 5 s
  engine._internals.tick();
  const burst = ctx.starts.slice(from);
  assert.ok(burst.every((s) => s.t >= ctx.currentTime), 'nothing scheduled in the past');
  assert.ok(burst.length < 25, `no burst of queued notes (${burst.length})`);
  assert.equal(ctx.lateStarts, 0);
  engine.dispose();
});

test('works on a bare context without optional node types', async () => {
  const engine = createAudio({
    AudioContext: BareAudioContext,
    timers: fakeTimers(),
    document: new FakeDocument(),
    window: new EventTarget(),
    random: () => 0.3,
  });
  await engine.unlock();
  assert.equal(engine._internals.graph.compressor, null);
  for (const id of REQUIRED_MUSIC) {
    engine.playMusic(id, { fadeMs: 0 });
    advance(engine, 0.6);
  }
  for (const id of SFX_IDS) {
    engine._internals.context.currentTime += 1;
    engine.sfx(id);
  }
  for (const id of CRY_IDS) engine.cry(id);
  const ctx = engine._internals.context;
  assert.ok(ctx.starts.some((s) => s.node.type === 'square'), 'pulse falls back to square');
  assert.ok(allParamsFinite(ctx));
  engine.dispose();
});

test('players and scheduler work directly (one-shot + stop)', () => {
  const ctx = new FakeAudioContext();
  const out = ctx.createGain();
  const timers = fakeTimers();
  const scheduler = createScheduler(ctx, { timers });
  const song = compileSong(JINGLES.fanfare);
  const player = createSongPlayer(ctx, song, out, { startTime: 0.1, loop: false });
  scheduler.add(player);
  for (let t = 0; t < 4; t += 0.025) {
    ctx.currentTime = t;
    scheduler.tick();
  }
  assert.equal(player.done, true, 'one-shot finishes');
  assert.equal(scheduler.size, 0);
  assert.equal(timers.intervals.size, 0);
  assert.ok(playSfx(ctx, out, 'fanfare') > 1.5);
  assert.equal(playSfx(ctx, out, 'nope'), null);
  assert.ok(playCry(ctx, out, 'dewsnail') > 1);
  assert.ok(allParamsFinite(ctx));
  scheduler.dispose();
});
