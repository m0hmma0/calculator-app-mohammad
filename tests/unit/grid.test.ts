import { describe, expect, it } from 'vitest';
import { BASE_GRID, gridOpacity, gridStep } from '@/canvas/grid';
import { MAX_ZOOM, MIN_ZOOM } from '@/canvas/viewport';

describe('gridStep', () => {
  it('uses the base spacing at 100%', () => {
    expect(gridStep(1)).toBe(BASE_GRID);
  });

  it('keeps on-screen spacing legible across the whole zoom range', () => {
    for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom *= 1.15) {
      const spacing = gridStep(zoom) * zoom;
      expect(spacing).toBeGreaterThanOrEqual(12);
      expect(spacing).toBeLessThanOrEqual(56);
    }
  });

  it('coarsens when zoomed out and subdivides when zoomed in', () => {
    expect(gridStep(0.05)).toBeGreaterThan(BASE_GRID);
    expect(gridStep(20)).toBeLessThan(BASE_GRID);
  });

  it('moves in 4x steps', () => {
    const coarse = gridStep(0.01);
    const fine = gridStep(1);
    const ratio = coarse / fine;
    expect(Math.log(ratio) / Math.log(4) - Math.round(Math.log(ratio) / Math.log(4))).toBeCloseTo(
      0,
      9,
    );
  });

  it('falls back to the base spacing on nonsense input', () => {
    expect(gridStep(0)).toBe(BASE_GRID);
    expect(gridStep(Number.NaN)).toBe(BASE_GRID);
  });
});

describe('gridOpacity', () => {
  it('fades dots as they crowd together', () => {
    expect(gridOpacity(26)).toBeCloseTo(1, 6);
    expect(gridOpacity(13)).toBeLessThan(1);
    expect(gridOpacity(1)).toBe(0.45);
    expect(gridOpacity(200)).toBe(1);
  });
});
