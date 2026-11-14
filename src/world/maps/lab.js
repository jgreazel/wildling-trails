/**
 * Greenhouse Lab — Dr. Ilse Marrow's research greenhouse, where the three
 * hatchlings wait on pedestals and you choose your partner.
 *
 * Story flags set here:
 *   met_marrow           first-visit greeting done (all three starters marked seen)
 *   chose_<id>           you partnered with <id>         (also has_partner)
 *   wren_took_<id>       Wren partnered with <id>        (WREN_PICK[yours])
 *   has_journal          Dr. Marrow gave you the Field Journal
 *   wren_left_lab        Wren ran outside (she then appears in the plaza)
 *
 * The post-choice sequence is resumable: if the page closes mid-scene (the
 * partner is saved the moment it joins you), entering the lab finishes it.
 *
 * Format: docs/ARCHITECTURE.md → "Map format". Validated by tools/validate-maps.mjs.
 */
import { WILDLINGS, STARTERS } from '../../data/wildlings.js';

const WHO = Object.freeze({ marrow: 'Dr. Marrow', corin: 'Corin', wren: 'Wren' });

/** Which hatchling Wren picks once you have chosen yours. */
export const WREN_PICK = Object.freeze({
  emberkit: 'brookling',
  brookling: 'mossbun',
  mossbun: 'emberkit',
});

/** Pedestal row and columns (STARTERS order, west → east). */
const PEDESTAL_Y = 3;
const PEDESTAL_X = Object.freeze({ emberkit: 4, brookling: 6, mossbun: 8 });
/** Clear row Wren uses to cross the room, and the exit mat. */
const AISLE_Y = 6;
const EXIT = Object.freeze({ x: 6, y: 10 });
/** Wren's standing spot before the choice. */
const WREN_HOME = Object.freeze({ x: 9, y: 4 });

/** What Wren says about her new partner. */
const WREN_CHEERS = Object.freeze({
  emberkit: 'Emberkit! Look, its tail glows! I will never need a nightlight again.',
  brookling: "Brookling! We're going to be the splashiest duo in Fernhollow!",
  mossbun: "Mossbun! Look at its little sprout! We'll be SO good at naps.",
});

/* ------------------------------------------------------------------ helpers */

/**
 * Axis-aligned walk through waypoints.
 * @param {{x:number, y:number}} start
 * @param {{x:number, y:number}[]} waypoints each must share an axis with the previous point
 * @returns {{dirs: string[], tiles: {x:number, y:number}[]}}
 */
function route(start, waypoints) {
  const pos = { x: start.x, y: start.y };
  const dirs = [];
  const tiles = [];
  for (const wp of waypoints) {
    while (pos.x !== wp.x || pos.y !== wp.y) {
      let dir;
      if (pos.x !== wp.x) dir = wp.x > pos.x ? 'right' : 'left';
      else dir = wp.y > pos.y ? 'down' : 'up';
      pos.x += dir === 'right' ? 1 : dir === 'left' ? -1 : 0;
      pos.y += dir === 'down' ? 1 : dir === 'up' ? -1 : 0;
      dirs.push(dir);
      tiles.push({ x: pos.x, y: pos.y });
    }
  }
  return { dirs, tiles };
}

/** @param {any} handle @param {{x:number,y:number}} fallback */
function positionOf(handle, fallback) {
  return Number.isInteger(handle?.x) && Number.isInteger(handle?.y) ? { x: handle.x, y: handle.y } : { ...fallback };
}

/** @param {{x:number,y:number}[]} tiles @param {any} player */
function crosses(tiles, player) {
  return tiles.some((t) => t.x === player?.x && t.y === player?.y);
}

/**
 * Split a blurb into sentence-sized dialogue pages.
 * @param {string} text
 */
function sentences(text) {
  return String(text ?? '')
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
}

/** @param {any} api @returns {string|null} */
function chosenSpecies(api) {
  return api.partner()?.species ?? STARTERS.find((id) => api.flag(`chose_${id}`)) ?? null;
}

/**
 * Everything after you pick: Wren takes her hatchling, Dr. Marrow hands over the
 * Field Journal, Wren races outside. Each step is skipped if already done.
 * @param {any} api
 */
