import { clamp } from '@/geometry';
import type { Size, Viewport } from './viewport';

export const BASE_GRID = 24;
const TARGET_SCREEN_SPACING = 26;

/**
 * Which grid level to draw at this zoom. Levels step by 4×, and we pick the one
 * whose on-screen spacing lands closest to the target — so the grid stays legible
 * from 2% to 6400% instead of becoming a solid wash or vanishing entirely.
 */
export function gridStep(zoom: number, base = BASE_GRID, target = TARGET_SCREEN_SPACING): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return base;
  const level = Math.round(Math.log(target / (base * zoom)) / Math.log(4));
  return base * Math.pow(4, level);
}

/**
 * Dots fade as they crowd together, so switching to a coarser level is a fade
 * rather than a pop. Spacing sits in [target/2, target*2) by construction.
 */
export function gridOpacity(screenSpacing: number, target = TARGET_SCREEN_SPACING): number {
  return clamp(screenSpacing / target, 0.45, 1);
}

/**
 * Dots are drawn at a fixed *screen* size, so they stay exactly as crisp at 6400%
 * as at 100% — they are a UI element, not board content that scales.
 */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  size: Size,
  color: string,
  dpr: number,
): void {
  const step = gridStep(vp.zoom);
  const screenSpacing = step * vp.zoom;
  if (screenSpacing < 4) return;

  const dot = dpr >= 2 ? 1.5 : 1;
  const half = dot / 2;

  // First grid line at or after the left/top edge of the visible board area.
  const startX = Math.ceil(vp.x / step) * step;
  const startY = Math.ceil(vp.y / step) * step;

  ctx.save();
  ctx.globalAlpha = gridOpacity(screenSpacing);
  ctx.fillStyle = color;
  ctx.beginPath();

  for (let boardY = startY; ; boardY += step) {
    const screenY = (boardY - vp.y) * vp.zoom;
    if (screenY > size.height) break;
    for (let boardX = startX; ; boardX += step) {
      const screenX = (boardX - vp.x) * vp.zoom;
      if (screenX > size.width) break;
      ctx.rect(screenX - half, screenY - half, dot, dot);
    }
  }

  ctx.fill();
  ctx.restore();
}
