import { rectContainsPoint, rectsIntersect, type Point, type Rect } from '@/geometry';
import { elementAABB, worldToLocal } from './bounds';
import { isInteractive, type BoardElement } from './element';
import { lineEnds, polygonPoints, POLYGONAL } from './shapePath';
import { sortByZ } from './zorder';

function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const straddles = a.y > point.y !== b.y > point.y;
    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/**
 * `tolerance` is in board units — the caller converts from a screen-pixel slop so
 * thin lines stay clickable at any zoom.
 */
export function hitTestElement(element: BoardElement, world: Point, tolerance = 0): boolean {
  const local = worldToLocal(element, world);

  if (element.type === 'line' || element.type === 'arrow') {
    const [start, end] = lineEnds(element);
    return distanceToSegment(local, start, end) <= tolerance + element.style.strokeWidth / 2;
  }

  if (element.type === 'ellipse') {
    const rx = element.w / 2 + tolerance;
    const ry = element.h / 2 + tolerance;
    if (rx <= 0 || ry <= 0) return false;
    const nx = (local.x - element.w / 2) / rx;
    const ny = (local.y - element.h / 2) / ry;
    return nx * nx + ny * ny <= 1;
  }

  if (POLYGONAL.has(element.type)) {
    return pointInPolygon(local, polygonPoints(element));
  }

  return rectContainsPoint(
    { x: -tolerance, y: -tolerance, w: element.w + tolerance * 2, h: element.h + tolerance * 2 },
    local,
  );
}

export interface PickOptions {
  /**
   * Locked elements cannot be picked up, but hover still has to find them — that is
   * the only way the pointer can say "not allowed" instead of silently doing nothing.
   */
  includeLocked?: boolean;
}

/** Topmost element under the point, or null. */
export function elementAt(
  elements: readonly BoardElement[],
  world: Point,
  tolerance = 0,
  options: PickOptions = {},
): BoardElement | null {
  const ordered = sortByZ(elements);
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const element = ordered[index]!;
    if (element.hidden) continue;
    if (!options.includeLocked && element.locked) continue;
    if (element.type === 'group') continue;
    if (hitTestElement(element, world, tolerance)) return element;
  }
  return null;
}

/**
 * Marquee selection. Touching the box is enough — requiring full containment makes
 * dragging a selection over a large shape feel broken.
 */
export function elementsInMarquee(
  elements: readonly BoardElement[],
  marquee: Rect,
): BoardElement[] {
  return elements.filter(
    (element) =>
      isInteractive(element) &&
      element.type !== 'group' &&
      rectsIntersect(marquee, elementAABB(element)),
  );
}