async function finishChoice(api) {
  const mine = chosenSpecies(api);
  const theirs = WREN_PICK[mine] ?? STARTERS.find((id) => id !== mine);
  const wren = api.npc('wren');

  if (theirs && !STARTERS.some((id) => api.flag(`wren_took_${id}`))) {
    await wren?.emote('!');
    await api.say(['My turn, my turn! Oh, I already know exactly who I want.'], { speaker: WHO.wren });
    const start = positionOf(wren, WREN_HOME);
    const tx = PEDESTAL_X[theirs];
    const toPedestal = route(start, [
      { x: start.x, y: AISLE_Y },
      { x: tx, y: AISLE_Y },
      { x: tx, y: PEDESTAL_Y + 1 },
    ]);
    if (!crosses(toPedestal.tiles, api.player)) await wren?.walk(toPedestal.dirs);
    wren?.face('up');
    api.cry(theirs);
    api.setFlag(`wren_took_${theirs}`);
    await wren?.emote('♥');
    wren?.facePlayer();
    await api.say(
      [WREN_CHEERS[theirs] ?? 'We are going to be the best team ever!', "Friendly rivals from here on, neighbour. Don't you dare go easy!"],
      { speaker: WHO.wren },
    );
  }

  if (!api.flag('has_journal')) {
    await api.say(
      [
        'Splendid! Two hatchlings, two partners. My heart may actually burst.',
        'Now, every good partnership deserves good notes. Here you are.',
      ],
      { speaker: WHO.marrow },
    );
    api.setFlag('has_journal');
    api.sfx('fanfare');
    await api.say(['You received the Field Journal!']);
    await api.say(
      [
        'Wildlings you meet are recorded in it. Open it from the menu.',
        'Mistfern Path, north of town, is full of wild wildlings to observe.',
        "Watch closely, be gentle and bring snacks. That's science.",
      ],
      { speaker: WHO.marrow },
    );
  }

  if (!api.flag('wren_left_lab')) {
    await api.say(['Race you to the plaza! Last one there is a soggy dewsnail!'], { speaker: WHO.wren });
    const start = positionOf(wren, WREN_HOME);
    const toDoor = route(start, [
      { x: start.x, y: AISLE_Y },
      { x: EXIT.x, y: AISLE_Y },
      { x: EXIT.x, y: EXIT.y },
    ]);
    if (!crosses(toDoor.tiles, api.player)) await wren?.walk(toDoor.dirs);
    api.sfx('door');
    wren?.hide();
    api.setFlag('wren_left_lab');
  }
}

/**
 * Talking to one of the three pedestals.
 * @param {string} id species on the pedestal
 */
function pedestalScript(id) {
  return async (api) => {
    const data = WILDLINGS[id];
    if (!data) return;
    if (api.flag(`chose_${id}`)) {
      await api.say(['Just a nest of warm straw. Your partner left a little dent in it.']);
      return;
    }
    if (api.flag(`wren_took_${id}`)) {
      await api.say([`Wren's ${data.name} napped here. A note reads: 'RESERVED. —W.'`]);
      return;
    }
    if (api.hasPartner()) {
      api.cry(id);
      await api.say([`The ${data.name} is curled up, fast asleep.`, 'Dr. Marrow will find it a perfect partner soon.']);
      return;
    }
    api.cry(id);
    await api.say([`It's ${data.name}, the ${data.element} wildling!`, ...sentences(data.blurb)]);
    const yes = await api.confirm(`Partner with ${data.name}?`);
    if (!yes) {
      await api.say([`The ${data.name} tilts its head. Take all the time you need.`]);
      return;
    }
    api.setFlag(`chose_${id}`);
    api.setFlag('has_partner');
    api.givePartner(id);
    await api.say([`${data.name} bounds into your arms and nuzzles your chin!`, `You and ${data.name} are partners now!`]);
    await api.follower?.emote('♥');
    await finishChoice(api);
  };
}

/* ------------------------------------------------------------------ scripts */

