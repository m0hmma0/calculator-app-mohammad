import { describe, expect, it } from 'vitest';
import { elementCorners, worldToLocal } from '@/model/bounds';
import { createElement, type BoardElement } from '@/model/element';
import { fitWidthPatch, frameForFitWidth } from '@/model/fitWidth';

function frame(box: Pick<BoardElement, 'x' | 'y' | 'w' | 'h'>): BoardElement {
  return createElement({ type: 'frame', box, z: 'a0' });
}

describe('Fit width', () => {
  it('uses the smallest visible frame and fills its width even when rotated', () => {
    const outer = frame({ x: 0, y: 0, w: 800, h: 600 });
    const inner = { ...frame({ x: 100, y: 100, w: 400, h: 250 }), rotation: Math.PI / 6 };
    const hidden = { ...frame({ x: 220, y: 160, w: 160, h: 100 }), hidden: true };
    const item = createElement({
      type: 'image',
      box: { x: 250, y: 200, w: 100, h: 50 },
      z: 'a1',
    });
    expect(frameForFitWidth(item, [outer, inner, hidden])).toBe(inner);

    const fitted = { ...item, ...fitWidthPatch(item, inner) };
    const corners = elementCorners(fitted).map((corner) => worldToLocal(inner, corner));
    const xs = corners.map((corner) => corner.x);
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(inner.w);
    expect(fitted.w / fitted.h).toBeCloseTo(2);
    expect(fitted.rotation).toBe(item.rotation);
  });

  it('centres vertical overflow while preserving width and proportions', () => {
    const target = frame({ x: 100, y: 100, w: 300, h: 150 });
    const item = createElement({
      type: 'rect',
      box: { x: 220, y: 140, w: 30, h: 60 },
      z: 'a1',
    });
    expect(fitWidthPatch(item, target)).toEqual({ x: 100, y: -125, w: 300, h: 600 });
  });
});
