import test from 'node:test';
import assert from 'node:assert/strict';
import { createInput, ACTIONS } from '../src/core/input.js';
import { createGamepadPoller, stickDirection, PAD_BUTTONS } from '../src/core/gamepad.js';

/** A fake standard-mapping pad the test mutates between polls. */
function fakePad(index = 0) {
  return {
    index,
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  };
}

function setup() {
  const input = createInput();
  /** @type {any[]} */
  const pads = [fakePad()];
  const poller = createGamepadPoller(input, { getGamepads: () => pads });
  const press = (i, on = true) => {
    pads[0].buttons[i] = { pressed: on, value: on ? 1 : 0 };
  };
  return { input, pads, poller, press };
}

test('every pad binding maps to a known action', () => {
  for (const [i, action] of Object.entries(PAD_BUTTONS)) assert.ok(ACTIONS.includes(action), `b${i} → ${action}`);
});

test('A press, hold and release: one press only', () => {
  const { input, poller, press } = setup();
  press(0);
  poller.poll();
  assert.equal(input.isDown('a'), true);
  assert.equal(input.pressed('a'), true);
  input.endFrame();
  poller.poll();
  assert.equal(input.pressed('a'), false, 'holding is not a new press');
  press(0, false);
  poller.poll();
  assert.equal(input.isDown('a'), false);
});

test('d-pad drives heldDirection; menu and view map to start/time', () => {
  const { input, poller, press } = setup();
  press(14);
  poller.poll();
  assert.equal(input.heldDirection(), 'left');
  press(9);
  press(8);
  poller.poll();
  assert.equal(input.pressed('start'), true);
  assert.equal(input.pressed('time'), true);
});

test('analog triggers count past half travel', () => {
  const { input, pads, poller } = setup();
  pads[0].buttons[7] = { pressed: false, value: 0.3 };
  poller.poll();
  assert.equal(input.isDown('run'), false);
  pads[0].buttons[7] = { pressed: false, value: 0.8 };
  poller.poll();
  assert.equal(input.isDown('run'), true);
});

test('left stick: dead zone, turning releases the old direction', () => {
  const { input, pads, poller } = setup();
  pads[0].axes = [0.2, -0.3, 0, 0];
  poller.poll();
  assert.equal(input.heldDirection(), null);
  pads[0].axes = [0, -0.9, 0, 0];
  poller.poll();
  assert.equal(input.heldDirection(), 'up');
  pads[0].axes = [0.9, 0, 0, 0];
  poller.poll();
  assert.equal(input.heldDirection(), 'right');
  assert.equal(input.isDown('up'), false);
  pads[0].axes = [0, 0, 0, 0];
  poller.poll();
  assert.equal(input.heldDirection(), null);
});

test('stickDirection hysteresis keeps a held direction on a near-diagonal', () => {
  assert.equal(stickDirection(0.6, 0.55, null), 'right');
  assert.equal(stickDirection(0.55, 0.6, 'right'), 'right', 'no flicker');
  assert.equal(stickDirection(0.4, 0, 'right'), 'right', 'above STICK_OFF holds');
  assert.equal(stickDirection(0.3, 0, 'right'), null);
  assert.equal(stickDirection(-0.6, 0, 'right'), 'left', 'flip sides');
  assert.equal(stickDirection(0.1, 0.9, 'right'), 'down', 'other axis takes over');
});

test('keyboard and pad share an action without releasing each other', () => {
  const { input, poller, press } = setup();
  input.setSource('a', 'KeyZ', true);
  press(0);
  poller.poll();
  press(0, false);
  poller.poll();
  assert.equal(input.isDown('a'), true, 'Z still holds a');
});

test('a disconnected pad releases everything it held', () => {
  const { input, pads, poller, press } = setup();
  press(12);
  press(2);
  poller.poll();
  assert.equal(poller.connected, 1);
  pads.length = 0;
  poller.poll();
  assert.equal(input.isDown('up'), false);
  assert.equal(input.isDown('run'), false);
  assert.equal(poller.connected, 0);
});

test('after input.clear(), a held direction resumes but a held A is not re-pressed', () => {
  const { input, poller, press } = setup();
  press(13);
  press(0);
  poller.poll();
  input.clear();
  poller.poll();
  assert.equal(input.heldDirection(), 'down', 'keeps walking');
  input.endFrame();
  assert.equal(input.isDown('a'), false);
  assert.equal(input.pressed('a'), false, 'no phantom confirm');
  press(0, false);
  poller.poll();
  press(0);
  poller.poll();
  assert.equal(input.pressed('a'), true, 'a fresh press works');
});

test('poll without navigator.getGamepads is a safe no-op', () => {
  const poller = createGamepadPoller(createInput());
  poller.poll();
  assert.equal(poller.connected, 0);
});
