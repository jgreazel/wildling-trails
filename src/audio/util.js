/**
 * Small shared helpers for the audio modules.
 * Pure functions only; nothing here touches Web Audio or the DOM at import time.
 */

const warned = new Set();

/**
 * Log a warning at most once per key, so a recurring problem never spams the console.
 * @param {string} key
 * @param {...any} args
 */
export function warnOnce(key, ...args) {
  if (warned.has(key)) return;
  warned.add(key);
  try {
    console.warn('[audio]', ...args);
  } catch {
    /* console unavailable: stay silent */
  }
}

/**
 * @param {number} value
 * @param {number} lo
 * @param {number} hi
 */
export function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Freeze an AudioParam at its current value at `time`, dropping later automation,
 * so new ramps start from where the sound is right now (no jumps, no clicks).
 * @param {AudioParam} param
 * @param {number} time
 */
export function holdParam(param, time) {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    try {
      param.cancelAndHoldAtTime(time);
      return;
    } catch {
      /* fall back below */
    }
  }
  const value = Number(param.value);
  param.cancelScheduledValues(time);
  param.setValueAtTime(Number.isFinite(value) ? value : 0, time);
}

/**
 * Linearly ramp an AudioParam from its current value to `target` over `seconds`.
 * @param {AudioParam} param
 * @param {number} target
 * @param {number} now   context time to start from
 * @param {number} seconds  0 = jump immediately
 */
export function rampParam(param, target, now, seconds) {
  holdParam(param, now);
  if (!(seconds > 0)) param.setValueAtTime(target, now);
  else param.linearRampToValueAtTime(target, now + seconds);
}

/**
 * Smoothly approach `target` (exponential glide, time constant = seconds / 3).
 * Used for mute so toggling never clicks.
 * @param {AudioParam} param
 * @param {number} target
 * @param {number} now
 * @param {number} seconds
 */
export function glideParam(param, target, now, seconds) {
  holdParam(param, now);
  param.setTargetAtTime(target, now, Math.max(0.001, seconds / 3));
}

/**
 * Disconnect a list of nodes, ignoring nodes that are already disconnected.
 * @param {Array<AudioNode|null|undefined>} nodes
 */
export function disconnectAll(nodes) {
  for (const node of nodes) {
    try {
      node?.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}
