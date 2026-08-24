import { trailOpacity, trailWidth, type LaserPoint } from '@/laser/laser';
import { boardToScreen, type Viewport } from './viewport';
import type { CanvasColors } from './theme';

const MAX_WIDTH = 7;

/**
 * The trail is drawn segment by segment because each one has its own opacity and
 * width — that gradient is what makes it read as a comet rather than a line. Drawn
 * in screen space so it keeps its weight at any zoom, and with a glow underneath so
 * it stays visible over dark and light content alike.
 */
export function renderLaser(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  points: readonly LaserPoint[],
  lifetimeMs: number,
  now: number,
  colors: CanvasColors,
): void {
  if (points.length < 2) return;
  const options = { now, lifetimeMs };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const pass of ['glow', 'core'] as const) {
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1]!;
      const current = points[index]!;
      const opacity = trailOpacity(current, options);
      if (opacity <= 0.01) continue;

      const from = boardToScreen(vp, previous);
      const to = boardToScreen(vp, current);
      const width = trailWidth(current, options, MAX_WIDTH);

      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);

      if (pass === 'glow') {
        ctx.globalAlpha = opacity * 0.28;
        ctx.lineWidth = width * 3.2;
        ctx.strokeStyle = colors.laser;
      } else {
        ctx.globalAlpha = opacity;
        ctx.lineWidth = width;
        ctx.strokeStyle = colors.laser;
      }
      ctx.stroke();
    }
  }

  ctx.restore();
}
