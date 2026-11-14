/**
 * Build kit for one actor instance: creates rig nodes, collects pieces to bake,
 * bakes them into meshes (with optional outline hulls) and tracks every
 * per-instance GPU resource so `dispose()` can free exactly those.
 */
import * as THREE from 'three';
import { createPiece, bakeParts } from './actor-geometry.js';
import { toonVertexMaterial, unlitVertexMaterial, outlineMaterial } from './actor-materials.js';

/**
 * @typedef {object} PieceOptions
 * @property {number} [outline] outline thickness in world units (0 = none)
 * @property {boolean} [unlit] use the shared unlit material (eyes, glints)
 * @property {THREE.Material} [material] per-instance material (no vertex colours)
 * @property {boolean} [castShadow] default true (false for unlit)
 * @property {string} [name] mesh name
 */

/**
 * @typedef {object} ActorKit
 * @property {(parent: THREE.Object3D, p?: number[], name?: string) => THREE.Group} node
 * @property {(node: THREE.Object3D, opts?: PieceOptions) => import('./actor-geometry.js').Piece} piece
 *   register a piece that will be baked into a mesh under `node` by `bakeAll()`
 * @property {() => THREE.Mesh[]} bakeAll bake every registered piece (once)
 * @property {(piece: import('./actor-geometry.js').Piece, node: THREE.Object3D, opts?: PieceOptions) => THREE.Mesh | null} bake
 * @property {<T extends { dispose(): void }>(thing: T) => T} own track a disposable
 * @property {() => void} dispose free every tracked resource (idempotent)
 */

/**
 * @returns {ActorKit}
 */
export function createKit() {
  /** @type {{ dispose(): void }[]} */
  const owned = [];
  /** @type {{ piece: import('./actor-geometry.js').Piece, node: THREE.Object3D, opts: PieceOptions }[]} */
  const pending = [];

  /** @type {ActorKit} */
  const kit = {
    node(parent, p = [0, 0, 0], name = '') {
      const g = new THREE.Group();
      g.position.set(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
      if (name) g.name = name;
      parent.add(g);
      return g;
    },

    piece(node, opts = {}) {
      const piece = createPiece();
      pending.push({ piece, node, opts });
      return piece;
    },

    bake(piece, node, opts = {}) {
      const material = opts.material ?? null;
      const geo = bakeParts(piece.parts, { colors: !material });
      if (!geo) return null;
      owned.push(geo);
      const mat = material ?? (opts.unlit ? unlitVertexMaterial() : toonVertexMaterial());
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = opts.name ?? (node.name ? `${node.name}-mesh` : 'part');
      mesh.castShadow = opts.castShadow ?? !opts.unlit;
      mesh.receiveShadow = false;
      node.add(mesh);
      const thickness = opts.outline ?? 0;
      if (thickness > 0) {
        const hullGeo = bakeParts(piece.parts, { colors: false, hull: thickness });
        if (hullGeo) {
          owned.push(hullGeo);
          const hull = new THREE.Mesh(hullGeo, outlineMaterial());
          hull.name = 'outline';
          hull.castShadow = false;
          hull.receiveShadow = false;
          mesh.add(hull);
        }
      }
      return mesh;
    },

    bakeAll() {
      /** @type {THREE.Mesh[]} */
      const meshes = [];
      for (const { piece, node, opts } of pending.splice(0)) {
        const m = kit.bake(piece, node, opts);
        if (m) meshes.push(m);
      }
      return meshes;
    },

    own(thing) {
      owned.push(thing);
      return thing;
    },

    dispose() {
      pending.length = 0;
      for (const thing of owned.splice(0)) {
        try {
          thing.dispose();
        } catch {
          /* already gone */
        }
      }
    },
  };
  return kit;
}
