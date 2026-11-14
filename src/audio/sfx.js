/**
 * One-shot sound effects (UI blips, footsteps, doors, the partner fanfare, ...).
 * Each effect is a few short procedural voices; all are original designs.
 * playSfx() only touches the context it is given.
 */
import { tone, noise } from './synth.js';
import { noteFreq } from './notation.js';
import { compileSong, playOnce } from './sequencer.js';
import { JINGLES } from './songs.js';
import { warnOnce } from './util.js';

/** Every sfx id the game may request. */
export const SFX_IDS = Object.freeze([
  'step',
  'bump',
  'door',
  'confirm',
  'cancel',
  'cursor',
  'text',
  'ledge',
  'grass',
  'save',
  'fanfare',
  'encounter',
  'menu',
]);

/**
 * Minimum seconds between two plays of the same effect. The dialog box calls 'text'
 * for every character burst and systems may call 'bump' every frame against a wall.
 * @type {Readonly<Record<string, number>>}
 */
export const SFX_THROTTLE = Object.freeze({
  text: 0.04,
  step: 0.06,
  bump: 0.22,
  grass: 0.07,
  cursor: 0.025,
});

const N = noteFreq;

/** @type {import('./sequencer.js').CompiledSong|null|undefined} */
let fanfareSong;

function getFanfare() {
  if (fanfareSong === undefined) {
    try {
      fanfareSong = compileSong(JINGLES.fanfare);
    } catch (err) {
      warnOnce('fanfare', 'Fanfare data is invalid', err);
      fanfareSong = null;
    }
  }
  return fanfareSong;
}

/**
 * @typedef {(ctx: BaseAudioContext, out: AudioNode, t: number, rand: () => number) => number} SfxFn
 * Each returns the effect's length in seconds.
 */

