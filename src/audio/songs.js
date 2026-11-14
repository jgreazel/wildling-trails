/**
 * Original chiptune compositions for Wildling Trails (written for this game).
 *
 * Format (see notation.js for the token grammar):
 *   {
 *     id, bpm, meter (beats per bar), swing? (0..1), loop? (default true),
 *     echo?: { beats, feedback, mix, cutoff }          // optional song-wide echo
 *     voices: { name: { inst, vol, gate?, pan?, echo?, vibrato?, env?, detune? } },
 *     intro?: { voiceName: part },                    // plays once
 *     body:   { voiceName: part },                    // loops forever
 *   }
 * A part is an array of strings; each string holds whole bars separated by '|'.
 * Every bar of every voice must add up to `meter` beats (tests enforce this).
 *
 * Handheld-console palette: two pulse voices (lead + counter), a triangle bass and
 * a light noise kit (bd sn hh oh sh cr ck). Chord symbols in the comments are only
 * there to make editing easier.
 */

/**
 * Repeat a one-bar pattern.
 * @param {string} pattern one bar
 * @param {number} n
 */
const bars = (pattern, n) => Array.from({ length: n }, () => pattern).join(' | ');

// ---------------------------------------------------------------------------
// title — "Trailhead Morning" (D major, 120 bpm). Hopeful, a little heroic.
// Intro 4 bars, then a 16-bar loop.
// ---------------------------------------------------------------------------

const TITLE_GROOVE = 'bd:e hh sn hh bd bd sn hh';
const TITLE_FILL = 'bd:e hh sn hh sn:s sn sn sn sn:e oh';

