import { describe, expect, it } from 'vitest';
import {
  boardToScreen,
  centerOn,
  clampZoom,
  fitToRect,
  formatZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  panByScreen,
  screenToBoard,
  viewportsEqual,
  visibleBounds,
  zoomAt,
  zoomAtCenter,
} from '@/canvas/viewport';

const SIZE = { width: 800, height: 600 };

describe('coordinate conversion', () => {
  it('maps the viewport origin to the screen origin', () => {
    expect(boardToScreen({ x: 100, y: 50, zoom: 1 }, { x: 100, y: 50 })).toEqual({ x: 0, y: 0 });
  });

  it('scales by zoom', () => {
    expect(boardToScreen({ x: 0, y: 0, zoom: 2 }, { x: 10, y: 20 })).toEqual({ x: 20, y: 40 });
  });

  it('round-trips at any zoom', () => {
    for (const zoom of [0.02, 0.37, 1, 3.5, 64]) {
      const vp = { x: -123.5, y: 456.25, zoom };
      const point = { x: 42, y: -17 };
      const back = screenToBoard(vp, boardToScreen(vp, point));
      expect(back.x).toBeCloseTo(point.x, 6);
      expect(back.y).toBeCloseTo(point.y, 6);
    }
  });
});

describe('zoomAt', () => {
  // The behaviour the Phase 1 checklist calls "zooms toward your cursor".
  it('keeps the board point under the cursor fixed', () => {
    const vp = { x: 100, y: 200, zoom: 1 };
    const cursor = { x: 640, y: 130 };
    const before = screenToBoard(vp, cursor);

    for (const factor of [1.25, 0.5, 8, 0.1]) {
      const next = zoomAt(vp, cursor, vp.zoom * factor);
      const after = screenToBoard(next, cursor);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    }
  });

  it('still pins the cursor when the zoom request is clamped', () => {
    const vp = { x: 0, y: 0, zoom: 1 };
    const cursor = { x: 300, y: 300 };
    const before = screenToBoard(vp, cursor);

    const next = zoomAt(vp, cursor, MAX_ZOOM * 1000);
    expect(next.zoom).toBe(MAX_ZOOM);
    expect(screenToBoard(next, cursor).x).toBeCloseTo(before.x, 6);
  });

  it('zooms about the middle of the stage when asked to', () => {
    const vp = { x: 0, y: 0, zoom: 1 };
    const centre = { x: SIZE.width / 2, y: SIZE.height / 2 };
    const before = screenToBoard(vp, centre);
    const after = screenToBoard(zoomAtCenter(vp, SIZE, 4), centre);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});

describe('clampZoom', () => {
  it('holds the limits', () => {
    expect(clampZoom(0)).toBe(1);
    expect(clampZoom(-3)).toBe(1);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(1e9)).toBe(MAX_ZOOM);
    expect(clampZoom(1e-9)).toBe(MIN_ZOOM);
    expect(clampZoom(2.5)).toBe(2.5);
  });
});

describe('panByScreen', () => {
  it('moves the board by screen pixels, scaled by zoom', () => {
    expect(panByScreen({ x: 0, y: 0, zoom: 2 }, 100, 50)).toEqual({ x: -50, y: -25, zoom: 2 });
  });

  it('drags further in board units when zoomed out', () => {
    const out = panByScreen({ x: 0, y: 0, zoom: 0.5 }, 100, 0);
    expect(out.x).toBe(-200);
  });
});

describe('visibleBounds', () => {
  it('covers exactly the stage', () => {
    expect(visibleBounds({ x: 10, y: 20, zoom: 2 }, SIZE)).toEqual({
      x: 10,
      y: 20,
      w: 400,
      h: 300,
    });
  });
});

describe('fitToRect', () => {
  it('frames the content and centres it', () => {
    const rect = { x: 0, y: 0, w: 1000, h: 500 };
    const vp = fitToRect(rect, SIZE, 50);

    const view = visibleBounds(vp, SIZE);
    expect(view.x).toBeLessThanOrEqual(rect.x);
    expect(view.y).toBeLessThanOrEqual(rect.y);
    expect(view.x + view.w).toBeGreaterThanOrEqual(rect.x + rect.w);
    expect(view.y + view.h).toBeGreaterThanOrEqual(rect.y + rect.h);

    const centre = screenToBoard(vp, { x: SIZE.width / 2, y: SIZE.height / 2 });
    expect(centre.x).toBeCloseTo(500, 6);
    expect(centre.y).toBeCloseTo(250, 6);
  });

  it('survives a degenerate rect instead of dividing by zero', () => {
    const vp = fitToRect({ x: 5, y: 5, w: 0, h: 0 }, SIZE);
    expect(Number.isFinite(vp.x)).toBe(true);
    expect(Number.isFinite(vp.y)).toBe(true);
    expect(vp.zoom).toBe(1);
  });

  it('clamps rather than zooming past the limit on a tiny rect', () => {
    expect(fitToRect({ x: 0, y: 0, w: 0.0001, h: 0.0001 }, SIZE).zoom).toBe(MAX_ZOOM);
  });
});

describe('centerOn', () => {
  it('puts the target in the middle without changing zoom', () => {
    const vp = centerOn({ x: 0, y: 0, zoom: 2 }, SIZE, { x: 300, y: 400 });
    expect(vp.zoom).toBe(2);
    const centre = screenToBoard(vp, { x: SIZE.width / 2, y: SIZE.height / 2 });
    expect(centre.x).toBeCloseTo(300, 6);
    expect(centre.y).toBeCloseTo(400, 6);
  });
});

describe('viewportsEqual', () => {
  it('ignores sub-pixel drift but notices real movement', () => {
    expect(viewportsEqual({ x: 0, y: 0, zoom: 1 }, { x: 1e-9, y: 0, zoom: 1 })).toBe(true);
    expect(viewportsEqual({ x: 0, y: 0, zoom: 1 }, { x: 0.5, y: 0, zoom: 1 })).toBe(false);
    expect(viewportsEqual({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0, zoom: 1.5 })).toBe(false);
  });
});

describe('formatZoom', () => {
  it('reads the way a zoom control should', () => {
    expect(formatZoom(1)).toBe('100%');
    expect(formatZoom(0.5)).toBe('50%');
    expect(formatZoom(12.345)).toBe('1235%');
    expect(formatZoom(0.02)).toBe('2%');
  });

  it('never shows 0%', () => {
    expect(formatZoom(0.001)).toBe('1%');
  });
});
