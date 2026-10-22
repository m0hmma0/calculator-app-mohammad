import { describe, expect, it } from 'vitest';
import { createElement, type BoardElement } from '@/model/element';
import { framesInOrder } from '@/workshop/presentation';

const frame = (id: string, x: number, y: number, w = 200, h = 140): BoardElement =>
  createElement({ type: 'frame', box: { x, y, w, h }, z: 'a0', id });

describe('presentation order', () => {
  it('reads frames left to right, then top to bottom', () => {
    const frames = [frame('c', 0, 400), frame('b', 300, 0), frame('a', 0, 0)];
    expect(framesInOrder(frames).map((each) => each.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps a hand-placed row together even when it is a little uneven', () => {
    const frames = [frame('right', 300, 0), frame('left', 0, 30), frame('below', 0, 300)];
    expect(framesInOrder(frames).map((each) => each.id)).toEqual(['left', 'right', 'below']);
  });

  it('skips hidden frames and everything that is not a frame', () => {
    const hidden = { ...frame('hidden', 0, 0), hidden: true };
    const rect = createElement({ type: 'rect', box: { x: 0, y: 0, w: 10, h: 10 }, z: 'a0' });
    expect(framesInOrder([hidden, rect, frame('shown', 500, 0)]).map((each) => each.id)).toEqual([
      'shown',
    ]);
  });
});
