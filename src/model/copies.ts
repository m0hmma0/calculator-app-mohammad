import type { Point } from '@/geometry';
import { createElementId, type BoardElement } from './element';
import { keysBetween } from './zorder';

/**
 * Fresh copies of a set of elements, placed with their top-left corner at `target`
 * and stacked above `topZ`. Ids are new; relationships inside the set — a group's
 * children, an arrow's ends — are kept. Bindings pointing outside the copy are
 * dropped when bringing it onto a board, or kept when duplicating in place.
 */
export function copiesOf(
  elements: readonly BoardElement[],
  target: Point,
  topZ: string | null,
  { keepExternalBindings = false } = {},
): BoardElement[] {
  if (elements.length === 0) return [];
  const minX = Math.min(...elements.map((element) => element.x));
  const minY = Math.min(...elements.map((element) => element.y));
  const keys = keysBetween(topZ, null, elements.length);
  const remap = new Map<string, string>();
  for (const element of elements) remap.set(element.id, createElementId(element.type));
  const binding = (end: BoardElement['from']) => {
    if (!end) return undefined;
    const id = remap.get(end.elementId);
    if (id) return { elementId: id };
    return keepExternalBindings ? end : undefined;
  };

  return elements.map((element, index) => ({
    ...element,
    id: remap.get(element.id)!,
    parentId: element.parentId ? (remap.get(element.parentId) ?? null) : null,
    from: binding(element.from),
    to: binding(element.to),
    x: element.x - minX + target.x,
    y: element.y - minY + target.y,
    z: keys[index]!,
  }));
}
