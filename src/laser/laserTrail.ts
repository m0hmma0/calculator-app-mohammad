import type { Point } from '@/geometry';
import { INK_TRAIL_MS, MOVE_TRAIL_MS, isTrailAlive, pruneTrail, type LaserPoint } from './laser';

/**
 * The laser lives outside the document on purpose: it is never saved, never undoable,
 * and never counted against storage. Phase 7 broadcasts this same buffer to everyone
 * else on the board over the presence channel.
 *
 * It also lives outside the store, because appending a point sixty times a second
 * would bump the render version and re-run every subscriber for something that
 * nothing else cares about.
 */
let points: LaserPoint[] = [];
let lifetimeMs = MOVE_TRAIL_MS;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

export function addLaserPoint(point: Point, inking: boolean, now = performance.now()): void {
  // Drawing leaves a trail that survives long enough to talk over; moving does not.
  lifetimeMs = inking ? INK_TRAIL_MS : MOVE_TRAIL_MS;
  points = [...pruneTrail(points, { now, lifetimeMs }), { ...point, at: now }];
  notify();
}

export function laserSnapshot(now = performance.now()): {
  points: LaserPoint[];
  lifetimeMs: number;
} {
  return { points: pruneTrail(points, { now, lifetimeMs }), lifetimeMs };
}

export function laserAlive(now = performance.now()): boolean {
  return isTrailAlive(points, { now, lifetimeMs });
}

export function clearLaser(): void {
  if (points.length === 0) return;
  points = [];
  notify();
}

export function onLaserChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
