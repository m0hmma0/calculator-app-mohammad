import type { Point } from '@/geometry';

/** A pressure-carrying input sample. */
export interface InkPoint {
  x: number;
  y: number;
  pressure: number;
}

export const DEFAULT_PRESSURE = 0.5;

export function toFlat(points: readonly InkPoint[]): number[] {
  const flat: number[] = new Array(points.length * 3);
  points.forEach((point, index) => {
    flat[index * 3] = point.x;
    flat[index * 3 + 1] = point.y;
    flat[index * 3 + 2] = point.pressure;
  });
  return flat;
}

export function fromFlat(flat: readonly number[]): InkPoint[] {
  const points: InkPoint[] = [];
  for (let index = 0; index + 2 < flat.length; index += 3) {
    points.push({ x: flat[index]!, y: flat[index + 1]!, pressure: flat[index + 2]! });
  }
  return points;
}

export function strokeBounds(points: readonly InkPoint[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function translatePoints(points: readonly InkPoint[], dx: number, dy: number): InkPoint[] {
  return points.map((point) => ({ x: point.x + dx, y: point.y + dy, pressure: point.pressure }));
}

/**
 * Holding Shift mid-stroke straightens everything drawn since the key went down,
 * live, without ending the stroke: the kept prefix stays freehand and the rest
 * becomes a line from the point where Shift was pressed to the cursor.
 *
 * Releasing Shift resumes freehand from there, which is why this takes the whole
 * stroke and an anchor index rather than replacing the buffer outright.
 */
export function straightenFrom(
  points: readonly InkPoint[],
  anchorIndex: number,
  cursor: InkPoint,
): InkPoint[] {
  if (points.length === 0) return [cursor];
  const clamped = Math.max(0, Math.min(anchorIndex, points.length - 1));
  const anchor = points[clamped]!;
  return [...points.slice(0, clamped + 1), { ...cursor, pressure: anchor.pressure }];
}

/**
 * Ramer–Douglas–Peucker. A minute of scribbling produces thousands of samples; this
 * drops the ones that carry no shape, which matters once every stroke has to travel
 * over a wire and live in a shared document.
 */
export function simplify(points: readonly InkPoint[], tolerance = 0.6): InkPoint[] {
  if (points.length <= 2) return [...points];

  const first = points[0]!;
  const last = points[points.length - 1]!;

  let maxDistance = -1;
  let maxIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = perpendicularDistance(points[index]!, first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = index;
    }
  }

  if (maxDistance <= tolerance) return [first, last];

  const head = simplify(points.slice(0, maxIndex + 1), tolerance);
  const tail = simplify(points.slice(maxIndex), tolerance);
  return [...head.slice(0, -1), ...tail];
}

function perpendicularDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const area = Math.abs(dy * point.x - dx * point.y + b.x * a.y - b.y * a.x);
  return area / Math.hypot(dx, dy);
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/**
 * Inserts samples so no two are further apart than `maxSpacing`. A stroke that has
 * been simplified may be two points a thousand units apart, and erasing between them
 * would otherwise do nothing at all — there is no sample there to remove.
 */
export function densify(points: readonly InkPoint[], maxSpacing: number): InkPoint[] {
  if (points.length < 2 || maxSpacing <= 0) return [...points];

  const dense: InkPoint[] = [points[0]!];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const span = Math.hypot(current.x - previous.x, current.y - previous.y);
    const steps = Math.ceil(span / maxSpacing);

    for (let step = 1; step < steps; step += 1) {
      const t = step / steps;
      dense.push({
        x: previous.x + (current.x - previous.x) * t,
        y: previous.y + (current.y - previous.y) * t,
        pressure: previous.pressure + (current.pressure - previous.pressure) * t,
      });
    }
    dense.push(current);
  }
  return dense;
}

/**
 * Stroke eraser: cuts away the part of the stroke the eraser passed over and returns
 * whatever survives as separate runs, so scrubbing the middle of a line leaves two
 * pieces rather than deleting the whole thing.
 */
export function eraseThrough(
  points: readonly InkPoint[],
  eraser: Point,
  radius: number,
  minimumRun = 2,
): InkPoint[][] {
  const runs: InkPoint[][] = [];
  let current: InkPoint[] = [];
  let removedAny = false;

  // Half the eraser radius is fine enough that the cut lands where it looks like it should.
  for (const point of densify(points, Math.max(1, radius / 2))) {
    if (Math.hypot(point.x - eraser.x, point.y - eraser.y) <= radius) {
      removedAny = true;
      if (current.length >= minimumRun) runs.push(current);
      current = [];
    } else {
      current.push(point);
    }
  }
  if (current.length >= minimumRun) runs.push(current);

  // Nothing was in reach, so hand back exactly what came in rather than a densified
  // copy of it — an eraser that misses should change nothing.
  if (!removedAny) return points.length >= minimumRun ? [[...points]] : [];

  return runs;
}

/** Whether an eraser at this point touches the stroke at all. */
export function strokeHit(points: readonly InkPoint[], eraser: Point, radius: number): boolean {
  if (points.length === 1) {
    const only = points[0]!;
    return Math.hypot(only.x - eraser.x, only.y - eraser.y) <= radius;
  }
  for (let index = 1; index < points.length; index += 1) {
    if (distanceToSegment(eraser, points[index - 1]!, points[index]!) <= radius) return true;
  }
  return false;
}
