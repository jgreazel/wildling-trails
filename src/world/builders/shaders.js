/**
 * Shader customisations for the world: wind sway + rustle for grass and trees,
 * butterfly wing flaps, drifting cloud shadows, animated water and additive
 * glow billboards. Built-in materials are extended via onBeforeCompile so
 * lighting, shadows and fog keep working.
 */
import * as THREE from 'three';
import { TONES } from '../../render/palette.js';

/**
 * Uniforms shared by every material of one map (updated in MapView.update).
 * @returns {{ uTime: {value:number}, uNight: {value:number}, uCloud: {value:number} }}
 */
export function createWorldUniforms() {
  return { uTime: { value: 0 }, uNight: { value: 0 }, uCloud: { value: 0 } };
}

/** @typedef {ReturnType<typeof createWorldUniforms>} WorldUniforms */

/** Soft drifting blobs; requires `uTime`. */
const CLOUD_GLSL = /* glsl */ `
float wtCloud(vec2 p) {
  p += vec2(uTime * 0.35, uTime * 0.16);
  float n = sin(p.x * 0.21 + sin(p.y * 0.17) * 1.7) * sin(p.y * 0.19 + sin(p.x * 0.13) * 1.9);
  n += 0.5 * sin(p.x * 0.43 - p.y * 0.31 + 1.7);
  return smoothstep(0.55, 1.15, n);
}
`;

/** @param {number} v */
const f = (v) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

/**
 * @typedef {object} WorldPatch
 * @property {boolean} [cloud] darken diffuse under drifting cloud shadows
 * @property {{height:number, amp:number, rustle?:boolean}} [sway] wind sway (+ per-instance `aRustle` shake)
 * @property {boolean} [flap] butterfly wings (per-instance `aFlap` phase)
 */

/**
 * Inject world effects into a built-in material (toon / lambert / basic).
 * @template {THREE.Material} M
 * @param {M} material
 * @param {WorldUniforms} uniforms
 * @param {WorldPatch} [opts]
 * @returns {M}
 */
export function patchWorld(material, uniforms, opts = {}) {
  const cloud = !!opts.cloud;
  const sway = opts.sway ?? null;
  const flap = !!opts.flap;
  const key = `wt|c${+cloud}|s${sway ? `${sway.height}:${sway.amp}:${+!!sway.rustle}` : 0}|f${+flap}`;

  let vHead = 'uniform float uTime;\n';
  let vBody = '';
  let fHead = '';
  let fBody = '';

  if (sway) {
    if (sway.rustle) vHead += 'attribute float aRustle;\n';
    vBody += /* glsl */ `
      vec3 wtBase = vec3(0.0);
      #ifdef USE_INSTANCING
        wtBase = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      #else
        wtBase = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      #endif
      float wtH = clamp(position.y / ${f(sway.height)}, 0.0, 1.0);
      float wtH2 = wtH * wtH;
      float wtWind = sin(uTime * 1.55 + wtBase.x * 0.55 + wtBase.z * 0.35) * 0.65
                   + sin(uTime * 2.7 + wtBase.x * 1.3 - wtBase.z * 0.8) * 0.35;
      transformed.x += wtWind * ${f(sway.amp)} * wtH2;
      transformed.z += wtWind * ${f(sway.amp * 0.5)} * wtH2;
    `;
    if (sway.rustle) {
      vBody += /* glsl */ `
      transformed.x += sin(uTime * 41.0 + wtBase.z * 3.0) * 0.12 * aRustle * wtH;
      transformed.z += cos(uTime * 35.0 + wtBase.x * 2.0) * 0.08 * aRustle * wtH;
      transformed.y *= 1.0 - 0.16 * aRustle;
    `;
    }
  }

  if (flap) {
    vHead += 'attribute float aFlap;\n';
    vBody += /* glsl */ `
      float wtWing = sin(uTime * 17.0 + aFlap) * 0.85 + 0.35;
      transformed.y = position.y + abs(position.x) * sin(wtWing);
      transformed.x = position.x * cos(wtWing);
    `;
  }

  if (cloud) {
    vHead += 'varying vec2 vWtCloud;\n';
    vBody += /* glsl */ `
      vec4 wtWorld = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        wtWorld = instanceMatrix * wtWorld;
      #endif
      vWtCloud = (modelMatrix * wtWorld).xz;
    `;
    fHead += `uniform float uTime;\nuniform float uCloud;\nvarying vec2 vWtCloud;\n${CLOUD_GLSL}`;
    fBody += 'diffuseColor.rgb *= 1.0 - wtCloud(vWtCloud) * 0.26 * uCloud;\n';
  }

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uCloud = uniforms.uCloud;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vHead}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vBody}`);
    if (fBody) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${fHead}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${fBody}`);
    }
  };
  material.customProgramCacheKey = () => key;
  material.needsUpdate = true;
  return material;
}

