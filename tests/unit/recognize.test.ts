import { describe, expect, it } from 'vitest';
import type { Point } from '@/geometry';
import { recognizeShape } from '@/ink/recognize';
import { createElement } from '@/model/element';
import { polygonPoints } from '@/model/shapePath';

/** A repeatable wobble, so a failing case fails the same way every run. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/**
 * The outline traced the way a hand traces it: from some point along it, in short
 * steps, every step a little off, ending near (and sometimes past) where it began.
 */
function handDrawn(outline: readonly Point[], seed: number, wobble = 3, overshoot = 0.04): Point[] {
  const next = random(seed);
  const n = outline.length;
  const start = Math.floor(next() * n);
  const steps = Math.round(n * (1 + overshoot));
  const out: Point[] = [];
  for (let step = 0; step < steps; step += 1) {
    const a = outline[(start + step) % n]!;
    const b = outline[(start + step + 1) % n]!;
    for (let t = 0; t < 1; t += 0.25) {
      out.push({
        x: a.x + (b.x - a.x) * t + (next() - 0.5) * wobble,
        y: a.y + (b.y - a.y) * t + (next() - 0.5) * wobble,
      });
    }
  }
  return out;
}

const around = (count: number, at: (t: number) => Point) =>
  Array.from({ length: count }, (_, index) => at(index / count));

const oval = (rx: number, ry: number) =>
  around(90, (t) => ({
    x: 300 + Math.cos(t * Math.PI * 2) * rx,
    y: 200 + Math.sin(t * Math.PI * 2) * ry,
  }));

function polyline(corners: readonly Point[], perSide = 24): Point[] {
  const out: Point[] = [];
  corners.forEach((corner, index) => {
    const to = corners[(index + 1) % corners.length]!;
    for (let step = 0; step < perSide; step += 1) {
      const t = step / perSide;
      out.push({ x: corner.x + (to.x - corner.x) * t, y: corner.y + (to.y - corner.y) * t });
    }
  });
  return out;
}

const shapeOutline = (type: 'cloud' | 'spike', w: number, h: number) =>
  polygonPoints(createElement({ type, box: { x: 0, y: 0, w, h }, z: 'a0' })).map((point) => ({
    x: point.x + 100,
    y: point.y + 100,
  }));

