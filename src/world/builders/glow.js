/**
 * Night glow: all registered halos (lamps, windows, fireplaces, screens) in a
 * single instanced additive billboard draw call, plus a pool of at most two
 * real PointLights that follow the light sources nearest the player and
 * cross-fade when they switch.
 */
import * as THREE from 'three';
import { createHaloMaterial } from './shaders.js';
import { hash2 } from '../../render/materials.js';

/** Maximum real point lights per map. */
export const MAX_POINT_LIGHTS = 2;
/** Candela for a power-1 light source. */
const LIGHT_INTENSITY = 5.5;
const LIGHT_DISTANCE = 6;

/**
 * Shared instanced billboard geometry with halo attributes.
 * @param {number} count
 */
export function createBillboardGeometry(count) {
  const plane = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = plane.index;
  geo.setAttribute('position', plane.getAttribute('position'));
  geo.setAttribute('uv', plane.getAttribute('uv'));
  geo.instanceCount = count;
  const attrs = {
    offset: new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3),
    size: new THREE.InstancedBufferAttribute(new Float32Array(count), 1),
    color: new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3),
    phase: new THREE.InstancedBufferAttribute(new Float32Array(count), 1),
    mode: new THREE.InstancedBufferAttribute(new Float32Array(count), 1),
  };
  geo.setAttribute('aOffset', attrs.offset);
  geo.setAttribute('aSize', attrs.size);
  geo.setAttribute('aColor', attrs.color);
  geo.setAttribute('aPhase', attrs.phase);
  geo.setAttribute('aMode', attrs.mode);
  return { geo, attrs };
}

/**
 * @param {import('./context.js').BuildContext} ctx
 */
export function buildGlow(ctx) {
  buildHalos(ctx);
  buildLightPool(ctx);
}

/** @param {import('./context.js').BuildContext} ctx */
function buildHalos(ctx) {
  const halos = ctx.halos;
  if (halos.length === 0) return;
  const { geo, attrs } = createBillboardGeometry(halos.length);
  halos.forEach((h, i) => {
    attrs.offset.setXYZ(i, h.pos.x, h.pos.y, h.pos.z);
    attrs.size.setX(i, h.size);
    attrs.color.setXYZ(i, h.color.r, h.color.g, h.color.b);
    attrs.phase.setX(i, hash2(i, Math.round(h.pos.x * 10), Math.round(h.pos.z * 10)));
    attrs.mode.setX(i, h.mode === 'always' ? 1 : 0);
  });
  ctx.ownGeometry(geo);
  const mesh = new THREE.Mesh(geo, ctx.kit.own(createHaloMaterial(ctx.uniforms)));
  mesh.name = 'halos';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  ctx.root.add(mesh);
  const anyAlways = halos.some((h) => h.mode === 'always');

  ctx.onFlags((flags) => {
    halos.forEach((h, i) => {
      const on = !h.owner || ctx.model.isActive(h.owner, flags);
      attrs.size.setX(i, on ? h.size : 0);
    });
    attrs.size.needsUpdate = true;
  });
  ctx.onUpdate((dt, t, env) => {
    mesh.visible = anyAlways || env.night > 0.02;
  });
}

/** @param {import('./context.js').BuildContext} ctx */
function buildLightPool(ctx) {
  const sources = ctx.lights;
  if (sources.length === 0) return;
  const count = Math.min(MAX_POINT_LIGHTS, sources.length);
  /** @type {Array<{light: THREE.PointLight, src: any, level: number}>} */
  const pool = [];
  for (let i = 0; i < count; i++) {
    const light = new THREE.PointLight(0xffc56b, 0, LIGHT_DISTANCE, 1.6);
    light.name = `pool-light-${i}`;
    light.castShadow = false;
    ctx.root.add(light);
    pool.push({ light, src: null, level: 0 });
  }
  const ref = new THREE.Vector3();
  let flags = ctx.flags;
  ctx.onFlags((f) => {
    flags = f;
  });

  ctx.onUpdate((dt, t, env) => {
    const at = env.playerPos ?? env.focus;
    if (at && Number.isFinite(at.x) && Number.isFinite(at.z)) ref.set(at.x, at.y ?? 0, at.z);
    // Rank sources by distance (only ones that are on right now).
    const ranked = [];
    for (const s of sources) {
      if (s.owner && !ctx.model.isActive(s.owner, flags)) continue;
      const strength = s.mode === 'always' ? 1 : env.night;
      if (strength < 0.02) continue;
      ranked.push({ s, d: s.pos.distanceTo(ref), strength });
    }
    ranked.sort((a, b) => a.d - b.d);
    const wanted = ranked.slice(0, count);
    const wantedSet = new Set(wanted.map((w) => w.s));
    const taken = new Set(pool.filter((p) => p.src && wantedSet.has(p.src)).map((p) => p.src));
    for (const slot of pool) {
      const keep = slot.src && wantedSet.has(slot.src);
      if (!keep) {
        slot.level = Math.max(0, slot.level - dt * 4);
        if (slot.level === 0) {
          const next = wanted.find((w) => !taken.has(w.s));
          slot.src = next ? next.s : null;
          if (next) taken.add(next.s);
        }
      } else {
        slot.level = Math.min(1, slot.level + dt * 3);
      }
      const entry = slot.src ? ranked.find((r) => r.s === slot.src) : null;
      // Lights stay in the scene (intensity 0) so the light count — and every
      // shader program — never changes while playing.
      if (!entry) {
        slot.light.intensity = 0;
        continue;
      }
      const fade = 1 - Math.min(1, Math.max(0, (entry.d - 6) / 5));
      const flicker = 0.94 + Math.sin(t * 7.3 + entry.s.pos.x) * 0.04 + Math.sin(t * 13.1 + entry.s.pos.z) * 0.02;
      slot.light.position.copy(entry.s.pos);
      slot.light.color.copy(entry.s.color);
      slot.light.intensity = LIGHT_INTENSITY * entry.s.power * entry.strength * slot.level * fade * flicker;
    }
  });
}
