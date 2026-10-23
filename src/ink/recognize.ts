import type { Point, Rect } from '@/geometry';

/**
 * Smart shapes: a closed pen stroke drawn with Ctrl held becomes the shape it looks
 * like. Each test asks one plain question of the outline, in the order least likely
 * to be fooled:
 *
 *   oval     every point is about one radius from the middle, scaled to the box
 *   rectangle  every point lies near an edge of its bounding box
 *   triangle the outline hugs the largest triangle inside it
 *   cloud / spike  it bulges out five times or more: rounded bulges with sharp dips
 *            between them is a cloud, sharp points with rounder dips is a spike
 *
 * Anything open, too small, or unlike all of these stays as ink. The thresholds were
 * set against shaky hand-drawn shapes (see the unit tests), not perfect ones.
 */
export type SmartShape = 'rect' | 'ellipse' | 'triangle' | 'cloud' | 'spike';

export interface Recognized {
  type: SmartShape;
  /** The element's box, in the stroke's coordinates, before rotation. */
  box: Rect;
  /** Radians, clockwise — a triangle pointing down or sideways. */
  rotation: number;
}

const SAMPLES = 128;
const MIN_SIZE = 16;

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function boundsOf(points: readonly Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** The stroke as a closed loop, or null if its ends are too far apart to be one. */
function closeLoop(points: readonly Point[], diagonal: number): Point[] | null {
  const start = points[0]!;
  // Overshooting the start is normal when closing a shape by hand: cut it off there.
  let end = points.length - 1;
  let best = distance(start, points[end]!);
  for (let index = Math.floor(points.length * 0.7); index < points.length; index += 1) {
    const gap = distance(start, points[index]!);
    if (gap < best) {
      best = gap;
      end = index;
    }
  }
  if (best > diagonal * 0.2) return null;
  return points.slice(0, end + 1);
}

/** Evenly spaced points around the closed loop. */
function resample(loop: readonly Point[], count: number): Point[] {
  const closed = [...loop, loop[0]!];
  let total = 0;
  for (let index = 1; index < closed.length; index += 1) {
    total += distance(closed[index - 1]!, closed[index]!);
  }
  if (total === 0) return [];
  const step = total / count;
  const out: Point[] = [{ ...closed[0]! }];
  let carried = 0;
  for (let index = 1; index < closed.length && out.length < count; index += 1) {
    let from = closed[index - 1]!;
    const to = closed[index]!;
    let segment = distance(from, to);
    while (carried + segment >= step && out.length < count) {
      const t = (step - carried) / segment;
      const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      out.push(point);
      from = point;
      segment = distance(from, to);
      carried = 0;
    }
    carried += segment;
  }
  return out;
}

function polygonArea(points: readonly Point[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Andrew's monotone chain. */
function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point[] = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  if (length === 0) return distance(point, a);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Indices of the turning points of a circular signal, ignoring wobbles below `delta`. */
function extremes(
  values: readonly number[],
  delta: number,
): { maxima: number[]; minima: number[] } {
  const n = values.length;
  let lowest = 0;
  for (let index = 1; index < n; index += 1) if (values[index]! < values[lowest]!) lowest = index;

  const maxima: number[] = [];
  const minima: number[] = [lowest];
  let rising = true;
  let candidate = lowest;
  for (let step = 1; step <= n; step += 1) {
    const index = (lowest + step) % n;
    const value = values[index]!;
    if (rising) {
      if (value > values[candidate]!) candidate = index;
      else if (values[candidate]! - value > delta) {
        maxima.push(candidate);
        rising = false;
        candidate = index;
      }
    } else {
      if (value < values[candidate]!) candidate = index;
      else if (value - values[candidate]! > delta) {
        if (candidate !== lowest) minima.push(candidate);
        rising = true;
        candidate = index;
      }
    }
  }
  return { maxima, minima };
}

/** The angle at a point of the loop, between its neighbours `span` away. Small is sharp. */
function cornerAngle(points: readonly Point[], index: number, span: number): number {
  const n = points.length;
  const here = points[index]!;
  const before = points[(index - span + n) % n]!;
  const after = points[(index + span) % n]!;
  const ax = before.x - here.x;
  const ay = before.y - here.y;
  const bx = after.x - here.x;
  const by = after.y - here.y;
  const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

const mean = (values: readonly number[]) =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

/** Squares and circles: sides within 15% of each other are made equal. */
function evened(box: Rect): Rect {
  const longer = Math.max(box.w, box.h);
  if (Math.abs(box.w - box.h) / longer > 0.15) return box;
  const side = (box.w + box.h) / 2;
  return {
    x: box.x + box.w / 2 - side / 2,
    y: box.y + box.h / 2 - side / 2,
    w: side,
    h: side,
  };
}

function asTriangle(loop: readonly Point[], hull: readonly Point[], hullArea: number) {
  let best: [Point, Point, Point] | null = null;
  let bestArea = 0;
  for (let i = 0; i < hull.length; i += 1) {
    for (let j = i + 1; j < hull.length; j += 1) {
      for (let k = j + 1; k < hull.length; k += 1) {
        const area = polygonArea([hull[i]!, hull[j]!, hull[k]!]);
        if (area > bestArea) {
          bestArea = area;
          best = [hull[i]!, hull[j]!, hull[k]!];
        }
      }
    }
  }
  if (!best || bestArea / hullArea < 0.85) return null;
  const [a, b, c] = best;
  const off = mean(
    loop.map((point) =>
      Math.min(
        distanceToSegment(point, a, b),
        distanceToSegment(point, b, c),
        distanceToSegment(point, c, a),
      ),
    ),
  );
  if (off / Math.sqrt(bestArea) > 0.06) return null;

  // The side nearest to level or upright is the base; the corner opposite it is
  // where the triangle points.
  const sides: Array<[Point, Point, Point]> = [
    [a, b, c],
    [b, c, a],
    [c, a, b],
  ];
  const tilt = ([p, q]: [Point, Point, Point]) => {
    const angle = Math.atan2(q.y - p.y, q.x - p.x);
    return Math.min(Math.abs(Math.sin(angle)), Math.abs(Math.cos(angle)));
  };
  const [p, q, apex] = sides.reduce((most, side) => (tilt(side) < tilt(most) ? side : most));
  const dx = apex.x - (p.x + q.x) / 2;
  const dy = apex.y - (p.y + q.y) / 2;
  const box = boundsOf(best);
  if (Math.abs(dy) >= Math.abs(dx)) return { box, rotation: dy < 0 ? 0 : Math.PI };
  // Pointing sideways: an upright triangle in a turned box.
  const turned = {
    x: box.x + box.w / 2 - box.h / 2,
    y: box.y + box.h / 2 - box.w / 2,
    w: box.h,
    h: box.w,
  };
  return { box: turned, rotation: dx > 0 ? Math.PI / 2 : -Math.PI / 2 };
}

export function recognizeShape(stroke: readonly Point[]): Recognized | null {
  if (stroke.length < 8) return null;
  const bounds = boundsOf(stroke);
  if (Math.max(bounds.w, bounds.h) < MIN_SIZE) return null;
  if (Math.min(bounds.w, bounds.h) < Math.max(bounds.w, bounds.h) * 0.08) return null;
  const diagonal = Math.hypot(bounds.w, bounds.h);

  const loop = closeLoop(stroke, diagonal);
  if (!loop || loop.length < 8) return null;
  const points = resample(loop, SAMPLES);
  if (points.length < SAMPLES / 2) return null;

  const box = boundsOf(points);
  const area = polygonArea(points);
  const hull = convexHull(points);
  const hullArea = polygonArea(hull);
  if (hullArea === 0) return null;
  const extent = area / (box.w * box.h);

  // Distance from the middle, measured in the box's own radii: 1 all round for an oval.
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const radial = points.map((point) =>
    Math.hypot((point.x - cx) / (box.w / 2), (point.y - cy) / (box.h / 2)),
  );
  const smoothed = radial.map((_, index) => {
    let sum = 0;
    for (let offset = -2; offset <= 2; offset += 1) {
      sum += radial[(index + offset + radial.length) % radial.length]!;
    }
    return sum / 5;
  });
  const { maxima, minima } = extremes(smoothed, 0.07);

  const ovalError = mean(radial.map((value) => Math.abs(value - 1)));
  if (ovalError < 0.075 && maxima.length <= 4) {
    return { type: 'ellipse', box: evened(box), rotation: 0 };
  }

  const nearestEdge = mean(
    points.map((point) =>
      Math.min(point.x - box.x, box.x + box.w - point.x, point.y - box.y, box.y + box.h - point.y),
    ),
  );
  if (nearestEdge / Math.min(box.w, box.h) < 0.06 && extent > 0.8) {
    return { type: 'rect', box: evened(box), rotation: 0 };
  }

  if (extent > 0.3 && extent < 0.7 && area / hullArea > 0.88) {
    const triangle = asTriangle(points, hull, hullArea);
    if (triangle) return { type: 'triangle', ...triangle };
  }

  if (maxima.length >= 5 && minima.length >= 4) {
    const peaks = mean(maxima.map((index) => smoothed[index]!));
    const dips = mean(minima.map((index) => smoothed[index]!));
    if (peaks / dips < 1.12) return null;
    const span = Math.max(2, Math.round(SAMPLES / 48));
    const tips = mean(maxima.map((index) => cornerAngle(points, index, span)));
    const valleys = mean(minima.map((index) => cornerAngle(points, index, span)));
    return { type: tips < valleys ? 'spike' : 'cloud', box, rotation: 0 };
  }

  return null;
}
