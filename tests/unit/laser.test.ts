import { describe, expect, it } from 'vitest';
import {
  INK_TRAIL_MS,
  isTrailAlive,
  MOVE_TRAIL_MS,
  pruneTrail,
  trailOpacity,
  trailWidth,
  type LaserPoint,
} from '@/laser/laser';

const at = (ms: number): LaserPoint => ({ x: 0, y: 0, at: ms });

// Checklist item 4 — the gate.
describe('laser trail', () => {
  it('keeps a moving trail for about a second and an inked one for several', () => {
    expect(MOVE_TRAIL_MS).toBeGreaterThanOrEqual(600);
    expect(MOVE_TRAIL_MS).toBeLessThanOrEqual(1500);
    expect(INK_TRAIL_MS).toBeGreaterThanOrEqual(4000);
    expect(INK_TRAIL_MS).toBeGreaterThan(MOVE_TRAIL_MS * 3);
  });

  it('drops points once they outlive the trail', () => {
    const points = [at(0), at(500), at(950)];
    expect(pruneTrail(points, { now: 1000, lifetimeMs: MOVE_TRAIL_MS })).toEqual([
      at(500),
      at(950),
    ]);
  });

  it('empties completely once nothing is left', () => {
    expect(pruneTrail([at(0)], { now: 9999, lifetimeMs: MOVE_TRAIL_MS })).toEqual([]);
  });

  it('is brightest at the head and gone at the tail', () => {
    const options = { now: 1000, lifetimeMs: 1000 };
    expect(trailOpacity(at(1000), options)).toBe(1);
    expect(trailOpacity(at(0), options)).toBe(0);
    expect(trailOpacity(at(500), options)).toBeCloseTo(0.25, 6);
  });

  it('holds its brightness longer than a flat fade would', () => {
    const options = { now: 1000, lifetimeMs: 1000 };
    // A quarter of the way through, a linear fade would already be at 0.75.
    expect(trailOpacity(at(750), options)).toBeGreaterThan(0.5);
  });

  it('never goes negative for a point older than the trail', () => {
    expect(trailOpacity(at(-5000), { now: 0, lifetimeMs: 1000 })).toBe(0);
  });

  it('tapers width toward the tail but keeps it drawable', () => {
    const options = { now: 1000, lifetimeMs: 1000 };
    const head = trailWidth(at(1000), options, 10);
    const tail = trailWidth(at(1), options, 10);
    expect(head).toBeGreaterThan(tail);
    expect(tail).toBeGreaterThan(0);
  });

  it('reports when there is still something to draw', () => {
    expect(isTrailAlive([at(900)], { now: 1000, lifetimeMs: MOVE_TRAIL_MS })).toBe(true);
    expect(isTrailAlive([at(0)], { now: 5000, lifetimeMs: MOVE_TRAIL_MS })).toBe(false);
    expect(isTrailAlive([], { now: 0, lifetimeMs: MOVE_TRAIL_MS })).toBe(false);
  });
});
