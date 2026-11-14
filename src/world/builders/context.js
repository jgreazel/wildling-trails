/**
 * Build context shared by every builder of one map: materials, uniforms, the
 * static batch set, per-object owner groups (for showIf/hideIf), and registries
 * for animation, flag updates, glow halos, light sources and disposal.
 */
import * as THREE from 'three';
import { BatchSet } from './batch.js';
import { Painter } from './painter.js';
import { createGrid, SKIRT } from './grid.js';
import { createMaterialKit, getToonGradient, hashString } from '../../render/materials.js';
import { createWorldUniforms, patchWorld } from './shaders.js';
import { PALETTE, TONES } from '../../render/palette.js';
import { FACING_ANGLE, LEVEL_HEIGHT } from '../../config.js';

/** Material keys for batched geometry. */
export const MAT = Object.freeze({
  /** Vertex-coloured toon (terrain, walls, roofs, props). */
  solid: 'solid',
  /** Windows / lamp heads: glow warm at night. */
  glow: 'glow',
  /** Translucent greenhouse / cabinet glass. */
  glass: 'glass',
  /** Unlit, always bright (screens, embers, flames). */
  lit: 'lit',
  /** Interior windows showing the sky (day ↔ night). */
  sky: 'sky',
});

/** @param {any} o */
export function isConditional(o) {
  return !!o && (o.showIf != null || o.hideIf != null);
}

/**
 * @typedef {object} Halo
 * @property {THREE.Vector3} pos
 * @property {number} size
 * @property {THREE.Color} color
 * @property {'night'|'always'} mode
 * @property {any} [owner]
 */

/**
 * @typedef {object} LightSource
 * @property {THREE.Vector3} pos
 * @property {THREE.Color} color
 * @property {number} power
 * @property {'night'|'always'} mode
 * @property {any} [owner]
 */

/**
 * @typedef {object} UpdateEnv
 * @property {number} night 0..1
 * @property {THREE.Vector3|{x:number,y:number,z:number}|null} focus
 * @property {{x:number,y:number,z:number}|null} playerPos
 */

/** Unknown object types already warned about (one warning each per session). */
const warnedTypes = new Set();

/**
 * @param {import('../map-utils.js').MapModel} model
 * @param {{ flags?: Record<string, any>, createWildlingModel?: ((species: string) => any) | null }} [opts]
 */
