import { describe, expect, it } from 'vitest';
import { snapMove } from '@/snapping/snap';

const box = (x: number, y: number, w = 50, h = 40) => ({ x, y, w, h });

describe('alignment snapping', () => {
  it('pulls a near-miss left edge into line', () => {
    const result = snapMove(box(103, 300), [box(100, 100)], 8);
    expect(result.dx).toBeCloseTo(-3, 6);
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0]!.axis).toBe('x');
    expect(result.guides[0]!.position).toBeCloseTo(100, 6);
  });

  it('leaves a box alone when nothing is close', () => {
    const result = snapMove(box(400, 400), [box(100, 100)], 8);
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
    expect(result.guides).toEqual([]);
  });

  it('aligns centres, not just edges', () => {
    // Other box spans 100..150, centre 125. Moving box centre at 121 → nudge by 4.
    const result = snapMove(box(96, 300), [box(100, 100)], 8);
    expect(result.dx).toBeCloseTo(4, 6);
  });

  it('snaps a left edge to another box right edge', () => {
    const result = snapMove(box(153, 300), [box(100, 100)], 8);
    expect(result.dx).toBeCloseTo(-3, 6);
    expect(result.guides[0]!.position).toBeCloseTo(150, 6);
  });

  it('snaps both axes at once', () => {
    const result = snapMove(box(103, 104), [box(100, 100)], 8);
    expect(result.dx).toBeCloseTo(-3, 6);
    expect(result.dy).toBeCloseTo(-4, 6);
    expect(result.guides.map((guide) => guide.axis).sort()).toEqual(['x', 'y']);
  });

  it('prefers the closest of several candidates', () => {
    const result = snapMove(box(103, 300), [box(100, 100), box(106, 200)], 8);
    expect(result.dx).toBeCloseTo(-3, 6);
  });

  it('draws the guide long enough to span every box it touches', () => {
    const result = snapMove(box(103, 500), [box(100, 100), box(100, 300)], 8);
    const guide = result.guides.find((candidate) => candidate.axis === 'x')!;
    expect(guide.from).toBeLessThanOrEqual(100);
    expect(guide.to).toBeGreaterThanOrEqual(540);
  });

  it('does nothing when snapping is switched off', () => {
    expect(snapMove(box(103, 104), [box(100, 100)], 0)).toEqual({
      dx: 0,
      dy: 0,
      guides: [],
      spacing: [],
    });
  });
});

describe('equal-spacing snapping', () => {
  it('centres a box between two others', () => {
    // Left box ends at 150, right box starts at 350. A 50-wide box centres at 225.
    const result = snapMove(box(220, 100), [box(100, 100), box(350, 100)], 8);
    expect(result.dx).toBeCloseTo(5, 6);
    expect(result.spacing).toHaveLength(2);

    const [first, second] = result.spacing;
    expect(first!.end - first!.start).toBeCloseTo(second!.end - second!.start, 6);
  });

  it('continues a run at the same gap', () => {
    // Boxes at 100 and 200 leave a 50 gap, so the next one belongs at 300.
    const result = snapMove(box(304, 100), [box(100, 100), box(200, 100)], 8);
    expect(result.dx).toBeCloseTo(-4, 6);
    expect(result.spacing.length).toBeGreaterThan(0);
  });

  it('ignores boxes on a different row', () => {
    const result = snapMove(box(220, 900), [box(100, 100), box(350, 100)], 8);
    expect(result.dx).toBe(0);
    expect(result.spacing).toEqual([]);
  });

  it('needs at least two neighbours', () => {
    expect(snapMove(box(220, 100), [box(100, 100)], 8).spacing).toEqual([]);
  });

  it('works vertically too', () => {
    const result = snapMove(box(100, 220), [box(100, 100, 50, 40), box(100, 350, 50, 40)], 8);
    expect(result.dy).not.toBe(0);
    expect(result.spacing.some((mark) => mark.axis === 'y')).toBe(true);
  });
});

describe('threshold scaling', () => {
  it('respects the window it is given', () => {
    expect(snapMove(box(110, 300), [box(100, 100)], 5).dx).toBe(0);
    expect(snapMove(box(110, 300), [box(100, 100)], 15).dx).toBeCloseTo(-10, 6);
  });
});
