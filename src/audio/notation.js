/**
 * Compact, human-editable note notation used by songs.js.
 *
 * A part is a string (or an array of strings, joined as consecutive bars) of
 * whitespace-separated tokens. `|` separates bars.
 *
 *   TOKEN := NAME [':' DUR] ['@' VEL]
 *   NAME  := pitch  e.g. C4, F#5, Bb3 (A4 = 440 Hz, C4 = middle C)
 *          | 'r'    rest
 *          | '~'    tie: extends the previous note (or rest) by DUR
 *          | drum   lowercase drum id (drum parts only, see synth.js DRUM_IDS)
 *   DUR   := w (4 beats) | h (2) | q (1) | e (1/2) | s (1/4)
 *            optionally followed by '.' (dotted, x1.5) or 't' (triplet, x2/3).
 *            Omitted -> same duration as the previous token (a part starts at 'q').
 *   VEL   := velocity multiplier 0..1 (default 1)
 *
 * One beat = one quarter note. Example: 'B4:e D5 G5:q. A5:e B5:q' is one 4/4 bar.
 */

/** Beats per duration letter. */
export const DURATION_BEATS = Object.freeze({ w: 4, h: 2, q: 1, e: 0.5, s: 0.25 });

const PITCH_RE = /^([A-G])(#|b)?([0-8])$/;
const DUR_RE = /^([whqes])(\.|t)?$/;
const SEMITONES = Object.freeze({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 });

/**
 * Convert a pitch name to a MIDI note number.
 * @param {string} name e.g. 'C4' (60), 'A4' (69), 'F#5', 'Bb3'
 * @returns {number|null} null when the name is not a valid pitch
 */
export function noteToMidi(name) {
  const m = PITCH_RE.exec(String(name));
  if (!m) return null;
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + SEMITONES[m[1]] + accidental;
}

/**
 * @param {number} midi
 * @returns {number} frequency in Hz (equal temperament, A4 = 440)
 */
export function midiToFreq(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * Frequency of a pitch name, e.g. noteFreq('E6').
 * @param {string} name
 * @returns {number} Hz, or NaN for an invalid name
 */
export function noteFreq(name) {
  const midi = noteToMidi(name);
  return midi === null ? NaN : midiToFreq(midi);
}

/**
 * Parse a duration code.
 * @param {string} code e.g. 'q', 'e.', 'qt', 'h.'
 * @returns {number} beats, or NaN when invalid
 */
export function parseDuration(code) {
  const m = DUR_RE.exec(String(code));
  if (!m) return NaN;
  let beats = DURATION_BEATS[/** @type {keyof typeof DURATION_BEATS} */ (m[1])];
  if (m[2] === '.') beats *= 1.5;
  else if (m[2] === 't') beats *= 2 / 3;
  return beats;
}

/**
 * @typedef {object} NoteEvent
 * @property {number} beat   start, in beats from the start of the part
 * @property {number} dur    length in beats (ties included)
 * @property {number|string} note  MIDI number, or drum id for drum parts
 * @property {number} vel    velocity 0..1
 */

/**
 * @typedef {object} ParsedPart
 * @property {NoteEvent[]} events
 * @property {number[]} barLengths  beats in each bar, in order
 * @property {number} totalBeats
 */

/**
 * Parse one voice's part.
 * @param {string|string[]} source
 * @param {{ drums?: ReadonlySet<string>|null }} [opts] pass the drum id set for drum parts
 * @returns {ParsedPart}
 * @throws {Error} with a readable message (bar number + token) on any syntax error
 */
export function parsePart(source, { drums = null } = {}) {
  const text = Array.isArray(source) ? source.join(' | ') : String(source ?? '');
  /** @type {NoteEvent[]} */
  const events = [];
  /** @type {number[]} */
  const barLengths = [];
  let beat = 0;
  let prevDur = 1;
  /** @type {NoteEvent|null} */
  let last = null;

  const bars = text
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

  bars.forEach((bar, barIndex) => {
    let length = 0;
    for (const token of bar.split(/\s+/)) {
      if (!token) continue;
      const where = `bar ${barIndex + 1}, token "${token}"`;
      const { name, dur, vel } = parseToken(token, prevDur, where);
      prevDur = dur;
      if (name === 'r') {
        last = null;
      } else if (name === '~') {
        if (last) last.dur += dur;
      } else {
        let note;
        if (drums) {
          if (!drums.has(name)) throw new Error(`Unknown drum "${name}" (${where})`);
          note = name;
        } else {
          note = noteToMidi(name);
          if (note === null) throw new Error(`Invalid note name "${name}" (${where})`);
        }
        last = { beat, dur, note, vel };
        events.push(last);
      }
      beat += dur;
      length += dur;
    }
    barLengths.push(length);
  });

  return { events, barLengths, totalBeats: beat };
}

/**
 * @param {string} token
 * @param {number} prevDur
 * @param {string} where
 */
function parseToken(token, prevDur, where) {
  let body = token;
  let vel = 1;
  const at = body.indexOf('@');
  if (at >= 0) {
    vel = Number(body.slice(at + 1));
    body = body.slice(0, at);
    if (!(vel >= 0 && vel <= 1)) throw new Error(`Velocity must be 0..1 (${where})`);
  }
  let name = body;
  let dur = prevDur;
  const colon = body.indexOf(':');
  if (colon >= 0) {
    name = body.slice(0, colon);
    dur = parseDuration(body.slice(colon + 1));
    if (!(dur > 0)) throw new Error(`Invalid duration (${where})`);
  }
  if (!name) throw new Error(`Missing note name (${where})`);
  return { name, dur, vel };
}
