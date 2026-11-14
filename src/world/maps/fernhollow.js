/**
 * Fernhollow — the starter village (outdoor map).
 *
 * Layout (north is row 0):
 *  - North: a tall-grass meadow (west), the dirt path out to Mistfern Path through
 *    a 3-tile gap in the tree line (guarded by Ranger Tamsin until you have a
 *    partner), and Dr. Marrow's greenhouse lab on a two-tier plateau (east),
 *    reached by a switchback stairway: plaza → S(0) → terrace (1) → S(1) → plateau (2).
 *  - Middle: your cottage and its fenced garden, the cobbled plaza (well, mossy
 *    statue, benches), and the creek, which enters from the east edge.
 *  - South: the old mill and its waterwheel at the creek's bend, a grassy knoll
 *    whose ledges hop down to the pond shore, Abe's pond, Wren's house and the
 *    community garden.
 *
 * Format: docs/ARCHITECTURE.md → "Map format". Validated by tools/validate-maps.mjs.
 */
import { WILDLINGS, STARTERS } from '../../data/wildlings.js';

/** Speaker labels (also used as NPC `name`s). */
const WHO = Object.freeze({
  tamsin: 'Ranger Tamsin',
  tilly: 'Tilly',
  wren: 'Wren',
  abe: 'Abe',
  hesketh: 'Old Hesketh',
  posy: 'Posy',
});

/** Wall / roof colours from the art-direction palette. */
const PALETTE = Object.freeze({
  wallCream: '#f2e6cf',
  timber: '#8a5a3b',
  roofTerracotta: '#c8643b',
  roofSlate: '#4f6d8f',
  roofMoss: '#6b8f4e',
  roofPlum: '#7d5a7a',
});

/** @param {any} api @returns {string} the partner's display name */
function partnerName(api) {
  return api.partner()?.name ?? 'your partner';
}

/** @param {any} api @returns {string|null} the partner's species id */
function partnerSpecies(api) {
  return api.partner()?.species ?? null;
}

/** @param {any} api @returns {string|null} the species Wren partnered with */
function wrenSpecies(api) {
  return STARTERS.find((id) => api.flag(`wren_took_${id}`)) ?? null;
}

/**
 * Pick a per-species line, falling back to a generic one.
 * @param {Record<string, string[]>} table @param {string|null} species @param {string[]} fallback
 */
function bySpecies(table, species, fallback) {
  return (species && table[species]) || fallback;
}

/* ------------------------------------------------------------------ scripts */

