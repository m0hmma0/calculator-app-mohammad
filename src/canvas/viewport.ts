import { clamp, type Point, type Rect } from '@/geometry';

/**
 * The camera over an infinite board.
 *
 *   x, y  the board coordinate sitting at the top-left corner of the visible area
 *   zoom  screen pixels per board unit (1 = 100%)
 *
 * screen = (board - origin) * zoom
 * board  = screen / zoom + origin
 *
 * Everything here is pure, so the awkward cases — zooming toward a cursor,
 * fitting content, clamping — are unit-tested rather than eyeballed.
 */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1;
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

export function boardToScreen(vp: Viewport, p: Point): Point {
  return { x: (p.x - vp.x) * vp.zoom, y: (p.y - vp.y) * vp.zoom };
}

export function screenToBoard(vp: Viewport, p: Point): Point {
  return { x: p.x / vp.zoom + vp.x, y: p.y / vp.zoom + vp.y };
}

/** The board rectangle currently on screen. */
export function visibleBounds(vp: Viewport, size: Size): Rect {
  return { x: vp.x, y: vp.y, w: size.width / vp.zoom, h: size.height / vp.zoom };
}

/** Pan by a screen-pixel delta — what a drag or a wheel event gives you. */
export function panByScreen(vp: Viewport, dx: number, dy: number): Viewport {
  return { ...vp, x: vp.x - dx / vp.zoom, y: vp.y - dy / vp.zoom };
}

/**
 * Zoom while pinning one screen point in place: the board coordinate under the
 * cursor before the zoom is the same one under it afterwards. This is the whole
 * difference between zooming that feels right and zooming that feels broken.
 */
export function zoomAt(vp: Viewport, screenPoint: Point, nextZoom: number): Viewport {
  const zoom = clampZoom(nextZoom);
  const anchor = screenToBoard(vp, screenPoint);
  return {
    zoom,
    x: anchor.x - screenPoint.x / zoom,
    y: anchor.y - screenPoint.y / zoom,
  };
}

export function zoomAtCenter(vp: Viewport, size: Size, nextZoom: number): Viewport {
  return zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, nextZoom);
}

/** Centre the viewport on a board point without changing zoom. */
export function centerOn(vp: Viewport, size: Size, target: Point): Viewport {
  return {
    ...vp,
    x: target.x - size.width / (2 * vp.zoom),
    y: target.y - size.height / (2 * vp.zoom),
  };
}

/**
 * Frame a board rectangle with padding. A zero-width or zero-height rect (a single
 * point, or a horizontal line) would divide by zero, so those axes are ignored.
 */
export function fitToRect(rect: Rect, size: Size, padding = 64): Viewport {
  const availableWidth = Math.max(1, size.width - padding * 2);
  const availableHeight = Math.max(1, size.height - padding * 2);

  const scaleX = rect.w > 0 ? availableWidth / rect.w : Infinity;
  const scaleY = rect.h > 0 ? availableHeight / rect.h : Infinity;

  const scale = Math.min(scaleX, scaleY);
  const zoom = clampZoom(Number.isFinite(scale) ? scale : 1);

  return centerOn({ x: 0, y: 0, zoom }, size, {
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2,
  });
}

/** True when the two cameras are close enough that redrawing would change nothing. */
export function viewportsEqual(a: Viewport, b: Viewport, epsilon = 1e-6): boolean {
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.zoom - b.zoom) < epsilon
  );
}

/** 1 → "100%", 0.025 → "3%" (never "0%", which reads as broken). */
export function formatZoom(zoom: number): string {
  const percent = zoom * 100;
  if (percent >= 100) return `${Math.round(percent)}%`;
  return `${Math.max(1, Math.round(percent))}%`;
}
