/**
 * Content tests: every map validates, every script survives a dry-run, the story
 * plays out end to end, and the validator itself catches broken maps.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAll,
  validateMaps,
  dryRunScripts,
  createScriptHarness,
  runScript,
  reachable,
  loadMaps,
  flagsFromSource,
  ANSWER_NO,
  MAX_PAGE_CHARS,
} from '../tools/validate-maps.mjs';
import { createMapModel, isActive, anyFlag } from '../src/world/map-utils.js';
import { STARTERS, WILDLINGS } from '../src/data/wildlings.js';
import { WREN_PICK } from '../src/world/maps/lab.js';

const maps = loadMaps();
const models = Object.fromEntries(Object.entries(maps).map(([id, def]) => [id, createMapModel(def)]));

/** Flags right after choosing `species` in the lab. */
function afterChoice(species) {
  return {
    intro_done: true,
    met_marrow: true,
    has_partner: true,
    [`chose_${species}`]: true,
    [`wren_took_${WREN_PICK[species]}`]: true,
    has_journal: true,
    wren_left_lab: true,
  };
}
const party = (species) => [{ species, name: WILDLINGS[species].name }];

/* ------------------------------------------------------------- validation */

test('all maps validate with zero errors', async () => {
  const result = await validateAll({ maps });
  assert.deepEqual(result.errors, []);
  assert.ok(result.stats.runs > 100, 'dry-run executed the scripts');
  assert.ok(result.stats.scenarios.length >= 4, 'new game + one scenario per starter');
});

test(`no dialogue page is longer than ${MAX_PAGE_CHARS} characters`, async () => {
  const result = await validateAll({ maps });
  assert.deepEqual(result.warnings.filter((w) => w.includes('dialogue page')), []);
});

test('script dry-run: no script throws or misuses the API', async () => {
  const dry = await dryRunScripts(maps);
  assert.deepEqual(dry.errors, []);
  assert.equal(dry.finals.length, 3);
  // Each playthrough ends with exactly one partner, and together they cover every starter.
  for (const f of dry.finals) assert.equal(f.party.length, 1, `${f.label} has one partner`);
  assert.deepEqual(dry.finals.map((f) => f.party[0].species).sort(), [...STARTERS].sort());
});

/* ----------------------------------------------------------------- layout */

test('Fernhollow layout matches the brief', () => {
  const m = models.fernhollow;
  assert.equal(m.width, 34);
  assert.equal(m.height, 30);
  assert.equal(m.def.music, 'town');
  assert.equal(m.def.musicNight, 'town-night');
  // A single 3-tile gap at the top centre.
  const gap = [...m.def.tiles[0]].map((c, x) => (m.typeAt(x, 0).walkable ? x : -1)).filter((x) => x >= 0);
  assert.deepEqual(gap, [15, 16, 17]);
  // Creek enters from the east edge; two bridges.
  assert.ok([...Array(m.height).keys()].some((y) => m.typeAt(m.width - 1, y).water), 'water on the east edge');
  const bridges = m.def.tiles.join('').split('').filter((c) => c === '=').length;
  assert.ok(bridges >= 2);
  // Greenhouse on the level-2 plateau; mill with a waterwheel on adjacent water.
  const greenhouse = m.objects.find((o) => o.variant === 'greenhouse');
  assert.equal(m.levelAt(greenhouse.door.x, greenhouse.door.y), 2);
  assert.equal(greenhouse.w * greenhouse.h, 35);
  const mill = m.objects.find((o) => o.variant === 'mill');
  const wheel = m.objects.find((o) => o.type === 'waterwheel');
  assert.ok(mill.text && !mill.door, 'mill is not enterable but has text');
  assert.equal(wheel.x, mill.x - 1, 'wheel sits against the mill wall');
  assert.ok(m.typeAt(wheel.x, wheel.y).water && m.typeAt(wheel.x, wheel.y + 1).water);
  // Landmarks and dressing.
  for (const type of ['well', 'statue', 'bench', 'lamp', 'mailbox', 'lilypad', 'sign', 'flowerpot', 'planter']) {
    assert.ok(m.objects.some((o) => o.type === type), `has a ${type}`);
  }
  assert.ok(m.def.tiles.join('').includes('v'), 'has ledges');
  assert.ok(m.def.tiles.join('').includes('F'), 'has fences');
  assert.ok(m.def.tiles.slice(3, 8).join('').includes('"'), 'tall-grass meadow near the north exit');
});