export function createContext(model, opts = {}) {
  const outdoor = model.kind !== 'indoor';
  const kit = createMaterialKit();
  const uniforms = createWorldUniforms();
  const root = new THREE.Group();
  root.name = `map:${model.id}`;
  const seed = hashString(model.id ?? 'map');
  const gradientMap = getToonGradient();

  const mats = {
    solid: patchWorld(
      kit.own(new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap })),
      uniforms,
      { cloud: outdoor },
    ),
    glow: kit.own(
      new THREE.MeshToonMaterial({
        color: 0xffffff,
        vertexColors: true,
        gradientMap,
        emissive: new THREE.Color(PALETTE.lampGlow),
        emissiveIntensity: 0,
      }),
    ),
    glass: kit.own(
      new THREE.MeshPhongMaterial({
        color: new THREE.Color(TONES.glass),
        specular: 0xffffff,
        shininess: 70,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        side: THREE.DoubleSide,
        emissive: new THREE.Color('#ffcf8a'),
        emissiveIntensity: 0,
      }),
    ),
    lit: kit.own(new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true })),
    sky: kit.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(TONES.skyWindowDay) })),
  };

  /** @type {Record<string, import('./batch.js').MeshSpec>} */
  const specs = {
    [MAT.solid]: { material: mats.solid, castShadow: true, receiveShadow: true },
    [MAT.glow]: { material: mats.glow },
    [MAT.glass]: { material: mats.glass, renderOrder: 2 },
    [MAT.lit]: { material: mats.lit },
    [MAT.sky]: { material: mats.sky },
  };

  const staticSet = new BatchSet();
  const staticGroup = new THREE.Group();
  staticGroup.name = 'static';
  root.add(staticGroup);

  /** @type {Set<THREE.BufferGeometry>} */
  const geometries = new Set();
  /** @type {Array<(dt:number, t:number, env:UpdateEnv) => void>} */
  const animators = [];
  /** @type {Array<(flags: Record<string, any>) => void>} */
  const flagHandlers = [];
  /** @type {Array<() => void>} */
  const disposers = [];
  /** @type {Halo[]} */
  const halos = [];
  /** @type {LightSource[]} */
  const lights = [];
  /** @type {Array<{pos: THREE.Vector3, owner?: any}>} */
  const chimneys = [];
  /** @type {Map<any, {group: THREE.Group, set: BatchSet}>} */
  const owners = new Map();

  const ctx = {
    model,
    outdoor,
    seed,
    kit,
    uniforms,
    mats,
    specs,
    root,
    flags: opts.flags ?? {},
    createWildlingModel: typeof opts.createWildlingModel === 'function' ? opts.createWildlingModel : null,
    grid: createGrid(model, outdoor ? SKIRT : 0),
    staticSet,
    animators,
    flagHandlers,
    disposers,
    halos,
    lights,
    chimneys,

    /** @template {THREE.BufferGeometry} G @param {G} g @returns {G} */
    ownGeometry(g) {
      geometries.add(g);
      return g;
    },

    /** @param {(dt:number, t:number, env:UpdateEnv) => void} fn */
    onUpdate(fn) {
      animators.push(fn);
    },

    /** @param {(flags: Record<string, any>) => void} fn */
    onFlags(fn) {
      flagHandlers.push(fn);
    },

    /** @param {() => void} fn */
    onDispose(fn) {
      disposers.push(fn);
    },

    /**
     * Owner record for a conditional object (own group toggled by flags).
     * @param {any} o
     */
    owner(o) {
      if (!isConditional(o)) return null;
      let rec = owners.get(o);
      if (!rec) {
        const group = new THREE.Group();
        group.name = `object:${o.id ?? o.type}`;
        root.add(group);
        rec = { group, set: new BatchSet() };
        owners.set(o, rec);
        flagHandlers.push((flags) => {
          group.visible = model.isActive(o, flags);
        });
      }
      return rec;
    },

    /** Batch set an object's static geometry goes to. @param {any} [o] */
    setFor(o) {
      return ctx.owner(o)?.set ?? staticSet;
    },

    /** Scene group an object's dynamic parts go to. @param {any} [o] */
    groupFor(o) {
      return ctx.owner(o)?.group ?? root;
    },

    /** Is the owning object currently visible? @param {any} [o] */
    ownerActive(o) {
      return !o || !isConditional(o) || model.isActive(o, ctx.flags);
    },

    /**
     * Painter in world space for terrain-like builders.
     * @param {string} [key]
     */
    painter(key = MAT.solid) {
      return new Painter(staticSet, key);
    },

    /**
     * Highest level under an object's footprint.
     * @param {any} o
     */
    objectLevel(o) {
      let level = 0;
      for (let dy = 0; dy < (o.h ?? 1); dy++) {
        for (let dx = 0; dx < (o.w ?? 1); dx++) {
          if (model.inBounds(o.x + dx, o.y + dy)) level = Math.max(level, model.levelAt(o.x + dx, o.y + dy));
        }
      }
      return level;
    },

    /**
     * Facing rotation for an object (non-square footprints only flip 180°).
     * @param {any} o
     */
    facingAngle(o) {
      const a = FACING_ANGLE[o.facing];
      if (a === undefined) return 0;
      if ((o.w ?? 1) !== (o.h ?? 1) && (o.facing === 'left' || o.facing === 'right')) return 0;
      return a;
    },

    /**
     * Local frame of an object: origin at its footprint centre on the ground, rotated by facing.
     * @param {any} o
     * @param {{ y?: number, angle?: number }} [opts]
     */
    objectFrame(o, opts = {}) {
      const cx = o.x + ((o.w ?? 1) - 1) / 2;
      const cz = o.y + ((o.h ?? 1) - 1) / 2;
      const y = opts.y ?? ctx.objectLevel(o) * LEVEL_HEIGHT;
      const angle = opts.angle ?? ctx.facingAngle(o);
      return new THREE.Matrix4().compose(
        new THREE.Vector3(cx, y, cz),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle),
        new THREE.Vector3(1, 1, 1),
      );
    },

    /**
     * Painter for an object (routes to its owner set when conditional).
     * @param {any} o @param {THREE.Matrix4} frame @param {string} [key]
     */
    objectPainter(o, frame, key = MAT.solid) {
      return new Painter(ctx.setFor(o), key, frame);
    },

    /**
     * A separately transformable piece (waterwheel, flames…). Build into
     * `painter()` in the piece's local space, then call finish().
     * @param {any} o owner object (or null) @param {string} name
     */
    dynamic(o, name) {
      const set = new BatchSet();
      const group = new THREE.Group();
      group.name = name;
      ctx.groupFor(o).add(group);
      return {
        group,
        /** @param {string} [key] */
        painter: (key = MAT.solid) => new Painter(set, key),
        finish: () => set.build(specs, group, ctx.ownGeometry),
      };
    },

    /**
     * Register an additive glow halo.
     * @param {THREE.Vector3} pos @param {number} size @param {THREE.ColorRepresentation} color
     * @param {'night'|'always'} [mode] @param {any} [owner]
     */
    addHalo(pos, size, color, mode = 'night', owner = null) {
      halos.push({ pos: pos.clone(), size, color: new THREE.Color(color), mode, owner });
    },

    /**
     * Register a candidate for the small pool of real point lights.
     * @param {THREE.Vector3} pos @param {THREE.ColorRepresentation} color @param {number} power
     * @param {'night'|'always'} [mode] @param {any} [owner]
     */
    addLight(pos, color, power, mode = 'night', owner = null) {
      lights.push({ pos: pos.clone(), color: new THREE.Color(color), power, mode, owner });
    },

    /** @param {THREE.Vector3} pos @param {any} [owner] */
    addChimney(pos, owner = null) {
      chimneys.push({ pos: pos.clone(), owner });
    },

    /** Warn once per unknown object type. @param {string} type */
    warnUnknown(type) {
      const key = String(type);
      if (warnedTypes.has(key)) return;
      warnedTypes.add(key);
      console.warn(`[world] Unknown object type "${key}" — showing a placeholder crate.`);
    },

    /** Turn all batches into meshes (call once, after every builder ran). */
    finalize() {
      staticSet.build(specs, staticGroup, ctx.ownGeometry);
      for (const rec of owners.values()) rec.set.build(specs, rec.group, ctx.ownGeometry);
    },

    /** Free every geometry / material / texture made for this map. */
    dispose() {
      for (const fn of disposers) {
        try {
          fn();
        } catch (err) {
          console.error('[world] dispose step failed', err);
        }
      }
      disposers.length = 0;
      // Instanced meshes own GPU buffers for their per-instance matrices / colours.
      root.traverse((obj) => {
        if (/** @type {any} */ (obj).isInstancedMesh) /** @type {THREE.InstancedMesh} */ (obj).dispose();
      });
      for (const g of geometries) g.dispose();
      geometries.clear();
      kit.dispose();
      root.removeFromParent();
      root.clear();
    },
  };
  return ctx;
}

/** @typedef {ReturnType<typeof createContext>} BuildContext */
