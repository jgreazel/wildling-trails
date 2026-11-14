/**
 * Actor occupancy. An actor holds its logical tile and, while moving, its
 * origin too — so starting a step reserves the destination and two actors can
 * never target the same tile. Followers may also reserve queued trail tiles.
 * Hidden actors occupy nothing.
 */

/**
 * @typedef {object} OccupantActor
 * @property {'player'|'npc'|'follower'} kind
 * @property {boolean} visible
 * @property {{ occupies(x:number, y:number): boolean }} mover
 * @property {{x:number, y:number}[]} [reserved]  extra reserved tiles
 */

/**
 * @typedef {object} AtOptions
 * @property {OccupantActor|null} [except]   ignore this actor (usually the asker)
 * @property {boolean} [ignoreFollower]      the follower never blocks the player
 */

/**
 * @typedef {object} Occupancy
 * @property {(actor: OccupantActor) => void} add
 * @property {(actor: OccupantActor) => void} remove
 * @property {() => void} clear
 * @property {(x:number, y:number, opts?: AtOptions) => OccupantActor|null} at
 * @property {(x:number, y:number, opts?: AtOptions) => boolean} isFree
 * @property {OccupantActor[]} list
 */

/**
 * Create an occupancy registry.
 * @returns {Occupancy}
 */
export function createOccupancy() {
  /** @type {Set<OccupantActor>} */
  const actors = new Set();

  /** @type {Occupancy['at']} */
  function at(x, y, { except = null, ignoreFollower = false } = {}) {
    for (const a of actors) {
      if (a === except || !a.visible) continue;
      if (ignoreFollower && a.kind === 'follower') continue;
      if (a.mover.occupies(x, y)) return a;
      if (a.reserved && a.reserved.some((t) => t.x === x && t.y === y)) return a;
    }
    return null;
  }

  return {
    add(actor) {
      if (actor) actors.add(actor);
    },
    remove(actor) {
      actors.delete(actor);
    },
    clear() {
      actors.clear();
    },
    at,
    isFree(x, y, opts) {
      return !at(x, y, opts);
    },
    get list() {
      return [...actors];
    },
  };
}
