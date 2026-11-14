/**
 * Fernhollow art-direction palette — the single source of truth for world colours.
 * Hex strings in sRGB (THREE.Color converts them to linear on set).
 * The first block mirrors the table in docs/ARCHITECTURE.md; the rest are
 * supporting tones derived from it for terrain, props and interiors.
 * Pure data — safe to import from Node tests.
 */

/** Art-direction table (docs/ARCHITECTURE.md → "Art direction"). */
export const PALETTE = Object.freeze({
  meadow: '#86b86a',
  meadowDark: '#5e9a4f',
  path: '#d9bb8c',
  cobble: '#b9b1a3',
  sand: '#ead9a8',
  water: '#4fa7a8',
  waterDeep: '#2c7a86',
  foliage: '#3f7d4a',
  foliageLight: '#69a85a',
  bark: '#7a5236',
  roofTerracotta: '#c8643b',
  roofSlate: '#4f6d8f',
  roofMoss: '#6b8f4e',
  roofPlum: '#7d5a7a',
  wallCream: '#f2e6cf',
  timber: '#8a5a3b',
  lampGlow: '#ffc56b',
  nightAmbient: '#1d2440',
});

/** Supporting tones (all original, derived from the table above). */
export const TONES = Object.freeze({
  // ground
  meadowLight: '#98c879',
  meadowWorn: '#b4b97c',
  meadowShade: '#6fa55c',
  forestFloor: '#4d7f45',
  pathDark: '#c9a677',
  pathLight: '#e3c99e',
  cobbleLight: '#cdc5b6',
  cobbleMortar: '#978f82',
  sandDark: '#d9c48f',
  basin: '#4f8478',
  basinShallow: '#7fa98c',
  waterFoam: '#eef8f1',
  // rock, earth, stone
  rock: '#9c9284',
  rockLight: '#b5aa97',
  rockDark: '#7f7569',
  rockWarm: '#a8957d',
  earth: '#9a7550',
  earthDark: '#6f5238',
  earthWet: '#5a5a48',
  stone: '#a7a094',
  stoneLight: '#c8c0b1',
  stoneDark: '#878074',
  ledgeStone: '#c6b89c',
  ledgeMortar: '#9f927a',
  moss: '#7d9a5a',
  // plants
  foliageDark: '#2f6340',
  conifer: '#2e6a55',
  coniferLight: '#4f9068',
  birchLeaf: '#86b867',
  birchLeafLight: '#b0d27f',
  birchBark: '#ece6d8',
  birchMark: '#4a4440',
  barkDark: '#5e3e29',
  hedge: '#467f45',
  hedgeLight: '#6aa357',
  grassBlade: '#4f8f45',
  grassTip: '#b0d679',
  stem: '#4e8a42',
  flowerCoral: '#f08a6c',
  flowerButter: '#f5d76e',
  flowerLilac: '#b9a0e0',
  flowerWhite: '#f7f3ea',
  flowerCenter: '#f2b544',
  lily: '#5f9e57',
  lilyFlower: '#f6c9d6',
  // wood & build
  wood: '#a57a52',
  woodLight: '#c49a6c',
  woodDark: '#6e4a31',
  woodPale: '#d8b98c',
  plank: '#b0845a',
  wallWarm: '#e8d6b6',
  siding: '#b98a63',
  brick: '#b0694f',
  chimneyStone: '#9a8e80',
  doorSage: '#6e8f5a',
  doorWood: '#7a4a2e',
  doorBlue: '#4f6d8f',
  frameWhite: '#f4f1e8',
  windowDay: '#5d7f99',
  windowShine: '#a9c8d8',
  glass: '#d4efe8',
  iron: '#3d3f46',
  ironLight: '#5b5e68',
  brass: '#c9a24a',
  canvas: '#efe4cc',
  smoke: '#efebe4',
  // interiors
  plaster: '#efe3cc',
  plasterLab: '#e4ede6',
  wainscot: '#9a6b48',
  wainscotLab: '#8fb0a0',
  trim: '#6b4a33',
  cutSection: '#3a2a22',
  floorWood: '#b98a5e',
  floorWoodDark: '#a5784f',
  floorWoodLight: '#c99b6c',
  labTile: '#ecf1ea',
  labTileAlt: '#cfe2d6',
  matRed: '#b5523b',
  matBorder: '#e3c08a',
  linen: '#f6f0e3',
  blanket: '#7d9bc9',
  rug: '#c8643b',
  rugBorder: '#e9cf9a',
  screen: '#7fe0c8',
  ember: '#ff8a3d',
  flame: '#ffd56b',
  skyWindowDay: '#cfeaf2',
  skyWindowNight: '#27305a',
  firefly: '#dcff8a',
  pedestalGlass: '#bff0ea',
});

/** Book spine / small-prop accent colours for deterministic variety. */
export const ACCENTS = Object.freeze([
  '#c8643b', '#4f6d8f', '#6b8f4e', '#7d5a7a', '#d9a441', '#5e9a8f', '#b5523b', '#8a6fb0',
]);

/** Flower petal colours (coral / butter / lilac / white). */
export const FLOWER_COLORS = Object.freeze([
  TONES.flowerCoral, TONES.flowerButter, TONES.flowerLilac, TONES.flowerWhite,
]);
