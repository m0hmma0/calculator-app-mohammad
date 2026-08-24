import { describe, expect, it } from 'vitest';
import { createElement, type BoardElement } from '@/model/element';
import { compareZ, keysBetween, reorder, sortByZ } from '@/model/zorder';

function board(count: number): BoardElement[] {
  const keys = keysBetween(null, null, count);
  return keys.map((z, index) =>
    createElement({ type: 'rect', box: { x: index, y: 0, w: 10, h: 10 }, z, id: `e${index}` }),
  );
}

const order = (elements: BoardElement[]) => sortByZ(elements).map((element) => element.id);

function applied(elements: BoardElement[], keys: Map<string, string>): BoardElement[] {
  return elements.map((element) =>
    keys.has(element.id) ? { ...element, z: keys.get(element.id)! } : element,
  );
}

describe('z keys', () => {
  it('sorts as plain strings', () => {
    const keys = keysBetween(null, null, 5);
    expect([...keys].sort()).toEqual(keys);
  });

  it('always finds room between two neighbours', () => {
    const low = 'a0';
    let high = 'a1';
    for (let round = 0; round < 30; round += 1) {
      const middle = keysBetween(low, high, 1)[0]!;
      expect(middle > low).toBe(true);
      expect(middle < high).toBe(true);
      high = middle;
    }
    expect(low < high).toBe(true);
  });

  it('breaks ties by id so ordering is never ambiguous', () => {
    const a = createElement({ type: 'rect', box: { x: 0, y: 0, w: 1, h: 1 }, z: 'a0', id: 'a' });
    const b = createElement({ type: 'rect', box: { x: 0, y: 0, w: 1, h: 1 }, z: 'a0', id: 'b' });
    expect(compareZ(a, b)).toBeLessThan(0);
    expect(compareZ(b, a)).toBeGreaterThan(0);
  });
});

describe('reorder', () => {
  it('steps one element forward past exactly one neighbour', () => {
    const elements = board(4); // e0 e1 e2 e3
    const next = applied(elements, reorder(elements, new Set(['e1']), 'forward'));
    expect(order(next)).toEqual(['e0', 'e2', 'e1', 'e3']);
  });

  it('steps one element backward past exactly one neighbour', () => {
    const elements = board(4);
    const next = applied(elements, reorder(elements, new Set(['e2']), 'backward'));
    expect(order(next)).toEqual(['e0', 'e2', 'e1', 'e3']);
  });

  it('sends to the front and to the back', () => {
    const elements = board(4);
    expect(order(applied(elements, reorder(elements, new Set(['e0']), 'front')))).toEqual([
      'e1',
      'e2',
      'e3',
      'e0',
    ]);
    expect(order(applied(elements, reorder(elements, new Set(['e3']), 'back')))).toEqual([
      'e3',
      'e0',
      'e1',
      'e2',
    ]);
  });

  it('keeps a multi-selection in its own order', () => {
    const elements = board(5);
    const next = applied(elements, reorder(elements, new Set(['e0', 'e1']), 'front'));
    const result = order(next);
    expect(result.slice(-2)).toEqual(['e0', 'e1']);
  });

  it('does nothing at the ends', () => {
    const elements = board(3);
    expect(reorder(elements, new Set(['e2']), 'forward').size).toBe(0);
    expect(reorder(elements, new Set(['e0']), 'backward').size).toBe(0);
  });

  it('does nothing with an empty selection', () => {
    expect(reorder(board(3), new Set(), 'front').size).toBe(0);
  });
});
