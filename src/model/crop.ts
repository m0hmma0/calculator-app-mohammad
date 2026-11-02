import type { Point, Rect } from '@/geometry';
import type { BoardElement, ImageCrop } from './element';
import { handleSign, type HandleId } from './transform';

/**
 * Cropping a picture. The element's box is the part shown; `crop` says which part of
 * the whole picture that is, so the rest is only hidden. Dragging a crop handle moves
 * that edge of the box over the picture, which stays where it is on the board.
 */

export const WHOLE: ImageCrop = { x: 0, y: 0, w: 1, h: 1 };

export const cropOf = (element: Pick<BoardElement, 'crop'>): ImageCrop => element.crop ?? WHOLE;

/** The whole picture in the element's own frame: origin at its box's top-left, unturned. */
export function wholePicture(element: Pick<BoardElement, 'w' | 'h' | 'crop'>): Rect {
  const crop = cropOf(element);
  const w = element.w / crop.w;
  const h = element.h / crop.h;
  return { x: 0 - crop.x * w, y: 0 - crop.y * h, w, h };
}

/** Where the part shown sits in a bitmap of this size, in its own pixels. */
export function cropSource(
  crop: ImageCrop,
  width: number,
  height: number,
): [number, number, number, number] {
  return [crop.x * width, crop.y * height, crop.w * width, crop.h * height];
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high));

/**
 * The picture after a crop handle is dragged to `local` — the pointer in the frame of
 * the picture as it was when the drag began. Edges stop at the whole picture, and never
 * cross each other; the box moves on the board only as far as its edges did, turned as
 * the picture is. Back to the whole picture, the crop goes.
 */
export function recrop(
  start: BoardElement,
  handle: HandleId,
  local: Point,
  minSize: number,
): Pick<BoardElement, 'x' | 'y' | 'w' | 'h' | 'crop'> {
  const whole = wholePicture(start);
  const { sx, sy } = handleSign(handle);
  let left = 0;
  let top = 0;
  let right = start.w;
  let bottom = start.h;
  if (sx < 0) left = clamp(local.x, whole.x, right - minSize);
  if (sx > 0) right = clamp(local.x, left + minSize, whole.x + whole.w);
  if (sy < 0) top = clamp(local.y, whole.y, bottom - minSize);
  if (sy > 0) bottom = clamp(local.y, top + minSize, whole.y + whole.h);

  const w = right - left;
  const h = bottom - top;
  // The centre moves by the change in the box, turned with the picture.
  const along = { x: (left + right) / 2 - start.w / 2, y: (top + bottom) / 2 - start.h / 2 };
  const cos = Math.cos(start.rotation);
  const sin = Math.sin(start.rotation);
  const cx = start.x + start.w / 2 + along.x * cos - along.y * sin;
  const cy = start.y + start.h / 2 + along.x * sin + along.y * cos;

  const crop = {
    x: (left - whole.x) / whole.w,
    y: (top - whole.y) / whole.h,
    w: w / whole.w,
    h: h / whole.h,
  };
  const all = crop.x < 1e-4 && crop.y < 1e-4 && crop.w > 1 - 1e-4 && crop.h > 1 - 1e-4;
  return { x: cx - w / 2, y: cy - h / 2, w, h, crop: all ? null : crop };
}

/** A crop read from the document, if it is one: four fractions inside the picture. */
export function isCrop(value: unknown): value is ImageCrop {
  if (!value || typeof value !== 'object') return false;
  const { x, y, w, h } = value as Record<string, unknown>;
  const fractions = [x, y, w, h].every(
    (each) => typeof each === 'number' && Number.isFinite(each) && each >= 0 && each <= 1,
  );
  return fractions && (w as number) > 0 && (h as number) > 0;
}
