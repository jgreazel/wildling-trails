/**
 * Chip-style voices on the Web Audio API: band-limited pulse waves (12.5 / 25 / 50 %
 * duty), triangle and sine oscillators, a cached white-noise buffer, an ADSR helper
 * and a tiny soft drum kit. Every function only touches the context passed in, so
 * this module imports cleanly in Node.
 */
import { clamp, disconnectAll, warnOnce } from './util.js';

/** Supported pulse duty cycles (fraction of the period spent high). */
export const PULSE_DUTIES = Object.freeze([0.125, 0.25, 0.5]);

/**
 * @typedef {object} Envelope
 * @property {number} a attack seconds
 * @property {number} d decay seconds (to sustain)
 * @property {number} s sustain level 0..1 (fraction of peak)
 * @property {number} r release seconds
 */

/** @type {Envelope} */
export const DEFAULT_ENV = Object.freeze({ a: 0.004, d: 0.1, s: 0.7, r: 0.06 });

/**
 * Instrument presets referenced by song voices (`inst`).
 * @type {Readonly<Record<string, { wave?: string, duty?: number, kind?: 'drums', env?: Envelope }>>}
 */
export const INSTRUMENTS = Object.freeze({
  pulse12: { wave: 'pulse', duty: 0.125, env: { a: 0.004, d: 0.14, s: 0.62, r: 0.07 } },
  pulse25: { wave: 'pulse', duty: 0.25, env: { a: 0.005, d: 0.16, s: 0.6, r: 0.07 } },
  pulse50: { wave: 'pulse', duty: 0.5, env: { a: 0.008, d: 0.18, s: 0.55, r: 0.08 } },
  triangle: { wave: 'triangle', env: { a: 0.004, d: 0.12, s: 0.8, r: 0.05 } },
  sine: { wave: 'sine', env: { a: 0.006, d: 0.15, s: 0.7, r: 0.08 } },
  drums: { kind: 'drums' },
});

/** Drum ids usable in drum parts. */
export const DRUM_IDS = Object.freeze([
  'bd', // soft kick
  'sn', // snare / brush
  'hh', // closed hat
  'oh', // open hat
  'sh', // shaker
  'cr', // crash / shimmer
  'ck', // cricket chirp (night ambience)
]);

/** @type {ReadonlySet<string>} */
export const DRUM_SET = new Set(DRUM_IDS);

const HARMONICS = 64;
/** @type {WeakMap<BaseAudioContext, Map<number, PeriodicWave|null>>} */
const waveCache = new WeakMap();
/** @type {WeakMap<BaseAudioContext, AudioBuffer|null>} */
const noiseCache = new WeakMap();

/**
 * Band-limited pulse wave with the given duty cycle (cached per context).
 * @param {BaseAudioContext} ctx
 * @param {number} duty 0 < duty < 1
 * @returns {PeriodicWave|null} null when PeriodicWave is unsupported
 */
export function pulseWave(ctx, duty) {
  if (typeof ctx.createPeriodicWave !== 'function') return null;
  let byDuty = waveCache.get(ctx);
  if (!byDuty) {
    byDuty = new Map();
    waveCache.set(ctx, byDuty);
  }
  const d = clamp(Number(duty) || 0.5, 0.01, 0.99);
  if (byDuty.has(d)) return byDuty.get(d) ?? null;
  // Fourier series of a 0/1 pulse that is high for the first `d` of each period.
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  for (let k = 1; k < HARMONICS; k++) {
    real[k] = Math.sin(2 * Math.PI * k * d) / (Math.PI * k);
    imag[k] = (1 - Math.cos(2 * Math.PI * k * d)) / (Math.PI * k);
  }
  /** @type {PeriodicWave|null} */
  let wave = null;
  try {
    wave = ctx.createPeriodicWave(real, imag);
  } catch (err) {
    warnOnce('periodic-wave', 'PeriodicWave unavailable, using square waves', err);
  }
  byDuty.set(d, wave);
  return wave;
}

/**
 * One second of deterministic white noise (cached per context).
 * @param {BaseAudioContext} ctx
 * @returns {AudioBuffer|null}
 */
export function noiseBuffer(ctx) {
  if (noiseCache.has(ctx)) return noiseCache.get(ctx) ?? null;
  /** @type {AudioBuffer|null} */
  let buffer = null;
  try {
    const rate = ctx.sampleRate || 44100;
    buffer = ctx.createBuffer(1, Math.floor(rate), rate);
    const data = buffer.getChannelData(0);
    let seed = 0x2f6e2b1;
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = seed / 2147483648 - 1;
    }
  } catch (err) {
    warnOnce('noise-buffer', 'Could not create the noise buffer', err);
    buffer = null;
  }
  noiseCache.set(ctx, buffer);
  return buffer;
}

/**
 * Create an oscillator for a chip voice.
 * @param {BaseAudioContext} ctx
 * @param {string} wave 'pulse' | 'triangle' | 'sine' | 'square' | 'sawtooth'
 * @param {number} [duty] pulse duty
 * @returns {OscillatorNode}
 */