/** @type {Record<string, SfxFn>} */
const EFFECTS = {
  step(ctx, out, t, rand) {
    // Soft scuff on soil: a filtered tick plus a tiny low thump, varied every step.
    noise(ctx, out, { t, decay: 0.05, vol: 0.13, filter: { type: 'lowpass', freq: 700 + rand() * 500, q: 0.8 } });
    tone(ctx, out, {
      t,
      dur: 0.025,
      freq: 100 + rand() * 25,
      wave: 'triangle',
      vol: 0.12,
      slide: [[0.03, 70]],
      env: { a: 0.002, d: 0.02, s: 0.4, r: 0.02 },
    });
    return 0.06;
  },

  bump(ctx, out, t) {
    tone(ctx, out, {
      t,
      dur: 0.08,
      freq: 150,
      wave: 'triangle',
      vol: 0.5,
      slide: [[0.08, 68]],
      env: { a: 0.002, d: 0.06, s: 0.4, r: 0.05 },
    });
    noise(ctx, out, { t, decay: 0.06, vol: 0.16, filter: { type: 'lowpass', freq: 520 } });
    return 0.14;
  },

  door(ctx, out, t) {
    // Latch click, wooden thunk, then a soft swish of air.
    noise(ctx, out, { t, decay: 0.018, vol: 0.18, filter: { type: 'highpass', freq: 3200 } });
    tone(ctx, out, {
      t: t + 0.03,
      dur: 0.07,
      freq: 210,
      wave: 'triangle',
      vol: 0.42,
      slide: [[0.08, 105]],
      env: { a: 0.002, d: 0.05, s: 0.35, r: 0.05 },
    });
    noise(ctx, out, {
      t: t + 0.06,
      attack: 0.06,
      decay: 0.24,
      vol: 0.13,
      filter: { type: 'bandpass', freq: 520, q: 1.1, to: 1900, time: 0.28 },
    });
    return 0.38;
  },

  confirm(ctx, out, t) {
    const env = { a: 0.003, d: 0.05, s: 0.6, r: 0.04 };
    tone(ctx, out, { t, dur: 0.045, freq: N('B5'), wave: 'pulse', duty: 0.25, vol: 0.2, env });
    tone(ctx, out, { t: t + 0.055, dur: 0.085, freq: N('E6'), wave: 'pulse', duty: 0.25, vol: 0.2, env });
    return 0.2;
  },

  cancel(ctx, out, t) {
    const env = { a: 0.003, d: 0.05, s: 0.6, r: 0.04 };
    tone(ctx, out, { t, dur: 0.045, freq: N('A5'), wave: 'pulse', duty: 0.25, vol: 0.18, env });
    tone(ctx, out, {
      t: t + 0.055,
      dur: 0.08,
      freq: N('E5'),
      wave: 'pulse',
      duty: 0.25,
      vol: 0.18,
      slide: [[0.08, N('D5')]],
      env,
    });
    return 0.19;
  },

  cursor(ctx, out, t) {
    tone(ctx, out, {
      t,
      dur: 0.028,
      freq: N('E6'),
      wave: 'pulse',
      duty: 0.125,
      vol: 0.15,
      env: { a: 0.002, d: 0.02, s: 0.6, r: 0.025 },
    });
    return 0.06;
  },

  text(ctx, out, t, rand) {
    // Very quiet, slightly varied "blip" for typewriter text.
    tone(ctx, out, {
      t,
      dur: 0.022,
      freq: 620 + Math.round(rand() * 3) * 22,
      wave: 'pulse',
      duty: 0.5,
      vol: 0.06,
      filter: { type: 'lowpass', freq: 2600 },
      env: { a: 0.002, d: 0.015, s: 0.6, r: 0.02 },
    });
    return 0.045;
  },

  ledge(ctx, out, t) {
    // Springy hop up, then a soft landing timed to the hop arc.
    tone(ctx, out, {
      t,
      dur: 0.13,
      freq: 240,
      wave: 'triangle',
      vol: 0.32,
      slide: [[0.13, 640]],
      env: { a: 0.004, d: 0.08, s: 0.6, r: 0.05 },
    });
    tone(ctx, out, {
      t: t + 0.4,
      dur: 0.06,
      freq: 150,
      wave: 'triangle',
      vol: 0.3,
      slide: [[0.07, 70]],
      env: { a: 0.002, d: 0.05, s: 0.4, r: 0.05 },
    });
    noise(ctx, out, { t: t + 0.4, decay: 0.06, vol: 0.12, filter: { type: 'lowpass', freq: 700 } });
    return 0.5;
  },

  grass(ctx, out, t, rand) {
    // Three quick leafy swishes.
    const base = 2100 + rand() * 900;
    noise(ctx, out, { t, attack: 0.008, decay: 0.05, vol: 0.15, filter: { type: 'bandpass', freq: base, q: 0.9 } });
    noise(ctx, out, { t: t + 0.05, attack: 0.008, decay: 0.05, vol: 0.11, filter: { type: 'bandpass', freq: base * 1.2, q: 0.9 } });
    noise(ctx, out, { t: t + 0.11, attack: 0.01, decay: 0.09, vol: 0.09, filter: { type: 'bandpass', freq: base * 0.9, q: 0.9 } });
    return 0.22;
  },

  save(ctx, out, t) {
    // Rising sparkle that settles on a held note.
    const notes = ['G5', 'B5', 'D6', 'G6'];
    notes.forEach((name, i) => {
      const last = i === notes.length - 1;
      tone(ctx, out, {
        t: t + i * 0.07,
        dur: last ? 0.3 : 0.06,
        freq: N(name),
        wave: 'pulse',
        duty: 0.125,
        vol: 0.17,
        vibrato: last ? { rate: 7, depth: 14, delay: 0.08 } : null,
        env: { a: 0.003, d: 0.12, s: 0.55, r: last ? 0.2 : 0.05 },
      });
      tone(ctx, out, {
        t: t + i * 0.07,
        dur: last ? 0.3 : 0.06,
        freq: N(name) / 2,
        wave: 'triangle',
        vol: 0.12,
        env: { a: 0.003, d: 0.12, s: 0.5, r: last ? 0.2 : 0.05 },
      });
    });
    return 0.75;
  },

  fanfare(ctx, out, t) {
    const song = getFanfare();
    if (!song) return 0;
    return playOnce(ctx, song, out, t + 0.02);
  },

  encounter(ctx, out, t) {
    // Rustle, a "pop!" as something peeks out, then a bright two-note sparkle.
    noise(ctx, out, {
      t,
      attack: 0.02,
      decay: 0.14,
      vol: 0.18,
      filter: { type: 'bandpass', freq: 900, q: 1, to: 3800, time: 0.16 },
    });
    tone(ctx, out, {
      t: t + 0.15,
      dur: 0.045,
      freq: 480,
      wave: 'sine',
      vol: 0.3,
      slide: [[0.05, 1500]],
      env: { a: 0.002, d: 0.03, s: 0.6, r: 0.03 },
    });
    tone(ctx, out, { t: t + 0.22, dur: 0.06, freq: N('E6'), wave: 'pulse', duty: 0.25, vol: 0.17, env: { a: 0.003, d: 0.05, s: 0.6, r: 0.04 } });
    tone(ctx, out, {
      t: t + 0.3,
      dur: 0.2,
      freq: N('B6'),
      wave: 'pulse',
      duty: 0.25,
      vol: 0.15,
      vibrato: { rate: 9, depth: 22, delay: 0.05 },
      env: { a: 0.003, d: 0.1, s: 0.55, r: 0.12 },
    });
    return 0.62;
  },

  menu(ctx, out, t) {
    // Quick three-note strum upward.
    ['F#5', 'A5', 'D6'].forEach((name, i) => {
      tone(ctx, out, {
        t: t + i * 0.03,
        dur: i === 2 ? 0.08 : 0.04,
        freq: N(name),
        wave: 'pulse',
        duty: 0.25,
        vol: 0.15,
        env: { a: 0.003, d: 0.05, s: 0.55, r: 0.05 },
      });
    });
    tone(ctx, out, { t, dur: 0.1, freq: N('D5'), wave: 'triangle', vol: 0.14, env: { a: 0.004, d: 0.06, s: 0.5, r: 0.06 } });
    return 0.22;
  },
};

/**
 * Whether `id` names a known effect.
 * @param {string} id
 */
export function hasSfx(id) {
  return Object.prototype.hasOwnProperty.call(EFFECTS, id);
}

/**
 * Play a sound effect.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} out destination (the sfx bus)
 * @param {string} id one of SFX_IDS
 * @param {number} [t] start time (defaults to now)
 * @param {() => number} [rand] random source (tests pass a fixed one)
 * @returns {number|null} effect length in seconds, or null for an unknown id
 */
export function playSfx(ctx, out, id, t = ctx.currentTime, rand = Math.random) {
  if (!hasSfx(id)) return null;
  return EFFECTS[id](ctx, out, Math.max(ctx.currentTime, t), rand);
}
