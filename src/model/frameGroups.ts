import { rectContainsPoint, type Point } from '@/geometry';
import { elementCorners, selectionAABB, worldToLocal } from './bounds';
import { elementCenter, type BoardElement, type ElementId } from './element';

export function groupRoot(element: BoardElement, elements: readonly BoardElement[]): BoardElement {
  if (!element.parentId) return element;
  let root = element;
  const visited = new Set([root.id]);
  while (root.parentId && !visited.has(root.parentId)) {
    const parent = elements.find((item) => item.id === root.parentId);
    if (!parent) break;
    root = parent;
    visited.add(root.id);
  }
  return root;
}

export function transformSelection(
  selected: readonly BoardElement[],
  elements: readonly BoardElement[],
): readonly BoardElement[] {
  if (!selected.some((item) => item.type === 'frame' || item.type === 'group')) return selected;
  return withGroupMembers(
    elements,
    selected.map((item) => item.id),
  ).filter((item) => item.type !== 'group');
}

/** Expand the selection in stacking order, including nested ordinary groups. */
export function withGroupMembers(
  elements: readonly BoardElement[],
  roots: Iterable<ElementId>,
): BoardElement[] {
  const ids = new Set(roots);
  if (!ids.size) return [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const element of elements) {
      if (!element.parentId || !ids.has(element.parentId) || ids.has(element.id)) continue;
      ids.add(element.id);
      changed = true;
    }
  }
  return elements.filter((element) => ids.has(element.id));
}

export function frameContainsCentre(frame: BoardElement, element: BoardElement): boolean {
  return rectContainsPoint(
    { x: 0, y: 0, w: frame.w, h: frame.h },
    worldToLocal(frame, elementCenter(element)),
  );
}

/** A frame keeps its own geometry for presentation; its selection can span its members. */
export function layoutBox(element: BoardElement, elements: readonly BoardElement[]): BoardElement {
  if (element.type !== 'frame' || !elements.some((item) => item.parentId === element.id)) {
    return element;
  }
  const members = withGroupMembers(elements, [element.id]).filter((item) => !item.hidden);
  const bounds = selectionAABB(members);
  return bounds ? { ...element, ...bounds, rotation: 0 } : element;
}

/** Clip the item's box in frame-local coordinates, including for rotated frames. */
function overlapArea(frame: BoardElement, item: BoardElement): number {
  const corners = elementCorners({
    ...item,
    x: item.w ? item.x : item.x - item.style.strokeWidth / 2,
    y: item.h ? item.y : item.y - item.style.strokeWidth / 2,
    w: item.w || item.style.strokeWidth,
    h: item.h || item.style.strokeWidth,
  });
  let polygon = corners.map((point) => worldToLocal(frame, point));
  const edges = [
    ['x', 0, 1],
    ['x', frame.w, -1],
    ['y', 0, 1],
    ['y', frame.h, -1],
  ] as const;
  for (const [axis, edge, sign] of edges) {
    const clipped: Point[] = [];
    let previous = polygon.at(-1);
    if (!previous) return 0;
    for (const point of polygon) {
      const a = (previous[axis] - edge) * sign;
      const b = (point[axis] - edge) * sign;
      if (a >= 0 !== b >= 0) {
        const t = a / (a - b);
        clipped.push({
          x: previous.x + (point.x - previous.x) * t,
          y: previous.y + (point.y - previous.y) * t,
        });
      }
      if (b >= 0) clipped.push(point);
      previous = point;
    }
    polygon = clipped;
  }
  let twiceArea = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]!;
    const b = polygon[(index + 1) % polygon.length]!;
    twiceArea += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twiceArea) / 2;
}

/** Greatest overlap wins; a more specific frame wins equal overlap. */
export function overlappingFrame(
  item: BoardElement,
  frames: readonly BoardElement[],
): BoardElement | undefined {
  let best: BoardElement | undefined;
  let area = 0;
  for (const frame of frames) {
    const overlap = overlapArea(frame, item);
    if (overlap <= 1e-6) continue;
    const tied = Math.abs(overlap - area) <= 1e-6;
    if (overlap > area + 1e-6 || (tied && best && frame.w * frame.h <= best.w * best.h)) {
      best = frame;
      area = overlap;
    }
  }
  return best;
}
