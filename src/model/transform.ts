import type { Point, Rect } from '@/geometry';
import { boxFromCentre, rotateVector } from './bounds';
import { elementCenter, MIN_SIZE, type BoardElement } from './element';

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLES: readonly HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** −1, 0 or 1 on each axis: which edges of the box this handle moves. */
export function handleSign(handle: HandleId): { sx: -1 | 0 | 1; sy: -1 | 0 | 1 } {
  const sx = handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0;
  const sy = handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0;
  return { sx, sy };
}

export function isCornerHandle(handle: HandleId): boolean {
  const { sx, sy } = handleSign(handle);
  return sx !== 0 && sy !== 0;
}

/** Where a handle sits, in the element's local frame. */
export function handleLocalPoint(element: BoardElement, handle: HandleId): Point {
  const { sx, sy } = handleSign(handle);
  return {
    x: element.w / 2 + (sx * element.w) / 2,
    y: element.h / 2 + (sy * element.h) / 2,
  };
}

export interface ResizeOptions {
  /** Alt: grow from the centre instead of from the opposite corner. */
  fromCentre?: boolean;
  /** Shift (for shapes): keep the width-to-height ratio. */
  lockAspect?: boolean;
  minSize?: number;
}

function withLockedAspect(element: BoardElement, w: number, h: number): { w: number; h: number } {
  if (element.w <= 0 || element.h <= 0) return { w, h };
  // Follow whichever axis the pointer pushed further, which is what feels intended.
  const scale = Math.max(w / element.w, h / element.h);
  return { w: element.w * scale, h: element.h * scale };
}

/**
 * The new unrotated box after dragging `handle` to `pointer`.
 *
 * The invariant that matters: whatever the element's rotation, the anchor — the
 * opposite corner, or the centre when Alt is held — does not move on screen.
 * Everything is computed in the element's local frame, then mapped back out.
 */
export function resizeBox(
  element: BoardElement,
  handle: HandleId,
  pointer: Point,
  options: ResizeOptions = {},
): Rect {
  const { sx, sy } = handleSign(handle);
  const minSize = options.minSize ?? MIN_SIZE;
  const centre = elementCenter(element);
  const angle = element.rotation;
  const corner = sx !== 0 && sy !== 0;

  if (options.fromCentre) {
    const local = rotateVector({ x: pointer.x - centre.x, y: pointer.y - centre.y }, -angle);
    let w = sx === 0 ? element.w : Math.max(minSize, Math.abs(local.x) * 2);
    let h = sy === 0 ? element.h : Math.max(minSize, Math.abs(local.y) * 2);
    if (options.lockAspect && corner) ({ w, h } = withLockedAspect(element, w, h));
    return boxFromCentre(centre, w, h);
  }

  const anchorOffset = rotateVector({ x: (-sx * element.w) / 2, y: (-sy * element.h) / 2 }, angle);
  const anchor = { x: centre.x + anchorOffset.x, y: centre.y + anchorOffset.y };

  const local = rotateVector({ x: pointer.x - anchor.x, y: pointer.y - anchor.y }, -angle);
  let w = sx === 0 ? element.w : Math.max(minSize, local.x * sx);
  let h = sy === 0 ? element.h : Math.max(minSize, local.y * sy);
  if (options.lockAspect && corner) ({ w, h } = withLockedAspect(element, w, h));

  const centreOffset = rotateVector({ x: (sx * w) / 2, y: (sy * h) / 2 }, angle);
  return boxFromCentre({ x: anchor.x + centreOffset.x, y: anchor.y + centreOffset.y }, w, h);
}

export const ROTATION_STEP = Math.PI / 12; // 15°
const SOFT_SNAP_WINDOW = ROTATION_STEP * 0.2;

export function normaliseAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  return ((angle % twoPi) + twoPi) % twoPi;
}

/**
 * Free rotation, but it settles onto each 15° mark as it passes — and Shift makes
 * those marks the only options.
 */
export function snapRotation(angle: number, hard: boolean): number {
  if (hard) return normaliseAngle(Math.round(angle / ROTATION_STEP) * ROTATION_STEP);
  const nearest = Math.round(angle / ROTATION_STEP) * ROTATION_STEP;
  return normaliseAngle(Math.abs(angle - nearest) <= SOFT_SNAP_WINDOW ? nearest : angle);
}

export function angleFromCentre(centre: Point, pointer: Point): number {
  return Math.atan2(pointer.y - centre.y, pointer.x - centre.x);
}

export function degreesOf(radians: number): number {
  return Math.round((normaliseAngle(radians) * 180) / Math.PI) % 360;
}

const CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'] as const;
const HANDLE_ANGLE: Record<HandleId, number> = {
  e: 0,
  se: 45,
  s: 90,
  sw: 135,
  w: 180,
  nw: 225,
  n: 270,
  ne: 315,
};

/** Resize cursors follow the element's rotation, so they always point the right way. */
export function cursorForHandle(handle: HandleId, rotation: number): string {
  const degrees = HANDLE_ANGLE[handle] + (rotation * 180) / Math.PI;
  const normalised = ((degrees % 180) + 180) % 180;
  return CURSORS[Math.round(normalised / 45) % 4]!;
}

/** Map a box from one bounding rect into another — how a multi-selection scales. */
export function scaleBoxInto(box: Rect, from: Rect, to: Rect): Rect {
  const scaleX = from.w === 0 ? 1 : to.w / from.w;
  const scaleY = from.h === 0 ? 1 : to.h / from.h;
  return {
    x: to.x + (box.x - from.x) * scaleX,
    y: to.y + (box.y - from.y) * scaleY,
    w: box.w * scaleX,
    h: box.h * scaleY,
  };
}