export function makeOscillator(ctx, wave, duty = 0.5) {
  const osc = ctx.createOscillator();
  if (wave === 'pulse') {
    const pw = pulseWave(ctx, duty);
    if (pw) osc.setPeriodicWave(pw);
    else osc.type = 'square';
  } else if (wave === 'triangle' || wave === 'sine' || wave === 'square' || wave === 'sawtooth') {
    osc.type = wave;
  } else {
    osc.type = 'square';
  }
  return osc;
}

/**
 * Apply an attack/decay/sustain/release envelope to a gain param.
 * Release uses an exponential tail so notes never end with a click.
 * @param {AudioParam} param
 * @param {number} t     note-on time
 * @param {number} dur   seconds until note-off
 * @param {Partial<Envelope>} env
 * @param {number} peak  level reached at the end of the attack
 * @returns {number} time at which the release is (practically) silent
 */
export function envelope(param, t, dur, env, peak) {
  const a = Math.max(0.001, Number(env.a ?? DEFAULT_ENV.a));
  const d = Math.max(0.003, Number(env.d ?? DEFAULT_ENV.d));
  const s = clamp(Number(env.s ?? DEFAULT_ENV.s), 0, 1);
  const r = Math.max(0.005, Number(env.r ?? DEFAULT_ENV.r));
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  const off = t + Math.max(dur, a);
  if (s < 1 && off > t + a) param.setTargetAtTime(peak * s, t + a, d / 3);
  param.setTargetAtTime(0, off, r / 5);
  return off + r;
}

/**
 * @param {BaseAudioContext} ctx
 * @param {{ type?: BiquadFilterType, freq: number, q?: number, to?: number, time?: number }} spec
 * @param {number} t
 */
function makeFilter(ctx, spec, t) {
  const f = ctx.createBiquadFilter();
  f.type = spec.type ?? 'lowpass';
  f.frequency.setValueAtTime(Math.max(10, spec.freq), t);
  if (spec.to && spec.to > 0) f.frequency.exponentialRampToValueAtTime(Math.max(10, spec.to), t + Math.max(0.005, spec.time ?? 0.1));
  f.Q.setValueAtTime(spec.q ?? 0.7, t);
  return f;
}

/**
 * @typedef {object} ToneOptions
 * @property {number} [t]      start time (defaults to now; never earlier than now)
 * @property {number} dur      seconds until note-off
 * @property {number} freq     Hz
 * @property {string} [wave]   'pulse' | 'triangle' | 'sine' | 'square'
 * @property {number} [duty]   pulse duty
 * @property {number} [vol]    peak gain
 * @property {Partial<Envelope>} [env]
 * @property {Array<[number, number, ('exp'|'lin')?]>} [slide]  [offset s, target Hz, curve] pitch automation
 * @property {{ rate: number, depth: number, delay?: number }|null} [vibrato] depth in cents
 * @property {{ type?: BiquadFilterType, freq: number, q?: number, to?: number, time?: number }} [filter]
 * @property {number} [detune] cents
 */

/**
 * Play one enveloped oscillator note.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} dest
 * @param {ToneOptions} o
 * @returns {number} time the note becomes silent
 */
export function tone(ctx, dest, o) {
  const now = ctx.currentTime;
  const t = Math.max(now, Number.isFinite(o.t) ? /** @type {number} */ (o.t) : now);
  const freq = Number(o.freq);
  const vol = Number(o.vol ?? 0.3);
  if (!(freq > 0) || !(vol > 0)) return t;
  const dur = Math.max(0.005, Number(o.dur) || 0.1);

  const osc = makeOscillator(ctx, o.wave ?? 'pulse', o.duty ?? 0.5);
  osc.frequency.setValueAtTime(freq, t);
  for (const [dt, target, curve] of o.slide ?? []) {
    if (!(target > 0) || !(dt > 0)) continue;
    if (curve === 'lin') osc.frequency.linearRampToValueAtTime(target, t + dt);
    else osc.frequency.exponentialRampToValueAtTime(target, t + dt);
  }
  if (o.detune) osc.detune.setValueAtTime(o.detune, t);

  const amp = ctx.createGain();
  const end = envelope(amp.gain, t, dur, { ...DEFAULT_ENV, ...(o.env ?? {}) }, vol);
  /** @type {AudioNode[]} */
  const nodes = [osc, amp];
  /** @type {AudioNode} */
  let head = osc;
  if (o.filter) {
    const f = makeFilter(ctx, o.filter, t);
    osc.connect(f);
    head = f;
    nodes.push(f);
  }
  head.connect(amp);
  amp.connect(dest);

  const vib = o.vibrato;
  if (vib && vib.depth > 0 && vib.rate > 0) {
    const delay = Math.max(0, vib.delay ?? 0.15);
    if (end - t > delay + 0.05) {
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(vib.rate, t);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.setValueAtTime(0, t + delay);
      depth.gain.linearRampToValueAtTime(vib.depth, t + delay + 0.18);
      lfo.connect(depth);
      depth.connect(osc.detune);
      lfo.start(t);
      lfo.stop(end + 0.02);
      nodes.push(lfo, depth);
    }
  }

  osc.start(t);
  osc.stop(end + 0.02);
  osc.onended = () => disconnectAll(nodes);
  return end;
}

