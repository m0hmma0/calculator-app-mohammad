import { rectFromPoints, unionRects, type Point, type Rect } from '@/geometry';
import { elementCenter, type BoardElement } from './element';

export function rotateVector(v: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

export function rotateAround(p: Point, centre: Point, angle: number): Point {
  const rotated = rotateVector({ x: p.x - centre.x, y: p.y - centre.y }, angle);
  return { x: centre.x + rotated.x, y: centre.y + rotated.y };
}

/** Point in the element's own unrotated frame, with (0,0) at its top-left corner. */
export function worldToLocal(element: BoardElement, p: Point): Point {
  const unrotated = rotateAround(p, elementCenter(element), -element.rotation);
  return { x: unrotated.x - element.x, y: unrotated.y - element.y };
}

export function localToWorld(element: BoardElement, local: Point): Point {
  const unrotated = { x: element.x + local.x, y: element.y + local.y };
  return rotateAround(unrotated, elementCenter(element), element.rotation);
}

/** Corners in world space, clockwise from the top-left of the unrotated box. */
export function elementCorners(element: BoardElement): [Point, Point, Point, Point] {
  return [
    localToWorld(element, { x: 0, y: 0 }),
    localToWorld(element, { x: element.w, y: 0 }),
    localToWorld(element, { x: element.w, y: element.h }),
    localToWorld(element, { x: 0, y: element.h }),
  ];
}

/** Axis-aligned box that contains the element however it is rotated. */
export function elementAABB(element: BoardElement): Rect {
  if (element.rotation === 0) {
    return { x: element.x, y: element.y, w: element.w, h: element.h };
  }
  const corners = elementCorners(element);
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  return rectFromPoints(
    { x: Math.min(...xs), y: Math.min(...ys) },
    { x: Math.max(...xs), y: Math.max(...ys) },
  );
}

export function selectionAABB(elements: readonly BoardElement[]): Rect | null {
  return unionRects(elements.map(elementAABB));
}

export function boxFromCentre(centre: Point, w: number, h: number): Rect {
  return { x: centre.x - w / 2, y: centre.y - h / 2, w, h };
}
