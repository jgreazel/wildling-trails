/**
 * Wren's House — home of your neighbour Wren and her grandmother, Nana Bee,
 * a retired beekeeper with honey in every cupboard.
 *
 * Wren herself is never home in the demo: before the partner choice she is
 * already waiting at the greenhouse lab, and afterwards she is out in the plaza
 * (flag `wren_left_lab`). Nana Bee's lines follow those same flags.
 *
 * Format: docs/ARCHITECTURE.md → "Map format". Validated by tools/validate-maps.mjs.
 */
import { WILDLINGS, STARTERS } from '../../data/wildlings.js';

const NANA = 'Nana Bee';

/** @param {any} api @returns {string|null} the species Wren partnered with */
function wrenSpecies(api) {
  return STARTERS.find((id) => api.flag(`wren_took_${id}`)) ?? null;
}

/* ------------------------------------------------------------------ scripts */

const scripts = {
  async nana(api) {
    if (!api.hasPartner()) {
      await api.say(
        [
          'Oh, hello, dear! Come in, come in. Mind the knitting basket.',
          'Wren? She shot off to the greenhouse at sunrise, toast in her mouth.',
          'She left one sock behind. I suspect the other is on her hand.',
        ],
        { speaker: NANA },
      );
      return;
    }
    const theirs = WILDLINGS[wrenSpecies(api) ?? '']?.name;
    const partner = api.partner();
    await api.say(
      [
        theirs
          ? `Wren stomped through with a little ${theirs}! Then off she ran again.`
          : 'Wren stomped through earlier, grinning ear to ear. Then off she ran.',
        "I've never seen her so proud. She forgot to wipe her boots, mind.",
        `And who's this? A ${partner?.name ?? 'wildling'}! I could knit it a tiny scarf.`,
      ],
      { speaker: NANA },
    );
    const pick = await api.choose('Have a spoonful of honey?', ['Yes, please', 'No, thank you']);
    if (pick === 0) {
      api.sfx('confirm');
      await api.say(['There you are. Clover honey, from my old hives by the creek.'], { speaker: NANA });
      await api.follower?.emote('♥');
      await api.say(['Your partner looks very sticky and very happy.']);
    } else {
      await api.say(["More for me, then. Don't tell Wren."], { speaker: NANA });
    }
  },

  /** Wren's bed changes once she has a partner to share it with. */
  async wren_bed(api) {
    if (!wrenSpecies(api)) {
      await api.say(["Wren's bed. The blanket has been tied into a cape."]);
      return;
    }
    await api.say(["Wren's bed. A second, much smaller pillow has appeared on it."]);
  },
};

/* ---------------------------------------------------------------------- map */

/** Map definition (format: docs/ARCHITECTURE.md → "Map format"). */
export default {
  id: 'wren-house',
  name: "Wren's House",
  kind: 'indoor',
  music: 'home',
  // 10 × 8, wood floor, exit mat at (4,7).
  tiles: [
    'WWWWWWWWWW',
    'WooooooooW',
    'WooooooooW',
    'WooooooooW',
    'WooooooooW',
    'WooooooooW',
    'WooooooooW',
    'WWWWEWWWWW',
  ],
  spawn: { x: 4, y: 6, facing: 'up' },
  objects: [
    // back wall: books, radio, hearth, then the kitchen on the east side
    {
      type: 'bookshelf', id: 'bookshelf', x: 1, y: 1,
      text: ['Beekeeping guides, mystery novels and a dog-eared atlas.', "Inside the atlas: 'WORLD'S BEST EXPLORER: ME.' —W."],
    },
    { type: 'radio', id: 'radio', x: 3, y: 1, text: ["♪ ...stay tuned for 'Knitting After Dark' with Marjorie."] },
    { type: 'fireplace', id: 'fireplace', x: 4, y: 1, text: ['A kettle hums on the hob. Nana Bee always has one on.'] },
    { type: 'cupboard', id: 'cupboard', x: 6, y: 1, text: ['Honey jars. More honey jars. Behind those... honey jars.'] },
    { type: 'stove', id: 'stove', x: 7, y: 1, text: ["A pot of porridge. Wren's bowl sits untouched beside it."] },
    { type: 'sink', id: 'sink', x: 8, y: 1, text: ['A row of teacups, washed and drying in the sun.'] },
    // Wren's corner
    { type: 'bed', id: 'wren-bed', x: 1, y: 3, color: '#7d5a7a', script: 'wren_bed' },
    {
      type: 'crate', id: 'treasure-crate', x: 1, y: 6,
      text: ["Wren's treasures: three pebbles, a feather and a map of 'secret spots'."],
    },
    // Nana's corner
    {
      type: 'chair', id: 'rocking-chair', x: 3, y: 3, facing: 'down',
      text: ["Nana Bee's rocking chair. A half-knitted something hangs over the arm."],
    },
    { type: 'rug', id: 'rug', x: 3, y: 4, w: 3, h: 2, color: '#d9a441' },
    { type: 'table', id: 'table', x: 6, y: 4, text: ['A honey cake under a glass dome. It has been sampled. Twice.'] },
    { type: 'chair', id: 'chair-a', x: 6, y: 5, facing: 'up' },
    { type: 'chair', id: 'chair-b', x: 7, y: 5, facing: 'up' },
    { type: 'barrel', id: 'honey-barrel', x: 8, y: 3, text: ["A barrel labelled 'HONEY. NOT FOR WREN.' The lid is slightly ajar."] },
    { type: 'plant', id: 'plant', x: 8, y: 6, text: ['A spider plant with big ambitions. It is halfway to the ceiling.'] },
  ],
  npcs: [
    {
      id: 'nana-bee', name: NANA, x: 4, y: 3, facing: 'down', behavior: 'turn',
      look: {
        skin: '#c98f65',
        hair: '#ece8e0',
        hairStyle: 'bun',
        shirt: '#f2e6cf',
        pants: '#6b5a4a',
        shoes: '#5a3e2a',
        outfit: 'dress',
        outfitColor: '#d9a441',
        build: 'elder',
        accessory: 'glasses',
        accessoryColor: '#3a2f28',
      },
      script: 'nana',
    },
  ],
  warps: [{ x: 4, y: 7, to: 'fernhollow', tx: 24, ty: 21, facing: 'down' }],
  triggers: [],
  scripts,
};