const scripts = {
  /** Talking to Ranger Tamsin (either placement). */
  async tamsin(api) {
    if (!api.hasPartner()) {
      await api.say(
        [
          'Ranger Tamsin, Mistfern Path patrol. Pleased to meet you!',
          "The path north is closed to lone travellers. Wild ones spook easy.",
          "Fetch a partner from Dr. Marrow's lab and I'll wave you through.",
        ],
        { speaker: WHO.tamsin },
      );
      return;
    }
    await api.say(
      [
        `Well, look at that! A ${partnerName(api)}. You two suit each other.`,
        'Mistfern Path is just through the gap. Walk gently out there.',
      ],
      { speaker: WHO.tamsin },
    );
  },

  /** North-exit trigger before you have a partner: Tamsin turns you back. */
  async tamsin_block(api) {
    const tamsin = api.npc('tamsin');
    tamsin?.facePlayer();
    await tamsin?.emote('!');
    const pages = api.flag('tamsin_warned')
      ? ["Still on your own? Wildlings out there spook easy. Partner first!"]
      : [
          'Whoa there! Hold up a second, friend.',
          'Wild wildlings on Mistfern Path get skittish around lone travellers.',
          "I hear Dr. Marrow's greenhouse has big news. Go see her first!",
        ];
    await api.say(pages, { speaker: WHO.tamsin });
    api.setFlag('tamsin_warned');
    await api.player.walk(['down']);
  },

  /** North-exit trigger once you have a partner: end-of-demo card. */
  async north_exit(api) {
    api.sfx('confirm');
    await api.card({
      title: 'Thanks for playing!',
      body:
        `You and ${partnerName(api)} are ready for the trail, but Mistfern Path is the ` +
        "next chapter, and it's still being built. Thank you for visiting Fernhollow! " +
        'Stay a while: chat with the neighbours, and see what peeks out of the tall grass.',
      cta: 'Back to Fernhollow',
    });
    await api.player.walk(['down']);
  },

  async tilly(api) {
    if (!api.hasPartner()) {
      await api.say(
        [
          "Shh! I'm sneaking up on a pipwing. They hop off whenever I get close!",
          "I've almost touched one fourteen times. Fifteen is my lucky number.",
        ],
        { speaker: WHO.tilly },
      );
      return;
    }
    await api.say(
      [
        `Whoa! Is that your very own ${partnerName(api)}?!`,
        'Can it help me find a pipwing? Not to catch one. Just to say hello!',
      ],
      { speaker: WHO.tilly },
    );
    await api.follower?.emote('♪');
  },

  /** Wren in the plaza after the partner choice: a friendly challenge. */
  async wren_town(api) {
    const theirs = WILDLINGS[wrenSpecies(api) ?? '']?.name;
    const yours = api.partner()?.name;
    if (!api.flag('wren_challenge')) {
      await api.say(
        [
          theirs
            ? `There you are! ${theirs} and I already did three laps of the well.`
            : 'There you are! I already did three laps of the well. Twice.',
          yours ? `Your ${yours} looks pretty quick too. Hmm. Hmmmm.` : 'You look pretty quick too. Hmm. Hmmmm.',
          "Okay, here's the deal. A friendly challenge, neighbour to neighbour.",
          'Next time we meet on the trail, we compare Field Journals.',
          'Whoever has spotted more wildlings buys the other a honey bun!',
        ],
        { speaker: WHO.wren },
      );
      const pick = await api.choose('Accept the challenge?', ["You're on!", 'Maybe...']);
      api.setFlag('wren_challenge');
      if (pick === 0) {
        api.npc('wren')?.emote('♪');
        await api.say(["Ha! I knew you'd say that. Start saving your coins!"], { speaker: WHO.wren });
      } else {
        await api.say(["'Maybe' means yes in Fernhollow. It's practically the law."], {
          speaker: WHO.wren,
        });
      }
      return;
    }
    await api.say(
      [
        "I'm heading up Mistfern Path the second Ranger Tamsin blinks.",
        "Don't let me catch you napping, neighbour! Honey bun's on the line.",
      ],
      { speaker: WHO.wren },
    );
  },

  async abe(api) {
    if (!api.hasPartner()) {
      await api.say(
        [
          'Shh... the fish are thinking.',
          "Forty years I've fished this pond. Caught a boot once. Named it Gerald.",
        ],
        { speaker: WHO.abe },
      );
      return;
    }
    const line = bySpecies(
      {
        emberkit: ["An Emberkit, eh? Keep that tail out of my pond. No steamed fish!"],
        brookling: ['A Brookling! Ask it to go easy on my fish. They spook something awful.'],
        mossbun: ['A Mossbun! Lovely. My lilypads could use a proper gardener.'],
      },
      partnerSpecies(api),
      [`Fine-looking ${partnerName(api)} you've got there.`],
    );
    await api.say([...line, 'Gerald the boot sends his regards.'], { speaker: WHO.abe });
  },

  async hesketh(api) {
    if (!api.hasPartner()) {
      await api.say(
        [
          "This mill's been grinding oats since my grandmother's grandmother.",
          'The wheel creaks in B-flat. Nobody believes me. Listen closely sometime.',
        ],
        { speaker: WHO.hesketh },
      );
      return;
    }
    await api.say(
      [
        `A ${partnerName(api)}! Fine little creature. Hungry, I'd wager.`,
        "If it ever is, the mill's always got a spare oatcake. Or six.",
      ],
      { speaker: WHO.hesketh },
    );
  },

  async posy(api) {
    if (!api.hasPartner()) {
      await api.say(
        [
          'Morning! These sweet peas are being terribly stubborn today.',
          "They say flowers bloom wherever a Mossbun naps. I'd love to test that!",
        ],
        { speaker: WHO.posy },
      );
      return;
    }
    const line = bySpecies(
      {
        mossbun: ['A MOSSBUN! Could it nap in my garden? Just for an hour? Please?'],
        emberkit: ['An Emberkit! Perfect for chilly mornings. Not for the hedges, though.'],
        brookling: ['A Brookling! Oh, it could help me water. I mean, if it wants to.'],
      },
      partnerSpecies(api),
      [`Oh, a ${partnerName(api)}! Does it like flowers?`],
    );
    await api.say([...line, 'The garden is prettiest at dusk, when the lamps come on.'], {
      speaker: WHO.posy,
    });
  },

  /** Your family's mailbox — gains a letter once you have a partner. */
  async mailbox_home(api) {
    if (!api.hasPartner()) {
      await api.say(["Your family's mailbox. A seed catalogue and a coupon for socks."]);
      return;
    }
    await api.say([
      "There's a new postcard: a sketch of a greenhouse and a heart.",
      "It's signed 'I.M.' Dr. Marrow works fast.",
    ]);
  },
};

