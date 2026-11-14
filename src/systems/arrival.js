/**
 * What happens when the player finishes a step (input-driven steps only):
 * warp > trigger > tall grass (rustle, sound, maybe a flavour encounter).
 * Also handles "push-through" exits: pressing down on an exit mat, up on a
 * door tile, or off the map edge while standing on a warp tile.
 */

/**
 * Create the arrival handler.
 * @param {any} ctx  session context (see world-session.js)
 */
export function createArrival(ctx) {
  /** @param {any} warp */
  function startWarp(warp) {
    const facing = warp.facing ?? ctx.player.actor?.mover.facing;
    ctx.warpTo(warp.to, warp.tx, warp.ty, facing);
  }

  return {
    /**
     * @param {number} x @param {number} y
     * @returns {boolean} true when something took over (the player should stop)
     */
    onPlayerArrive(x, y) {
      const model = ctx.mapModel;
      if (!model || ctx.isBusy()) return false;
      ctx.encounters.noteStep();
      const flags = ctx.state.flags;

      const warp = model.warpAt(x, y, flags);
      if (warp) {
        startWarp(warp);
        return true;
      }

      const trigger = model.triggerAt(x, y, flags);
      if (trigger && trigger.script) {
        ctx.runScript(trigger.script);
        return true;
      }

      if (model.typeAt(x, y).tallGrass) {
        ctx.rustle(x, y);
        ctx.audio.sfx('grass');
        if (ctx.encounters.maybeStart()) return true;
      }
      return false;
    },

    /**
     * The player pushed against something while standing still.
     * @param {number} x @param {number} y @param {import('../config.js').Dir} dir
     * @param {{reason: string|null}} res  canStep result
     * @returns {boolean} true when a warp started
     */
    onPlayerBlocked(x, y, dir, res) {
      const model = ctx.mapModel;
      if (!model || ctx.isBusy()) return false;
      const warp = model.warpAt(x, y, ctx.state.flags);
      if (!warp) return false;
      const type = model.typeAt(x, y);
      const push = res?.reason === 'edge' || (type.exit && dir === 'down') || (type.door && dir === 'up');
      if (!push) return false;
      startWarp(warp);
      return true;
    },
  };
}