const TITLE = {
  id: 'title',
  bpm: 120,
  meter: 4,
  voices: {
    lead: { inst: 'pulse25', vol: 0.42, gate: 0.92, pan: -0.12, vibrato: { rate: 5.6, depth: 14, delay: 0.16 } },
    counter: { inst: 'pulse12', vol: 0.2, gate: 0.85, pan: 0.22 },
    bass: { inst: 'triangle', vol: 0.8, gate: 0.82 },
    drums: { inst: 'drums', vol: 0.5 },
  },
  intro: {
    //        D                                         | D
    lead: [
      'D5:e. D5:s D5:e A4:e D5:q F#5:q | A5:e. A5:s A5:e F#5:e A5:q D6:q',
      //        G          A               | A(sus) run
      'D6:q. B5:e C#6:q. A5:e | A5:e B5 C#6 D6 E6:h',
    ],
    counter: [
      'F#4:e. F#4:s F#4:e E4:e F#4:q A4:q | D5:e. D5:s D5:e D5:e F#5:q A5:q',
      'B5:q. G5:e A5:q. E5:e | C#5:e D5 E5 F#5 G5:h',
    ],
    bass: [
      'D3:e. D3:s D3:e A2:e D3:q D3:q | D3:e. D3:s D3:e A2:e D3:q A2:q',
      'G2:q. G2:e A2:q. A2:e | A2:e A2 A2 A2 A2 A2 B2 C#3',
    ],
    drums: [
      'bd:e. sn:s sn:e bd:e bd:q sn:q | bd:e. sn:s sn:e bd:e bd:q sn:q',
      'bd:q. bd:e sn:q. sn:e | sn:s@0.3 sn@0.36 sn@0.42 sn@0.48 sn@0.54 sn@0.6 sn@0.66 sn@0.72 sn@0.78 sn@0.84 sn@0.9 sn@0.96 bd:e oh:e',
    ],
  },
  body: {
    lead: [
      //  D                     | A/C#               | Bm                              | G
      'F#5:q. E5:e D5:q A5:q | C#6:q. B5:e A5:h | B5:e A5 F#5:q D5:q F#5:e A5:e | B5:h. A5:e G5:e',
      //  D                     | Em                 | G                               | A
      'F#5:q. E5:e D5:q D6:q | B5:q. A5:e G5:q E5:q | D5:e G5 B5:q D6:q. B5:e | C#6:h E5:e F#5 G5 A5',
      //  Bm                    | G                  | D                               | A
      'B5:q. C#6:e D6:q B5:q | D6:q. C#6:e B5:q G5:q | A5:q. F#5:e D5:q F#5:q | E5:h. A4:e C#5:e',
      //  G                     | D/F#               | Em                              | A
      'D5:q. G5:e B5:q D6:q | D6:q. A5:e F#5:q A5:q | G5:e A5 B5:q E6:q D6:e C#6:e | C#6:q. B5:e A5:q G5:e E5:e',
    ],
    counter: [
      'D5:h A4:h | E5:h C#5:h | D5:h B4:h | D5:e E5 G5 D5 B4:q D5:q',
      'A4:h F#4:h | G4:h B4:h | B4:h D5:h | E5:h C#5:h',
      'B4:e D5 F#5 D5 B4 D5 F#5 D5 | B4:e D5 G5 D5 B4 D5 G5 D5 | A4:e D5 F#5 D5 A4 D5 F#5 D5 | A4:e C#5 E5 C#5 A4 C#5 E5 C#5',
      'B4:e D5 G5 D5 B4 D5 G5 D5 | A4:e D5 F#5 D5 A4 D5 F#5 D5 | G4:e B4 E5 B4 G4 B4 D5 E5 | A4:e C#5 E5 C#5 A4 C#5 B4 C#5',
    ],
    bass: [
      'D3:e D3 A2 D3 F#3 D3 A2 D3 | C#3:e C#3 A2 C#3 E3 C#3 A2 C#3 | B2:e B2 F#2 B2 D3 B2 F#2 B2 | G2:e G2 D3 G2 B2 G2 D3 G2',
      'D3:e D3 A2 D3 F#3 D3 A2 D3 | E3:e E3 B2 E3 G3 E3 B2 E3 | G2:e G2 D3 G2 B2 G2 D3 G2 | A2:e A2 E3 A2 C#3 A2 E3 A2',
      'B2:q. F#2:e B2:q D3:q | G2:q. D3:e G2:q B2:q | D3:q. A2:e D3:q F#3:q | A2:q. E2:e A2:q C#3:q',
      'G2:q. D3:e G2:q B2:q | F#2:q. A2:e D3:q F#3:q | E3:q. B2:e G2:q E2:q | A2:e A2 C#3 A2 E3 A2 C#3 E3',
    ],
    drums: [
      `${bars(TITLE_GROOVE, 7)} | ${TITLE_FILL}`,
      `${bars(TITLE_GROOVE, 7)} | ${TITLE_FILL}`,
    ],
  },
};

// ---------------------------------------------------------------------------
// town — "Creekside Breeze" (G major, 104 bpm). Fernhollow by day.
// 32-bar loop: A (8) · B (8) · A' (8) · C (8, lyrical, half-time drums).
// ---------------------------------------------------------------------------

const TOWN_LEAD_A = [
  //  G                       | C                    | G                            | D
  'B4:e D5 G5:q. A5:e B5:q | C6:q. B5:e A5:q G5:q | G5:q. D5:e E5:e G5:e B5:q | A5:h. F#5:e A5:e',
  //  Em                          | C                       | Am      D                 | G
  'B5:q. G5:e E5:q G5:e B5:e | C6:q B5:e A5:e G5:q E5:q',
];
const TOWN_COUNTER_A = [
  'G4:h. B4:q | E5:h. C5:q | D5:h. B4:q | r:e D5 E5 F#5 E5:q D5:q',
  'G4:h B4:h | C5:h G4:h',
];
const TOWN_BASS_A = [
  'G2:q A2 B2 D3 | C3:q E3 D3 C3 | G2:q B2 D3 C#3 | D3:q C3:e B2:e A2:q F#2:q',
  'E2:q G2 B2 G2 | C3:q G2 E2 G2',
];
const TOWN_GROOVE = 'bd:e sh sh bd sn sh sh sh';
const TOWN_FILL = 'bd:e sh sn sh sn:s sn sn:e sh sn';
const TOWN_HALF = 'bd:q sh sn sh';
const TOWN_HALF_FILL = 'bd:q sh sn:e sn sh:s sh sh sh';

