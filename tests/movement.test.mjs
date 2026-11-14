import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapModel } from '../src/world/map-utils.js';
import { createCollider, tilesUnder } from '../src/systems/collision.js';
import { pointBehind } from '../src/systems/follower.js';
import { frontScore } from '../src/systems/interaction.js';
import { createInput, shapeStick, AXIS_DEAD_ZONE } from '../src/core/input.js';
import { yawToDir, FACING_ANGLE } from '../src/config.js';

const R = 0.3;

/** Small map: walls round the edge, a pillar, a cliff and stairs. */
function model() {
  return createMapModel({
    id: 'm',
    tiles: [
      'TTTTTTT', // 0
      'T.....T', // 1
      'T..T..T', // 2  pillar (3,2)
      'T.....T', // 3
      'T....ST', // 4  stairs (5,4) at level 0
      'T.....T', // 5
      'TTTTTTT', // 6
    ],
    heights: ['1111111', '1111111', '1111111', '1111111', '0000001', '0000001', '0000000'],
  });
}

test('collider: open ground moves freely; walls stop the body flush', () => {
  const c = createCollider({ model: model(), radius: R });
  const free = c.move(2, 1, 0.5, 0);
  assert.ok(Math.abs(free.x - 2.5) < 1e-9 && free.z === 1);
  const hit = c.move(4, 1, 2, 0);
  assert.ok(Math.abs(hit.x - (5.5 - R)) < 1e-4, `flush with the wall (${hit.x})`);
  assert.equal(hit.z, 1);
});

test('collider: diagonal pushes slide along walls and round a pillar', () => {
  const c = createCollider({ model: model(), radius: R });
  const slide = c.move(2, 1, 1, -1);
  assert.ok(Math.abs(slide.z - (0.5 + R)) < 1e-4, 'kept off the top wall');
  assert.ok(slide.x > 2.9, `slid along it (${slide.x})`);
  // Clipping the pillar's corner deflects instead of stopping dead.
  const round = c.move(2.2, 3, 1.6, 0);
  assert.ok(round.x > 3.5, `got past the pillar row (${round.x})`);
});

test('collider: cliffs block, stairs bridge one level', () => {
  const m = model();
  const c = createCollider({ model: m, radius: R });
  // (2,3) level 1 → (2,4) level 0 with no stairs: a cliff.
  const cliff = c.move(2, 3, 0, 1);
  assert.ok(cliff.z < 3.5, `cliff holds (${cliff.z})`);
  assert.equal(c.passable(2, 3, 2, 4), false);
  // (5,3) level 1 ↔ stairs (5,4) level 0 ↔ (5,5) level 0.
  assert.equal(c.passable(5, 3, 5, 4), true);
  assert.equal(c.passable(5, 4, 5, 5), true);
  const down = c.move(5, 3, 0, 1);
  assert.equal(Math.round(down.z), 4, 'onto the stairs');
});

test('collider: extra blockers (NPC tiles) are solid; the own tile never is', () => {
  const c = createCollider({ model: model(), radius: R, isBlocked: (x, y) => x === 2 && y === 1 });
  const res = c.move(2, 1, -0.4, 0);
  assert.ok(Math.abs(res.x - 1.6) < 1e-9, 'standing in a blocked tile does not trap you');
  const into = c.move(2, 3, 0, -2);
  assert.ok(into.z > 1.5, 'cannot walk into an NPC tile');
  assert.equal(c.fits(4, 3), true);
  assert.equal(c.fits(0.7, 3), false, 'overlapping the wall does not fit');
});

test('tilesUnder lists only tiles the circle really overlaps', () => {
  assert.deepEqual(tilesUnder(2, 2, R), [{ x: 2, y: 2 }]);
  const edge = tilesUnder(2.4, 2, R).map((t) => `${t.x},${t.y}`);
  assert.deepEqual(edge.sort(), ['2,2', '3,2']);
  const corner = tilesUnder(2.4, 2.4, R).map((t) => `${t.x},${t.y}`);
  assert.equal(corner.length, 4);
});

test('pointBehind walks back along a polyline', () => {
  const trail = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 2 },
    { x: 2, y: 1, z: 2 },
  ];
  assert.deepEqual(pointBehind(trail, 1), { x: 1, y: 0.5, z: 2, index: 1 });
  const round = pointBehind(trail, 3);
  assert.equal(round.x, 0);
  assert.equal(round.z, 1, 'continues round the corner, not straight across');
  assert.equal(pointBehind(trail, 10), null, 'null when the trail is too short');
});

test('frontScore: reach and the facing cone', () => {
  const p = { px: 0, pz: 0, yaw: FACING_ANGLE.down }; // facing +z
  assert.ok(frontScore(p, 0, 1) !== null, 'straight ahead');
  assert.ok(frontScore(p, 0.5, 1) !== null, 'a little to the side');
  assert.equal(frontScore(p, 0, -1), null, 'behind');
  assert.equal(frontScore(p, 1, 0), null, 'beside (outside the cone)');
  assert.equal(frontScore(p, 0, 3), null, 'out of reach');
  assert.ok(frontScore(p, 0, 1) < frontScore(p, 0.5, 1), 'straighter scores better');
});

test('yawToDir picks the nearest cardinal', () => {
  for (const [dir, yaw] of Object.entries(FACING_ANGLE)) assert.equal(yawToDir(yaw), dir);
  assert.equal(yawToDir(FACING_ANGLE.right + 0.3), 'right');
  assert.equal(yawToDir(Math.PI * 0.9), 'up');
});

test('shapeStick: radial dead zone, rescaled to full range', () => {
  assert.deepEqual(shapeStick(0.1, 0.1), { x: 0, y: 0, magnitude: 0 });
  const full = shapeStick(1, 0);
  assert.equal(full.magnitude, 1);
  const mid = shapeStick(0, (1 + AXIS_DEAD_ZONE) / 2);
  assert.ok(Math.abs(mid.magnitude - 0.5) < 1e-9);
  assert.ok(mid.y > 0 && mid.x === 0);
  assert.equal(shapeStick(2, 0).magnitude, 1, 'clamped');
});

test('moveVector: analog stick wins; keys give an 8-way unit vector', () => {
  const input = createInput();
  assert.deepEqual(input.moveVector(), { x: 0, y: 0, magnitude: 0, analog: false });
  input.setSource('right', 'KeyD', true);
  input.setSource('down', 'KeyS', true);
  const diag = input.moveVector();
  assert.ok(Math.abs(diag.x - Math.SQRT1_2) < 1e-9 && Math.abs(diag.y - Math.SQRT1_2) < 1e-9);
  assert.equal(diag.analog, false);
  input.setSource('left', 'KeyA', true);
  assert.ok(input.moveVector().x < 0, 'newest of two opposite keys wins');
  input.setAxis('pad0:stick', 0.6, 0);
  const stick = input.moveVector();
  assert.equal(stick.analog, true);
  assert.ok(stick.x > 0 && stick.x < 1 && stick.y === 0, 'partial tilt keeps its magnitude');
  input.setAxis('pad0:stick', 0.05, 0);
  assert.equal(input.moveVector().analog, false, 'a resting stick falls back to keys');
  input.setAxis('pad0:stick', 1, 0);
  input.clear();
  assert.equal(input.moveVector().magnitude, 0, 'clear() drops axes too');
});
