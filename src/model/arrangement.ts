import { elementAABB } from './bounds';
import type { BoardElement } from './element';

export type ArrangeDirection = 'row' | 'column';
export const DEFAULT_ARRANGE_GAP = 24;
export const ARRANGE_GAP_STEP = 8;

export function orderedForArrangement(
  elements: readonly BoardElement[],
  direction: ArrangeDirection,
) {
  const row = direction === 'row';
  return elements
    .map((element) => {
      const box = elementAABB(element);
      return {
        element,
        start: row ? box.x : box.y,
        cross: row ? box.y : box.x,
        size: row ? box.w : box.h,
      };
    })
    .sort((a, b) => a.start - b.start);
}

/** Read the current spacing from the board so undo, reload and reselection agree. */
export function arrangementOf(elements: readonly BoardElement[]) {
  if (elements.length < 2) return null;
  for (const direction of ['row', 'column'] as const) {
    const items = orderedForArrangement(elements, direction);
    const first = items[0]!;
    const gap = items[1]!.start - first.start - first.size;
    if (gap < -1e-6 || items[1]!.start === first.start) continue;
    const aligned = items.every((item, index) => {
      if (Math.abs(item.cross - first.cross) > 1e-6) return false;
      const previous = items[index - 1];
      return !previous || Math.abs(item.start - previous.start - previous.size - gap) < 1e-6;
    });
    if (aligned) return { direction, gap: Math.max(0, gap) };
  }
  return null;
}
