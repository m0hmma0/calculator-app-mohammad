import { clamp, rectContainsPoint, type Rect } from '@/geometry';
import { boxFromCentre, localToWorld, worldToLocal } from './bounds';
import { isBound } from './connectors';
import { elementCenter, type BoardElement } from './element';

function spanInFrame(element: BoardElement, frame: BoardElement) {
  const angle = element.rotation - frame.rotation;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  return { w: element.w * cos + element.h * sin, h: element.w * sin + element.h * cos };
}

/** Overlapping or nested frames use the smallest visible frame around the centre. */
export function frameForFitWidth(
  element: BoardElement,
  elements: readonly BoardElement[],
): BoardElement | null {
  if (element.hidden || element.type === 'frame' || element.type === 'group' || isBound(element)) {
    return null;
  }

  const centre = elementCenter(element);
  let match: BoardElement | null = null;
  for (const frame of elements) {
    if (frame.type !== 'frame' || frame.hidden || frame.w <= 0 || frame.h <= 0) continue;
    if (match && frame.w * frame.h > match.w * match.h) continue;
    if (
      rectContainsPoint({ x: 0, y: 0, w: frame.w, h: frame.h }, worldToLocal(frame, centre)) &&
      spanInFrame(element, frame).w > 1e-6
    ) {
      match = frame;
    }
  }
  return match;
}

/** Fill the frame along its own horizontal axis while preserving the element's rotation. */
export function fitWidthPatch(
  element: BoardElement,
  frame: BoardElement,
): Rect & Partial<Pick<BoardElement, 'autoHeight' | 'points' | 'style'>> {
  const span = spanInFrame(element, frame);
  const scale = frame.w / span.w;
  const centre = worldToLocal(frame, elementCenter(element));
  const inset = Math.min((span.h * scale) / 2, frame.h / 2);
  const target = localToWorld(frame, {
    x: frame.w / 2,
    y: clamp(centre.y, inset, frame.h - inset),
  });
  const box = boxFromCentre(target, element.w * scale, element.h * scale);
  const resized = Math.abs(scale - 1) > 1e-9;
  return {
    ...box,
    ...(resized && element.autoHeight ? { autoHeight: false } : {}),
    ...(resized && element.points
      ? {
          points: element.points.map((value, index) => (index % 3 === 2 ? value : value * scale)),
          style: { ...element.style, strokeWidth: element.style.strokeWidth * scale },
        }
      : {}),
  };
}
