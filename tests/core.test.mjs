import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapModel, isActive } from '../src/world/map-utils.js';
import { state, resetState, setFlag, getFlag, addPartner, markSeen } from '../src/core/state.js';
import { MAP_IDS, getMapDef } from '../src/world/map-registry.js';

const fixture = {
  id: 'fixture',
  name: 'Fixture',
  kind: 'outdoor',
  tiles: [
    'TTTTTTTT',
    'T......T',
    'T..##..T',
    'T..#D..T',
    'T.~~=~.T',
    'T.vvvv.T',
    'T..S...T',
    'T......T',
    'TTTTTTTT',
  ],
  heights: [
    '22222222',
    '22222222',
    '22222222',
    '22222222',
    '22222222',
    '22222222',
    '11111111',
    '11111111',
    '11111111',
  ],
  objects: [
    { type: 'building', id: 'hut', x: 3, y: 2, w: 2, h: 2, door: { x: 4, y: 3 } },
    { type: 'sign', id: 'sign', x: 6, y: 1, text: 'Hi', hideIf: 'sign_gone' },
    { type: 'rug', id: 'rug', x: 1, y: 1 },
  ],
  spawn: { x: 1, y: 1, facing: 'down' },
};

test('basic queries', () => {
  const m = createMapModel(fixture);
  assert.equal(m.width, 8);
  assert.equal(m.height, 9);
  assert.equal(m.typeAt(0, 0).tree, true);
  assert.equal(m.typeAt(-1, 0).void, true);
  assert.equal(m.levelAt(1, 1), 2);
  assert.equal(m.surfaceY(1, 1), 1);
  assert.equal(m.objects.find((o) => o.id === 'rug').solid, false);
  assert.equal(m.activeObjectAt(3, 2).id, 'hut');
});

test('building footprint is solid except its door', () => {
  const m = createMapModel(fixture);
  assert.equal(m.isWalkableStatic(3, 2), false);
  assert.equal(m.isWalkableStatic(4, 3), true);
  assert.equal(m.doorBuildingAt(4, 3).id, 'hut');
  assert.equal(m.canStep(4, 4, 'up').ok, true); // bridge → door
});

test('water blocks, bridges do not', () => {
  const m = createMapModel(fixture);
  assert.equal(m.canStep(2, 3, 'down').reason, 'water');
  assert.equal(m.canStep(4, 3, 'down').ok, true);
});

test('ledges hop one way', () => {
  const m = createMapModel(fixture);
  // bridge (4,4) → ledge (4,5) → lands on (4,6)
  const ok = m.canStep(4, 4, 'down');
  assert.deepEqual([ok.ok, ok.hop, ok.x, ok.y], [true, true, 4, 6]);
  const back = m.canStep(4, 6, 'up');
  assert.equal(back.ok, false);
});

test('levels need stairs', () => {
  const m = createMapModel(fixture);
  // (6,5) level 2 grass → (6,6) level 1 grass: cliff
  assert.equal(m.canStep(6, 5, 'down').reason, 'cliff');
  // stairs at (3,6) level 1 connects to (3,5)? (3,5) is a ledge, so use a custom map
  const s = createMapModel({
    id: 's',
    tiles: ['...', '.S.', '...'],
    heights: ['111', '000', '000'],
  });
  assert.equal(s.canStep(1, 2, 'up').ok, true); // ground → stairs (same level)
  assert.equal(s.canStep(1, 1, 'up').ok, true); // stairs → upper
  assert.equal(s.canStep(1, 0, 'down').ok, true); // upper → stairs
  assert.equal(s.canStep(0, 0, 'down').reason, 'cliff'); // upper → ground, no stairs
  assert.equal(s.surfaceY(1, 1), 0.25);
});

test('flag gating', () => {
  const m = createMapModel(fixture);
  assert.equal(m.isWalkableStatic(6, 1, {}), false);
  assert.equal(m.isWalkableStatic(6, 1, { sign_gone: true }), true);
  assert.equal(isActive({ showIf: '!a' }, {}), true);
  assert.equal(isActive({ showIf: '!a' }, { a: true }), false);
  assert.equal(isActive({ showIf: ['a', 'b'] }, { a: true }), false);
  assert.equal(isActive({ hideIf: ['a', 'b'] }, { b: true }), false);
});

test('state helpers', () => {
  resetState();
  setFlag('x');
  assert.equal(getFlag('x'), true);
  assert.equal(getFlag('!x'), false);
  setFlag('x', false);
  assert.equal(getFlag('x'), false);
  addPartner('emberkit');
  assert.equal(state.party[0].name, 'Emberkit');
  assert.ok(state.seen.includes('emberkit'));
  markSeen('nope');
  assert.equal(state.seen.length, 1);
  assert.equal(addPartner('nope'), null);
});

test('every registered map builds a model', () => {
  for (const id of MAP_IDS) {
    const m = createMapModel(getMapDef(id));
    assert.equal(m.id, id);
  }
});
