import { linkInText } from '@/canvas/renderContent';
import type { Point } from '@/geometry';
import { worldToLocal } from '@/model/bounds';
import { canHoldLabel, labelBox, type BoardElement } from '@/model/element';
import { measuring } from './measure';

/**
 * The link under a point on the board, if the words of this element carry one there.
 * The words are laid out exactly as they are drawn — a shape's label centred in the
 * room inside its outline — and a rotated element is looked at in its own frame.
 */
export function linkAt(element: BoardElement, world: Point): string | null {
  if (!element.text || !element.marks?.some((mark) => mark.link)) return null;
  const label = canHoldLabel(element);
  if (!label && element.type !== 'text' && element.type !== 'sticky') return null;
  const ctx = measuring();
  if (!ctx) return null;
  const local = worldToLocal(element, world);
  const point = { x: element.x + local.x, y: element.y + local.y };
  const laidOut: BoardElement = label
    ? {
        ...element,
        ...labelBox(element),
        type: 'sticky',
        style: { ...element.style, align: 'center' },
      }
    : element;
  return linkInText(ctx, laidOut, point);
}
