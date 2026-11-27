import { describe, expect, it } from 'vitest';
import { createElement } from '@/model/element';
import { overlappingFrame } from '@/model/frameGroups';

const shape = (type: 'frame' | 'rect', x: number, w: number) =>
  createElement({ type, box: { x, y: 0, w, h: 100 }, z: 'a0' });

describe('frame drops', () => {
  it('chooses the greatest overlap and takes the smaller frame on a tie', () => {
    const left = shape('frame', 0, 100);
    const right = shape('frame', 90, 120);
    const item = shape('rect', 80, 60);
    expect(overlappingFrame(item, [right, left])).toBe(right);

    const inner = shape('frame', 80, 60);
    const outer = shape('frame', 0, 200);
    expect(overlappingFrame(item, [inner, outer])).toBe(inner);
  });

  it('ignores edge contact and empty corners of a rotated frame', () => {
    expect(overlappingFrame(shape('rect', 100, 10), [shape('frame', 0, 100)])).toBeUndefined();
    const frame = { ...shape('frame', 0, 100), rotation: Math.PI / 4 };
    const item = { ...shape('rect', -10, 5), y: -10, h: 5 };
    expect(overlappingFrame(item, [frame])).toBeUndefined();
  });
});