const TOWN = {
  id: 'town',
  bpm: 104,
  meter: 4,
  voices: {
    lead: { inst: 'pulse25', vol: 0.4, gate: 0.9, pan: -0.1, vibrato: { rate: 5.2, depth: 12, delay: 0.18 } },
    counter: { inst: 'pulse50', vol: 0.15, gate: 0.88, pan: 0.25, env: { a: 0.012, d: 0.25, s: 0.5, r: 0.1 } },
    bass: { inst: 'triangle', vol: 0.78, gate: 0.78 },
    drums: { inst: 'drums', vol: 0.42 },
  },
  body: {
    lead: [
      // A
      ...TOWN_LEAD_A,
      'C5:e E5 A5:q F#5:e A5 D6:q | B5:h G5:e A5:e B5:e D6:e',
      // B — C | D | Bm | Em | C | D | Bm Em | Am D
      'E6:q. D6:e C6:q G5:q | A5:q. F#5:e D5:h | F#5:e A5 B5:q D6:q B5:q | G5:q. F#5:e E5:h',
      'E5:e G5 C6:q. B5:e A5:q | F#5:q A5:q D6:h | D6:q B5:e F#5:e G5:q B5:e E6:e | C6:q. A5:e F#5:e E5:e D5:q',
      // A'
      ...TOWN_LEAD_A,
      'C6:e B5 A5:q D6:e C6 A5:q | G5:h B5:e A5:e G5:e F#5:e',
      // C — Em | C | G | D | Em | C | Am | D
      'E5:q. G5:e B5:h | C6:q. B5:e G5:q E5:q | D5:q. G5:e B5:q A5:q | A5:h. F#5:q',
      'G5:q. B5:e E6:h | E6:e D6 C6:q G5:h | A5:q. C6:e E6:q D6:e C6:e | A5:h F#5:q D5:e A4:e',
    ],
    counter: [
      ...TOWN_COUNTER_A,
      'A4:q C5:q D5:q C5:q | r:e G5 E5 D5 B4:q r:q',
      'C5:e E5 G5 E5 C5 E5 G5 E5 | D5:e F#5 A5 F#5 D5 F#5 A5 F#5 | B4:e D5 F#5 D5 B4 D5 F#5 D5 | G4:e B4 E5 B4 G4 B4 D5 B4',
      'C5:e E5 G5 E5 C5 E5 G5 E5 | D5:e F#5 A5 F#5 D5 F#5 A5 F#5 | B4:e D5 F#5 D5 E5 B4 E5 G5 | A4:e C5 E5 C5 D5 C5 A4 F#4',
      ...TOWN_COUNTER_A,
      'A4:q C5:q D5:q C5:q | r:e D5 B4 D5 E5:q D5:q',
      'G4:q B4:q E5:h | E5:h C5:h | B4:h D5:q C5:q | D5:h. A4:q',
      'E5:h G5:h | G5:h E5:h | C5:q E5:q A5:h | F#5:h D5:q r:q',
    ],
    bass: [
      ...TOWN_BASS_A,
      'A2:q E2 D2 F#2 | G2:q G2:e A2:e B2:q D3:q',
      'C3:q E3 G3 E3 | D3:q A2 F#2 A2 | B2:q F#2 D2 F#2 | E2:q G2 B2 D3',
      'C3:q E3 G2 C3 | D3:q A2 F#2 A2 | B2:q F#2 E2 G2 | A2:q E2 D2 F#2',
      ...TOWN_BASS_A,
      'A2:q E2 D2 F#2 | G2:q D3 B2 G2',
      'E2:q. B2:e E3:q B2:q | C3:q. G2:e E2:q G2:q | G2:q. D3:e G3:q D3:q | D3:q. A2:e F#2:q A2:q',
      'E2:q. B2:e E3:q B2:q | C3:q. G2:e E2:q G2:q | A2:q. E2:e A2:q C3:q | D3:q. A2:e F#2:q A2:q',
    ],
    drums: [
      `${bars(TOWN_GROOVE, 7)} | ${TOWN_FILL}`,
      `${bars(TOWN_GROOVE, 7)} | ${TOWN_FILL}`,
      `${bars(TOWN_GROOVE, 7)} | ${TOWN_FILL}`,
      `${bars(TOWN_HALF, 7)} | ${TOWN_HALF_FILL}`,
    ],
  },
};

