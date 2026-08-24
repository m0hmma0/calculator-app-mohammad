import { describe, expect, it } from 'vitest';
import { routeConnectors } from '@/model/connectors';
import { createElement, type BoardElement } from '@/model/element';
import { boxFromEnds, lineEnds } from '@/model/shapePath';
import { keysBetween } from '@/model/zorder';

const box = (x: number, y: number, w = 60, h = 40) => ({ x, y, w, h });

function scene(): BoardElement[] {
  const keys = keysBetween(null, null, 3);
  const a = createElement({ type: 'rect', box: box(100, 100), z: keys[0]!, id: 'a' });
  const b = createElement({ type: 'rect', box: box(100, 400), z: keys[1]!, id: 'b' });
  const arrow = createElement({
    type: 'arrow',
    box: { x: 130, y: 140, w: 0, h: 260 },
    z: keys[2]!,
    id: 'arrow',
  });
  arrow.from = { elementId: 'a' };
  arrow.to = { elementId: 'b' };
  return [a, b, arrow];
}

const arrowIn = (elements: BoardElement[]) => elements.find((element) => element.id === 'arrow')!;

/** Absolute start and end of a connector, in board coordinates. */
function ends(element: BoardElement) {
  const [start, end] = lineEnds(element);
  return {
    start: { x: element.x + start.x, y: element.y + start.y },
    end: { x: element.x + end.x, y: element.y + end.y },
  };
}

describe('boxFromEnds', () => {
  it('normalises the box whichever way the line was drawn', () => {
    const down = boxFromEnds({ x: 10, y: 10 }, { x: 50, y: 90 });
    expect(down).toMatchObject({ x: 10, y: 10, w: 40, h: 80 });

    const up = boxFromEnds({ x: 50, y: 90 }, { x: 10, y: 10 });
    expect(up).toMatchObject({ x: 10, y: 10, w: 40, h: 80 });
  });

  it('records the diagonal', () => {
    expect(boxFromEnds({ x: 0, y: 0 }, { x: 50, y: 50 }).flipX).toBe(false);
    expect(boxFromEnds({ x: 0, y: 50 }, { x: 50, y: 0 }).flipX).toBe(true);
  });

  it('gives a vertical or horizontal line the untilted diagonal', () => {
    // The regression: treating a zero-width line as flipped put the arrowhead on
    // the wrong end of every vertical connector.
    expect(boxFromEnds({ x: 10, y: 0 }, { x: 10, y: 90 }).flipX).toBe(false);
    expect(boxFromEnds({ x: 0, y: 10 }, { x: 90, y: 10 }).flipX).toBe(false);
  });

  it('records which end the line starts from', () => {
    expect(boxFromEnds({ x: 0, y: 0 }, { x: 50, y: 50 }).reverse).toBe(false);
    expect(boxFromEnds({ x: 50, y: 50 }, { x: 0, y: 0 }).reverse).toBe(true);
    expect(boxFromEnds({ x: 10, y: 90 }, { x: 10, y: 0 }).reverse).toBe(true);
  });

  it('round-trips every direction back to the points it was given', () => {
    const cases: Array<[{ x: number; y: number }, { x: number; y: number }]> = [
      [
        { x: 0, y: 0 },
        { x: 40, y: 60 },
      ],
      [
        { x: 40, y: 60 },
        { x: 0, y: 0 },
      ],
      [
        { x: 0, y: 60 },
        { x: 40, y: 0 },
      ],
      [
        { x: 40, y: 0 },
        { x: 0, y: 60 },
      ],
      [
        { x: 20, y: 0 },
        { x: 20, y: 60 },
      ],
      [
        { x: 20, y: 60 },
        { x: 20, y: 0 },
      ],
      [
        { x: 0, y: 20 },
        { x: 60, y: 20 },
      ],
      [
        { x: 60, y: 20 },
        { x: 0, y: 20 },
      ],
    ];

    for (const [start, end] of cases) {
      const encoded = boxFromEnds(start, end);
      const element = {
        ...createElement({ type: 'arrow', box: encoded, z: 'a0' }),
        style: {
          ...createElement({ type: 'arrow', box: encoded, z: 'a0' }).style,
          flipX: encoded.flipX,
          reverse: encoded.reverse,
        },
      };
      const decoded = ends(element);
      expect(decoded.start, `start of ${JSON.stringify(start)}`).toEqual(start);
      expect(decoded.end, `end of ${JSON.stringify(end)}`).toEqual(end);
    }
  });
});

// Checklist item 11.
describe('routeConnectors', () => {
  it('pulls both ends onto the bound elements edges', () => {
    const routed = routeConnectors(scene());
    const { start, end } = ends(arrowIn(routed));

    // Bottom edge of a (y = 140) up to the top edge of b (y = 400).
    expect(start.y).toBeCloseTo(140, 6);
    expect(end.y).toBeCloseTo(400, 6);
    expect(start.x).toBeCloseTo(130, 6);
  });

  it('points from the source to the target, not the other way round', () => {
    const routed = routeConnectors(scene());
    const { start, end } = ends(arrowIn(routed));
    expect(end.y).toBeGreaterThan(start.y);
  });

  it('keeps pointing the right way when the target is above the source', () => {
    const elements = scene();
    const b = elements.find((element) => element.id === 'b')!;
    b.y = -400;

    const routed = routeConnectors(elements);
    const { start, end } = ends(arrowIn(routed));
    // The arrow now runs upward, so its head must be the higher of the two.
    expect(end.y).toBeLessThan(start.y);
  });

  it('re-routes when a bound element moves sideways', () => {
    const elements = scene();
    const before = ends(arrowIn(routeConnectors(elements)));

    const b = elements.find((element) => element.id === 'b')!;
    b.x = 700;
    const after = ends(arrowIn(routeConnectors(elements)));

    expect(after.end.x).not.toBeCloseTo(before.end.x, 1);
    expect(after.end.x).toBeGreaterThan(before.end.x);
  });

  it('leaves an unbound connector exactly as drawn', () => {
    const elements = scene();
    const arrow = arrowIn(elements);
    delete arrow.from;
    delete arrow.to;
    const before = { ...arrow };

    const routed = arrowIn(routeConnectors(elements));
    expect(routed).toMatchObject({ x: before.x, y: before.y, w: before.w, h: before.h });
  });

  it('keeps the drawn end when only one end is bound', () => {
    const elements = scene();
    const arrow = arrowIn(elements);
    delete arrow.to;

    const routed = arrowIn(routeConnectors(elements));
    const { end } = ends(routed);
    expect(end.y).toBeCloseTo(400, 6);
  });

  it('returns the same array when nothing is bound at all', () => {
    const elements = scene().filter((element) => element.type === 'rect');
    expect(routeConnectors(elements)).toBe(elements);
  });
});