const scripts = {
  /** onEnter: first-visit greeting, or resume an interrupted choice scene. */
  async lab_enter(api) {
    if (api.flag('has_partner') && !api.flag('wren_left_lab')) {
      await finishChoice(api);
      return;
    }
    if (api.flag('met_marrow')) return;
    for (const id of STARTERS) api.markSeen(id);
    await api.wait(350);
    await api.npc('marrow')?.emote('!');
    await api.say(
      [
        'Ah, there you are! Come in, come in. Mind the seedlings, they nibble.',
        "I'm Ilse Marrow. I study wildlings, and very occasionally I sleep.",
        'Last night, all three eggs in my incubator hatched at once!',
      ],
      { speaker: WHO.marrow },
    );
    await api.npc('wren')?.emote('♪');
    await api.say(["Morning, snail-pace! I've been here since the first pipwing sang."], { speaker: WHO.wren });
    await api.say(
      [
        "Wildlings bond best when they're young, and these three need partners.",
        'Wren has very kindly agreed to let you choose first.',
      ],
      { speaker: WHO.marrow },
    );
    await api.say(['I lost at rock-pebble-twig. Twice. Best of five next time!'], { speaker: WHO.wren });
    await api.say(['Meet each hatchling on its pedestal, then choose your partner.'], { speaker: WHO.marrow });
    api.setFlag('met_marrow');
  },

  async marrow(api) {
    if (!api.hasPartner()) {
      await api.say(
        ['Take your time. Each of them is wonderful in its own way.', 'Talk to a pedestal to meet a hatchling up close.'],
        { speaker: WHO.marrow },
      );
      return;
    }
    await api.say(
      [
        `How is ${api.partner()?.name ?? 'your partner'} settling in? They learn by watching you.`,
        'Mistfern Path is north of town. Fill that Field Journal for me!',
      ],
      { speaker: WHO.marrow },
    );
  },

  async corin(api) {
    if (!api.hasPartner()) {
      await api.say(
        [
          "Hi! I'm Corin. I water the seedlings and get sneezed on by hatchlings.",
          'The Mossbun sneezed pollen on me twice. I think that means it likes me.',
        ],
        { speaker: WHO.corin },
      );
      return;
    }
    const lines = {
      emberkit: 'Your Emberkit warmed my tea from across the room. Very helpful!',
      brookling: 'Your Brookling keeps humming at the sprinkler. I think they are friends.',
      mossbun: 'Your Mossbun napped on a seed tray. Now the tray is sprouting.',
    };
    await api.say(
      [lines[chosenSpecies(api) ?? ''] ?? 'Your partner seems very happy!', 'Dr. Marrow writes everything down. Even lunch. It was soup.'],
      { speaker: WHO.corin },
    );
  },

  async wren_lab(api) {
    await api.say(
      ['Go on, pick one! But not too fast. Okay, kind of fast.', "I've already got a favourite. Not telling. Okay, not telling YET."],
      { speaker: WHO.wren },
    );
  },

  async incubator(api) {
    if (!api.hasPartner()) {
      await api.say(['The incubator hums softly. Three cracked eggshells rest in warm straw.']);
      return;
    }
    await api.say(["The incubator is switched off. A note on it says: 'Well done, everyone.'"]);
  },

  pedestal_emberkit: pedestalScript('emberkit'),
  pedestal_brookling: pedestalScript('brookling'),
  pedestal_mossbun: pedestalScript('mossbun'),
};

/* ---------------------------------------------------------------------- map */

/** One pedestal per starter, in STARTERS order (west → east). */
const pedestals = STARTERS.map((id) => ({
  type: 'pedestal',
  id: `pedestal-${id}`,
  x: PEDESTAL_X[id],
  y: PEDESTAL_Y,
  species: id,
  emptyIf: [`chose_${id}`, `wren_took_${id}`],
  script: `pedestal_${id}`,
}));

