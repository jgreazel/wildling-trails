/**
 * The Script API handed to map scripts: `scripts[id](api)`.
 * Every member resolves live session state at call time, so a handle kept
 * across a warp quietly becomes a no-op instead of touching disposed actors.
 * See docs/ARCHITECTURE.md → "Script API".
 */
import { DIRS } from '../config.js';
import { safeEmote } from './actor-utils.js';

/** @typedef {import('../config.js').Dir} Dir */

/**
 * Normalise dialog pages: drops empty input so `say()` never opens a blank box.
 * @param {string|string[]|null|undefined} pages
 * @returns {string[]}
 */
export function toPages(pages) {
  if (pages == null) return [];
  const list = Array.isArray(pages) ? pages : [pages];
  return list.filter((p) => p != null && String(p).length > 0).map(String);
}

/**
 * Build the Script API for a session.
 * @param {any} ctx  session context (see world-session.js)
 * @returns {any} api — see docs/ARCHITECTURE.md
 */
export function createScriptApi(ctx) {
  const { ui, audio, clock, deps, logger } = ctx;
  let warnedNoDialog = false;

  function dialog() {
    const dlg = ui?.dialog;
    if (dlg && typeof dlg.say === 'function') return dlg;
    if (!warnedNoDialog) {
      warnedNoDialog = true;
      logger.warn('[world] no dialog box available; script text is skipped');
    }
    return null;
  }

  const playerHandle = {
    /** @param {Dir} dir */
    face(dir) {
      ctx.player.face(dir);
    },
    /** @param {Dir[]} dirs */
    walk(dirs) {
      return ctx.player.walk(dirs);
    },
    /** @param {string} kind */
    emote(kind) {
      const actor = ctx.player.actor;
      return actor ? safeEmote(actor.model, kind, 1100, clock) : Promise.resolve();
    },
    get x() {
      return ctx.player.actor?.mover.x ?? ctx.state.x;
    },
    get y() {
      return ctx.player.actor?.mover.y ?? ctx.state.y;
    },
    get facing() {
      return ctx.player.actor?.mover.facing ?? ctx.state.facing;
    },
  };

  const api = {
    /**
     * @param {string|string[]} pages
     * @param {{speaker?: string}} [opts]
     */
    async say(pages, opts = {}) {
      const list = toPages(pages);
      if (!list.length) return;
      const dlg = dialog();
      if (!dlg) return;
      await dlg.say(list.length === 1 ? list[0] : list, opts ?? {});
    },

    /**
     * @param {string} prompt @param {string[]} options
     * @param {{speaker?: string}} [opts]  optional extension: label the question
     * @returns {Promise<number>} chosen index, −1 on cancel
     */
    async choose(prompt, options, opts) {
      const dlg = dialog();
      if (!dlg || typeof dlg.choose !== 'function') return -1;
      const n = opts ? await dlg.choose(prompt, options, opts) : await dlg.choose(prompt, options);
      return Number.isInteger(n) ? n : -1;
    },

    /**
     * Yes/No question (Yes first). Uses dialog.confirm() when the dialog has one.
     * @param {string} prompt @param {{speaker?: string}} [opts]
     * @returns {Promise<boolean>}
     */
    async confirm(prompt, opts) {
      const dlg = ui?.dialog;
      if (dlg && typeof dlg.confirm === 'function') return !!(await dlg.confirm(prompt, opts));
      return (await api.choose(prompt, ['Yes', 'No'], opts)) === 0;
    },

    /** @param {number} ms */
    wait(ms) {
      return clock.wait(ms);
    },

    /** @param {string} name */
    flag(name) {
      return !!deps.getFlag(name);
    },

    /** @param {string} name @param {boolean} [value] */
    setFlag(name, value = true) {
      deps.setFlag(name, value);
    },

    hasPartner() {
      return (ctx.state.party?.length ?? 0) > 0;
    },

    partner() {
      const p = ctx.state.party?.[0];
      return p ? { species: p.species, name: p.name } : null;
    },

    /**
     * Add a partner: party, fanfare, follower pops in behind the player, save.
     * @param {string} speciesId
     */
    givePartner(speciesId) {
      const member = deps.addPartner(speciesId);
      if (!member) {
        logger.warn(`[world] givePartner: unknown species "${speciesId}"`);
        return null;
      }
      audio.sfx('fanfare');
      ctx.follower.sync({ animate: true });
      deps.saveState();
      return { ...member };
    },

    /** @param {string} speciesId */
    markSeen(speciesId) {
      deps.markSeen(speciesId);
    },

    /** @param {string} id */
    npc(id) {
      return ctx.npcs.handle(id);
    },

    get player() {
      return playerHandle;
    },

    get follower() {
      return ctx.follower.handle();
    },

    /** @param {string} id */
    sfx(id) {
      audio.sfx(id);
    },

    /** Play a music track until the next map load; `null` returns to the map's music. @param {string|null} id */
    music(id) {
      ctx.music.setOverride(id);
    },

    /** @param {string} speciesId */
    cry(speciesId) {
      audio.cry(speciesId);
    },

    /** @param {string} text */
    banner(text) {
      try {
        ui?.banner?.show?.(text);
      } catch (err) {
        logger.error('[world] banner failed', err);
      }
    },

    /** @param {{title:string, body:string, cta?:string}} card */
    async card(card) {
      const el = ui?.card;
      if (el && typeof el.show === 'function') {
        await el.show(card);
        return;
      }
      await api.say([card?.title, card?.body].filter(Boolean));
    },

    /**
     * Warp like a door does (door sfx, fade, load).
     * @param {string} mapId @param {number} [x] @param {number} [y] @param {Dir} [facing]
     */
    warp(mapId, x, y, facing) {
      return ctx.warpTo(mapId, x, y, DIRS[facing] ? facing : undefined);
    },

    save() {
      return deps.saveState();
    },
  };

  return api;
}
