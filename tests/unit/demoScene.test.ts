import { describe, expect, it } from 'vitest';
import { generateDemoShapes, sceneBounds } from '@/scene/demoScene';

describe('generateDemoShapes', () => {
  it('produces the requested count', () => {
    expect(generateDemoShapes(250)).toHaveLength(250);
    expect(generateDemoShapes(0)).toHaveLength(0);
  });

  it('is deterministic for a seed', () => {
    expect(generateDemoShapes(50, 7)).toEqual(generateDemoShapes(50, 7));
  });

  it('differs between seeds', () => {
    expect(generateDemoShapes(50, 7)).not.toEqual(generateDemoShapes(50, 8));
  });

  it('keeps every shape valid and inside the palette', () => {
    for (const shape of generateDemoShapes(500, 3, 6)) {
      expect(shape.w).toBeGreaterThan(0);
      expect(shape.h).toBeGreaterThan(0);
      expect(shape.color).toBeGreaterThanOrEqual(0);
      expect(shape.color).toBeLessThan(6);
      expect(Number.isFinite(shape.x)).toBe(true);
      expect(Number.isFinite(shape.y)).toBe(true);
    }
  });

  it('gives every shape a unique id', () => {
    const shapes = generateDemoShapes(400, 11);
    expect(new Set(shapes.map((shape) => shape.id)).size).toBe(400);
  });
});

describe('sceneBounds', () => {
  it('is null for an empty board', () => {
    expect(sceneBounds([])).toBeNull();
  });

  it('wraps every shape', () => {
    const shapes = generateDemoShapes(300, 5);
    const bounds = sceneBounds(shapes)!;
    for (const shape of shapes) {
      expect(shape.x).toBeGreaterThanOrEqual(bounds.x);
      expect(shape.y).toBeGreaterThanOrEqual(bounds.y);
      expect(shape.x + shape.w).toBeLessThanOrEqual(bounds.x + bounds.w);
      expect(shape.y + shape.h).toBeLessThanOrEqual(bounds.y + bounds.h);
    }
  });
});
