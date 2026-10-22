import type { Point } from '@/geometry';
import { createElementId, type BoardElement } from './element';
import { keysBetween } from './zorder';

/**
 * Fresh copies of a set of elements, placed with their top-left corner at `target`
 * and stacked above `topZ`. Ids are new; relationships inside the set — a group's
 * children, an arrow's ends — are kept, and ones pointing outside it are dropped.
 * Used by paste and by the library, which both bring outside elements onto a board.
 */
export function copiesOf(
  elements: readonly BoardElement[],
  target: Point,
  topZ: string | null,
): BoardElement[] {
  if (elements.length === 0) return [];
  const minX = Math.min(...elements.map((element) => element.x));
  const minY = Math.min(...elements.map((element) => element.y));
  const keys = keysBetween(topZ, null, elements.length);
  const remap = new Map<string, string>();
  for (const element of elements) remap.set(element.id, createElementId(element.type));

  return elements.map((element, index) => ({
    ...element,
    id: remap.get(element.id)!,
    parentId: element.parentId ? (remap.get(element.parentId) ?? null) : null,
    from:
      element.from && remap.has(element.from.elementId)
        ? { elementId: remap.get(element.from.elementId)! }
        : undefined,
    to:
      element.to && remap.has(element.to.elementId)
        ? { elementId: remap.get(element.to.elementId)! }
        : undefined,
    x: element.x - minX + target.x,
    y: element.y - minY + target.y,
    z: keys[index]!,
  }));
}
