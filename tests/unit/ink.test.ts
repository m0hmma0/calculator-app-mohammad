import { describe, expect, it } from 'vitest';
import {
  densify,
  eraseThrough,
  fromFlat,
  simplify,
  straightenFrom,
  strokeBounds,
  strokeHit,
  toFlat,
  translatePoints,
  type InkPoint,
} from '@/ink/stroke';

const ink = (x: number, y: number, pressure = 0.5): InkPoint => ({ x, y, pressure });

const line = (count: number): InkPoint[] =>
  Array.from({ length: count }, (_, index) => ink(index * 10, 0));

describe('flat storage', () => {
  it('round-trips', () => {
    const points = [ink(1, 2, 0.3), ink(4, 5, 0.9)];
    expect(fromFlat(toFlat(points))).toEqual(points);
  });

  it('ignores a truncated tail rather than inventing a point', () => {
    expect(fromFlat([1, 2, 0.5, 9, 9])).toEqual([ink(1, 2, 0.5)]);
  });
});

describe('bounds and translation', () => {
  it('wraps every sample', () => {
    expect(strokeBounds([ink(10, 20), ink(-5, 40), ink(30, 0)])).toEqual({
      x: -5,
      y: 0,
      w: 35,
      h: 40,
    });
  });

  it('is empty for no points', () => {
    expect(strokeBounds([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it('shifts every sample and keeps pressure', () => {
    expect(translatePoints([ink(1, 1, 0.8)], 5, -2)).toEqual([ink(6, -1, 0.8)]);
  });
});

// Checklist item 2 — the gate.
describe('straightenFrom', () => {
  it('keeps the freehand prefix and replaces the rest with one segment', () => {
    const points = line(6); // x = 0,10,20,30,40,50
    const straightened = straightenFrom(points, 2, ink(500, 500));

    expect(straightened).toHaveLength(4);
    expect(straightened.slice(0, 3)).toEqual(points.slice(0, 3));
    expect(straightened[3]).toMatchObject({ x: 500, y: 500 });
  });

  it('follows the cursor without growing the stroke', () => {
    const points = line(6);
    const first = straightenFrom(points, 2, ink(100, 100));
    const second = straightenFrom(points, 2, ink(200, 40));

    expect(first).toHaveLength(second.length);
    expect(second[3]).toMatchObject({ x: 200, y: 40 });
  });

  it('takes its pressure from the anchor so the line does not taper oddly', () => {
    const points = [ink(0, 0, 0.2), ink(10, 0, 0.9)];
    expect(straightenFrom(points, 1, ink(50, 50, 0.1))[1]!.pressure).toBe(0.9);
  });

  it('survives an anchor past either end', () => {
    expect(straightenFrom(line(3), 99, ink(1, 1))).toHaveLength(4);
    expect(straightenFrom(line(3), -5, ink(1, 1))).toHaveLength(2);
  });

  it('returns just the cursor for an empty stroke', () => {
    expect(straightenFrom([], 0, ink(3, 4))).toEqual([ink(3, 4)]);
  });
});

describe('simplify', () => {
  it('reduces a straight run to its ends', () => {
    expect(simplify(line(50), 0.5)).toHaveLength(2);
  });

  it('keeps a corner', () => {
    const corner = [ink(0, 0), ink(50, 0), ink(50, 50)];
    expect(simplify(corner, 0.5)).toHaveLength(3);
  });

  it('leaves short strokes alone', () => {
    const two = [ink(0, 0), ink(1, 1)];
    expect(simplify(two)).toEqual(two);
  });

  it('drops a lot from a noisy line but keeps its shape', () => {
    const noisy = Array.from({ length: 200 }, (_, index) => ink(index, Math.sin(index / 20) * 40));
    const reduced = simplify(noisy, 1);
    expect(reduced.length).toBeLessThan(noisy.length / 4);
    expect(reduced[0]).toEqual(noisy[0]);
    expect(reduced.at(-1)).toEqual(noisy.at(-1));
  });
});

// Checklist item 3.
describe('eraseThrough', () => {
  it('splits a stroke into two runs when scrubbed in the middle', () => {
    const runs = eraseThrough(line(11), { x: 50, y: 0 }, 12);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.at(-1)!.x).toBeLessThan(50);
    expect(runs[1]![0]!.x).toBeGreaterThan(50);
  });

  it('leaves one run when scrubbed at an end', () => {
    const runs = eraseThrough(line(11), { x: 0, y: 0 }, 12);
    expect(runs).toHaveLength(1);
  });

  it('returns nothing when the whole stroke is covered', () => {
    expect(eraseThrough(line(5), { x: 20, y: 0 }, 500)).toEqual([]);
  });

  it('cuts between two distant samples, not just on them', () => {
    // The regression: a simplified stroke is two points far apart, and erasing in
    // the middle of that gap used to remove nothing at all.
    const sparse = [ink(0, 0), ink(1000, 0)];
    const runs = eraseThrough(sparse, { x: 500, y: 0 }, 20);

    expect(runs).toHaveLength(2);
    expect(runs[0]!.at(-1)!.x).toBeLessThan(500);
    expect(runs[1]![0]!.x).toBeGreaterThan(500);
  });

  it('discards fragments too small to be worth keeping', () => {
    // Only one sample survives on the left, which is not a stroke.
    expect(eraseThrough(line(6), { x: 15, y: 0 }, 45)).toHaveLength(0);
  });

  it('leaves an untouched stroke whole', () => {
    const runs = eraseThrough(line(6), { x: 0, y: 900 }, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(6);
  });
});

describe('strokeHit', () => {
  it('finds a hit between samples, not only on them', () => {
    // Midway along a 100-unit gap, where there is no sample at all.
    expect(strokeHit([ink(0, 0), ink(100, 0)], { x: 50, y: 3 }, 5)).toBe(true);
  });

  it('misses when the eraser is clear of the line', () => {
    expect(strokeHit([ink(0, 0), ink(100, 0)], { x: 50, y: 40 }, 5)).toBe(false);
  });

  it('handles a single-sample stroke', () => {
    expect(strokeHit([ink(0, 0)], { x: 2, y: 0 }, 5)).toBe(true);
    expect(strokeHit([ink(0, 0)], { x: 50, y: 0 }, 5)).toBe(false);
  });
});

describe('densify', () => {
  it('inserts samples so no gap exceeds the spacing', () => {
    const dense = densify([ink(0, 0), ink(100, 0)], 10);
    expect(dense.length).toBeGreaterThanOrEqual(11);
    for (let index = 1; index < dense.length; index += 1) {
      const gap = Math.hypot(
        dense[index]!.x - dense[index - 1]!.x,
        dense[index]!.y - dense[index - 1]!.y,
      );
      expect(gap).toBeLessThanOrEqual(10.001);
    }
  });

  it('keeps the original endpoints exactly', () => {
    const dense = densify([ink(3, 4), ink(103, 4)], 7);
    expect(dense[0]).toEqual(ink(3, 4));
    expect(dense.at(-1)).toEqual(ink(103, 4));
  });

  it('interpolates pressure along the way', () => {
    const dense = densify([ink(0, 0, 0), ink(10, 0, 1)], 5);
    const middle = dense[Math.floor(dense.length / 2)]!;
    expect(middle.pressure).toBeGreaterThan(0);
    expect(middle.pressure).toBeLessThan(1);
  });

  it('leaves a stroke alone when it is already dense enough', () => {
    const points = [ink(0, 0), ink(2, 0), ink(4, 0)];
    expect(densify(points, 10)).toEqual(points);
  });

  it('handles a single point', () => {
    expect(densify([ink(1, 1)], 5)).toEqual([ink(1, 1)]);
  });
});