// ---------------------------------------------------------------------------
// town-night — "Lanterns on the Creek" (G major, 72 bpm). Same harmonic world as
// the day theme, as a lullaby: thin 12.5% lead with echo, music-box triangle,
// soft bass and the odd cricket.
// ---------------------------------------------------------------------------

const NIGHT = {
  id: 'town-night',
  bpm: 72,
  meter: 4,
  echo: { beats: 0.75, feedback: 0.32, mix: 0.42, cutoff: 2200 },
  voices: {
    lead: {
      inst: 'pulse12',
      vol: 0.26,
      gate: 0.94,
      pan: -0.08,
      echo: 0.5,
      vibrato: { rate: 4.6, depth: 10, delay: 0.3 },
      env: { a: 0.03, d: 0.5, s: 0.55, r: 0.35 },
    },
    harp: {
      inst: 'triangle',
      vol: 0.42,
      gate: 0.95,
      pan: 0.2,
      echo: 0.25,
      env: { a: 0.006, d: 0.5, s: 0.25, r: 0.4 },
    },
    bass: { inst: 'triangle', vol: 0.6, gate: 0.9, env: { a: 0.02, d: 1.2, s: 0.4, r: 0.4 } },
    drums: { inst: 'drums', vol: 0.3 },
  },
  body: {
    lead: [
      //  G                  | C                    | G              | D
      'B4:q D5:q G5:h | G5:q. E5:e C5:h | D5:h. B4:q | A4:w',
      //  Em                         | C                    | Am      D                | G
      'B4:q E5:q G5:q. F#5:e | E5:q. D5:e C5:h | C5:q E5:q D5:q. C5:e | B4:w',
      //  C                  | D                    | Bm                | Em
      'E5:q G5:q C6:h | B5:q. A5:e F#5:h | D5:q F#5:q B5:h | A5:q. G5:e E5:h',
      //  C                          | D                    | Am      D                  | G
      'G5:q. E5:e C5:q E5:q | D5:h. E5:e F#5:e | G5:q. E5:e F#5:q. D5:e | G5:h. r:q',
    ],
    harp: [
      'G3:e B3 D4 G4 D4 B3 r:q | G3:e C4 E4 G4 E4 C4 r:q | G3:e B3 D4 G4 D4 B3 r:q | F#3:e A3 D4 F#4 D4 A3 r:q',
      'G3:e B3 E4 G4 E4 B3 r:q | G3:e C4 E4 G4 E4 C4 r:q | A3:e C4 E4 r:e F#3:e A3 D4 r:e | G3:e B3 D4 G4 D4 B3 r:q',
      'G3:e C4 E4 G4 E4 C4 r:q | F#3:e A3 D4 F#4 D4 A3 r:q | F#3:e B3 D4 F#4 D4 B3 r:q | G3:e B3 E4 G4 E4 B3 r:q',
      'G3:e C4 E4 G4 E4 C4 r:q | F#3:e A3 D4 F#4 D4 A3 r:q | A3:e C4 E4 r:e F#3:e A3 D4 r:e | G3:e B3 D4 G4 D4 B3 r:q',
    ],
    bass: [
      'G2:w | C3:w | G2:h B2:h | D3:h D2:h',
      'E2:w | C3:w | A2:h D2:h | G2:h D2:h',
      'C3:w | D3:w | B2:w | E2:w',
      'C3:w | D3:h F#2:h | A2:h D2:h | G2:w',
    ],
    drums: [
      'r:h. ck:q | r:w | r:h ck:q r:q | r:w',
      'r:h. ck:q@0.8 | r:w | r:w | r:h r:e ck:e@0.7 r:q',
      'r:h. ck:q | r:w | r:h ck:q r:q | r:w',
      'r:h. ck:q@0.8 | r:w | r:h r:e ck:e@0.7 r:q | r:w',
    ],
  },
};

