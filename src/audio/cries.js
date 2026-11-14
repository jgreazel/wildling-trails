/**
 * Procedural creature cries, one distinct voice per wildling species
 * (ids from src/data/wildlings.js). Unknown species get a friendly generic chirp.
 * Each cry has a little random variation so repeats feel alive.
 */
import { tone, noise } from './synth.js';

/** Species with a bespoke cry. */
export const CRY_IDS = Object.freeze(['emberkit', 'brookling', 'mossbun', 'pipwing', 'dewsnail']);

/**
 * @typedef {(ctx: BaseAudioContext, out: AudioNode, t: number, rand: () => number) => number} CryFn
 * Each returns the cry's length in seconds.
 */

/** @type {Record<string, CryFn>} */
const CRIES = {
  /** Emberkit — two bright fox-kit yips and a few ember crackles. */
  emberkit(ctx, out, t, rand) {
    const j = 1 + (rand() - 0.5) * 0.06;
    /** @param {number} at @param {number} f */
    const yip = (at, f) => {
      tone(ctx, out, {
        t: at,
        dur: 0.08,
        freq: f * 0.82,
        wave: 'pulse',
        duty: 0.25,
        vol: 0.3,
        slide: [
          [0.025, f * 1.25],
          [0.085, f * 0.92],
        ],
        filter: { type: 'lowpass', freq: 5200 },
        env: { a: 0.004, d: 0.05, s: 0.6, r: 0.035 },
      });
      noise(ctx, out, { t: at, decay: 0.03, vol: 0.05, filter: { type: 'highpass', freq: 3000 } });
    };
    yip(t, 880 * j);
    yip(t + 0.14, 1060 * j);
    for (let i = 0; i < 3; i++) {
      noise(ctx, out, {
        t: t + 0.27 + i * 0.045 + rand() * 0.03,
        decay: 0.01,
        vol: 0.08,
        filter: { type: 'highpass', freq: 4200 },
      });
    }
    return 0.45;
  },

  /** Brookling — a bubbly, wobbling warble with little bubble pops. */
  brookling(ctx, out, t, rand) {
    const j = 1 + (rand() - 0.5) * 0.06;
    tone(ctx, out, {
      t,
      dur: 0.42,
      freq: 520 * j,
      wave: 'triangle',
      vol: 0.36,
      slide: [
        [0.16, 790 * j],
        [0.42, 610 * j],
      ],
      vibrato: { rate: 16, depth: 70, delay: 0.02 },
      env: { a: 0.02, d: 0.2, s: 0.75, r: 0.08 },
    });
    for (let i = 0; i < 4; i++) {
      const at = t + 0.05 + i * 0.11 + rand() * 0.04;
      tone(ctx, out, {
        t: at,
        dur: 0.03,
        freq: 480 + rand() * 180,
        wave: 'sine',
        vol: 0.16,
        slide: [[0.035, 1400 + rand() * 300]],
        env: { a: 0.002, d: 0.02, s: 0.6, r: 0.02 },
      });
    }
    return 0.55;
  },

  /** Mossbun — a soft nose squeak and a little falling chirp. */
  mossbun(ctx, out, t, rand) {
    const j = 1 + (rand() - 0.5) * 0.06;
    tone(ctx, out, {
      t,
      dur: 0.07,
      freq: 1300 * j,
      wave: 'sine',
      vol: 0.26,
      slide: [[0.07, 1760 * j]],
      filter: { type: 'lowpass', freq: 4000 },
      env: { a: 0.008, d: 0.04, s: 0.7, r: 0.03 },
    });
    tone(ctx, out, {
      t: t + 0.12,
      dur: 0.1,
      freq: 1650 * j,
      wave: 'triangle',
      vol: 0.2,
      slide: [[0.1, 1240 * j]],
      filter: { type: 'lowpass', freq: 3600 },
      env: { a: 0.006, d: 0.06, s: 0.6, r: 0.05 },
    });
    noise(ctx, out, { t: t + 0.25, attack: 0.01, decay: 0.04, vol: 0.04, filter: { type: 'bandpass', freq: 2200, q: 1.5 } });
    return 0.32;
  },

  /** Pipwing — a rising tweet, a quick trill, and a falling tweet. */
  pipwing(ctx, out, t, rand) {
    const j = 1 + (rand() - 0.5) * 0.05;
    const env = { a: 0.003, d: 0.03, s: 0.7, r: 0.025 };
    tone(ctx, out, { t, dur: 0.065, freq: 2200 * j, wave: 'sine', vol: 0.18, slide: [[0.065, 3100 * j]], env });
    for (let i = 0; i < 6; i++) {
      const f = (i % 2 ? 2900 : 2600) * j;
      tone(ctx, out, {
        t: t + 0.1 + i * 0.045,
        dur: 0.032,
        freq: f,
        wave: 'sine',
        vol: 0.15,
        slide: [[0.032, f * 0.9]],
        env,
      });
    }
    tone(ctx, out, {
      t: t + 0.4,
      dur: 0.09,
      freq: 3000 * j,
      wave: 'triangle',
      vol: 0.12,
      slide: [[0.09, 2150 * j]],
      filter: { type: 'lowpass', freq: 6000 },
      env,
    });
    return 0.52;
  },

  /** Dewsnail — two slow, glassy bell chimes over a faint low hum. */
  dewsnail(ctx, out, t, rand) {
    const j = 1 + (rand() - 0.5) * 0.03;
    const partials = [
      [1, 1],
      [2.76, 0.42],
      [5.4, 0.2],
      [8.93, 0.08],
    ];
    /** @param {number} at @param {number} f @param {number} level */
    const chime = (at, f, level) => {
      partials.forEach(([ratio, amp], i) => {
        tone(ctx, out, {
          t: at,
          dur: 0.9 / (i + 1),
          freq: f * ratio,
          wave: 'sine',
          vol: 0.2 * amp * level,
          env: { a: 0.012, d: 1.2 / (i + 1), s: 0.05, r: 0.5 / (i + 1) },
        });
      });
    };
    chime(t, 1046.5 * j, 1);
    chime(t + 0.38, 784 * j, 0.75);
    tone(ctx, out, {
      t,
      dur: 0.7,
      freq: 196 * j,
      wave: 'triangle',
      vol: 0.08,
      slide: [[0.7, 182 * j, 'lin']],
      env: { a: 0.15, d: 0.4, s: 0.6, r: 0.3 },
    });
    return 1.5;
  },
};

/** Generic friendly chirp for species without a bespoke cry. */
/** @type {CryFn} */
function genericCry(ctx, out, t, rand) {
  const j = 1 + (rand() - 0.5) * 0.06;
  tone(ctx, out, {
    t,
    dur: 0.18,
    freq: 700 * j,
    wave: 'triangle',
    vol: 0.28,
    slide: [
      [0.08, 1100 * j],
      [0.18, 900 * j],
    ],
    env: { a: 0.006, d: 0.08, s: 0.7, r: 0.05 },
  });
  return 0.25;
}

/**
 * Play a species cry.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} out destination (the sfx bus)
 * @param {string} speciesId
 * @param {number} [t] start time (defaults to now)
 * @param {() => number} [rand]
 * @returns {number} cry length in seconds
 */
export function playCry(ctx, out, speciesId, t = ctx.currentTime, rand = Math.random) {
  const fn = Object.prototype.hasOwnProperty.call(CRIES, speciesId) ? CRIES[speciesId] : genericCry;
  return fn(ctx, out, Math.max(ctx.currentTime, t), rand);
}