/**
 * @typedef {object} NoiseOptions
 * @property {number} [t]
 * @property {number} decay   seconds from peak to silence
 * @property {number} [attack]
 * @property {number} [hold]  seconds held at peak before decaying
 * @property {number} [vol]
 * @property {{ type?: BiquadFilterType, freq: number, q?: number, to?: number, time?: number }} [filter]
 * @property {number} [rate]  playback rate (pitch of the noise)
 */

/**
 * Play a burst of filtered white noise (percussion, rustles, whooshes).
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} dest
 * @param {NoiseOptions} o
 * @returns {number} time the burst is silent
 */
export function noise(ctx, dest, o) {
  const now = ctx.currentTime;
  const t = Math.max(now, Number.isFinite(o.t) ? /** @type {number} */ (o.t) : now);
  const vol = Number(o.vol ?? 0.3);
  const buffer = noiseBuffer(ctx);
  if (!buffer || !(vol > 0)) return t;
  const attack = Math.max(0.001, o.attack ?? 0.002);
  const hold = Math.max(0, o.hold ?? 0);
  const decay = Math.max(0.005, o.decay ?? 0.1);

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  if (o.rate && o.rate > 0) src.playbackRate.setValueAtTime(o.rate, t);
  const amp = ctx.createGain();
  /** @type {AudioNode[]} */
  const nodes = [src, amp];
  /** @type {AudioNode} */
  let head = src;
  if (o.filter) {
    const f = makeFilter(ctx, o.filter, t);
    src.connect(f);
    head = f;
    nodes.push(f);
  }
  head.connect(amp);
  amp.connect(dest);

  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(vol, t + attack);
  if (hold > 0) amp.gain.setValueAtTime(vol, t + attack + hold);
  const end = t + attack + hold + decay;
  amp.gain.exponentialRampToValueAtTime(0.0004, end);
  amp.gain.setValueAtTime(0, end + 0.005);

  const offset = Math.random() * Math.max(0, buffer.duration - 0.05);
  src.start(t, Number.isFinite(offset) ? offset : 0);
  src.stop(end + 0.02);
  src.onended = () => disconnectAll(nodes);
  return end;
}

/**
 * Play one drum hit from the soft kit.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} dest
 * @param {string} id one of DRUM_IDS
 * @param {number} t
 * @param {number} [vel] 0..1
 * @returns {number} time the hit is silent
 */
export function playDrum(ctx, dest, id, t, vel = 1) {
  const v = clamp(Number(vel) || 0, 0, 1);
  if (v <= 0) return t;
  switch (id) {
    case 'bd':
      noise(ctx, dest, { t, decay: 0.02, vol: 0.18 * v, filter: { type: 'lowpass', freq: 1600 } });
      return tone(ctx, dest, {
        t,
        dur: 0.07,
        freq: 150,
        wave: 'sine',
        vol: 0.85 * v,
        slide: [[0.07, 46]],
        env: { a: 0.002, d: 0.07, s: 0.35, r: 0.07 },
      });
    case 'sn':
      tone(ctx, dest, { t, dur: 0.03, freq: 210, wave: 'triangle', vol: 0.3 * v, slide: [[0.04, 150]], env: { a: 0.002, d: 0.03, s: 0.4, r: 0.03 } });
      return noise(ctx, dest, { t, decay: 0.12, vol: 0.4 * v, filter: { type: 'bandpass', freq: 1900, q: 0.7 } });
    case 'hh':
      return noise(ctx, dest, { t, decay: 0.035, vol: 0.24 * v, filter: { type: 'highpass', freq: 7600, q: 0.6 } });
    case 'oh':
      return noise(ctx, dest, { t, decay: 0.22, vol: 0.17 * v, filter: { type: 'highpass', freq: 6400, q: 0.6 } });
    case 'sh':
      return noise(ctx, dest, { t, attack: 0.014, decay: 0.05, vol: 0.2 * v, filter: { type: 'bandpass', freq: 5600, q: 1.3 } });
    case 'cr':
      return noise(ctx, dest, { t, attack: 0.004, decay: 0.95, vol: 0.2 * v, filter: { type: 'highpass', freq: 4600, q: 0.5 } });
    case 'ck': {
      let end = t;
      for (let i = 0; i < 3; i++) {
        end = tone(ctx, dest, {
          t: t + i * 0.048,
          dur: 0.022,
          freq: 4350,
          wave: 'sine',
          vol: 0.32 * v,
          env: { a: 0.004, d: 0.01, s: 0.7, r: 0.012 },
        });
      }
      return end;
    }
    default:
      warnOnce(`drum:${id}`, `Unknown drum "${id}"`);
      return t;
  }
}
