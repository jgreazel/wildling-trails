/**
 * Species data for the original creatures ("wildlings"). Visuals live in
 * src/actors/wildlings.js and cries in src/audio — both keyed by these ids.
 */

/** @typedef {{ id:string, name:string, element:string, starter:boolean, blurb:string }} Wildling */

/** @type {Readonly<Record<string, Wildling>>} */
export const WILDLINGS = Object.freeze({
  emberkit: {
    id: 'emberkit',
    name: 'Emberkit',
    element: 'Ember',
    starter: true,
    blurb: 'A fox kit whose tail-tip smoulders like a hearth coal. It naps in sunbeams and hums when it is happy.',
  },
  brookling: {
    id: 'brookling',
    name: 'Brookling',
    element: 'Tide',
    starter: true,
    blurb: 'A frilled newt that sings along with running water. Its gill fronds blush pink when it is curious.',
  },
  mossbun: {
    id: 'mossbun',
    name: 'Mossbun',
    element: 'Bloom',
    starter: true,
    blurb: 'A round rabbit with a fern sprouting from its back. Little flowers open wherever it naps.',
  },
  pipwing: {
    id: 'pipwing',
    name: 'Pipwing',
    element: 'Gust',
    starter: false,
    blurb: 'A plump songbird that would rather hop than fly. Flocks gossip loudly at dawn.',
  },
  dewsnail: {
    id: 'dewsnail',
    name: 'Dewsnail',
    element: 'Tide',
    starter: false,
    blurb: 'A patient snail whose glassy shell gathers morning dew and glows like a tiny lantern.',
  },
});

/** Ids of the three partner choices, in pedestal order (west → east). */
export const STARTERS = Object.freeze(['emberkit', 'brookling', 'mossbun']);
/** Ids that can peek out of tall grass. */
export const WILD_SPECIES = Object.freeze(['pipwing', 'dewsnail']);
