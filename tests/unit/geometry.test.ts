import { describe, expect, it } from 'vitest';
import {
  clamp,
  distance,
  expandRect,
  lerp,
  rectBottom,
  rectCenter,
  rectContainsPoint,
  rectContainsRect,
  rectFromPoints,
  rectRight,
  rectsIntersect,
  unionRects,
} from '@/geometry';

describe('scalars', () => {
  it('clamps into range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
  });

  it('interpolates', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.25)).toBe(2.5);
  });

  it('measures distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(distance({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
  });
});

describe('rectFromPoints', () => {
  it('normalises a drag in any direction', () => {
    const downRight = rectFromPoints({ x: 10, y: 10 }, { x: 30, y: 40 });
    const upLeft = rectFromPoints({ x: 30, y: 40 }, { x: 10, y: 10 });
    expect(downRight).toEqual({ x: 10, y: 10, w: 20, h: 30 });
    expect(upLeft).toEqual(downRight);
  });

  it('handles a click with no movement', () => {
    expect(rectFromPoints({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, w: 0, h: 0 });
  });
});

describe('rect edges', () => {
  const r = { x: 10, y: 20, w: 30, h: 40 };

  it('computes edges and centre', () => {
    expect(rectRight(r)).toBe(40);
    expect(rectBottom(r)).toBe(60);
    expect(rectCenter(r)).toEqual({ x: 25, y: 40 });
  });
});

describe('rectContainsPoint', () => {
  const r = { x: 0, y: 0, w: 10, h: 10 };

  it('accepts interior points', () => {
    expect(rectContainsPoint(r, { x: 5, y: 5 })).toBe(true);
  });

  it('accepts points exactly on an edge or corner', () => {
    expect(rectContainsPoint(r, { x: 0, y: 5 })).toBe(true);
    expect(rectContainsPoint(r, { x: 10, y: 10 })).toBe(true);
  });

  it('rejects points outside', () => {
    expect(rectContainsPoint(r, { x: -0.1, y: 5 })).toBe(false);
    expect(rectContainsPoint(r, { x: 5, y: 10.1 })).toBe(false);
  });
});

describe('rectsIntersect', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };

  it('detects overlap', () => {
    expect(rectsIntersect(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
  });

  it('counts touching edges as intersecting', () => {
    expect(rectsIntersect(a, { x: 10, y: 0, w: 5, h: 5 })).toBe(true);
  });

  it('rejects separated rects on either axis', () => {
    expect(rectsIntersect(a, { x: 10.5, y: 0, w: 5, h: 5 })).toBe(false);
    expect(rectsIntersect(a, { x: 0, y: 20, w: 5, h: 5 })).toBe(false);
  });

  it('is symmetric', () => {
    const b = { x: 5, y: 5, w: 10, h: 10 };
    expect(rectsIntersect(a, b)).toBe(rectsIntersect(b, a));
  });
});

describe('rectContainsRect', () => {
  const outer = { x: 0, y: 0, w: 100, h: 100 };

  it('accepts a fully enclosed rect', () => {
    expect(rectContainsRect(outer, { x: 10, y: 10, w: 10, h: 10 })).toBe(true);
  });

  it('accepts a rect flush with the edges', () => {
    expect(rectContainsRect(outer, outer)).toBe(true);
  });

  it('rejects a rect poking out', () => {
    expect(rectContainsRect(outer, { x: 95, y: 10, w: 10, h: 10 })).toBe(false);
  });
});

describe('expandRect', () => {
  it('grows on every side', () => {
    expect(expandRect({ x: 10, y: 10, w: 20, h: 20 }, 5)).toEqual({ x: 5, y: 5, w: 30, h: 30 });
  });

  it('shrinks with a negative amount', () => {
    expect(expandRect({ x: 10, y: 10, w: 20, h: 20 }, -5)).toEqual({ x: 15, y: 15, w: 10, h: 10 });
  });
});

describe('unionRects', () => {
  it('returns null for nothing', () => {
    expect(unionRects([])).toBeNull();
  });

  it('returns the rect itself for one', () => {
    const r = { x: 3, y: 4, w: 5, h: 6 };
    expect(unionRects([r])).toEqual(r);
  });

  it('wraps several, including a negative-origin one', () => {
    expect(
      unionRects([
        { x: 0, y: 0, w: 10, h: 10 },
        { x: -20, y: 5, w: 5, h: 5 },
        { x: 30, y: 30, w: 10, h: 10 },
      ]),
    ).toEqual({ x: -20, y: 0, w: 60, h: 40 });
  });
});
