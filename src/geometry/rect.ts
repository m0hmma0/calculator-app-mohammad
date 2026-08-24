/**
 * Pure geometry. No DOM, no canvas, no React — so it stays fast and trivially testable.
 * Rect edges are treated as inclusive: rectangles that merely touch DO intersect, and a
 * point exactly on an edge IS inside. That is the behaviour marquee selection and
 * viewport culling both want.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Build a rect from two corners dragged in any direction; w and h are never negative. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

export function rectRight(r: Rect): number {
  return r.x + r.w;
}

export function rectBottom(r: Rect): number {
  return r.y + r.h;
}

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function rectContainsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= rectRight(r) && p.y >= r.y && p.y <= rectBottom(r);
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    rectRight(inner) <= rectRight(outer) &&
    rectBottom(inner) <= rectBottom(outer)
  );
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= rectRight(b) && b.x <= rectRight(a) && a.y <= rectBottom(b) && b.y <= rectBottom(a);
}

/** Grow (or shrink, with a negative value) a rect on every side. */
export function expandRect(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

/** Smallest rect containing all of them. Returns null for an empty list. */
export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (rectRight(r) > maxX) maxX = rectRight(r);
    if (rectBottom(r) > maxY) maxY = rectBottom(r);
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