test('stairs climb ground → landing → plateau', () => {
  const m = models.fernhollow;
  // plaza (19,10) → S(0) (20,10) → terrace (21,10) → (22,11) → S(1) (22,10) → plateau (22,9)
  assert.equal(m.canStep(19, 10, 'right').ok, true);
  assert.equal(m.canStep(20, 10, 'right').ok, true);
  assert.equal(m.levelAt(21, 10), 1);
  assert.equal(m.canStep(22, 11, 'up').ok, true);
  assert.equal(m.canStep(22, 10, 'up').ok, true);
  assert.equal(m.levelAt(22, 9), 2);
  // Cliffs block everywhere else.
  assert.equal(m.canStep(20, 7, 'right').reason, 'cliff');
  assert.equal(m.canStep(25, 11, 'down').reason, 'cliff');
});

test('knoll ledges are a one-way shortcut to the pond shore', () => {
  const m = models.fernhollow;
  const hop = m.canStep(5, 17, 'down');
  assert.deepEqual([hop.ok, hop.hop, hop.x, hop.y], [true, true, 5, 19]);
  assert.equal(m.canStep(5, 19, 'up').ok, false);
  // The long way round works too (footbridge), so nobody gets stuck on the shore.
  const { reached } = reachable(m, { x: 5, y: 19 }, {});
  assert.ok(reached.has('5,12'), 'shore connects back to the cottage');
});

test('north exit: blocked before a partner, open after', () => {
  const m = models.fernhollow;
  const before = reachable(m, m.spawn, {});
  assert.ok(!before.reached.has('16,0') && !before.reached.has('15,1') && !before.reached.has('17,1'));
  const after = reachable(m, m.spawn, afterChoice('emberkit'));
  assert.ok(after.reached.has('16,0'));
  // Ranger Tamsin swaps placements.
  const tamsin = m.npcs.find((n) => n.id === 'tamsin');
  const aside = m.npcs.find((n) => n.id === 'tamsin-aside');
  assert.ok(isActive(tamsin, {}) && !isActive(aside, {}));
  assert.ok(!isActive(tamsin, { has_partner: true }) && isActive(aside, { has_partner: true }));
});

test('interiors: walls around, exit mats on the bottom row, correct floors and music', () => {
  for (const [id, floor, music] of [
    ['home', 'o', 'home'],
    ['wren-house', 'o', 'home'],
    ['lab', 't', 'lab'],
  ]) {
    const m = models[id];
    assert.equal(m.kind, 'indoor');
    assert.equal(m.def.music, music);
    const rows = m.def.tiles;
    assert.match(rows[0], /^W+$/);
    assert.match(rows[rows.length - 1], /^W+EW+$/);
    rows.forEach((r) => assert.ok(r.startsWith('W') && r.endsWith('W'), `${id} side walls`));
    assert.ok(rows.slice(1, -1).every((r) => [...r.slice(1, -1)].every((c) => c === floor)), `${id} floor is ${floor}`);
  }
  // Lab pedestals follow STARTERS west → east and empty out by flag.
  const pedestals = models.lab.objects.filter((o) => o.type === 'pedestal').sort((a, b) => a.x - b.x);
  assert.deepEqual(pedestals.map((p) => p.species), [...STARTERS]);
  for (const p of pedestals) assert.deepEqual(p.emptyIf, [`chose_${p.species}`, `wren_took_${p.species}`]);
});

test('every NPC from the cast has a name, a look and something to say', () => {
  const cast = Object.values(models).flatMap((m) => m.npcs.map((n) => n.name));
  for (const who of ['Mom', 'Dr. Marrow', 'Corin', 'Wren', 'Nana Bee', 'Ranger Tamsin', 'Abe', 'Tilly', 'Old Hesketh', 'Posy']) {
    assert.ok(cast.includes(who), `${who} is placed`);
  }
  const abe = models.fernhollow.npcs.find((n) => n.id === 'abe');
  const posy = models.fernhollow.npcs.find((n) => n.id === 'posy');
  const marrow = models.lab.npcs.find((n) => n.id === 'marrow');
  assert.equal(abe.look.accessory, 'fishing-rod');
  assert.equal(posy.look.accessory, 'watering-can');
  assert.equal(marrow.look.outfit, 'labcoat');
  assert.equal(marrow.look.accessory, 'glasses');
});

/* ------------------------------------------------------------------ story */

