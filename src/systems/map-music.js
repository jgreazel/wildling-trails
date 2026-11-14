/**
 * Map music: plays the map's `music` (or `musicNight` outdoors at night),
 * re-checking about once a second so the track follows the day/night phase.
 * Scripts can override the track until the next map load.
 */

/** How often (ms) the day/night music choice is re-checked. */
export const MUSIC_RECHECK_MS = 1000;

/**
 * Track id for a map right now.
 * @param {any} model MapModel
 * @param {{isNight?: boolean}|null|undefined} dayNight
 * @returns {string|null}
 */
export function musicFor(model, dayNight) {
  const def = model?.def;
  if (!def) return null;
  if (model.kind === 'outdoor' && dayNight?.isNight && def.musicNight) return def.musicNight;
  return def.music ?? null;
}

/**
 * Create the map-music controller.
 * @param {{ audio: { playMusic(id:string): void, stopMusic?(opts?: any): void }, dayNight?: any }} deps
 */
export function createMapMusic({ audio, dayNight }) {
  /** @type {any} */
  let model = null;
  /** @type {string|null} */
  let current = null;
  /** @type {string|null} */
  let override = null;
  let timer = 0;

  function refresh() {
    if (override || !model) return;
    const id = musicFor(model, dayNight);
    if (!id || id === current) return;
    current = id;
    audio.playMusic(id);
  }

  return {
    /** Start the music for a freshly loaded map (clears any script override). @param {any} mapModel */
    enter(mapModel) {
      model = mapModel;
      override = null;
      timer = 0;
      current = null;
      // audio.playMusic() ignores an empty id, so a silent map must stop the last track itself.
      if (!musicFor(model, dayNight)) {
        audio.stopMusic?.();
        return;
      }
      refresh();
    },

    /** Stop tracking (preview / teardown) without touching what is playing. */
    leave() {
      model = null;
      override = null;
    },

    /** Script override; null/empty returns to the map's own track. @param {string|null|undefined} id */
    setOverride(id) {
      if (id) {
        override = String(id);
        current = override;
        audio.playMusic(override);
      } else {
        override = null;
        current = null;
        refresh();
      }
    },

    /** @param {number} dtMs */
    update(dtMs) {
      timer += dtMs;
      if (timer < MUSIC_RECHECK_MS) return;
      timer = 0;
      refresh();
    },

    get current() {
      return current;
    },
  };
}
