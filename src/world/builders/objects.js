/**
 * Object dispatcher: routes every map object to its builder with a painter in
 * the object's frame. Conditional objects (showIf / hideIf) get their own group
 * so applyFlags can toggle them. Unknown types become a neutral placeholder and
 * log one warning; a failing builder never breaks the rest of the map.
 */
import { buildBuilding } from './buildings.js';
import { buildBigTree } from './nature.js';
import { PROP_BUILDERS, placeholder } from './props.js';
import { FURNITURE_BUILDERS } from './furniture.js';
import { LEVEL_HEIGHT } from '../../config.js';
import { WATER_DROP } from './grid.js';

/** Types rendered by other builders (water.js handles lily pads). */
const HANDLED_ELSEWHERE = new Set(['lilypad']);

/**
 * @type {Record<string, (ctx: import('./context.js').BuildContext, o: any, p: import('./painter.js').Painter) => void>}
 */
const BUILDERS = {
  building: buildBuilding,
  bigtree: (ctx, o, p) => buildBigTree(ctx, o, p),
  ...PROP_BUILDERS,
  ...FURNITURE_BUILDERS,
};

/** Every object type this module can draw (for tests / validation). */
export const KNOWN_OBJECT_TYPES = Object.freeze([...Object.keys(BUILDERS), ...HANDLED_ELSEWHERE]);

/**
 * Frame for an object: buildings stand on their door tile's level and never
 * rotate; waterwheels sit on the water surface.
 * @param {import('./context.js').BuildContext} ctx @param {any} o
 */
function frameFor(ctx, o) {
  const { model } = ctx;
  if (o.type === 'building') {
    const dx = o.door?.x;
    const dy = o.door?.y;
    const level = Number.isInteger(dx) && Number.isInteger(dy) && model.inBounds(dx, dy) ? model.levelAt(dx, dy) : ctx.objectLevel(o);
    return ctx.objectFrame(o, { y: level * LEVEL_HEIGHT, angle: 0 });
  }
  if (o.type === 'waterwheel') {
    return ctx.objectFrame(o, { y: ctx.objectLevel(o) * LEVEL_HEIGHT - WATER_DROP, angle: 0 });
  }
  return ctx.objectFrame(o);
}

/**
 * @param {import('./context.js').BuildContext} ctx
 */
export function buildObjects(ctx) {
  for (const o of ctx.model.objects) {
    if (!o || HANDLED_ELSEWHERE.has(o.type)) continue;
    if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) {
      console.warn(`[world] Object "${o.id ?? o.type}" has no position — skipped.`);
      continue;
    }
    const frame = frameFor(ctx, o);
    const builder = BUILDERS[o.type];
    if (!builder) {
      ctx.warnUnknown(o.type);
      placeholder(ctx, o, ctx.objectPainter(o, frame));
      continue;
    }
    try {
      builder(ctx, o, ctx.objectPainter(o, frame));
    } catch (err) {
      console.error(`[world] Failed to build ${o.type} "${o.id}"`, err);
      placeholder(ctx, o, ctx.objectPainter(o, frame));
    }
  }
}
