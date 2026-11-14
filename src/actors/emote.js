/**
 * Emote bubbles: a little speech balloon (!, ?, …, ♥, ♪) that pops in above an
 * actor's head, floats, fades out and resolves after `ms`.
 *
 * Bubble textures are drawn once per kind on a canvas and cached for the
 * session. Without a DOM (Node tests) nothing is drawn and the promise simply
 * resolves after `ms`.
 */
import * as THREE from 'three';

/** Emote kinds from the actor contract. */
export const EMOTE_KINDS = Object.freeze(['!', '?', '…', '♥', '♪']);

/** Default display time (ms) when none / an invalid one is given. */
export const DEFAULT_EMOTE_MS = 1100;

const POP_S = 0.2;
const FADE_S = 0.2;
const SIZE = 0.44;

/** @type {Map<string, THREE.CanvasTexture>} */
const textures = new Map();

/** True when a DOM canvas can be created. */
function hasDom() {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

/**
 * Clamp an emote duration: invalid, missing or negative values become
 * DEFAULT_EMOTE_MS; anything longer than a minute is capped.
 * @param {unknown} ms
 * @returns {number}
 */
export function sanitizeMs(ms) {
  const n = Number(ms);
  if (ms === undefined || ms === null || !Number.isFinite(n) || n < 0) return DEFAULT_EMOTE_MS;
  return Math.min(n, 60000);
}

/**
 * @param {CanvasRenderingContext2D} g
 * @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r
 */
function roundRectPath(g, x, y, w, h, r) {
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  // tail (bottom centre)
  g.lineTo(x + w * 0.62, y + h);
  g.lineTo(x + w * 0.5, y + h + 20);
  g.lineTo(x + w * 0.38, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/**
 * Draw the symbol for `kind` centred at (cx, cy).
 * @param {CanvasRenderingContext2D} g @param {string} kind @param {number} cx @param {number} cy
 */
function drawSymbol(g, kind, cx, cy) {
  g.lineJoin = 'round';
  g.lineCap = 'round';
  switch (kind) {
    case '!': {
      g.fillStyle = '#e0533d';
      g.beginPath();
      g.moveTo(cx - 9, cy - 30);
      g.lineTo(cx + 9, cy - 30);
      g.lineTo(cx + 5, cy + 10);
      g.lineTo(cx - 5, cy + 10);
      g.closePath();
      g.fill();
      g.beginPath();
      g.arc(cx, cy + 25, 8, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case '?': {
      g.strokeStyle = '#3d74d6';
      g.lineWidth = 11;
      g.beginPath();
      g.arc(cx, cy - 13, 15, Math.PI * 1.1, Math.PI * 2.35);
      g.quadraticCurveTo(cx, cy + 2, cx, cy + 10);
      g.stroke();
      g.fillStyle = '#3d74d6';
      g.beginPath();
      g.arc(cx, cy + 27, 7.5, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case '…': {
      g.fillStyle = '#5a5048';
      for (const dx of [-24, 0, 24]) {
        g.beginPath();
        g.arc(cx + dx, cy + 6, 8, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case '♥': {
      g.fillStyle = '#e8577a';
      g.beginPath();
      g.moveTo(cx, cy + 28);
      g.bezierCurveTo(cx - 40, cy + 2, cx - 30, cy - 34, cx, cy - 14);
      g.bezierCurveTo(cx + 30, cy - 34, cx + 40, cy + 2, cx, cy + 28);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.beginPath();
      g.ellipse(cx - 15, cy - 12, 6, 4, -0.6, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case '♪': {
      g.fillStyle = '#3f9a63';
      g.strokeStyle = '#3f9a63';
      g.beginPath();
      g.ellipse(cx - 8, cy + 20, 13, 10, -0.45, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(cx + 3, cy + 18);
      g.lineTo(cx + 3, cy - 30);
      g.stroke();
      g.lineWidth = 8;
      g.beginPath();
      g.moveTo(cx + 3, cy - 29);
      g.quadraticCurveTo(cx + 26, cy - 22, cx + 22, cy - 2);
      g.stroke();
      break;
    }
    default: {
      g.fillStyle = '#5a5048';
      g.font = 'bold 56px system-ui, "Segoe UI", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(kind).slice(0, 2), cx, cy + 2);
    }
  }
}

/**
 * Lazily drawn, cached bubble texture for one kind. Browser only.
 * @param {string} kind
 * @returns {THREE.CanvasTexture | null}
 */
function bubbleTexture(kind) {
  const key = String(kind);
  const hit = textures.get(key);
  if (hit) return hit;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const g = canvas.getContext('2d');
    if (!g) return null;
    // soft drop shadow
    g.fillStyle = 'rgba(30, 20, 30, 0.22)';
    g.beginPath();
    roundRectPath(g, 13, 13, 104, 84, 26);
    g.fill();
    // bubble
    g.beginPath();
    roundRectPath(g, 9, 7, 104, 84, 26);
    g.fillStyle = '#fffaf0';
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = '#2b2024';
    g.lineJoin = 'round';
    g.stroke();
    drawSymbol(g, key, 61, 48);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 2;
    textures.set(key, tex);
    return tex;
  } catch {
    return null;
  }
}

/** @param {number} x */
function easeOutBack(x) {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

/**
 * @typedef {object} EmoteBubble
 * @property {(kind: string, ms?: number) => Promise<void>} show replaces any bubble already showing
 * @property {() => void} update animate (call every frame)
 * @property {(y: number) => void} setAnchor change the bubble's base height
 * @property {() => void} dispose resolves anything pending, frees the sprite material
 */

/**
 * Create an emote bubble attached to `parent` (usually the actor group).
 * @param {THREE.Object3D} parent
 * @param {number} anchorY local height of the bubble's tail tip
 * @returns {EmoteBubble}
 */
export function createEmoteBubble(parent, anchorY) {
  /** @type {THREE.Sprite | null} */
  let sprite = null;
  /** @type {THREE.SpriteMaterial | null} */
  let material = null;
  /** @type {{ start: number, ms: number, resolve: () => void, timer: ReturnType<typeof setTimeout> } | null} */
  let current = null;
  let anchor = anchorY;
  let disposed = false;

  function finish() {
    if (!current) return;
    const { resolve, timer } = current;
    current = null;
    clearTimeout(timer);
    if (sprite) sprite.visible = false;
    resolve();
  }

  function ensureSprite() {
    if (sprite) return sprite;
    material = new THREE.SpriteMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    sprite = new THREE.Sprite(material);
    sprite.name = 'emote';
    // Anchor at the tip of the bubble's tail (x 61 px, y ≈ 112 px on the 128² canvas).
    sprite.center.set(61 / 128, 16 / 128);
    sprite.renderOrder = 999;
    sprite.visible = false;
    sprite.position.set(0, anchor, 0);
    sprite.raycast = () => {};
    parent.add(sprite);
    return sprite;
  }

  return {
    show(kind, ms) {
      const duration = sanitizeMs(ms);
      finish();
      if (disposed) return Promise.resolve();
      return new Promise((resolve) => {
        const timer = setTimeout(finish, duration);
        current = { start: now(), ms: duration, resolve, timer };
        if (!hasDom()) return;
        const tex = bubbleTexture(kind);
        if (!tex) return;
        const s = ensureSprite();
        if (material && material.map !== tex) {
          material.map = tex;
          material.needsUpdate = true;
        }
        if (material) material.opacity = 1;
        s.scale.setScalar(0.001);
        s.visible = true;
      });
    },

    update() {
      if (!current || !sprite || !sprite.visible || !material) return;
      const elapsed = (now() - current.start) / 1000;
      const total = current.ms / 1000;
      const pop = easeOutBack(Math.min(1, elapsed / POP_S));
      const fadeStart = Math.max(POP_S, total - FADE_S);
      const fade = elapsed > fadeStart ? Math.min(1, (elapsed - fadeStart) / FADE_S) : 0;
      const size = SIZE * Math.max(0.001, pop) * (1 + fade * 0.12);
      sprite.scale.set(size, size, 1);
      sprite.position.y = anchor + Math.sin(elapsed * 5.5) * 0.025 + fade * 0.06;
      material.opacity = 1 - fade;
    },

    setAnchor(y) {
      anchor = y;
      if (sprite) sprite.position.y = y;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      finish();
      if (sprite) sprite.removeFromParent();
      material?.dispose();
      sprite = null;
      material = null;
    },
  };
}
