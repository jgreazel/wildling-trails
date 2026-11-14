import test from 'node:test';
import assert from 'node:assert/strict';
import { createInput, input as singleton, ACTIONS, KEY_BINDINGS } from '../src/core/input.js';

/** Fresh input instance wired to a fresh EventTarget. */
function setup() {
  const target = new EventTarget();
  const input = createInput();
  input.init(target);
  return { target, input };
}

/**
 * Dispatch a keyboard-like Event (Node has no KeyboardEvent).
 * @param {EventTarget} target
 * @param {'keydown'|'keyup'} type
 * @param {Record<string, unknown>} props code/key/repeat/ctrlKey…
 */
function key(target, type, props) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { repeat: false, key: '', code: '', ...props });
  target.dispatchEvent(event);
  return event;
}
const down = (t, code, extra = {}) => key(t, 'keydown', { code, ...extra });
const up = (t, code, extra = {}) => key(t, 'keyup', { code, ...extra });

test('every binding maps to a known action', () => {
  for (const [code, action] of Object.entries(KEY_BINDINGS)) {
    assert.ok(ACTIONS.includes(action), `${code} → ${action}`);
  }
});

test('press, hold and release', () => {
  const { target, input } = setup();
  assert.equal(input.isDown('a'), false);
  down(target, 'KeyZ');
  assert.equal(input.isDown('a'), true);
  assert.equal(input.pressed('a'), true);
  assert.equal(input.pressed('a'), false, 'a press is reported once');
  assert.equal(input.isDown('a'), true, 'still held');
  up(target, 'KeyZ');
  assert.equal(input.isDown('a'), false);
});

test('two keys for one action: no early release, one press', () => {
  const { target, input } = setup();
  let presses = 0;
  input.onPress('up', () => {
    presses += 1;
  });
  down(target, 'KeyW');
  down(target, 'ArrowUp');
  assert.equal(presses, 1, 'second key on a held action is not a new press');
  up(target, 'ArrowUp');
  assert.equal(input.isDown('up'), true, 'W still holds up');
  assert.equal(input.heldDirection(), 'up');
  up(target, 'KeyW');
  assert.equal(input.isDown('up'), false);
  assert.equal(input.heldDirection(), null);
});

test('heldDirection is the most recent still-held direction', () => {
  const { target, input } = setup();
  assert.equal(input.heldDirection(), null);
  down(target, 'ArrowUp');
  assert.equal(input.heldDirection(), 'up');
  down(target, 'ArrowLeft');
  assert.equal(input.heldDirection(), 'left');
  down(target, 'ArrowRight');
  assert.equal(input.heldDirection(), 'right');
  up(target, 'ArrowRight');
  assert.equal(input.heldDirection(), 'left');
  up(target, 'ArrowUp');
  assert.equal(input.heldDirection(), 'left', 'releasing an older key keeps the newest');
  up(target, 'ArrowLeft');
  assert.equal(input.heldDirection(), null);
});

test('re-pressing a held direction with another key moves it to the top', () => {
  const { target, input } = setup();
  down(target, 'ArrowLeft');
  down(target, 'ArrowUp');
  assert.equal(input.heldDirection(), 'up');
  down(target, 'KeyA'); // left again, via WASD
  assert.equal(input.heldDirection(), 'left');
  up(target, 'KeyA');
  assert.equal(input.heldDirection(), 'left', 'ArrowLeft still holds left');
  up(target, 'ArrowLeft');
  assert.equal(input.heldDirection(), 'up');
});

test('auto-repeat never creates presses', () => {
  const { target, input } = setup();
  let presses = 0;
  input.onPress('a', () => {
    presses += 1;
  });
  down(target, 'Space');
  down(target, 'Space', { repeat: true });
  down(target, 'Space', { repeat: true });
  assert.equal(presses, 1);
  input.endFrame();
  assert.equal(input.pressed('a'), false);
  assert.equal(input.isDown('a'), true);
});

test('a repeat for an unseen key counts as held but not pressed', () => {
  const { target, input } = setup();
  let presses = 0;
  input.onPress('down', () => {
    presses += 1;
  });
  down(target, 'ArrowDown', { repeat: true });
  assert.equal(presses, 0);
  assert.equal(input.isDown('down'), true);
  assert.equal(input.heldDirection(), 'down');
  assert.equal(input.pressed('down'), false);
  up(target, 'ArrowDown');
  assert.equal(input.isDown('down'), false);
});

