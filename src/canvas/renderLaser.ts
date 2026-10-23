import getStroke from 'perfect-freehand';
import { trailOpacity, type LaserPoint } from '@/laser/laser';
import { boardToScreen, type Viewport } from './viewport';
import type { CanvasColors } from './theme';

/** The trail's width at its head, in screen pixels. */
const HEAD_WIDTH = 7;

/**
 * The trail is one smooth, tapering shape rather than a chain of segments — drawn
 * segment by segment, the round ends overlap and the trail reads as beads. The
 * pointer's samples are smoothed into a curve that is widest at the head and thins
 * to nothing at the tail, then filled once with a soft glow, so it reads as a comet.
 * It is drawn in screen space, so it keeps its weight at any zoom.
 */
export function renderLaser(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  points: readonly LaserPoint[],
  lifetimeMs: number,
  now: number,
  colors: CanvasColors,
  /** Someone else's laser is drawn in their colour. */
  color: string = colors.laser,
): void {
  const options = { now, lifetimeMs };
  const live = points.filter((point) => trailOpacity(point, options) > 0.01);
  if (live.length < 2) return;

  // Pressure carries the taper: the newest point is full width, older ones thinner.
  const samples = live.map((point) => {
    const screen = boardToScreen(vp, point);
    return [screen.x, screen.y, Math.sqrt(trailOpacity(point, options))];
  });
  const outline = getStroke(samples, {
    size: HEAD_WIDTH,
    thinning: 0.95,
    smoothing: 0.75,
    streamline: 0.35,
    simulatePressure: false,
    start: { taper: true, cap: false },
    end: { cap: true },
    last: true,
  });
  if (outline.length < 3) return;

  const path = new Path2D();
  path.moveTo(outline[0]![0]!, outline[0]![1]!);
  for (let index = 1; index < outline.length; index += 1) {
    // Through the midpoints, so the edge is a curve rather than a polygon.
    const [x0, y0] = outline[index - 1]!;
    const [x1, y1] = outline[index]!;
    path.quadraticCurveTo(x0!, y0!, (x0! + x1!) / 2, (y0! + y1!) / 2);
  }
  path.closePath();

  // As the trail ages as a whole — the pointer stopped — it fades as a whole.
  const head = trailOpacity(live.at(-1)!, options);

  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.globalAlpha = 0.35 * head;
  ctx.shadowBlur = 18;
  ctx.fill(path);
  ctx.globalAlpha = 0.95 * head;
  ctx.shadowBlur = 6;
  ctx.fill(path);

  // A bright core at the pointer itself.
  const tip = boardToScreen(vp, live.at(-1)!);
  ctx.globalAlpha = head;
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, HEAD_WIDTH * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