/** Map definition (format: docs/ARCHITECTURE.md → "Map format"). */
export default {
  id: 'lab',
  name: 'Greenhouse Lab',
  kind: 'indoor',
  music: 'lab',
  // 14 × 11, lab tile floor, exit mat at (6,10).
  tiles: [
    'WWWWWWWWWWWWWW',
    'WttttttttttttW',
    'WttttttttttttW',
    'WttttttttttttW',
    'WttttttttttttW',
    'WttttttttttttW',
    'WttttttttttttW',
    'WttttttttttttW',
    'WttttttttttttW',
    'WttttttttttttW',
    'WWWWWWEWWWWWWW',
  ],
  spawn: { x: 6, y: 9, facing: 'up' },
  onEnter: 'lab_enter',
  objects: [
    // back wall: library, incubator, instruments
    {
      type: 'bookshelf', id: 'shelf-west', x: 1, y: 1,
      text: ["Books on wildling care, botany and one called 'Soup: A Love Story'."],
    },
    { type: 'bookshelf', id: 'shelf-east', x: 3, y: 1, text: ['Field notes stacked in towers. Several towers are leaning.'] },
    { type: 'plant', id: 'plant-flytrap', x: 5, y: 1, text: ["A toothy-looking plant. A sticky note says: 'VEGETARIAN. HONEST.'"] },
    // (6,1) sits behind Dr. Marrow, so it is decorative only.
    { type: 'plant', id: 'plant-fern', x: 6, y: 1 },
    { type: 'machine', id: 'incubator', x: 7, y: 1, color: '#e2b64a', script: 'incubator' },
    { type: 'terminal', id: 'terminal-notes', x: 8, y: 1, text: ["Notes on screen: 'Hatchling #3 sneezes pollen. Keep tissues near.'"] },
    { type: 'machine', id: 'seed-sorter', x: 9, y: 1, text: ['A seed sorter. It rattles, beeps, then sorts exactly one seed.'] },
    { type: 'machine', id: 'mister', x: 10, y: 1, text: ["A humidity gauge. The needle points to 'pleasantly misty'."] },
    {
      type: 'terminal', id: 'terminal-mail', x: 11, y: 1,
      text: ["An email draft: 'Dear Village Council, regarding the snail parade...'"],
    },
    { type: 'plant', id: 'plant-hatted', x: 12, y: 1, text: ['A fern so lush it has its own weather. It is wearing a tiny knitted hat.'] },
    // the three hatchlings
    ...pedestals,
    // seedling planters along the east wall
    { type: 'planter', id: 'planter-1', x: 11, y: 3, text: ['Seedlings in neat rows, each with a tiny name tag.'] },
    { type: 'planter', id: 'planter-2', x: 11, y: 5, text: ["These sprouts are labelled: 'PLEASE DO NOT SIT ON. —Management.'"] },
    { type: 'planter', id: 'planter-3', x: 11, y: 7, text: ['Tomato vines. One tomato has a small bite out of it. Suspicious.'] },
    // work area along the west wall
    { type: 'desk', id: 'desk-marrow', x: 1, y: 4, text: ["Dr. Marrow's desk: notes, teacups and a pencil worn to a nub."] },
    { type: 'stool', id: 'stool-marrow', x: 3, y: 4 },
    { type: 'desk', id: 'desk-corin', x: 1, y: 6, text: ["Corin's desk. A tidy row of pencils, sorted by height."] },
    { type: 'sink', id: 'sink', x: 1, y: 8, text: ['A deep sink full of muddy trowels.'] },
    { type: 'plant', id: 'plant-sw', x: 1, y: 9, text: ['A potted sapling with a label: "Future Shade (est. 2 years)".'] },
    { type: 'crate', id: 'crate-seeds', x: 12, y: 9, text: ['A crate of seed packets, sorted alphabetically. Then by mood.'] },
    // green runner from the door to the pedestals
    { type: 'rug', id: 'runner', x: 5, y: 6, w: 3, h: 3, color: '#5e9a4f' },
  ],
  npcs: [
    {
      id: 'marrow', name: WHO.marrow, x: 6, y: 2, facing: 'down', behavior: 'stand',
      look: {
        skin: '#d9a27a',
        hair: '#c8643b',
        hairStyle: 'bob',
        shirt: '#6b8f4e',
        pants: '#4a3b2f',
        shoes: '#3a2f28',
        outfit: 'labcoat',
        outfitColor: '#f4f1ea',
        build: 'adult',
        accessory: 'glasses',
        accessoryColor: '#3a2f28',
      },
      script: 'marrow',
    },
    {
      id: 'corin', name: WHO.corin, x: 10, y: 5, facing: 'right', behavior: 'turn',
      look: {
        skin: '#8d5a3c',
        hair: '#2b1d14',
        hairStyle: 'spiky',
        shirt: '#e8d9b0',
        pants: '#3d4a5c',
        shoes: '#efe6d2',
        outfit: 'jacket',
        outfitColor: '#4f6d8f',
        build: 'adult',
        accessory: 'scarf',
        accessoryColor: '#d9a441',
      },
      script: 'corin',
    },
    {
      id: 'wren', name: WHO.wren, x: WREN_HOME.x, y: WREN_HOME.y, facing: 'left', behavior: 'stand',
      look: {
        skin: '#f2c9a5',
        hair: '#d97a3a',
        hairStyle: 'ponytail',
        shirt: '#f2e6cf',
        pants: '#4f6d8f',
        shoes: '#c8643b',
        outfit: 'overalls',
        outfitColor: '#7d5a7a',
        build: 'kid',
        accessory: 'scarf',
        accessoryColor: '#e2b64a',
      },
      script: 'wren_lab',
      hideIf: 'wren_left_lab',
    },
  ],
  warps: [{ x: 6, y: 10, to: 'fernhollow', tx: 26, ty: 8, facing: 'down' }],
  triggers: [],
  scripts,
};