describe('smart shapes', () => {
  it('a wobbly circle is a circle, its sides made equal', () => {
    for (const seed of [1, 2, 3]) {
      const shape = recognizeShape(handDrawn(oval(80, 76), seed));
      expect(shape?.type).toBe('ellipse');
      expect(shape!.box.w).toBeCloseTo(shape!.box.h, 5);
    }
  });

  it('a wobbly oval stays an oval', () => {
    const shape = recognizeShape(handDrawn(oval(140, 60), 4));
    expect(shape?.type).toBe('ellipse');
    expect(shape!.box.w / shape!.box.h).toBeGreaterThan(2);
  });

  it('a rectangle and a square', () => {
    const rect = recognizeShape(
      handDrawn(
        polyline([
          { x: 100, y: 100 },
          { x: 360, y: 100 },
          { x: 360, y: 240 },
          { x: 100, y: 240 },
        ]),
        5,
      ),
    );
    expect(rect?.type).toBe('rect');
    expect(rect!.box.w / rect!.box.h).toBeGreaterThan(1.6);

    const square = recognizeShape(
      handDrawn(
        polyline([
          { x: 100, y: 100 },
          { x: 250, y: 100 },
          { x: 250, y: 240 },
          { x: 100, y: 240 },
        ]),
        6,
      ),
    );
    expect(square?.type).toBe('rect');
    expect(square!.box.w).toBeCloseTo(square!.box.h, 5);
  });

  it('a triangle, pointing whichever way it was drawn', () => {
    const up = recognizeShape(
      handDrawn(
        polyline([
          { x: 200, y: 80 },
          { x: 320, y: 260 },
          { x: 80, y: 260 },
        ]),
        7,
      ),
    );
    expect(up).toMatchObject({ type: 'triangle', rotation: 0 });

    const down = recognizeShape(
      handDrawn(
        polyline([
          { x: 80, y: 80 },
          { x: 320, y: 80 },
          { x: 200, y: 260 },
        ]),
        8,
      ),
    );
    expect(down).toMatchObject({ type: 'triangle', rotation: Math.PI });

    const right = recognizeShape(
      handDrawn(
        polyline([
          { x: 80, y: 80 },
          { x: 240, y: 230 },
          { x: 80, y: 380 },
        ]),
        9,
      ),
    );
    expect(right).toMatchObject({ type: 'triangle', rotation: Math.PI / 2 });
    // Turned on its side, the box is upright and turned with it.
    expect(right!.box.w).toBeGreaterThan(right!.box.h);
  });

  it('a cloud and a spike', () => {
    expect(recognizeShape(handDrawn(shapeOutline('cloud', 420, 200), 10, 2))?.type).toBe('cloud');
    expect(recognizeShape(handDrawn(shapeOutline('spike', 380, 240), 11, 2))?.type).toBe('spike');
  });

  it('clouds and spikes of other proportions, as hands draw them', () => {
    for (const [bumps, seed] of [
      [6, 20],
      [8, 21],
      [11, 22],
    ] as const) {
      const cloud = around(bumps * 24, (t) => {
        const angle = t * Math.PI * 2;
        const swell = 1 + 0.25 * Math.abs(Math.sin((bumps * angle) / 2));
        return { x: 300 + Math.cos(angle) * 160 * swell, y: 200 + Math.sin(angle) * 80 * swell };
      });
      expect(recognizeShape(handDrawn(cloud, seed, 3)), `cloud of ${bumps}`).toMatchObject({
        type: 'cloud',
      });
    }
    for (const [points, seed] of [
      [7, 30],
      [9, 31],
      [12, 32],
    ] as const) {
      const corners = around(points * 2, (t) => {
        const index = Math.round(t * points * 2);
        const angle = t * Math.PI * 2;
        const radius = index % 2 === 0 ? 1 - 0.2 * ((index * 0.37) % 1) : 0.5;
        return { x: 300 + Math.cos(angle) * 170 * radius, y: 200 + Math.sin(angle) * 110 * radius };
      });
      expect(
        recognizeShape(handDrawn(polyline(corners, 10), seed, 3)),
        `spike of ${points}`,
      ).toMatchObject({
        type: 'spike',
      });
    }
  });

  it('leaves alone anything open, tiny, or shaped like nothing on the list', () => {
    // Open: an arc that stops well short of where it started.
    const arc = around(60, (t) => ({
      x: 300 + Math.cos(t * Math.PI * 1.4) * 100,
      y: 200 + Math.sin(t * Math.PI * 1.4) * 100,
    }));
    const wobble = random(12);
    const traced = arc.map((point) => ({
      x: point.x + (wobble() - 0.5) * 2,
      y: point.y + (wobble() - 0.5) * 2,
    }));
    expect(recognizeShape(traced), 'arc').toBeNull();

    // A straight line there and back.
    const line = around(60, (t) => ({ x: 100 + Math.abs(t - 0.5) * 400, y: 200 }));
    expect(recognizeShape(line), 'line').toBeNull();

    // Too small to mean anything.
    expect(recognizeShape(handDrawn(oval(5, 5), 13, 0.5)), 'tiny').toBeNull();

    // A closed squiggle: a figure of eight.
    const eight = around(120, (t) => ({
      x: 300 + Math.sin(t * Math.PI * 2) * 120,
      y: 200 + Math.sin(t * Math.PI * 4) * 60,
    }));
    expect(recognizeShape(handDrawn(eight, 14, 2)), 'eight').toBeNull();
  });
});
