/**
 * Small helpers for creating, showing and disposing actor models safely.
 * Systems never trust a model factory blindly: a model that fails to build is
 * replaced by an invisible stand-in so the game stays playable.
 */
import * as THREE from 'three';

/**
 * An ActorModel that renders nothing. Used when a factory throws.
 * @returns {any} ActorModel
 */
export function createNullModel() {
  const group = new THREE.Group();
  return {
    group,
    height: 1,
    setFacing() {},
    setMoving() {},
    hop() {},
    emote() {
      return Promise.resolve();
    },
    update() {},
    dispose() {},
  };
}

/**
 * Build a model with `factory(arg)`, falling back to a null model on failure.
 * @param {(arg:any) => any} factory
 * @param {any} arg
 * @param {Pick<Console, 'error'>} logger
 * @param {string} label  for the error message
 * @returns {any} ActorModel
 */
export function buildModel(factory, arg, logger, label) {
  try {
    const model = factory(arg);
    if (model && model.group && model.group.isObject3D) return model;
    logger.error(`[world] ${label}: factory returned no model group`);
  } catch (err) {
    logger.error(`[world] ${label}: model failed to build`, err);
  }
  return createNullModel();
}

/**
 * Remove a model from the scene and free it.
 * @param {any} scene
 * @param {any} model
 * @param {Pick<Console, 'error'>} logger
 */
export function disposeModel(scene, model, logger) {
  if (!model) return;
  try {
    if (model.group?.parent) model.group.parent.remove(model.group);
    else scene?.remove?.(model.group);
  } catch {
    /* ignore */
  }
  try {
    model.dispose?.();
  } catch (err) {
    logger.error('[world] model dispose failed', err);
  }
}

/**
 * Show an emote bubble and resolve when it is done — or after a game-time
 * timeout, so a stuck model can never hang a script.
 * @param {any} model
 * @param {string} kind
 * @param {number} ms
 * @param {{ wait(ms:number): Promise<void> }} clock
 * @returns {Promise<void>}
 */
export function safeEmote(model, kind, ms, clock) {
  const duration = Number(ms) > 0 ? Number(ms) : 1100;
  let shown;
  try {
    shown = model?.emote?.(kind, duration);
  } catch {
    shown = null;
  }
  const guard = clock.wait(duration + 400);
  if (!shown || typeof shown.then !== 'function') return guard;
  return Promise.race([Promise.resolve(shown).catch(() => {}), guard]).then(() => {});
}

/** Models whose update already failed once (logged a single time). */
const failedModels = new WeakSet();

/**
 * Call model.update(dt) without letting one broken model stop the frame.
 * Logs the first failure per model only, so a bad animation can't spam the console.
 * @param {any} model
 * @param {number} dt seconds
 * @param {Pick<Console, 'error'>} [logger]
 */
export function updateModel(model, dt, logger = console) {
  try {
    model?.update?.(dt);
  } catch (err) {
    if (model && typeof model === 'object' && !failedModels.has(model)) {
      failedModels.add(model);
      logger.error('[world] model update failed', err);
    }
  }
}
