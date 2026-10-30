import { describe, expect, it } from 'vitest';
import { createElement, type BoardElement } from '@/model/element';
import { frameNumbers, framesInOrder, slidePatches } from '@/workshop/presentation';

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

describe('numbered frames', () => {
  it('puts numbered frames first, by number, then the rest in reading order', () => {
    const frames = [
      frame('a', 0, 0),
      { ...frame('b', 300, 0), slide: 'a2' },
      frame('c', 600, 0),
      { ...frame('d', 0, 400), slide: 'a1' },
    ];
    expect(framesInOrder(frames).map((each) => each.id)).toEqual(['d', 'b', 'a', 'c']);
    expect(frameNumbers(frames).get('a')).toBe(3);
  });

  it('gives every frame a key, in exactly the order asked for', () => {
    const frames = [frame('a', 0, 0), frame('b', 300, 0), frame('c', 600, 0)];
    const patches = slidePatches(['c', 'a', 'b']);
    const keyed = frames.map((each) => ({ ...each, ...patches.get(each.id) }));
    expect(framesInOrder(keyed).map((each) => each.id)).toEqual(['c', 'a', 'b']);
  });

  it('falls back to reading order for two frames with the same number', () => {
    const frames = [
      { ...frame('right', 300, 0), slide: 'a0' },
      { ...frame('left', 0, 0), slide: 'a0' },
    ];
    expect(framesInOrder(frames).map((each) => each.id)).toEqual(['left', 'right']);
  });
});
