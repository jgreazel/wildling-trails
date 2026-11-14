/**
 * Boot + wiring. Owns no game logic: it connects renderer, day/night, camera,
 * input, audio, UI components and the world session, then runs the frame loop.
 */
import { createRenderer } from './render/renderer.js';
import { createDayNight } from './render/daynight.js';
import { createCameraRig } from './render/camera-rig.js';
import { createLoop } from './core/loop.js';
import { input } from './core/input.js';
import { createGamepadPoller } from './core/gamepad.js';
import {
  state,
  prefs,
  loadState,
  resetState,
  saveState,
  hasSave,
  loadPrefs,
  savePrefs,
} from './core/state.js';
import { audio } from './audio/audio.js';
import { createWorldSession } from './systems/world-session.js';
import { WILDLINGS } from './data/wildlings.js';
import { PREVIEW_MAP } from './config.js';
import './ui/register.js';

/** Clock override cycle used by the pause menu and the T key. */
const CLOCK_STEPS = [null, 'morning', 'day', 'evening', 'night'];
const CLOCK_LABEL = { null: 'Live', morning: 'Morning', day: 'Day', evening: 'Evening', night: 'Night' };

/** @param {string} message */
function showFatal(message) {
  const el = document.querySelector('.fatal');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

async function boot() {
  const $ = (sel) => document.querySelector(sel);
  const ui = {
    dialog: $('dialog-box'),
    banner: $('location-banner'),
    fade: $('fade-overlay'),
    card: $('story-card'),
    menu: $('pause-menu'),
    title: $('title-screen'),
    touch: $('touch-pad'),
  };

  input.init();
  const gamepads = createGamepadPoller(input);
  window.addEventListener('gamepadconnected', () => ui.title.setAttribute('pad', ''));
  loadPrefs();
  audio.setMuted(!!prefs.muted);

  /** @type {ReturnType<typeof createRenderer>} */
  let gfx;
  try {
    gfx = createRenderer(/** @type {HTMLCanvasElement} */ ($('#game')));
  } catch (err) {
    console.error(err);
    showFatal('Wildling Trails needs WebGL, which this browser could not start.');
    return;
  }

  const { scene, camera, resize, render } = gfx;
  const dayNight = createDayNight({ scene, renderer: gfx.renderer });
  const cameraRig = createCameraRig(camera);
  const session = createWorldSession({ scene, cameraRig, dayNight, ui, audio, input });

  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  resize();

  document.addEventListener('ui-sfx', (e) => audio.sfx(/** @type {CustomEvent} */ (e).detail?.id));

  /** @type {'title'|'play'} */
  let mode = 'title';
  let clockIndex = 0;

  function cycleClock() {
    clockIndex = (clockIndex + 1) % CLOCK_STEPS.length;
    const phase = CLOCK_STEPS[clockIndex];
    dayNight.setOverride(phase);
    const label = CLOCK_LABEL[String(phase)];
    ui.menu.setClock?.(label);
    return label;
  }

  function journalData() {
    return {
      seen: [...state.seen],
      all: Object.values(WILDLINGS).map(({ id, name, element, blurb }) => ({ id, name, element, blurb })),
    };
  }

  function openMenu() {
    session.setPaused(true);
    ui.menu.setParty(state.party.map((p) => ({ ...WILDLINGS[p.species], ...p })));
    ui.menu.setJournal(journalData());
    ui.menu.setSound(!audio.muted);
    ui.menu.setClock(CLOCK_LABEL[String(CLOCK_STEPS[clockIndex])]);
    ui.menu.open();
    audio.sfx('menu');
  }

  ui.menu.addEventListener('menu-action', (e) => {
    const action = /** @type {CustomEvent} */ (e).detail?.action;
    if (action === 'save') {
      const ok = saveState();
      audio.sfx(ok ? 'save' : 'bump');
      ui.banner.show(ok ? 'Progress saved' : 'Saving is unavailable here');
    } else if (action === 'sound') {
      audio.setMuted(!audio.muted);
      prefs.muted = audio.muted;
      savePrefs();
      ui.menu.setSound(!audio.muted);
    } else if (action === 'clock') {
      cycleClock();
    } else if (action === 'close') {
      ui.menu.close();
    }
  });
  ui.menu.addEventListener('menu-close', () => session.setPaused(false));

  input.onPress('start', () => {
    if (mode !== 'play' || session.busy || ui.menu.isOpen) return false;
    openMenu();
    return true;
  });

  input.onPress('time', () => {
    if (mode !== 'play' || ui.menu.isOpen) return false;
    ui.banner.show(`Clock: ${cycleClock()}`);
    return true;
  });

  ui.title.addEventListener('title-wake', async () => {
    await audio.unlock();
    audio.playMusic('title');
  });

  ui.title.addEventListener('title-start', async (e) => {
    const wantsContinue = /** @type {CustomEvent} */ (e).detail?.mode === 'continue';
    await audio.unlock();
    if (!(wantsContinue && loadState())) resetState();
    mode = 'play';
    ui.title.hide();
    try {
      await session.start();
    } catch (err) {
      console.error(err);
      showFatal('Something went wrong loading the village. Please reload the page.');
    }
  });

  // Keep track of play time for the save file.
  const loop = createLoop((dt, elapsed) => {
    gamepads.poll();
    if (mode === 'play' && !ui.menu.isOpen) state.playTime += dt;
    session.update(dt, elapsed);
    cameraRig.update(dt);
    dayNight.update(dt, cameraRig.focus);
    render();
    input.endFrame();
  });
  loop.start();

  try {
    await session.preview(PREVIEW_MAP);
  } catch (err) {
    console.error(err);
  }
  ui.title.toggleAttribute('has-save', hasSave());
  ui.title.removeAttribute('loading');

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) input.clear();
  });

  // Debug handle for manual testing in devtools.
  Object.defineProperty(window, '__game', {
    value: { session, state, dayNight, cameraRig, input, gamepads, audio, scene, camera, renderer: gfx.renderer },
    configurable: true,
  });
}

boot();
