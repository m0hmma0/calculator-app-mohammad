import type { Point } from '@/geometry';

export interface LaserPoint extends Point {
  at: number;
}

/**
 * How long a trail stays readable. Moving the pointer leaves a short comet; holding
 * the button down to draw leaves something that survives long enough to talk over,
 * then dissolves on its own. Neither is ever written to the document.
 */
export const MOVE_TRAIL_MS = 900;
export const INK_TRAIL_MS = 5000;

export interface TrailOptions {
  now: number;
  lifetimeMs: number;
}

/** Drops points that have outlived the trail. */
export function pruneTrail(points: readonly LaserPoint[], options: TrailOptions): LaserPoint[] {
  return points.filter((point) => options.now - point.at < options.lifetimeMs);
}

/**
 * 1 at the head, 0 at the tail. Squared so the trail keeps its brightness for most
 * of its life and then falls away quickly, rather than fading flatly throughout.
 */
export function trailOpacity(point: LaserPoint, options: TrailOptions): number {
  const age = options.now - point.at;
  if (age <= 0) return 1;
  if (age >= options.lifetimeMs) return 0;
  const remaining = 1 - age / options.lifetimeMs;
  return remaining * remaining;
}

/** Width tapers toward the tail as well, which is what makes it read as motion. */
export function trailWidth(point: LaserPoint, options: TrailOptions, maxWidth: number): number {
  return Math.max(0.5, maxWidth * (0.35 + 0.65 * trailOpacity(point, options)));
}

export function isTrailAlive(points: readonly LaserPoint[], options: TrailOptions): boolean {
  return points.some((point) => options.now - point.at < options.lifetimeMs);
}