test('story 1: Mom wakes you on a new game, once', async () => {
  const h = createScriptHarness({ maps, mapId: 'home' });
  assert.ok(await runScript(h, 'intro'));
  assert.deepEqual(h.report.errors, []);
  assert.equal(h.state.flags.intro_done, true);
  assert.equal(h.log.says[0].speaker, 'Mom');
  assert.ok(h.log.says[0].pages.some((p) => p.includes('Three wildling eggs hatched')));
  assert.equal(h.log.npcWalks.length, 2, 'Mom walks over and back');

  const again = createScriptHarness({ maps, mapId: 'home', flags: { intro_done: true } });
  await runScript(again, 'intro');
  assert.equal(again.log.says.length, 0);
});

test('story 2: Ranger Tamsin turns lone travellers back', async () => {
  const h = createScriptHarness({ maps, mapId: 'fernhollow', flags: { intro_done: true }, player: { x: 15, y: 2 } });
  await runScript(h, 'tamsin_block');
  assert.deepEqual(h.report.errors, []);
  assert.deepEqual(h.log.emotes[0], { who: 'npc tamsin', kind: '!' });
  assert.equal(h.log.says[0].speaker, 'Ranger Tamsin');
  assert.deepEqual([h.player.x, h.player.y], [15, 3], 'walked back one tile');
  assert.equal(h.state.flags.tamsin_warned, true);
});

test('story 3: first lab visit greets you and marks the starters seen', async () => {
  const h = createScriptHarness({ maps, mapId: 'lab', flags: { intro_done: true } });
  await runScript(h, 'lab_enter');
  assert.deepEqual(h.report.errors, []);
  assert.equal(h.state.flags.met_marrow, true);
  assert.deepEqual([...new Set(h.log.seen)].sort(), [...STARTERS].sort());
  assert.ok(h.log.emotes.some((e) => e.who === 'npc marrow' && e.kind === '!'));
});

