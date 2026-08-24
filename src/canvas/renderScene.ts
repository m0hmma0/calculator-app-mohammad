import { rectsIntersect } from '@/geometry';
import type { DemoShape } from '@/scene/demoScene';
import { visibleBounds, type Size, type Viewport } from './viewport';

export interface RenderStats {
  total: number;
  visible: number;
}

/**
 * Reused across frames: allocating buckets 60 times a second would hand the
 * garbage collector work that shows up as stutter during a pan.
 */
const buckets: DemoShape[][] = [];

function bucketsFor(paletteSize: number): DemoShape[][] {
  while (buckets.length < paletteSize) buckets.push([]);
  for (let index = 0; index < paletteSize; index += 1) buckets[index]!.length = 0;
  return buckets;
}

/**
 * Draws the visible slice of the scene. Two things keep this fast at 5,000 shapes:
 * culling against the visible board rect, and grouping by colour so each colour is
 * one path and one fill rather than one per shape.
 */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  size: Size,
  shapes: readonly DemoShape[],
  palette: readonly string[],
): RenderStats {
  const view = visibleBounds(vp, size);
  const paletteSize = Math.max(1, palette.length);
  const groups = bucketsFor(paletteSize);

  let visible = 0;
  for (const shape of shapes) {
    if (!rectsIntersect(view, shape)) continue;
    groups[shape.color % paletteSize]!.push(shape);
    visible += 1;
  }

  if (visible === 0) return { total: shapes.length, visible: 0 };

  ctx.save();
  // Board space from here on: translate then scale, so shape coordinates are used raw.
  ctx.translate(-vp.x * vp.zoom, -vp.y * vp.zoom);
  ctx.scale(vp.zoom, vp.zoom);

  for (let index = 0; index < paletteSize; index += 1) {
    const group = groups[index]!;
    if (group.length === 0) continue;

    ctx.beginPath();
    for (const shape of group) {
      if (shape.kind === 'ellipse') {
        const rx = shape.w / 2;
        const ry = shape.h / 2;
        ctx.moveTo(shape.x + shape.w, shape.y + ry);
        ctx.ellipse(shape.x + rx, shape.y + ry, rx, ry, 0, 0, Math.PI * 2);
      } else {
        ctx.rect(shape.x, shape.y, shape.w, shape.h);
      }
    }
    ctx.fillStyle = palette[index]!;
    ctx.fill();
  }

  ctx.restore();
  return { total: shapes.length, visible };
}
