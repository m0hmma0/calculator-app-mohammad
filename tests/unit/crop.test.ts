import { describe, expect, it } from 'vitest';
import { cropSource, isCrop, recrop, wholePicture } from '@/model/crop';
import { createElement, type BoardElement } from '@/model/element';

const picture = (fields: Partial<BoardElement> = {}): BoardElement => ({
  ...createElement({ type: 'image', box: { x: 100, y: 100, w: 400, h: 200 }, z: 'a0' }),
  ...fields,
});

describe('cropping a picture', () => {
  it('takes an edge in over the picture, which stays where it is', () => {
    const start = picture();
    // The right edge dragged a quarter of the way in.
    const cut = recrop(start, 'e', { x: 300, y: 100 }, 1);
    expect(cut).toMatchObject({ x: 100, y: 100, w: 300, h: 200 });
    expect(cut.crop).toEqual({ x: 0, y: 0, w: 0.75, h: 1 });
    // The left edge in by 100: the box starts later, the picture has not moved.
    const both = recrop({ ...start, ...cut }, 'w', { x: 100, y: 50 }, 1);
    expect(both).toMatchObject({ x: 200, w: 200 });
    expect(both.crop!.x).toBeCloseTo(0.25);
    expect(both.crop!.w).toBeCloseTo(0.5);
    expect(wholePicture({ ...start, ...both })).toEqual({ x: -100, y: 0, w: 400, h: 200 });
  });

  it('stops at the whole picture, and drops the crop once it is all shown again', () => {
    const start = picture({ ...recrop(picture(), 'e', { x: 300, y: 0 }, 1) });
    const out = recrop(start, 'e', { x: 900, y: 0 }, 1);
    expect(out).toMatchObject({ x: 100, w: 400 });
    expect(out.crop).toBeNull();
  });

  it('never lets edges cross', () => {
    const out = recrop(picture(), 'w', { x: 900, y: 0 }, 8);
    expect(out.w).toBe(8);
    expect(out.x).toBe(100 + 400 - 8);
  });

  it('keeps a turned picture in place on the board', () => {
    const start = picture({ rotation: Math.PI / 2 });
    // Turned a quarter: its own right edge points down on the board.
    const cut = recrop(start, 'e', { x: 300, y: 100 }, 1);
    const centre = { x: cut.x + cut.w / 2, y: cut.y + cut.h / 2 };
    expect(centre.x).toBeCloseTo(300);
    expect(centre.y).toBeCloseTo(150);
  });

  it('reads back only a real crop, and finds it in a bitmap', () => {
    expect(isCrop({ x: 0.1, y: 0, w: 0.5, h: 1 })).toBe(true);
    expect(isCrop({ x: 0.1, y: 0, w: 0, h: 1 })).toBe(false);
    expect(isCrop({ x: -1, y: 0, w: 0.5, h: 1 })).toBe(false);
    expect(isCrop('crop')).toBe(false);
    expect(cropSource({ x: 0.25, y: 0, w: 0.5, h: 1 }, 800, 400)).toEqual([200, 0, 400, 400]);
  });
});
