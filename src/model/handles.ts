import type { Point, Rect } from '@/geometry';
import { rotateAround, selectionAABB } from './bounds';
import type { BoardElement } from './element';
import { handleSign, type HandleId } from './transform';

/**
 * The frame the transform handles hang off. One element keeps its own rotation, so
 * the handles turn with it; several fall back to an upright box around them all,
 * which is what makes a mixed selection predictable to drag.
 */
export interface SelectionFrame {
  box: Rect;
  rotation: number;
  single: boolean;
}

export function selectionFrame(selected: readonly BoardElement[]): SelectionFrame | null {
  if (selected.length === 0) return null;

  if (selected.length === 1) {
    const element = selected[0]!;
    return {
      box: { x: element.x, y: element.y, w: element.w, h: element.h },
      rotation: element.rotation,
      single: true,
    };
  }

  const box = selectionAABB(selected);
  return box ? { box, rotation: 0, single: false } : null;
}

export function frameCentre(frame: SelectionFrame): Point {
  return { x: frame.box.x + frame.box.w / 2, y: frame.box.y + frame.box.h / 2 };
}

/** Where a handle sits in board space, accounting for the frame's rotation. */
export function handlePoint(frame: SelectionFrame, handle: HandleId): Point {
  const { sx, sy } = handleSign(handle);
  const unrotated = {
    x: frame.box.x + frame.box.w / 2 + (sx * frame.box.w) / 2,
    y: frame.box.y + frame.box.h / 2 + (sy * frame.box.h) / 2,
  };
  return frame.rotation === 0
    ? unrotated
    : rotateAround(unrotated, frameCentre(frame), frame.rotation);
}

export function frameCorners(frame: SelectionFrame): [Point, Point, Point, Point] {
  return [
    handlePoint(frame, 'nw'),
    handlePoint(frame, 'ne'),
    handlePoint(frame, 'se'),
    handlePoint(frame, 'sw'),
  ];
}
