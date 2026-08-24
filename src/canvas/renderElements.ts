import { rectsIntersect } from '@/geometry';
import { elementAABB } from '@/model/bounds';
import type { BoardElement } from '@/model/element';
import { lineEnds, polygonPoints, POLYGONAL } from '@/model/shapePath';
import { resolveColor, type CanvasColors } from './theme';
import { visibleBounds, type Size, type Viewport } from './viewport';

export interface RenderStats {
  total: number;
  visible: number;
}

const DASH_PATTERNS: Record<string, number[]> = {
  solid: [],
  dashed: [10, 7],
  dotted: [1, 5],
};

const ARROW_HEAD = 14;

/**
 * Adds one element's outline to the current path, in local coordinates offset by
 * (ox, oy). Rotated elements set the transform around this call — canvas converts
 * each path point using the transform in force when the point is added, so a single
 * path can hold shapes at different angles.
 */
function addOutline(ctx: CanvasRenderingContext2D, element: BoardElement, ox: number, oy: number) {
  const { w, h } = element;

  if (element.type === 'line' || element.type === 'arrow') {
    const [start, end] = lineEnds(element);
    ctx.moveTo(ox + start.x, oy + start.y);
    ctx.lineTo(ox + end.x, oy + end.y);

    if (element.type === 'arrow') {
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const size = Math.min(ARROW_HEAD, Math.hypot(w, h) * 0.4);
      for (const spread of [Math.PI * 0.82, -Math.PI * 0.82]) {
        ctx.moveTo(ox + end.x, oy + end.y);
        ctx.lineTo(
          ox + end.x + Math.cos(angle + spread) * size,
          oy + end.y + Math.sin(angle + spread) * size,
        );
      }
    }
    return;
  }

  if (element.type === 'ellipse') {
    ctx.moveTo(ox + w, oy + h / 2);
    ctx.ellipse(ox + w / 2, oy + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    return;
  }

  if (POLYGONAL.has(element.type)) {
    const points = polygonPoints(element);
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(ox + point.x, oy + point.y);
      else ctx.lineTo(ox + point.x, oy + point.y);
    });
    ctx.closePath();
    return;
  }

  const radius = Math.min(element.style.radius, w / 2, h / 2);
  if (radius > 0.5) ctx.roundRect(ox, oy, w, h, radius);
  else ctx.rect(ox, oy, w, h);
}

/** Elements sharing every drawing property can share one path and one fill. */
function styleKey(element: BoardElement): string {
  const s = element.style;
  return `${s.fill}|${s.stroke}|${s.strokeWidth}|${s.dash}|${s.shadow}|${element.opacity}`;
}

/**
 * Batching has a sweet spot. Merging same-styled shapes into one path saves calls,
 * but canvas fill cost grows faster than linearly in subpath count — one path holding
 * 5,000 rounded rectangles measured 145ms per frame against 8ms for the same shapes
 * drawn in small batches. So runs are capped rather than unbounded.
 */
const MAX_RUN = 48;

/** Reused across frames so a pan does not hand the garbage collector 5,000 objects. */
const onScreen: BoardElement[] = [];

function paintRun(
  ctx: CanvasRenderingContext2D,
  run: readonly BoardElement[],
  start: number,
  end: number,
  colors: CanvasColors,
  zoom: number,
): void {
  const sample = run[start];
  if (!sample) return;
  const style = sample.style;

  ctx.beginPath();
  for (let index = start; index < end; index += 1) {
    const element = run[index]!;
    if (element.rotation === 0) {
      addOutline(ctx, element, element.x, element.y);
    } else {
      ctx.save();
      ctx.translate(element.x + element.w / 2, element.y + element.h / 2);
      ctx.rotate(element.rotation);
      ctx.translate(-element.w / 2, -element.h / 2);
      addOutline(ctx, element, 0, 0);
      ctx.restore();
    }
  }

  ctx.globalAlpha = sample.opacity;

  if (style.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.28)';
    ctx.shadowBlur = 12 / zoom;
    ctx.shadowOffsetY = 4 / zoom;
  }

  const fill = resolveColor(style.fill, colors);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  const stroke = resolveColor(style.stroke, colors);
  if (stroke && style.strokeWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = style.strokeWidth;
    ctx.setLineDash((DASH_PATTERNS[style.dash] ?? []).map((n) => n * style.strokeWidth * 0.5));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.globalAlpha = 1;
}

/**
 * `elements` must already be sorted back to front — the store keeps it that way, so
 * no per-frame sort is needed. Adjacent elements sharing a style are merged into one
 * path and one fill; splitting on any style change is what keeps overlapping shapes
 * painting in the right order.
 */
export function renderElements(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  size: Size,
  elements: readonly BoardElement[],
  colors: CanvasColors,
): RenderStats {
  const view = visibleBounds(vp, size);

  onScreen.length = 0;
  for (const element of elements) {
    if (element.hidden || element.type === 'group') continue;
    if (!rectsIntersect(view, elementAABB(element))) continue;
    onScreen.push(element);
  }

  if (onScreen.length === 0) return { total: elements.length, visible: 0 };

  ctx.save();
  ctx.translate(-vp.x * vp.zoom, -vp.y * vp.zoom);
  ctx.scale(vp.zoom, vp.zoom);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  let runStart = 0;
  let runKey = styleKey(onScreen[0]!);

  for (let index = 1; index <= onScreen.length; index += 1) {
    const element = onScreen[index];
    const key = element ? styleKey(element) : null;
    if (key === runKey && index - runStart < MAX_RUN) continue;

    paintRun(ctx, onScreen, runStart, index, colors, vp.zoom);
    if (!element || key === null) break;
    runStart = index;
    runKey = key;
  }

  ctx.restore();
  return { total: elements.length, visible: onScreen.length };
}