test('onPress listeners run newest first; true consumes', () => {
  const { target, input } = setup();
  /** @type {string[]} */
  const calls = [];
  input.onPress('a', () => {
    calls.push('old');
  });
  const offMid = input.onPress('a', () => {
    calls.push('mid');
    return true;
  });
  input.onPress('a', () => {
    calls.push('new');
    return false;
  });

  down(target, 'KeyZ');
  up(target, 'KeyZ');
  assert.deepEqual(calls, ['new', 'mid'], 'mid consumed, old never ran');
  assert.equal(input.pressed('a'), false, 'consumed presses are not buffered');

  offMid();
  offMid(); // idempotent
  calls.length = 0;
  down(target, 'KeyZ');
  assert.deepEqual(calls, ['new', 'old']);
  assert.equal(input.pressed('a'), true, 'unconsumed press reaches the poll buffer');
});

test('only a literal true consumes', () => {
  const { target, input } = setup();
  input.onPress('b', () => 1);
  input.onPress('b', () => 'yes');
  down(target, 'KeyX');
  assert.equal(input.pressed('b'), true);
});

test('a listener added during dispatch waits for the next press', () => {
  const { target, input } = setup();
  let lateCalls = 0;
  input.onPress('start', () => {
    input.onPress('start', () => {
      lateCalls += 1;
      return true;
    });
    return false;
  });
  down(target, 'Enter');
  assert.equal(lateCalls, 0);
  assert.equal(input.pressed('start'), true);
  up(target, 'Enter');
  down(target, 'Enter');
  assert.equal(lateCalls, 1);
  assert.equal(input.pressed('start'), false);
});

test('a listener removed by an earlier one is skipped', () => {
  const { target, input } = setup();
  let ran = false;
  const offOld = input.onPress('a', () => {
    ran = true;
  });
  input.onPress('a', () => {
    offOld();
  });
  down(target, 'KeyJ');
  assert.equal(ran, false);
});

test('a throwing listener is logged and does not block others', (t) => {
  const { target, input } = setup();
  const errors = t.mock.method(console, 'error', () => {});
  let reached = false;
  input.onPress('a', () => {
    reached = true;
  });
  input.onPress('a', () => {
    throw new Error('boom');
  });
  down(target, 'KeyZ');
  assert.equal(reached, true);
  assert.equal(errors.mock.callCount(), 1);
});

test('onPress rejects non-functions', () => {
  const input = createInput();
  assert.throws(() => input.onPress('a', /** @type {any} */ (null)), TypeError);
});

test('endFrame drops unconsumed presses', () => {
  const { target, input } = setup();
  down(target, 'KeyZ');
  down(target, 'KeyX');
  input.endFrame();
  assert.equal(input.pressed('a'), false);
  assert.equal(input.pressed('b'), false);
  assert.equal(input.isDown('a'), true, 'held state survives endFrame');
});

test('pressed() counts multiple presses within one frame', () => {
  const { target, input } = setup();
  down(target, 'KeyZ');
  up(target, 'KeyZ');
  down(target, 'KeyZ');
  up(target, 'KeyZ');
  assert.equal(input.pressed('a'), true);
  assert.equal(input.pressed('a'), true);
  assert.equal(input.pressed('a'), false);
});

test('setVirtual is its own source', () => {
  const { target, input } = setup();
  let presses = 0;
  input.onPress('left', () => {
    presses += 1;
  });
  input.setVirtual('left', true);
  input.setVirtual('left', true); // idempotent
  assert.equal(presses, 1);
  assert.equal(input.isDown('left'), true);
  assert.equal(input.heldDirection(), 'left');

  down(target, 'KeyA'); // keyboard joins in
  input.setVirtual('left', false);
  assert.equal(input.isDown('left'), true, 'keyboard still holds it');
  up(target, 'KeyA');
  assert.equal(input.isDown('left'), false);

  input.setVirtual('start', true);
  assert.equal(input.pressed('start'), true);
  input.setVirtual('start', false);
  assert.equal(input.isDown('start'), false);

  input.setVirtual(/** @type {any} */ ('jump'), true); // unknown action: ignored
  assert.equal(input.isDown(/** @type {any} */ ('jump')), false);
});

test('virtual direction stacking with the keyboard', () => {
  const { target, input } = setup();
  down(target, 'ArrowUp');
  input.setVirtual('right', true);
  assert.equal(input.heldDirection(), 'right');
  input.setVirtual('right', false);
  assert.equal(input.heldDirection(), 'up');
  up(target, 'ArrowUp');
});

