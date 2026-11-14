/**
 * WebGL renderer, scene and perspective camera for the diorama view.
 * Neutral tone mapping keeps the warm palette saturated; soft PCF shadows.
 */
import * as THREE from 'three';
import { TONES } from './palette.js';

/** Vertical field of view (degrees) — narrow for a toy-diorama feel. */
export const CAMERA_FOV = 38;

/** @returns {boolean} true on touch-first devices (runtime only). */
function isCoarsePointer() {
  try {
    return !!globalThis.matchMedia?.('(pointer: coarse)')?.matches;
  } catch {
    return false;
  }
}

/** @returns {number} */
function targetPixelRatio() {
  const dpr = Number(globalThis.devicePixelRatio) || 1;
  return Math.min(dpr, isCoarsePointer() ? 1.5 : 2);
}

/**
 * Create the renderer, scene and camera bound to a canvas.
 * @param {HTMLCanvasElement} canvas
 * @returns {{ renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, resize: () => void, render: () => void }}
 */
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(TONES.skyWindowDay, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#bfe3ea');

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 200);
  camera.position.set(0, 8.5, 7.5);
  camera.lookAt(0, 0, 0);

  // Let the browser restore the context after a GPU reset instead of dying.
  canvas.addEventListener?.('webglcontextlost', (e) => e.preventDefault(), false);

  let lastW = 0;
  let lastH = 0;
  let lastRatio = 0;

  /** Match the drawing buffer to the canvas' CSS size (call on resize). */
  function resize() {
    const w = Math.max(1, Math.round(canvas.clientWidth || globalThis.innerWidth || 1));
    const h = Math.max(1, Math.round(canvas.clientHeight || globalThis.innerHeight || 1));
    const ratio = targetPixelRatio();
    if (w === lastW && h === lastH && ratio === lastRatio) return;
    lastW = w;
    lastH = h;
    lastRatio = ratio;
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /** Draw one frame. */
  function render() {
    renderer.render(scene, camera);
  }

  return { renderer, scene, camera, resize, render };
}