// ---------------------------------------------------------------------------
// home — "Kettle On" (F major, 3/4, 94 bpm). A warm little waltz:
// bass on one, "pah-pah" on two and three, a singing square-wave lead.
// 24 bars: A (16) · B (8).
// ---------------------------------------------------------------------------

const HOME = {
  id: 'home',
  bpm: 94,
  meter: 3,
  echo: { beats: 0.5, feedback: 0.18, mix: 0.22, cutoff: 2600 },
  voices: {
    lead: {
      inst: 'pulse50',
      vol: 0.27,
      gate: 0.92,
      pan: -0.08,
      echo: 0.3,
      vibrato: { rate: 5, depth: 13, delay: 0.22 },
      env: { a: 0.014, d: 0.3, s: 0.6, r: 0.12 },
    },
    counter: { inst: 'pulse25', vol: 0.13, gate: 0.55, pan: 0.25, env: { a: 0.006, d: 0.12, s: 0.4, r: 0.06 } },
    bass: { inst: 'triangle', vol: 0.72, gate: 0.85 },
    drums: { inst: 'drums', vol: 0.26 },
  },
  body: {
    lead: [
      //  F                 | C/E          | Dm              | Bb
      'C5:q F5:q A5:q | G5:h E5:q | F5:q. E5:e D5:q | D5:h.',
      //  F                 | Gm           | C               | C7
      'C5:q A5:q C6:q | Bb5:h G5:q | E5:q. F5:e G5:q | G5:h.',
      //  F                 | F7           | Bb              | Bbm
      'A5:q. G5:e F5:q | Eb5:h C5:q | D5:q F5:q Bb5:q | Db6:h.',
      //  F                 | Dm           | Gm  C           | F
      'C6:q. A5:e F5:q | D5:q F5:q A5:q | G5:h E5:q | F5:h.',
      //  Bb                | F/A          | Gm              | C
      'F5:h D5:q | A4:q C5:q F5:q | Bb5:h G5:q | E5:h.',
      //  Bb                | F/A          | Gm              | C7
      'D5:q F5:q Bb5:q | A5:h C6:q | Bb5:q. A5:e G5:q | G5:q. F5:e E5:q',
    ],
    counter: [
      'r:q A4 C5 | r:q G4 C5 | r:q F4 A4 | r:q D4 F4',
      'r:q A4 C5 | r:q G4 Bb4 | r:q E4 G4 | r:q E4 Bb4',
      'r:q A4 C5 | r:q A4 Eb5 | r:q F4 D5 | r:q F4 Db5',
      'r:q A4 C5 | r:q F4 A4 | r:q G4 E4 | r:q A4 C5',
      'r:q D4 F4 | r:q C4 F4 | r:q G4 Bb4 | r:q E4 G4',
      'r:q D4 F4 | r:q F4 C5 | r:q G4 Bb4 | r:q E4 Bb4',
    ],
    bass: [
      'F2:q r:h | E2:q r:h | D2:q r:h | Bb2:q r:h',
      'F2:q r:q C3:q | G2:q r:q D3:q | C3:q r:q G2:q | C3:q Bb2:q G2:q',
      'F2:q r:q C3:q | F2:q A2:q Eb3:q | D3:q r:q Bb2:q | Db3:q r:q Bb2:q',
      'C3:q r:q A2:q | D3:q r:q A2:q | G2:q Bb2:q C3:q | F2:q r:q C3:q',
      'Bb2:q r:q F2:q | A2:q r:q C3:q | G2:q r:q D3:q | C3:q r:q G2:q',
      'Bb2:q r:q D3:q | A2:q r:q F2:q | G2:q r:q Bb2:q | C3:q Bb2:q G2:q',
    ],
    drums: [
      bars('r:q sh@0.7 sh@0.55', 4),
      bars('r:q sh@0.7 sh@0.55', 4),
      bars('r:q sh@0.7 sh@0.55', 4),
      'r:q sh@0.7 sh@0.55 | r:q sh@0.7 sh@0.55 | r:q sh@0.7 sh@0.55 | r:q. sh:e@0.5 sh:q@0.6',
      bars('r:q sh@0.7 sh@0.55', 4),
      'r:q sh@0.7 sh@0.55 | r:q sh@0.7 sh@0.55 | r:q sh@0.7 sh@0.55 | r:q. sh:e@0.5 sh:q@0.6',
    ],
  },
};