test('clear() releases everything and empties the buffer', () => {
  const { target, input } = setup();
  down(target, 'ArrowUp');
  down(target, 'ShiftLeft');
  input.setVirtual('b', true);
  input.clear();
  for (const action of ACTIONS) assert.equal(input.isDown(action), false, action);
  assert.equal(input.heldDirection(), null);
  assert.equal(input.pressed('up'), false);
  assert.equal(input.pressed('b'), false);
  // keyup after clear is harmless; a fresh press works again
  up(target, 'ArrowUp');
  down(target, 'ArrowUp');
  assert.equal(input.pressed('up'), true);
});

test('window blur clears held keys', () => {
  const { target, input } = setup();
  down(target, 'KeyD');
  assert.equal(input.isDown('right'), true);
  target.dispatchEvent(new Event('blur'));
  assert.equal(input.isDown('right'), false);
  assert.equal(input.heldDirection(), null);
});

test('preventDefault for arrows, space, backspace and enter only', () => {
  const { target } = setup();
  for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace', 'Enter']) {
    assert.equal(down(target, code).defaultPrevented, true, code);
    up(target, code);
  }
  for (const code of ['KeyZ', 'KeyW', 'Escape', 'ShiftLeft', 'KeyT', 'KeyQ']) {
    assert.equal(down(target, code).defaultPrevented, false, code);
    up(target, code);
  }
});

test('typing in a text field is left alone', () => {
  // An EventTarget that looks like a focused <input type="text">.
  class FakeInput extends EventTarget {
    tagName = 'INPUT';
    type = 'text';
  }
  const field = new FakeInput();
  const input = createInput();
  input.init(field);
  const ev = down(field, 'Space');
  assert.equal(ev.defaultPrevented, false);
  assert.equal(input.isDown('a'), false);
  assert.equal(input.pressed('a'), false);

  class FakeCheckbox extends EventTarget {
    tagName = 'INPUT';
    type = 'checkbox';
  }
  const box = new FakeCheckbox();
  input.init(box);
  assert.equal(down(box, 'Space').defaultPrevented, true, 'non-text inputs still drive the game');
  assert.equal(input.isDown('a'), true);
});

test('browser shortcuts with ctrl/meta/alt are ignored', () => {
  const { target, input } = setup();
  const ev = down(target, 'KeyS', { ctrlKey: true });
  assert.equal(input.isDown('down'), false);
  assert.equal(ev.defaultPrevented, false);
  down(target, 'KeyW', { altKey: true });
  assert.equal(input.isDown('up'), false);
});

test('falls back to event.key when code is missing', () => {
  const { target, input } = setup();
  key(target, 'keydown', { key: 'ArrowLeft' });
  assert.equal(input.heldDirection(), 'left');
  key(target, 'keydown', { key: 'W' }); // shifted letter
  assert.equal(input.heldDirection(), 'up');
  key(target, 'keyup', { key: 'w' });
  assert.equal(input.heldDirection(), 'left');
  key(target, 'keyup', { key: 'ArrowLeft' });
  assert.equal(input.heldDirection(), null);
  const ev = key(target, 'keydown', { key: ' ' });
  assert.equal(ev.defaultPrevented, true);
  assert.equal(input.pressed('a'), true);
});

test('code wins over key (physical layout)', () => {
  const { target, input } = setup();
  // AZERTY: the key labelled "Z" sits where QWERTY has W.
  down(target, 'KeyW', { key: 'z' });
  assert.equal(input.isDown('up'), true);
  assert.equal(input.isDown('a'), false);
});

test('a lost keyup does not swallow the next real press', () => {
  const { target, input } = setup();
  let presses = 0;
  input.onPress('a', () => {
    presses += 1;
  });
  down(target, 'KeyZ');
  down(target, 'KeyZ'); // keyup never arrived, but this is a fresh (non-repeat) keydown
  assert.equal(presses, 2);
});

test('Meta keydown clears (macOS drops keyups while ⌘ is held)', () => {
  const { target, input } = setup();
  down(target, 'ArrowUp');
  key(target, 'keydown', { code: 'MetaLeft', key: 'Meta' });
  assert.equal(input.isDown('up'), false);
});

test('init is idempotent and re-targetable; dispose detaches', () => {
  const target = new EventTarget();
  const input = createInput();
  let presses = 0;
  input.onPress('a', () => {
    presses += 1;
  });
  input.init(target);
  input.init(target);
  down(target, 'KeyZ');
  assert.equal(presses, 1, 'listeners attached once');
  up(target, 'KeyZ');

  const other = new EventTarget();
  input.init(other);
  down(target, 'KeyZ');
  assert.equal(presses, 1, 'old target detached');
  down(other, 'KeyZ');
  assert.equal(presses, 2);

  input.dispose();
  up(other, 'KeyZ');
  down(other, 'KeyZ');
  assert.equal(presses, 2, 'disposed');
  assert.equal(input.isDown('a'), false);
});

