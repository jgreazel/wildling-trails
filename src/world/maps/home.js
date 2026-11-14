/**
 * Home — the player's cottage interior, where a new game begins.
 *
 * Kitchen corner along the back wall (stove, sink, counter, cupboard), the
 * fireplace and bookshelf, your bed in the north-east corner, a table with two
 * chairs, a rug by the hearth and the radio. Mom wakes you on the first load.
 *
 * Format: docs/ARCHITECTURE.md → "Map format". Validated by tools/validate-maps.mjs.
 */

const MOM = 'Mom';

/** Mom's reaction to each partner species: [delight, follow-up]. */
const MOM_REACTS = Object.freeze({
  emberkit: ['An Emberkit! Mind my curtains, please, little one.', '...Although you could keep the kettle warm. Hired!'],
  brookling: ['A Brookling! It can help me water the window boxes.', '...And possibly the floor. I will fetch a mop.'],
  mossbun: ["A Mossbun! It's already sniffing my herb pots.", 'Basil is fine, sweet pea. The rosemary is for supper.'],
});

/* ------------------------------------------------------------------ scripts */

const scripts = {
  /** onEnter: the wake-up scene, once per game. */
  async intro(api) {
    if (api.flag('intro_done')) return;
    const mom = api.npc('mom');
    await api.wait(500);
    await mom?.emote('!');
    // Walk over to the bedside if the player is still at the spawn tile.
    const atBed = api.player.x === 8 && api.player.y === 2;
    if (atBed) await mom?.walk(['up', 'right', 'right', 'right', 'right']);
    mom?.facePlayer();
    api.player.face(atBed ? 'left' : 'down');
    await api.say(
      [
        'Rise and shine, sleepyhead! There is big news from up the hill.',
        "Dr. Marrow's greenhouse had a busy night. Three wildling eggs hatched!",
        "She rang at dawn and asked for you by name. Said you've got kind hands.",
        'Her greenhouse lab is up the stone steps, just east of the plaza.',
        'Oh, and Wren sprinted past the window an hour ago. In her slippers.',
      ],
      { speaker: MOM },
    );
    api.setFlag('intro_done');
    if (atBed) {
      await mom?.walk(['left', 'left', 'left', 'left', 'down']);
      mom?.face('down');
    }
  },

  /** Talking to Mom. */
  async mom(api) {
    if (!api.hasPartner()) {
      await api.say(
        [
          'Dr. Marrow is expecting you, love. Up the steps east of the plaza.',
          "I'd come too, but these scones won't bake themselves.",
        ],
        { speaker: MOM },
      );
      return;
    }
    const partner = api.partner();
    const reaction = MOM_REACTS[partner?.species] ?? ['What a sweet little face!', 'Wipe its paws before supper.'];
    await api.say([`Oh my stars, look at you two! Hello there, little ${partner?.name ?? 'one'}!`, ...reaction], {
      speaker: MOM,
    });
    await api.follower?.emote('♥');
    const pick = await api.choose('Want a snack for the road?', ['Yes, please!', "I'm all right"]);
    if (pick === 0) {
      api.sfx('confirm');
      await api.say(['One honey scone, wrapped in a napkin. Share the crumbs, now!'], { speaker: MOM });
    } else {
      await api.say(["Suit yourself. I'll keep one warm for when you're back."], { speaker: MOM });
    }
  },

  /** The radio changes its tune once the news is out. */
  async radio(api) {
    api.sfx('text');
    if (!api.hasPartner()) {
      await api.say(['♪ ...the forecast for Fernhollow: sunny, with a chance of pipwings.']);
      return;
    }
    await api.say([
      '♪ ...word from the greenhouse: all three hatchlings have partners!',
      '♪ ...and now, a song about soup.',
    ]);
  },
};

/* ---------------------------------------------------------------------- map */

/** Map definition (format: docs/ARCHITECTURE.md → "Map format"). */
export default {
  id: 'home',
  name: 'Home',
  kind: 'indoor',
  music: 'home',
  // 11 × 8, wood floor, exit mat at (5,7).
  tiles: [
    'WWWWWWWWWWW',
    'WoooooooooW',
    'WoooooooooW',
    'WoooooooooW',
    'WoooooooooW',
    'WoooooooooW',
    'WoooooooooW',
    'WWWWWEWWWWW',
  ],
  spawn: { x: 8, y: 2, facing: 'down' },
  onEnter: 'intro',
  objects: [
    // kitchen corner
    { type: 'stove', id: 'stove', x: 1, y: 1, text: ["Something with cinnamon is baking. A note says: 'NOT YET.'"] },
    { type: 'sink', id: 'sink', x: 2, y: 1, text: ['The tap drips a cheerful little rhythm.'] },
    { type: 'counter', id: 'counter', x: 3, y: 1, w: 1, text: ["A cutting board, a heap of carrots and Mom's lucky spoon."] },
    { type: 'cupboard', id: 'cupboard', x: 4, y: 1, text: ["Jars of jam, sorted by colour. Mom's system is unbreakable."] },
    // hearth + shelf
    { type: 'fireplace', id: 'fireplace', x: 5, y: 1, text: ['The fire crackles and pops. Perfect for toasting toes.'] },
    {
      type: 'bookshelf', id: 'bookshelf', x: 7, y: 1,
      text: ["Field guides, a cookbook and 'Knots for Beginners'.", "The bookmark in the knot book hasn't moved in years."],
    },
    { type: 'bed', id: 'bed', x: 9, y: 1, color: '#c8643b', text: ['Your bed. Still warm. Dangerously tempting.'] },
    // living area
    { type: 'rug', id: 'rug', x: 5, y: 3, w: 3, h: 2, color: '#b5523a' },
    { type: 'table', id: 'table', x: 2, y: 4, text: ['Breakfast is set. Your toast has been ambushed by jam.'] },
    { type: 'chair', id: 'chair-west', x: 1, y: 4, facing: 'right' },
    { type: 'chair', id: 'chair-east', x: 4, y: 4, facing: 'left' },
    { type: 'radio', id: 'radio', x: 9, y: 4, script: 'radio' },
    { type: 'plant', id: 'plant-west', x: 1, y: 6, text: ['A potted fern. Mom chats with it every morning.'] },
    { type: 'plant', id: 'plant-east', x: 9, y: 6, text: ['A lemon tree in a pot. It has produced exactly one lemon.'] },
  ],
  npcs: [
    {
      id: 'mom', name: MOM, x: 3, y: 3, facing: 'down', behavior: 'turn',
      look: {
        skin: '#e8b48a',
        hair: '#7a4a2a',
        hairStyle: 'bun',
        shirt: '#8fb3c9',
        pants: '#5a4a3a',
        shoes: '#6b4a32',
        outfit: 'apron',
        outfitColor: '#f2e6cf',
        build: 'adult',
        accessory: null,
      },
      script: 'mom',
    },
  ],
  warps: [{ x: 5, y: 7, to: 'fernhollow', tx: 5, ty: 12, facing: 'down' }],
  triggers: [],
  scripts,
};
