import type { Point, Rect } from '@/geometry';

export type ElementId = string;

export type ShapeType =
  'rect' | 'ellipse' | 'triangle' | 'diamond' | 'star' | 'polygon' | 'line' | 'arrow';

export type ElementType = ShapeType | 'group';

export type DashStyle = 'solid' | 'dashed' | 'dotted';

export interface ElementStyle {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  dash: DashStyle;
  /** Corner radius for rectangles, in board units. */
  radius: number;
  shadow: boolean;
  /** Sides for `polygon`, points for `star`. */
  sides: number;
  /**
   * Lines and arrows run corner to corner of their box. This says which diagonal:
   * false is top-left → bottom-right, true is bottom-left → top-right. Keeping the
   * box normalised (never a negative width) lets every other operation stay uniform.
   */
  flipX: boolean;
}

export interface BoardElement {
  id: ElementId;
  type: ElementType;
  /** Unrotated bounding box in board coordinates. Width and height are never negative. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Radians, clockwise, about the box centre. */
  rotation: number;
  opacity: number;
  locked: boolean;
  hidden: boolean;
  /** Fractional index — sorts as a plain string, and two people can reorder at once. */
  z: string;
  parentId: ElementId | null;
  style: ElementStyle;
}

export const MIN_SIZE = 1;

export const DEFAULT_STYLE: ElementStyle = {
  fill: 'var(--shape-1)',
  stroke: null,
  strokeWidth: 2,
  dash: 'solid',
  radius: 4,
  shadow: false,
  sides: 5,
  flipX: false,
};

/** Lines have no interior, so they default to a stroke instead of a fill. */
export const LINE_STYLE: ElementStyle = {
  ...DEFAULT_STYLE,
  fill: null,
  stroke: 'var(--shape-1)',
  strokeWidth: 2,
};

export function isStroked(element: BoardElement): boolean {
  return element.type === 'line' || element.type === 'arrow';
}

export function isContainer(element: BoardElement): boolean {
  return element.type === 'group';
}

/** Locked or hidden elements are inert: they cannot be picked, dragged or nudged. */
export function isInteractive(element: BoardElement): boolean {
  return !element.locked && !element.hidden;
}

let counter = 0;

export function createElementId(prefix = 'el'): ElementId {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export interface CreateElementOptions {
  type: ElementType;
  box: Rect;
  z: string;
  style?: Partial<ElementStyle>;
  id?: ElementId;
}

export function createElement({ type, box, z, style, id }: CreateElementOptions): BoardElement {
  const base = type === 'line' || type === 'arrow' ? LINE_STYLE : DEFAULT_STYLE;
  return {
    id: id ?? createElementId(type),
    type,
    x: box.x,
    y: box.y,
    w: Math.max(type === 'line' || type === 'arrow' ? 0 : MIN_SIZE, box.w),
    h: Math.max(type === 'line' || type === 'arrow' ? 0 : MIN_SIZE, box.h),
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    z,
    parentId: null,
    style: { ...base, ...style },
  };
}

export function elementBox(element: BoardElement): Rect {
  return { x: element.x, y: element.y, w: element.w, h: element.h };
}

export function elementCenter(element: BoardElement): Point {
  return { x: element.x + element.w / 2, y: element.y + element.h / 2 };
}

/**
 * Whether Shift means "free the aspect ratio" rather than "lock it" for this element.
 * Shapes lock only while Shift is held; images (Phase 3) invert it, per the spec.
 */
export function aspectLockedByDefault(_element: BoardElement): boolean {
  return false;
}
