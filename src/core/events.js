/**
 * Minimal synchronous event emitter.
 * Listener errors are caught and logged so one bad listener can't break the game.
 */

/** @returns {{ on(type:string, fn:(detail:any)=>void): () => void, off(type:string, fn:Function): void, emit(type:string, detail?:any): void }} */
export function createEmitter() {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();
  return {
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type)?.delete(fn);
    },
    off(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    emit(type, detail) {
      const set = listeners.get(type);
      if (!set) return;
      for (const fn of [...set]) {
        try {
          fn(detail);
        } catch (err) {
          console.error(`[bus] listener for "${type}" failed`, err);
        }
      }
    },
  };
}

/** App-wide bus. Events: flag {name, value} · party · seen {species} · saved · map {id}. */
export const bus = createEmitter();