// ---------------------------------------------------------------------------
// lab — "Tinker & Sprout" (C major, 116 bpm, shuffled). Curious and bouncy:
// staccato square lead with syncopated pushes, off-beat stabs, hopping bass.
// 24 bars: A (8) · B (8) · A' (8).
// ---------------------------------------------------------------------------

const LAB_LEAD_A = [
  //  C                                   | C                                  | F                                     | D7
  'E5:e G5 r:e C6:e ~:e G5:e E5:q | D#5:e E5 r:e G5:e ~:q r:e B4:e | C5:e F5 r:e A5:e ~:e F5:e C6:q | A5:e B5 A5 F#5 C6:q r:q',
  //  C                                   | Am
  'E5:e G5 r:e C6:e ~:e G5:e E5:q | A5:e G5 r:e E5:e ~:e C5:e A4:q',
];
const LAB_COUNTER_A = [
  'r:e E4 r:e G4 r:e E4 r:e G4 | r:e E4 r:e G4 r:e E4 r:e G4 | r:e F4 r:e A4 r:e F4 r:e A4 | r:e F#4 r:e C5 r:e F#4 r:e C5',
  'r:e E4 r:e G4 r:e E4 r:e G4 | r:e E4 r:e A4 r:e E4 r:e A4',
];
const LAB_BASS_A = [
  'C3:q. G2:e r:e C3:e G2:q | C3:q. G2:e r:e C3:e E3:q | F2:q. C3:e r:e F2:e C3:q | D3:q. A2:e r:e D3:e F#2:q',
  'C3:q. G2:e r:e C3:e G2:q | A2:q. E2:e r:e A2:e E2:q',
];
const LAB_GROOVE = 'bd:e r hh bd sn r hh hh';
const LAB_FILL = 'bd:e r hh bd sn:s sn sn:e sn oh';