/**
 * Animated water: gentle vertex ripples, glints, lighter foam along shores
 * (per-vertex `aShore` 0..1), cloud shadows and a moonlit sheen at night.
 * @param {WorldUniforms} uniforms
 * @returns {THREE.MeshLambertMaterial}
 */
export function createWaterMaterial(uniforms) {
  const m = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    opacity: 0.86,
  });
  const foam = { value: new THREE.Color(TONES.waterFoam) };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uNight = uniforms.uNight;
    shader.uniforms.uCloud = uniforms.uCloud;
    shader.uniforms.uFoam = foam;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform float uTime;
attribute float aShore;
varying float vWtShore;
varying vec3 vWtWorld;`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
vec3 wtW = (modelMatrix * vec4(transformed, 1.0)).xyz;
float wtWave = sin(wtW.x * 1.9 + uTime * 1.5) * 0.5 + sin(wtW.z * 1.6 - uTime * 1.2) * 0.5;
transformed.y += wtWave * 0.014 * (1.0 - aShore * 0.6);
vWtShore = aShore;
vWtWorld = wtW;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform float uTime;
uniform float uNight;
uniform float uCloud;
uniform vec3 uFoam;
varying float vWtShore;
varying vec3 vWtWorld;
${CLOUD_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
vec2 wtP = vWtWorld.xz;
float wtA = sin(wtP.x * 2.3 + wtP.y * 1.4 + uTime * 1.3);
float wtB = sin(wtP.y * 2.9 - wtP.x * 1.1 - uTime * 1.05);
float wtGlint = smoothstep(0.62, 0.95, wtA * wtB) * (1.0 - vWtShore);
diffuseColor.rgb += wtGlint * 0.12;
float wtEdge = vWtShore + 0.14 * sin(uTime * 1.7 + wtP.x * 3.7 + wtP.y * 2.9);
float wtFoam = smoothstep(0.58, 0.78, wtEdge);
diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, wtFoam * 0.85);
diffuseColor.a = mix(diffuseColor.a, 1.0, wtFoam * 0.9);
diffuseColor.rgb *= 1.0 - wtCloud(wtP) * 0.22 * uCloud;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(0.16, 0.2, 0.32) * wtGlint * uNight;`,
      );
  };
  m.customProgramCacheKey = () => 'wt-water';
  return m;
}

/**
 * Additive camera-facing glow billboards driven by instanced attributes:
 * aOffset (vec3 centre), aSize, aColor (linear rgb), aPhase, aMode (0 = night only, 1 = always).
 * With `firefly`, sprites drift and blink around their home position.
 * @param {WorldUniforms} uniforms
 * @param {{ firefly?: boolean }} [opts]
 * @returns {THREE.ShaderMaterial}
 */
export function createHaloMaterial(uniforms, { firefly = false } = {}) {
  return new THREE.ShaderMaterial({
    name: firefly ? 'wt-fireflies' : 'wt-halos',
    uniforms: { uTime: uniforms.uTime, uNight: uniforms.uNight },
    defines: firefly ? { WT_FIREFLY: '' } : {},
    vertexShader: /* glsl */ `
attribute vec3 aOffset;
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;
attribute float aMode;
uniform float uTime;
uniform float uNight;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec3 p = aOffset;
  float flick = 0.92 + 0.05 * sin(uTime * 6.3 + aPhase * 17.0) + 0.03 * sin(uTime * 13.7 + aPhase * 5.0);
  #ifdef WT_FIREFLY
    p += vec3(sin(uTime * 0.7 + aPhase * 6.0) * 0.7, sin(uTime * 1.3 + aPhase * 3.0) * 0.25, cos(uTime * 0.6 + aPhase * 4.0) * 0.7);
    flick = smoothstep(0.15, 1.0, sin(uTime * 2.2 + aPhase * 9.0) * 0.5 + 0.5);
  #endif
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += position.xy * aSize * (0.85 + 0.15 * flick);
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vColor = aColor;
  vAlpha = mix(uNight, 1.0, aMode) * flick;
}`,
    fragmentShader: /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a = a * a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
