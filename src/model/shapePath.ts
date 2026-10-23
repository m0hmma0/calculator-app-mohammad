import type { Point } from '@/geometry';
import type { BoardElement, ElementType } from './element';

/**
 * Outlines in element-local coordinates, spanning (0,0) to (w,h). Rendering and
 * hit-testing both read from here, so what you click is always what you see.
 */
export function polygonPoints(element: BoardElement): Point[] {
  const { w, h, type, style } = element;

  switch (type) {
    case 'triangle':
      return [
        { x: w / 2, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ];

    case 'diamond':
      return [
        { x: w / 2, y: 0 },
        { x: w, y: h / 2 },
        { x: w / 2, y: h },
        { x: 0, y: h / 2 },
      ];

    case 'polygon': {
      const sides = Math.max(3, Math.round(style.sides));
      const points: Point[] = [];
      for (let index = 0; index < sides; index += 1) {
        // Start at the top so an odd-sided polygon points upwards.
        const angle = (index / sides) * Math.PI * 2 - Math.PI / 2;
        points.push({
          x: w / 2 + (Math.cos(angle) * w) / 2,
          y: h / 2 + (Math.sin(angle) * h) / 2,
        });
      }
      return points;
    }

    case 'star': {
      const spikes = Math.max(3, Math.round(style.sides));
      const points: Point[] = [];
      for (let index = 0; index < spikes * 2; index += 1) {
        const radius = index % 2 === 0 ? 1 : 0.42;
        const angle = (index / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
        points.push({
          x: w / 2 + (Math.cos(angle) * w * radius) / 2,
          y: h / 2 + (Math.sin(angle) * h * radius) / 2,
        });
      }
      return points;
    }

    case 'cloud':
      return fitToBox(cloudOutline(), w, h);

    case 'spike':
      return fitToBox(spikeOutline(), w, h);

    default:
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ];
  }
}

export const POLYGONAL: ReadonlySet<ElementType> = new Set([
  'triangle',
  'diamond',
  'polygon',
  'star',
  'cloud',
  'spike',
]);

/** Stretches an outline drawn around the origin to fill the box (0,0)–(w,h). */
function fitToBox(points: readonly Point[], w: number, h: number): Point[] {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX || 1;
  const spanY = Math.max(...ys) - minY || 1;
  return points.map((point) => ({
    x: ((point.x - minX) / spanX) * w,
    y: ((point.y - minY) / spanY) * h,
  }));
}

let cloud: Point[] | null = null;
/**
 * A cloud: an oval scalloped into round bulges, with sharp dips where they meet.
 * Computed once — every cloud is this outline stretched to its box.
 */
function cloudOutline(): Point[] {
  if (cloud) return cloud;
  const bumps = 9;
  const samples = 216;
  cloud = [];
  for (let index = 0; index < samples; index += 1) {
    const angle = (index / samples) * Math.PI * 2;
    const swell = 1 + 0.2 * Math.abs(Math.sin((bumps * angle) / 2));
    cloud.push({ x: Math.cos(angle) * 1.45 * swell, y: Math.sin(angle) * swell });
  }
  return cloud;
}

let spike: Point[] | null = null;
/** A burst: sharp points of uneven length around a rounder middle, like a "pow!". */
function spikeOutline(): Point[] {
  if (spike) return spike;
  const points = 11;
  spike = [];
  for (let index = 0; index < points * 2; index += 1) {
    const angle = (index / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    // Fixed, uneven lengths: the hand-drawn look, the same every time.
    const radius =
      index % 2 === 0 ? 1 - 0.22 * (((index / 2) * 0.618) % 1) : 0.52 + 0.08 * ((index * 0.37) % 1);
    spike.push({ x: Math.cos(angle) * 1.35 * radius, y: Math.sin(angle) * radius });
  }
  return spike;
}

/** The two ends of a line or arrow, in local coordinates, start first. */
export function lineEnds(element: BoardElement): [Point, Point] {
  const diagonal: [Point, Point] = element.style.flipX
    ? [
        { x: 0, y: element.h },
        { x: element.w, y: 0 },
      ]
    : [
        { x: 0, y: 0 },
        { x: element.w, y: element.h },
      ];
  return element.style.reverse ? [diagonal[1], diagonal[0]] : diagonal;
}

/**
 * Encodes a start and end point as a normalised box plus the two flags. Keeping the
 * box positive lets every transform, hit-test and bounds calculation stay uniform;
 * the flags carry the direction that would otherwise be lost.
 */
export function boxFromEnds(
  start: Point,
  end: Point,
): { x: number; y: number; w: number; h: number; flipX: boolean; reverse: boolean } {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);

  // Opposite signs mean the line runs bottom-left to top-right. A purely vertical or
  // horizontal line has no diagonal, so it takes the untilted one.
  const flipX = (end.x - start.x) * (end.y - start.y) < 0;
  const first = flipX ? { x, y: y + h } : { x, y };
  const reverse =
    Math.hypot(start.x - first.x, start.y - first.y) > Math.hypot(end.x - first.x, end.y - first.y);

  return { x, y, w, h, flipX, reverse };
}
