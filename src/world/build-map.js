/**
 * buildMap: turns a MapModel into a renderable diorama (MapView).
 * Orchestrates the builders in src/world/builders/ — terrain, water, nature,
 * grass, fences, buildings/props/furniture, interiors, glow and ambient life —
 * then merges static geometry into a handful of draw calls.
 */
import { createContext, MAT } from './builders/context.js';
import { buildTerrain } from './builders/terrain.js';
import { buildWater } from './builders/water.js';
import { buildNature } from './builders/nature.js';
import { buildGrass } from './builders/grass.js';
import { buildFences } from './builders/fences.js';
import { buildObjects } from './builders/objects.js';
import { buildInterior } from './builders/interior.js';
import { buildGlow } from './builders/glow.js';
import { buildAmbient } from './builders/ambient.js';
import { TONES } from '../render/palette.js';
import { color } from '../render/materials.js';

/**
 * @typedef {object} MapView
 * @property {import('three').Group} group add to the scene
 * @property {(dt: number, elapsed?: number, env?: { nightFactor?: number, focus?: {x:number,y:number,z:number}, playerPos?: {x:number,y:number,z:number} }) => void} update
 * @property {(flags: Record<string, any>) => void} applyFlags re-evaluate showIf / hideIf / emptyIf
 * @property {(x: number, y: number) => void} rustleGrass tall-grass rustle at a tile
 * @property {() => void} dispose free per-map GPU resources
 */

/** Wrap time so shader trig keeps its precision in long sessions. */
const TIME_WRAP = 3600;

/** @param {unknown} v */
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Build the 3D view of a map.
 * @param {import('./map-utils.js').MapModel} model
 * @param {{ flags?: Record<string, any>, createWildlingModel?: (species: string) => any }} [opts]
 * @returns {MapView}
 */
export function buildMap(model, { flags = {}, createWildlingModel } = {}) {
  if (!model || typeof model.typeAt !== 'function') throw new Error('buildMap needs a MapModel');
  const ctx = createContext(model, { flags, createWildlingModel });

  /** Run one builder; a failure logs and leaves the rest of the map intact. */
  const step = (name, fn) => {
    try {
      return fn(ctx);
    } catch (err) {
      console.error(`[world] ${name} failed for map "${model.id}"`, err);
      return null;
    }
  };

  step('terrain', buildTerrain);
  if (!ctx.outdoor) step('interior', buildInterior);
  step('water', buildWater);
  step('nature', buildNature);
  const grass = step('grass', buildGrass);
  step('fences', buildFences);
  step('objects', buildObjects);
  step('glow', buildGlow);
  step('ambient', buildAmbient);
  step('finalize', (c) => c.finalize());

  const dayWindow = color(TONES.skyWindowDay);
  const nightWindow = color(TONES.skyWindowNight);
  const env = { night: 0, focus: null, playerPos: null };
  let time = 0;
  let disposed = false;
  let currentFlags = flags ?? {};

  /** @param {Record<string, any>} f */
  function applyFlags(f) {
    if (disposed) return;
    currentFlags = f && typeof f === 'object' ? f : {};
    ctx.flags = currentFlags;
    for (const fn of ctx.flagHandlers) {
      try {
        fn(currentFlags);
      } catch (err) {
        console.error('[world] applyFlags handler failed', err);
      }
    }
  }
  applyFlags(currentFlags);

  return {
    group: ctx.root,

    update(dt, elapsed, opts) {
      if (disposed) return;
      const d = finite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
      time = finite(elapsed) ? /** @type {number} */ (elapsed) : time + d;
      const night = Math.min(1, Math.max(0, finite(opts?.nightFactor) ? /** @type {number} */ (opts?.nightFactor) : 0));
      env.night = night;
      env.focus = opts?.focus ?? null;
      env.playerPos = opts?.playerPos ?? null;
      const t = time % TIME_WRAP;
      ctx.uniforms.uTime.value = t;
      ctx.uniforms.uNight.value = night;
      ctx.uniforms.uCloud.value = ctx.outdoor ? 1 - night : 0;
      const flicker = 1 + Math.sin(t * 7.1) * 0.03 + Math.sin(t * 12.7) * 0.02;
      ctx.mats.glow.emissiveIntensity = (ctx.outdoor ? night * 1.7 : 0.55 + night * 0.7) * flicker;
      ctx.mats.glass.emissiveIntensity = ctx.outdoor ? night * 0.38 : 0;
      ctx.mats.sky.color.copy(dayWindow).lerp(nightWindow, night);
      for (const fn of ctx.animators) fn(d, t, env);
    },

    applyFlags,

    rustleGrass(x, y) {
      if (disposed || !grass) return;
      grass.rustle(Math.round(x), Math.round(y));
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      ctx.dispose();
    },
  };
}

export { MAT };