/* -------------------------------------------------------------------- looks */

const LOOKS = Object.freeze({
  tamsin: {
    skin: '#b57a52',
    hair: '#3a2a1e',
    hairStyle: 'cap',
    hat: '#5e7d4a',
    shirt: '#d9c79a',
    pants: '#5a4a3a',
    shoes: '#4a3526',
    outfit: 'jacket',
    outfitColor: '#5e7d4a',
    build: 'adult',
    accessory: 'backpack',
    accessoryColor: '#a0703c',
  },
  tilly: {
    skin: '#f0c8a0',
    hair: '#2b1d14',
    hairStyle: 'bob',
    shirt: '#f2e6cf',
    pants: '#6b8f4e',
    shoes: '#e07a5f',
    outfit: 'dress',
    outfitColor: '#e2b64a',
    build: 'kid',
    accessory: null,
  },
  wren: {
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
  abe: {
    skin: '#e0b08a',
    hair: '#a8a29a',
    hairStyle: 'beanie',
    hat: '#c8643b',
    shirt: '#4f6d8f',
    pants: '#5a4a3a',
    shoes: '#3a2f28',
    outfit: 'jacket',
    outfitColor: '#7a6a3a',
    build: 'elder',
    accessory: 'fishing-rod',
    accessoryColor: '#8a5a3b',
  },
  hesketh: {
    skin: '#d9a27a',
    hair: '#e8e4dc',
    hairStyle: 'bald',
    shirt: '#c9b79c',
    pants: '#5a4a3a',
    shoes: '#4a3526',
    outfit: 'apron',
    outfitColor: '#ece2cc',
    build: 'elder',
    accessory: 'cane',
    accessoryColor: '#7a5236',
  },
  posy: {
    skin: '#f2c9a5',
    hair: '#7d5a7a',
    hairStyle: 'bun',
    shirt: '#f2a5b5',
    pants: '#5e9a4f',
    shoes: '#7a5236',
    outfit: 'overalls',
    outfitColor: '#6b8f4e',
    build: 'adult',
    accessory: 'watering-can',
    accessoryColor: '#4fa7a8',
  },
});

/* ---------------------------------------------------------------------- map */

/** Map definition (format: docs/ARCHITECTURE.md → "Map format"). */
export default {
  id: 'fernhollow',
  name: 'Fernhollow',
  kind: 'outdoor',
  music: 'town',
  musicNight: 'town-night',
  // 34 × 30. Legend: src/world/tiles.js. '#' marks building footprints.
  //        0         1         2         3
  //        0123456789012345678901234567890123
  tiles: [
    'TTTTTTTTTTTTTTT","TTTTTTTTTTTTTTTT', //  0  north gap → Mistfern Path
    'TTTTTTTTTTTTTTT","TTTTTTTTTTTTTTTT', //  1
    'TTTTTTTTTTTTTTT.,.TTTTTTTTTTTTTTTT', //  2  Ranger Tamsin's post
    'TTTR""""""""....,...T..#######TTTT', //  3  meadow · path · greenhouse
    'TTT""""f"""""...,...T..#######.TTT', //  4
    'TT."""""""f""...,.ff...#######ffTT', //  5
    'TT..""""""".....,.ff...#######ffTT', //  6
    'TT..............,......###D###ffTT', //  7  lab door (26,7)
    'TTh#####FFF.::::::::......,.....TT', //  8  cottage · plaza · plateau front
    'TTh#####ffF.::::::::..,,,,,fff..TT', //  9
    'TTh#####ffF.::::::::S,S.ff....ffTT', // 10  S(0) at x20, S(1) at x22
    'TTh##D##....::::::::S,,.ff....ffTT', // 11  cottage door (5,11)
    'TT...,,,,,,,::::::::.......fff.TTT', // 12
    'TT........~~~~~~~==~~~~~~~.....TTT', // 13  creek · main bridge
    'TT...SS...~~~~~~~==~~~~~~~~~~~~~~~', // 14  knoll stairs · creek enters (east)
    'TT........~~####.,,.....~~~~~~~~~~', // 15  knoll (level 1) · mill
    'TT.ff.....~~####.,,.............TT', // 16
    'TT........~~####..,...#####FFFFFTT', // 17  Wren's house · community garden
    'TTRvvvvvvR~~####..,...#####FfffFTT', // 18  ledges ↓
    'TT________==,,,,,,,...#####FfffFTT', // 19  pond shore · footbridge
    'TT________~~......,...##D##FfffFTT', // 20  Wren's door (24,20)
    'TT_~~~~~~~~~......,,,,,,,..FfffFTT', // 21  pond
    'TT~~~~~~~~___.......ff....RFF,FFTT', // 22
    'TT~~~~~~~~___.fff............,..TT', // 23
    'TT~~~~~~~~___.fff........fff....TT', // 24
    'TT_~~~~~~___.............fffT...TT', // 25
    'TTT________.....R.....TT.......TTT', // 26
    'TTTT.........TT.........TT....TTTT', // 27
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT', // 28
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT', // 29
  ],
  // Plateau (2) + terrace (1) in the north-east; knoll (1) above the ledges.
  heights: [
    '0000000000000000000002222222222222',
    '0000000000000000000002222222222222',
    '0000000000000000000002222222222222',
    '0000000000000000000002222222222222',
    '0000000000000000000002222222222222',
    '0000000000000000000002222222222222',
    '0000000000000000000002222222222222',
    '0000000000000000000002222222222222',
    '0000000000000000000002222222222222',
    '0000000000000000000002222222222222',
    '0000000000000000000001111111111111',
    '0000000000000000000001111111111111',
    '0000000000000000000000000000000000',
    '0000000000000000000000000000000000',
    '0000000000000000000000000000000000',
    '1111111111000000000000000000000000',
    '1111111111000000000000000000000000',
    '1111111111000000000000000000000000',
    '1111111111000000000000000000000000',
    '0000000000000000000000000000000000',
    '0000000000000000000000000000000000',
    '0000000000000000000000000000000000',
    '0000000000000000000000000000000000',
    '0000000000000000000000000000000000',
    '0000000000000000000000000000000000',
    '0000000000000000000000000000000000',
    '0000000000000000000000000000000000',
    '0000000000000000000000000000000000',
    '0000000000000000000000000000000000',
    '0000000000000000000000000000000000',
  ],
  spawn: { x: 5, y: 12, facing: 'down' },
  objects: [
    // --- buildings ---
    {
      type: 'building', id: 'cottage', variant: 'cottage', x: 3, y: 8, w: 5, h: 4,
      door: { x: 5, y: 11 }, wall: PALETTE.wallCream, roof: PALETTE.roofTerracotta,
    },
    {
      type: 'building', id: 'wren-house', variant: 'house', x: 22, y: 17, w: 5, h: 4,
      door: { x: 24, y: 20 }, wall: '#efe0c4', roof: PALETTE.roofSlate,
    },
    {
      type: 'building', id: 'greenhouse', variant: 'greenhouse', x: 23, y: 3, w: 7, h: 5,
      door: { x: 26, y: 7 }, wall: PALETTE.wallCream, roof: PALETTE.roofMoss,
    },
    {
      type: 'building', id: 'mill', variant: 'mill', x: 12, y: 15, w: 4, h: 4,
      wall: '#e3d3b4', roof: PALETTE.roofPlum,
      text: [
        'Fernhollow Mill. Its great wheel turns slow and steady.',
        "A chalk note on the door: 'Round the side. Knock loudly. —H.'",
      ],
    },
    { type: 'waterwheel', id: 'waterwheel', x: 11, y: 16, facing: 'left' },

    // --- plaza ---
    {
      type: 'well', id: 'well', x: 14, y: 9,
      text: ['An old wishing well. Coins glint at the bottom, plus one very old button.'],
    },
    {
      type: 'statue', id: 'statue', x: 18, y: 10, species: 'pipwing',
      text: [
        "A mossy statue of a pipwing, Fernhollow's lucky bird.",
        'Someone has tucked a fresh daisy behind its wing.',
      ],
    },
    { type: 'bench', id: 'bench-plaza-north', x: 12, y: 8, facing: 'down' },
    { type: 'bench', id: 'bench-plaza-creek', x: 14, y: 12, facing: 'down' },
    {
      type: 'sign', id: 'sign-village', x: 15, y: 7,
      text: ['FERNHOLLOW', 'Where the creek hums and the kettle is always on.'],
    },

    // --- north exit ---
    {
      type: 'sign', id: 'sign-route', x: 18, y: 3,
      text: ['NORTH: MISTFERN PATH', 'Fog in the mornings, wildlings all day. Walk gently.'],
    },
    { type: 'stump', id: 'stump-meadow', x: 13, y: 6 },

    // --- greenhouse plateau + terrace ---
    {
      type: 'sign', id: 'sign-lab', x: 23, y: 8,
      text: [
        'MARROW GREENHOUSE LAB',
        'Wildling research and seedlings. Please wipe your boots (and paws).',
      ],
    },
    { type: 'flowerpot', id: 'pot-lab-west', x: 25, y: 8, color: '#c8643b' },
    { type: 'flowerpot', id: 'pot-lab-east', x: 27, y: 8, color: '#e2b64a' },
    {
      type: 'planter', id: 'planter-lab', x: 28, y: 8,
      text: ['Seedling trays from the greenhouse, toughening up in the sun.'],
    },
    {
      type: 'bench', id: 'bench-terrace', x: 27, y: 11, facing: 'down',
      text: ['A bench with a view over the creek. Perfect for doing nothing at all.'],
    },

    // --- cottage + knoll ---
    {
      type: 'mailbox', id: 'mailbox-home', x: 4, y: 12, color: PALETTE.roofTerracotta,
      script: 'mailbox_home',
    },
    {
      type: 'bigtree', id: 'oak-knoll', x: 7, y: 15,
      text: ['A grand old oak. Abe swears its roots hold the whole hill together.'],
    },
    {
      type: 'bench', id: 'bench-knoll', x: 2, y: 15, facing: 'down',
      text: ['A bench overlooking the pond. The best seat in Fernhollow, says Abe.'],
    },

    // --- mill yard ---
    { type: 'barrel', id: 'barrel-mill', x: 16, y: 15, text: ['A barrel of oats. It smells like breakfast.'] },
    { type: 'logpile', id: 'logpile-mill', x: 14, y: 20 },

    // --- Wren's house + garden ---
    {
      type: 'mailbox', id: 'mailbox-wren', x: 25, y: 21, color: PALETTE.roofSlate,
      text: ['WREN & NANA BEE', "A sticker on the side: 'NO JUNK MAIL. YES SNAIL MAIL.'"],
    },
    {
      type: 'sign', id: 'sign-garden', x: 30, y: 23,
      text: ['COMMUNITY GARDEN', 'Pull a weed, take a flower. Be kind to the worms.'],
    },

    // --- south meadow ---
    {
      type: 'bigtree', id: 'tree-south', x: 19, y: 24,
      text: ['A broad, shady tree. Its bark is carved with years of initials.'],
    },
    { type: 'stump', id: 'stump-south', x: 13, y: 22 },

    // --- pond ---
    { type: 'lilypad', id: 'lily-1', x: 4, y: 22 },
    { type: 'lilypad', id: 'lily-2', x: 7, y: 23 },
    { type: 'lilypad', id: 'lily-3', x: 5, y: 24 },
    { type: 'lilypad', id: 'lily-4', x: 8, y: 21 },
    { type: 'lilypad', id: 'lily-5', x: 3, y: 23 },

    // --- lamps along the main paths ---
    { type: 'lamp', id: 'lamp-plaza-west', x: 11, y: 11 },
    { type: 'lamp', id: 'lamp-plaza-ne', x: 19, y: 8 },
    { type: 'lamp', id: 'lamp-bridge-nw', x: 16, y: 12 },
    { type: 'lamp', id: 'lamp-bridge-ne', x: 19, y: 12 },
    { type: 'lamp', id: 'lamp-north-path', x: 17, y: 5 },
    { type: 'lamp', id: 'lamp-plateau-west', x: 21, y: 8 },
    { type: 'lamp', id: 'lamp-plateau-east', x: 31, y: 8 },
    { type: 'lamp', id: 'lamp-terrace', x: 23, y: 10 },
    { type: 'lamp', id: 'lamp-bridge-south', x: 19, y: 16 },
    { type: 'lamp', id: 'lamp-mill', x: 17, y: 18 },
    { type: 'lamp', id: 'lamp-wren', x: 19, y: 20 },
    { type: 'lamp', id: 'lamp-pond', x: 11, y: 26 },
  ],
  npcs: [
    {
      id: 'tamsin', name: WHO.tamsin, x: 16, y: 2, facing: 'down', behavior: 'stand',
      look: LOOKS.tamsin, script: 'tamsin', hideIf: 'has_partner',
    },
    {
      id: 'tamsin-aside', name: WHO.tamsin, x: 14, y: 3, facing: 'right', behavior: 'turn',
      look: LOOKS.tamsin, script: 'tamsin', showIf: 'has_partner',
    },
    {
      id: 'tilly', name: WHO.tilly, x: 8, y: 5, facing: 'left', behavior: 'wander', radius: 2,
      look: LOOKS.tilly, script: 'tilly',
    },
    {
      id: 'wren', name: WHO.wren, x: 13, y: 11, facing: 'left', behavior: 'turn',
      look: LOOKS.wren, script: 'wren_town', showIf: 'wren_left_lab',
    },
    {
      id: 'abe', name: WHO.abe, x: 10, y: 23, facing: 'left', behavior: 'stand', noTurn: true,
      look: LOOKS.abe, script: 'abe',
    },
    {
      id: 'hesketh', name: WHO.hesketh, x: 16, y: 17, facing: 'left', behavior: 'turn',
      look: LOOKS.hesketh, script: 'hesketh',
    },
    {
      id: 'posy', name: WHO.posy, x: 29, y: 19, facing: 'down', behavior: 'wander', radius: 1,
      look: LOOKS.posy, script: 'posy',
    },
  ],
  warps: [
    { x: 5, y: 11, to: 'home', tx: 5, ty: 6, facing: 'up' },
    { x: 24, y: 20, to: 'wren-house', tx: 4, ty: 6, facing: 'up' },
    { x: 26, y: 7, to: 'lab', tx: 6, ty: 9, facing: 'up' },
  ],
  triggers: [
    // Before a partner: Ranger Tamsin stands in the gap; the tiles beside her turn you back.
    { x: 15, y: 2, script: 'tamsin_block', showIf: '!has_partner' },
    { x: 17, y: 2, script: 'tamsin_block', showIf: '!has_partner' },
    // After: the path is open up to the map edge, where the demo ends.
    { x: 15, y: 0, script: 'north_exit', showIf: 'has_partner' },
    { x: 16, y: 0, script: 'north_exit', showIf: 'has_partner' },
    { x: 17, y: 0, script: 'north_exit', showIf: 'has_partner' },
  ],
  scripts,
};