for (const species of STARTERS) {
  test(`story 4: choosing ${species} — Wren takes ${WREN_PICK[species]}, journal handed over`, async () => {
    const x = models.lab.objects.find((o) => o.species === species).x;
    const h = createScriptHarness({
      maps,
      mapId: 'lab',
      flags: { intro_done: true, met_marrow: true },
      player: { x, y: 4, facing: 'up' },
    });
    await runScript(h, `pedestal_${species}`);
    assert.deepEqual(h.report.errors, []);
    assert.deepEqual(h.state.flags, afterChoice(species));
    assert.deepEqual(h.log.given, [species]);
    assert.deepEqual(h.log.prompts[0], { kind: 'confirm', prompt: `Partner with ${WILDLINGS[species].name}?`, answer: true });
    assert.ok(h.log.cries.includes(species) && h.log.cries.includes(WREN_PICK[species]));
    assert.ok(h.log.says.some((s) => s.pages.includes('You received the Field Journal!')));
    assert.ok(h.log.hidden.has('wren'), 'Wren ran outside');
    assert.equal(h.log.npcWalks.length, 2, 'Wren walks to her pedestal, then out');

    // Pedestals empty out; the remaining hatchling is resting.
    const flags = h.state.flags;
    const [mine, theirs, resting] = [species, WREN_PICK[species], STARTERS.find((s) => s !== species && s !== WREN_PICK[species])];
    const ped = (s) => models.lab.objects.find((o) => o.species === s);
    assert.equal(anyFlag(ped(mine).emptyIf, flags), true);
    assert.equal(anyFlag(ped(theirs).emptyIf, flags), true);
    assert.equal(anyFlag(ped(resting).emptyIf, flags), false);
    const talk = async (s) => {
      const t = createScriptHarness({ maps, mapId: 'lab', flags, party: party(species) });
      await runScript(t, `pedestal_${s}`);
      assert.deepEqual(t.log.given, [], 'no second partner');
      return t.log.says.flatMap((x) => x.pages).join(' ');
    };
    assert.match(await talk(theirs), /Wren's/);
    assert.match(await talk(resting), /asleep/);
  });
}

test('story 4b: declining a hatchling changes nothing', async () => {
  const h = createScriptHarness({ maps, mapId: 'lab', flags: { met_marrow: true }, answers: ANSWER_NO });
  await runScript(h, 'pedestal_mossbun');
  assert.deepEqual(h.state.flags, { met_marrow: true });
  assert.deepEqual(h.log.given, []);
});

test('story 4c: an interrupted choice scene resumes on the next lab visit', async () => {
  const h = createScriptHarness({
    maps,
    mapId: 'lab',
    flags: { intro_done: true, met_marrow: true, chose_mossbun: true, has_partner: true },
    party: party('mossbun'),
  });
  await runScript(h, 'lab_enter');
  assert.deepEqual(h.report.errors, []);
  assert.equal(h.state.flags.wren_took_emberkit, true);
  assert.equal(h.state.flags.has_journal, true);
  assert.equal(h.state.flags.wren_left_lab, true);
});

test('story 5: with a partner the north exit shows the end card', async () => {
  const flags = afterChoice('brookling');
  const h = createScriptHarness({ maps, mapId: 'fernhollow', flags, party: party('brookling'), player: { x: 16, y: 0 } });
  await runScript(h, 'north_exit');
  assert.deepEqual(h.report.errors, []);
  assert.equal(h.log.cards.length, 1);
  assert.equal(h.log.cards[0].title, 'Thanks for playing!');
  assert.match(h.log.cards[0].body, /Brookling/);
  assert.match(h.log.cards[0].body, /Mistfern Path/);
  assert.deepEqual([h.player.x, h.player.y], [16, 1]);
  // Tamsin's turn-back triggers are off, the exit triggers are on.
  const m = models.fernhollow;
  assert.equal(m.triggerAt(15, 2, flags), null);
  assert.equal(m.triggerAt(16, 0, flags).script, 'north_exit');
  assert.equal(m.triggerAt(16, 0, {}), null);
});

test('story 6: neighbours react to your partner; Wren issues a friendly challenge', async () => {
  const flags = afterChoice('emberkit');
  const say = async (mapId, script, extra = {}) => {
    const h = createScriptHarness({ maps, mapId, flags: { ...flags, ...extra }, party: party('emberkit') });
    await runScript(h, script);
    assert.deepEqual(h.report.errors, [], `${mapId}:${script}`);
    return h;
  };
  assert.match((await say('home', 'mom')).log.says[0].pages.join(' '), /Emberkit/);
  assert.match((await say('wren-house', 'nana')).log.says[0].pages.join(' '), /Brookling/);
  for (const [mapId, script] of [
    ['fernhollow', 'tamsin'],
    ['fernhollow', 'tilly'],
    ['fernhollow', 'hesketh'],
    ['lab', 'marrow'],
  ]) {
    assert.match((await say(mapId, script)).log.says[0].pages.join(' '), /Emberkit/, `${script} mentions the partner`);
  }
  const first = await say('fernhollow', 'wren_town');
  assert.equal(first.log.prompts[0].kind, 'choose');
  assert.equal(first.state.flags.wren_challenge, true);
  assert.match(first.log.says[0].pages.join(' '), /Brookling/, "Wren brags about her own partner");
  const later = await say('fernhollow', 'wren_town', { wren_challenge: true });
  assert.equal(later.log.prompts.length, 0);
  // Wren is in exactly one place at a time.
  const wrenLab = models.lab.npcs.find((n) => n.id === 'wren');
  const wrenTown = models.fernhollow.npcs.find((n) => n.id === 'wren');
  for (const f of [{}, { met_marrow: true }, flags]) assert.notEqual(isActive(wrenLab, f), isActive(wrenTown, f));
});

/* -------------------------------------------------- the validator itself */

/** A tiny, valid two-map world used to prove the validator catches mistakes. */
function world(mutate = () => {}) {
  const w = {
    yard: {
      id: 'yard',
      name: 'Yard',
      kind: 'outdoor',
      tiles: ['TTTTTTT', 'T.....T', 'T.##..T', 'T.#D..T', 'T.....T', 'TTTTTTT'],
      spawn: { x: 1, y: 1, facing: 'down' },
      objects: [{ type: 'building', id: 'hut', variant: 'house', x: 2, y: 2, w: 2, h: 2, door: { x: 3, y: 3 } }],
      npcs: [],
      warps: [{ x: 3, y: 3, to: 'hut', tx: 1, ty: 1, facing: 'up' }],
      triggers: [],
      scripts: {},
    },
    hut: {
      id: 'hut',
      name: 'Hut',
      kind: 'indoor',
      tiles: ['WWW', 'WoW', 'WEW'],
      spawn: { x: 1, y: 1, facing: 'up' },
      objects: [],
      npcs: [],
      warps: [{ x: 1, y: 2, to: 'yard', tx: 3, ty: 4, facing: 'down' }],
      triggers: [],
      scripts: {},
    },
  };
  mutate(w);
  return w;
}
const check = (w, flags = new Set()) =>
  validateMaps(w, { setFlags: flags, scenarios: [{ name: 'new game', flags: {} }] }).errors.join('\n');

test('validator: the fixture world is clean', () => {
  assert.equal(check(world()), '');
});

test('validator: catches structural mistakes', () => {
  assert.match(check(world((w) => (w.yard.tiles[2] = 'T.##.T'))), /not rectangular/);
  assert.match(check(world((w) => (w.yard.tiles[1] = 'T..?..T'))), /unknown tile char "\?"/);
  assert.match(check(world((w) => (w.yard.heights = ['0000000', '00a0000', '0000000', '0000000', '0000000', '0000000']))), /non-digits/);
  assert.match(check(world((w) => (w.yard.spawn = { x: 0, y: 0 }))), /spawn.*not walkable/);
  assert.match(check(world((w) => w.yard.objects.push({ type: 'sign', id: 's', x: 9, y: 1, text: 'x' }))), /out of bounds/);
  assert.match(
    check(world((w) => w.yard.objects.push({ type: 'well', id: 'well', x: 4, y: 1 }, { type: 'lamp', id: 'lamp', x: 5, y: 2 }))),
    /overlaps/,
  );
});

test('validator: catches broken doors and warps', () => {
  assert.match(check(world((w) => (w.yard.objects[0].door = { x: 3, y: 2 }))), /bottom row/);
  assert.match(check(world((w) => (w.yard.warps[0].to = 'nowhere'))), /does not exist/);
  assert.match(check(world((w) => (w.hut.warps[0].tx = 4))), /directly south of this door/);
  assert.match(check(world((w) => (w.yard.warps[0].ty = 2))), /lands on another warp|exit mat/);
});

test('validator: catches bad NPCs, scripts and flags', () => {
  const npc = { id: 'n', name: 'N', x: 0, y: 1, look: { hairStyle: 'short', build: 'adult' }, text: 'hi' };
  assert.match(check(world((w) => w.yard.npcs.push(npc))), /blocked tile/);
  assert.match(check(world((w) => w.yard.npcs.push({ ...npc, x: 5, y: 1, script: 'missing', text: undefined }))), /script "missing" does not exist/);
  assert.match(check(world((w) => w.yard.npcs.push({ ...npc, x: 5, y: 1, showIf: 'never_set' }))), /flag "never_set" is never set/);
  assert.equal(check(world((w) => w.yard.npcs.push({ ...npc, x: 5, y: 1, showIf: '!seen' })), new Set(['seen'])), '');
});

test('validator: catches unreachable doors, soft-locks, bad stairs and open exits', () => {
  // Enclose the door's front tile in a pocket the spawn cannot reach.
  assert.match(
    check(world((w) => (w.yard.tiles = ['TTTTTTT', 'T.....T', 'T.##TTT', 'T.#DT.T', 'TTT.T.T', 'TTTTTTT']))),
    /door .* is unreachable/,
  );
  // A one-way ledge into a pocket with no way back.
  assert.match(
    check(world((w) => (w.yard.tiles = ['TTTTTTT', 'T.....T', 'T.##..T', 'T.#D..T', 'T....vT', 'TTTTT.T', 'TTTTTTT']))),
    /stuck .*5,5/,
  );
  // Stairs with nothing above them.
  assert.match(check(world((w) => (w.yard.tiles[1] = 'T..S..T'))), /no walkable neighbour at level 1/);
  // An open edge before the partner.
  assert.match(check(world((w) => (w.yard.tiles[0] = 'TTTT.TT'))), /reachable before the partner/);
});

test('validator: dry-run reports throwing scripts and unknown ids', async () => {
  const w = world((x) => {
    x.yard.onEnter = 'boom';
    x.yard.scripts = {
      boom: async () => {
        throw new Error('kaboom');
      },
      ghost: async (api) => {
        api.npc('nobody');
        api.cry('not-a-species');
      },
    };
    x.yard.objects.push({ type: 'sign', id: 'sign', x: 5, y: 1, script: 'ghost' });
  });
  const dry = await dryRunScripts(w);
  const all = dry.errors.join('\n');
  assert.match(all, /kaboom/);
  assert.match(all, /no such npc/);
  assert.match(all, /unknown species/);
});

test('validator: template setFlag names expand with species ids', () => {
  const names = flagsFromSource('api.setFlag(`chose_${id}`); api.setFlag("plain"); api.setFlag(\'x_y\')');
  for (const s of STARTERS) assert.ok(names.has(`chose_${s}`));
  assert.ok(names.has('plain') && names.has('x_y'));
});
