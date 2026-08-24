import { rectBottom, rectRight, type Rect } from '@/geometry';

export type SnapKind = 'align' | 'spacing';

export interface SnapGuide {
  /** 'x' is a vertical line at `position`; 'y' is a horizontal one. */
  axis: 'x' | 'y';
  position: number;
  from: number;
  to: number;
  kind: SnapKind;
}

/** A measured gap to draw as a bar between two boxes. */
export interface SpacingMark {
  axis: 'x' | 'y';
  start: number;
  end: number;
  /** Position on the cross axis to draw the bar at. */
  at: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
  spacing: SpacingMark[];
}

export const EMPTY_SNAP: SnapResult = { dx: 0, dy: 0, guides: [], spacing: [] };

const transpose = (r: Rect): Rect => ({ x: r.y, y: r.x, w: r.h, h: r.w });

const overlaps = (aLo: number, aHi: number, bLo: number, bHi: number): boolean =>
  aLo <= bHi && bLo <= aHi;

interface AxisResult {
  delta: number;
  guides: SnapGuide[];
  spacing: SpacingMark[];
}

/**
 * Alignment: the moving box's left, centre and right against every other box's
 * left, centre and right. The closest match inside the threshold wins, and every
 * other box that lines up on that same value gets a guide too.
 */
function snapAlign(moving: Rect, others: readonly Rect[], threshold: number): AxisResult | null {
  const movingValues = [moving.x, moving.x + moving.w / 2, rectRight(moving)];

  let best: { delta: number; position: number } | null = null;

  for (const other of others) {
    for (const target of [other.x, other.x + other.w / 2, rectRight(other)]) {
      for (const value of movingValues) {
        const delta = target - value;
        if (Math.abs(delta) > threshold) continue;
        if (!best || Math.abs(delta) < Math.abs(best.delta)) {
          best = { delta, position: target };
        }
      }
    }
  }

  if (!best) return null;

  const snapped = { ...moving, x: moving.x + best.delta };
  const involved = others.filter((other) =>
    [other.x, other.x + other.w / 2, rectRight(other)].some(
      (value) => Math.abs(value - best!.position) < 0.01,
    ),
  );

  const tops = [snapped.y, ...involved.map((other) => other.y)];
  const bottoms = [rectBottom(snapped), ...involved.map(rectBottom)];

  return {
    delta: best.delta,
    guides: [
      {
        axis: 'x',
        position: best.position,
        from: Math.min(...tops),
        to: Math.max(...bottoms),
        kind: 'align',
      },
    ],
    spacing: [],
  };
}

/**
 * Equal spacing, in the two forms that actually come up: dropping a box between two
 * others so both gaps match, and extending a run so the next gap matches the last.
 */
function snapSpacing(moving: Rect, others: readonly Rect[], threshold: number): AxisResult | null {
  const row = others
    .filter((other) => overlaps(other.y, rectBottom(other), moving.y, rectBottom(moving)))
    .sort((a, b) => a.x - b.x);
  if (row.length < 2) return null;

  const before = row.filter((other) => rectRight(other) <= moving.x + threshold);
  const after = row.filter((other) => other.x >= rectRight(moving) - threshold);

  const mark = (start: number, end: number, at: number): SpacingMark => ({
    axis: 'x',
    start,
    end,
    at,
  });

  // Centre it between the nearest neighbour on each side.
  const left = before.at(-1);
  const right = after[0];
  if (left && right) {
    const available = right.x - rectRight(left);
    const gap = (available - moving.w) / 2;
    if (gap >= 0) {
      const delta = rectRight(left) + gap - moving.x;
      if (Math.abs(delta) <= threshold) {
        const y = moving.y + moving.h / 2;
        return {
          delta,
          guides: [],
          spacing: [
            mark(rectRight(left), moving.x + delta, y),
            mark(rectRight(moving) + delta, right.x, y),
          ],
        };
      }
    }
  }

  // Or continue an existing run in either direction.
  const runs: Array<{ delta: number; marks: SpacingMark[] }> = [];

  if (before.length >= 2) {
    const near = before.at(-1)!;
    const far = before.at(-2)!;
    const gap = near.x - rectRight(far);
    if (gap >= 0) {
      const delta = rectRight(near) + gap - moving.x;
      const y = moving.y + moving.h / 2;
      runs.push({
        delta,
        marks: [mark(rectRight(far), near.x, y), mark(rectRight(near), moving.x + delta, y)],
      });
    }
  }

  if (after.length >= 2) {
    const near = after[0]!;
    const far = after[1]!;
    const gap = far.x - rectRight(near);
    if (gap >= 0) {
      const delta = near.x - gap - moving.w - moving.x;
      const y = moving.y + moving.h / 2;
      runs.push({
        delta,
        marks: [mark(rectRight(moving) + delta, near.x, y), mark(rectRight(near), far.x, y)],
      });
    }
  }

  const best = runs
    .filter((run) => Math.abs(run.delta) <= threshold)
    .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0];

  return best ? { delta: best.delta, guides: [], spacing: best.marks } : null;
}

function snapAxis(moving: Rect, others: readonly Rect[], threshold: number): AxisResult {
  // Alignment wins over spacing: it is the stronger intent and the more common one.
  const aligned = snapAlign(moving, others, threshold);
  if (aligned) return aligned;

  const spaced = snapSpacing(moving, others, threshold);
  if (spaced) return spaced;

  return { delta: 0, guides: [], spacing: [] };
}

const flipGuide = (guide: SnapGuide): SnapGuide => ({ ...guide, axis: 'y' });
const flipMark = (mark: SpacingMark): SpacingMark => ({ ...mark, axis: 'y' });

/**
 * `threshold` is in board units, so the caller divides a screen-pixel slop by the
 * zoom — snapping should feel the same distance away however far you are zoomed in.
 */
export function snapMove(moving: Rect, others: readonly Rect[], threshold: number): SnapResult {
  if (others.length === 0 || threshold <= 0) return EMPTY_SNAP;

  const horizontal = snapAxis(moving, others, threshold);
  const vertical = snapAxis(transpose(moving), others.map(transpose), threshold);

  return {
    dx: horizontal.delta,
    dy: vertical.delta,
    guides: [...horizontal.guides, ...vertical.guides.map(flipGuide)],
    spacing: [...horizontal.spacing, ...vertical.spacing.map(flipMark)],
  };
}