test('singleton init without a window is a safe no-op', () => {
  assert.doesNotThrow(() => singleton.init());
  assert.doesNotThrow(() => singleton.init(/** @type {any} */ ({})));
  assert.equal(singleton.isDown('a'), false);
});

// ── UI modules import cleanly without a DOM ─────────────────────────────

test('every UI component module imports in Node', async () => {
  const reg = await import('../src/ui/register.js');
  assert.ok(Array.isArray(reg.UI_TAGS) && reg.UI_TAGS.length === 7);
  const modules = {
    'dialog-box': ['DialogBox', await import('../src/ui/dialog-box.js')],
    'location-banner': ['LocationBanner', await import('../src/ui/location-banner.js')],
    'fade-overlay': ['FadeOverlay', await import('../src/ui/fade-overlay.js')],
    'story-card': ['StoryCard', await import('../src/ui/story-card.js')],
    'title-screen': ['TitleScreen', await import('../src/ui/title-screen.js')],
    'pause-menu': ['PauseMenu', await import('../src/ui/pause-menu.js')],
    'touch-pad': ['TouchPad', await import('../src/ui/touch-pad.js')],
  };
  for (const tag of reg.UI_TAGS) {
    const [name, mod] = modules[tag];
    assert.equal(typeof mod[name], 'function', `${tag} exports ${name}`);
    for (const method of ['connectedCallback', 'disconnectedCallback']) {
      assert.equal(typeof mod[name].prototype[method], 'function', `${name}.${method}`);
    }
  }
  const { DialogBox } = modules['dialog-box'][1];
  for (const m of ['say', 'choose']) assert.equal(typeof DialogBox.prototype[m], 'function');
  const { PauseMenu } = modules['pause-menu'][1];
  for (const m of ['open', 'close', 'setParty', 'setJournal', 'setSound', 'setClock']) {
    assert.equal(typeof PauseMenu.prototype[m], 'function', m);
  }
  assert.deepEqual(modules['title-screen'][1].TitleScreen.observedAttributes, ['loading', 'has-save']);
});

test('shared helpers: pages, paragraphs, element colours', async () => {
  const { toPages, toParagraphs, elementColor } = await import('../src/ui/shared.js');
  assert.deepEqual(toPages('Hi'), ['Hi']);
  assert.deepEqual(toPages(['A', '', null, '  ', 'B']), ['A', 'B']);
  assert.deepEqual(toPages(undefined), []);
  assert.deepEqual(toParagraphs('One.\n\nTwo.'), ['One.', 'Two.']);
  assert.deepEqual(toParagraphs(['x', 'y']), ['x', 'y']);
  assert.equal(elementColor('Ember'), 'var(--el-ember, var(--el-default))');
  assert.equal(elementColor('<bad>;"'), 'var(--el-bad, var(--el-default))');
  assert.equal(elementColor(''), 'var(--el-default)');
});

test('dialog typewriter lingers after punctuation', async () => {
  const { revealCost } = await import('../src/ui/dialog-box.js');
  const text = 'Hi. Ok, go';
  assert.equal(revealCost(text, 0), 1);
  assert.ok(revealCost(text, 3) > 1, 'space after a full stop pauses');
  assert.ok(revealCost(text, 7) > 1, 'space after a comma pauses');
  assert.ok(revealCost(text, 3) > revealCost(text, 7), 'full stops pause longer');
  assert.equal(revealCost(text, 4), 1);
});

test('touch d-pad direction: dead zone, axis choice, hysteresis', async () => {
  const { padDirection } = await import('../src/ui/touch-pad.js');
  const r = 75;
  assert.equal(padDirection(2, 2, r, null), null, 'centre dead zone');
  assert.equal(padDirection(2, 2, r, 'left'), 'left', 'dead zone keeps the held direction');
  assert.equal(padDirection(0, -40, r), 'up');
  assert.equal(padDirection(0, 40, r), 'down');
  assert.equal(padDirection(-40, 5, r), 'left');
  assert.equal(padDirection(40, -5, r), 'right');
  // Near the diagonal, stay on the current axis…
  assert.equal(padDirection(30, -32, r, 'right'), 'right');
  assert.equal(padDirection(32, -30, r, 'up'), 'up');
  // …until the other axis clearly wins.
  assert.equal(padDirection(20, -40, r, 'right'), 'up');
  // Sliding across to the other side of the same axis flips immediately.
  assert.equal(padDirection(-40, 0, r, 'right'), 'left');
});
