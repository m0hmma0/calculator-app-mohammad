import type { Point, Rect } from '@/geometry';

export type ElementId = string;

export type ShapeType =
  'rect' | 'ellipse' | 'triangle' | 'diamond' | 'star' | 'polygon' | 'line' | 'arrow';

export type ContentType = 'path' | 'text' | 'sticky' | 'image' | 'frame';

export type ElementType = ShapeType | ContentType | 'group';

export type TextAlign = 'start' | 'center' | 'end';
export type ListStyle = 'none' | 'bullet' | 'number';

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
  /**
   * Which end of that diagonal the line starts from. `flipX` alone can only say
   * which diagonal of the box the line lies along — it cannot say which end carries
   * the arrowhead, so an arrow drawn upwards would point the wrong way without this.
   */
  reverse: boolean;

  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  align: TextAlign;
  lineHeight: number;
  letterSpacing: number;
  list: ListStyle;
  /** Text colour; falls back to fill when null. */
  textColor: string | null;
}

/** One end of a connector, optionally bound to an element so it re-routes. */
export interface Binding {
  elementId: ElementId;
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

  /**
   * Freehand ink: a flat [x, y, pressure, …] run in element-local coordinates.
   * Flat rather than objects because these get long, and Phase 4 has to put every
   * one of them into a shared document.
   */
  points?: number[];

  /** Text and sticky-note content. */
  text?: string;

  /** Image source. Phase 6 swaps the data URL for an R2 key. */
  image?: { src: string; naturalWidth: number; naturalHeight: number };

  /** Connector endpoints. When bound, the arrow follows the element. */
  from?: Binding;
  to?: Binding;
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
  reverse: false,

  fontFamily: 'sans',
  fontSize: 20,
  fontWeight: 400,
  italic: false,
  underline: false,
  align: 'start',
  lineHeight: 1.35,
  letterSpacing: 0,
  list: 'none',
  textColor: null,
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

export function isTextual(element: BoardElement): boolean {
  return element.type === 'text' || element.type === 'sticky';
}

export function isConnector(element: BoardElement): boolean {
  return element.type === 'arrow' || element.type === 'line';
}

export const STICKY_SIZE = 180;
export const TEXT_STYLE: Partial<ElementStyle> = {
  fill: null,
  stroke: null,
  textColor: 'var(--text)',
};
export const STICKY_STYLE: Partial<ElementStyle> = {
  fill: 'var(--sticky)',
  stroke: null,
  radius: 3,
  shadow: true,
  align: 'center',
  textColor: 'var(--sticky-ink)',
};
export const INK_STYLE: Partial<ElementStyle> = {
  fill: 'var(--shape-1)',
  stroke: null,
  strokeWidth: 6,
};
export const FRAME_STYLE: Partial<ElementStyle> = {
  fill: 'var(--surface)',
  stroke: 'var(--border-strong)',
  strokeWidth: 1,
  radius: 2,
};

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
  const base =
    type === 'line' || type === 'arrow'
      ? LINE_STYLE
      : type === 'path'
        ? { ...DEFAULT_STYLE, ...INK_STYLE }
        : type === 'text'
          ? { ...DEFAULT_STYLE, ...TEXT_STYLE }
          : type === 'sticky'
            ? { ...DEFAULT_STYLE, ...STICKY_STYLE }
            : type === 'frame'
              ? { ...DEFAULT_STYLE, ...FRAME_STYLE }
              : type === 'image'
                ? { ...DEFAULT_STYLE, fill: null, stroke: null, radius: 0 }
                : DEFAULT_STYLE;
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
 * Whether the aspect ratio holds *without* Shift, so that Shift frees it instead of
 * locking it. Images work this way by request — the reverse of Figma — because a
 * stretched photo is almost always a mistake. Shapes keep the usual behaviour.
 */
export function aspectLockedByDefault(element: BoardElement): boolean {
  return element.type === 'image';
}

/** Resolves Shift against the element's default: for images it *frees* the ratio. */
export function shouldLockAspect(element: BoardElement, shiftHeld: boolean): boolean {
  return aspectLockedByDefault(element) ? !shiftHeld : shiftHeld;
}
