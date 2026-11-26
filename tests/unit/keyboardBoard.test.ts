import { describe, expect, it } from 'vitest';
import { describeSelection, readingOrder } from '@/input/keyboardBoard';
import { createElement, type BoardElement } from '@/model/element';

const shape = (id: string, x: number, y: number, extra: Partial<BoardElement> = {}) => ({
  ...createElement({ type: 'rect', box: { x, y, w: 100, h: 80 }, z: 'a0', id }),
  ...extra,
});

describe('Tab’s order on the board', () => {
  it('reads across a row, then down to the next, a few pixels out of line still one row', () => {
    const elements = [
      shape('c', 0, 200),
      shape('b', 300, 10),
      shape('a', 0, 0),
      shape('d', 300, 205),
    ];
    expect(readingOrder(elements).map((element) => element.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('leaves out what is hidden and what is inside a group', () => {
    const elements = [
      shape('a', 0, 0),
      shape('hidden', 200, 0, { hidden: true }),
      shape('child', 400, 0, { parentId: 'g' }),
    ];
    expect(readingOrder(elements).map((element) => element.id)).toEqual(['a']);
  });

  it('says what is selected, with its words and its place', () => {
    const elements = [shape('a', 0, 0, { text: 'Hello  there' }), shape('b', 200, 0)];
    expect(describeSelection(elements, ['a'])).toBe('Rectangle: Hello there, 1 of 2');
    expect(describeSelection(elements, ['a', 'b'])).toBe('2 items selected');
    expect(describeSelection(elements, [])).toBe('');
  });
});
