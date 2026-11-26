import { describe, expect, it } from 'vitest';
import { createElement, type BoardElement } from '@/model/element';
import {
  frameNumbers,
  framesInOrder,
  hasFrameNumbers,
  selectedFrame,
  slidePatches,
  keepOnSlide,
} from '@/workshop/presentation';

const frame = (id: string, x: number, y: number, w = 200, h = 140): BoardElement =>
  createElement({ type: 'frame', box: { x, y, w, h }, z: 'a0', id });

describe('presentation order', () => {
  it('reads frames down a column, then down the next column to the right', () => {
    const frames = [frame('c', 0, 400), frame('b', 300, 0), frame('a', 0, 0)];
    expect(framesInOrder(frames).map((each) => each.id)).toEqual(['a', 'c', 'b']);
  });

  it('numbers a grid column by column', () => {
    const grid = [
      ['1', '4'],
      ['2', '5'],
      ['3', '6'],
    ].flatMap((row, y) => row.map((id, x) => frame(id, x * 300, y * 200)));
    expect(framesInOrder(grid.reverse()).map((each) => each.id)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
  });

  it('keeps a hand-placed column together even when it is a little uneven', () => {
    const frames = [frame('right', 300, 0), frame('below', 30, 300), frame('top', 0, 0)];
    expect(framesInOrder(frames).map((each) => each.id)).toEqual(['top', 'below', 'right']);
  });

  it('still reads a single row left to right', () => {
    const frames = [frame('c', 600, 20), frame('a', 0, 0), frame('b', 300, -10)];
    expect(framesInOrder(frames).map((each) => each.id)).toEqual(['a', 'b', 'c']);
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
  it('puts numbered frames first, by number, then the rest in column order', () => {
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

  it('falls back to column order for two frames with the same number', () => {
    const frames = [
      { ...frame('right', 300, 0), slide: 'a0' },
      { ...frame('left', 0, 0), slide: 'a0' },
    ];
    expect(framesInOrder(frames).map((each) => each.id)).toEqual(['left', 'right']);
  });
});

describe('where presenting starts', () => {
  const frames = [frame('left', 0, 0), frame('right', 300, 0)];
  const inRight = createElement({
    type: 'rect',
    box: { x: 340, y: 40, w: 40, h: 40 },
    z: 'a1',
    id: 'inside',
  });
  const outside = createElement({
    type: 'rect',
    box: { x: 0, y: 600, w: 40, h: 40 },
    z: 'a1',
    id: 'outside',
  });
  const board = [...frames, inRight, outside];

  it('is the selected frame, the first in order if several are', () => {
    expect(selectedFrame(board, ['right'])?.id).toBe('right');
    expect(selectedFrame(board, ['right', 'left'])?.id).toBe('left');
  });

  it('is the frame holding what is selected', () => {
    expect(selectedFrame(board, ['inside'])?.id).toBe('right');
  });

  it('is nowhere in particular with nothing selected, or nothing inside a frame', () => {
    expect(selectedFrame(board, [])).toBeNull();
    expect(selectedFrame(board, ['outside'])).toBeNull();
  });

  it('knows whether any frame has a number of its own', () => {
    expect(hasFrameNumbers(board)).toBe(false);
    expect(hasFrameNumbers([...board, { ...frame('n', 600, 0), slide: 'a0' }])).toBe(true);
    expect(hasFrameNumbers([{ ...frame('n', 600, 0), slide: null }])).toBe(false);
  });
});

describe('the view while a slide is on show', () => {
  const frame = { x: 0, y: 0, w: 1600, h: 900 };
  const size = { width: 800, height: 600 };
  // The whole slide, centred: 0.5 fits its width.
  const fitted = { x: 0, y: -150, zoom: 0.5 };

  it('never goes smaller than the slide, and at its size shows it whole', () => {
    expect(keepOnSlide({ x: 500, y: 500, zoom: 0.2 }, frame, fitted, size)).toEqual(fitted);
    expect(keepOnSlide({ x: -300, y: 40, zoom: 0.5 }, frame, fitted, size)).toEqual(fitted);
  });

  it('zoomed in, moves inside the slide but never past its edges', () => {
    // At 1×, 800×600 of the slide shows: x may run 0..800, y 0..300.
    expect(keepOnSlide({ x: 200, y: 100, zoom: 1 }, frame, fitted, size)).toEqual({
      x: 200,
      y: 100,
      zoom: 1,
    });
    expect(keepOnSlide({ x: -500, y: 9000, zoom: 1 }, frame, fitted, size)).toEqual({
      x: 0,
      y: 300,
      zoom: 1,
    });
    expect(keepOnSlide({ x: 5000, y: -20, zoom: 1 }, frame, fitted, size)).toEqual({
      x: 800,
      y: 0,
      zoom: 1,
    });
  });

  it('keeps a side that still fits centred', () => {
    // At 0.6× the slide is 960 wide (more than the screen) but 540 high (less).
    const view = keepOnSlide({ x: 100, y: -400, zoom: 0.6 }, frame, fitted, size);
    expect(view.x).toBe(100);
    expect(view.y).toBeCloseTo(450 - 600 / 0.6 / 2, 6);
  });
});