const LAB = {
  id: 'lab',
  bpm: 116,
  meter: 4,
  swing: 0.5,
  voices: {
    lead: { inst: 'pulse50', vol: 0.3, gate: 0.62, pan: -0.1, env: { a: 0.004, d: 0.1, s: 0.5, r: 0.05 } },
    counter: { inst: 'pulse12', vol: 0.16, gate: 0.42, pan: 0.3, env: { a: 0.003, d: 0.06, s: 0.4, r: 0.03 } },
    bass: { inst: 'triangle', vol: 0.8, gate: 0.6 },
    drums: { inst: 'drums', vol: 0.42 },
  },
  body: {
    lead: [
      ...LAB_LEAD_A,
      //  D7                                  | G
      'F#5:e A5 r:e D6:e ~:e C6:e A5:q | G5:s A5 G5 F#5 G5:e r:e D5:e r:e G4:q',
      //  Fmaj7                 | Em7                  | Dm7                  | G7
      'A5:q. E5:e ~:q C5:q | G5:q. D5:e ~:q B4:q | F5:q. C5:e ~:q A4:q | B4:e C5 D5 F5 ~:e E5:e D5:q',
      //  Fmaj7                 | E7                   | Am                              | D7        G7
      'A5:q. E5:e ~:q C6:q | B5:q. G#5:e ~:q E5:q | C6:e B5 A5 E5 ~:e C5:e A4:q | F#5:e A5 C6 r:e B5:e G5 F5 D5',
      ...LAB_LEAD_A,
      //  Dm      G7                          | C
      'F5:e A5 r:e D6:e ~:e B5:e G5:q | C6:e r:e G5:e r:e C5:q r:q',
    ],
    counter: [
      ...LAB_COUNTER_A,
      'r:e F#4 r:e C5 r:e F#4 r:e C5 | r:e F4 r:e B4 r:e F4 r:e B4',
      'r:e E4 r:e A4 r:e E4 r:e A4 | r:e D4 r:e G4 r:e D4 r:e G4 | r:e C4 r:e F4 r:e C4 r:e F4 | r:e F4 r:e B4 r:e F4 r:e B4',
      'r:e E4 r:e A4 r:e E4 r:e A4 | r:e D4 r:e G#4 r:e D4 r:e G#4 | r:e E4 r:e A4 r:e E4 r:e A4 | r:e F#4 r:e C5 r:e F4 r:e B4',
      ...LAB_COUNTER_A,
      'r:e F4 r:e A4 r:e F4 r:e B4 | r:e E4 r:e G4 r:e E4 r:q',
    ],
    bass: [
      ...LAB_BASS_A,
      'D3:q. A2:e r:e D3:e F#2:q | G2:q. D3:e r:e G2:e B2:q',
      'F2:q. C3:e r:e F2:e A2:q | E2:q. B2:e r:e E2:e G2:q | D3:q. A2:e r:e D3:e F2:q | G2:q. D3:e r:e G2:e F2:q',
      'F2:q. C3:e r:e F2:e A2:q | E2:q. B2:e r:e E2:e G#2:q | A2:q. E2:e r:e A2:e C3:q | D3:q. A2:e G2:q. D3:e',
      ...LAB_BASS_A,
      'D3:q. A2:e G2:q. B2:e | C3:q. G2:e r:e C3:e r:q',
    ],
    drums: [
      `${bars(LAB_GROOVE, 7)} | ${LAB_FILL}`,
      `${bars(LAB_GROOVE, 7)} | ${LAB_FILL}`,
      `${bars(LAB_GROOVE, 7)} | ${LAB_FILL}`,
    ],
  },
};

// ---------------------------------------------------------------------------
// Jingles (one-shot, routed through the sfx bus).
// fanfare — "A New Friend!" (~2 s): quick climb, a held C, then a bright landing on E.
// ---------------------------------------------------------------------------

const FANFARE = {
  id: 'fanfare',
  bpm: 168,
  meter: 4,
  loop: false,
  voices: {
    lead: { inst: 'pulse25', vol: 0.5, gate: 0.95, vibrato: { rate: 6, depth: 18, delay: 0.12 } },
    counter: { inst: 'pulse12', vol: 0.28, gate: 0.9, pan: 0.2 },
    bass: { inst: 'triangle', vol: 0.85, gate: 0.85 },
    drums: { inst: 'drums', vol: 0.55 },
  },
  body: {
    //        C               F       G       | C
    lead: ['E5:s F5 G5:e C6:q A5:e B5 C6 D6 | E6:h r:h'],
    counter: ['C5:s D5 E5:e G5:q F5:e F5 G5 B5 | G5:h r:h'],
    bass: ['C3:q. r:e F2:q G2:q | C3:h r:h'],
    drums: ['bd:q. sn:s sn bd:e r:e sn:e sn:e | cr:h r:h'],
  },
};

/** Looping background music, keyed by music id (map `music` / `musicNight`). */
export const SONGS = Object.freeze({
  title: TITLE,
  town: TOWN,
  'town-night': NIGHT,
  home: HOME,
  lab: LAB,
});

/** One-shot jingles played through the sfx bus. */
export const JINGLES = Object.freeze({
  fanfare: FANFARE,
});

/** Every music id the game may request. */
export const MUSIC_IDS = Object.freeze(Object.keys(SONGS));
