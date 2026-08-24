import { rectsIntersect } from '@/geometry';
import { elementAABB } from '@/model/bounds';
import type { BoardElement } from '@/model/element';
import { lineEnds, polygonPoints, POLYGONAL } from '@/model/shapePath';
import { drawFrameLabel, drawImage, drawInk, drawText } from './renderContent';
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

/**
 * Ink, text, images and frames each need their own drawing pass, so they cannot join
 * a shared path. They interrupt a run rather than being reordered out of it, which is
 * what keeps a sticky note on top of the rectangle it was dropped onto.
 */
const CONTENT: ReadonlySet<string> = new Set(['path', 'text', 'sticky', 'image', 'frame']);

function drawContent(
  ctx: CanvasRenderingContext2D,
  element: BoardElement,
  colors: CanvasColors,
  zoom: number,
  onImageReady: () => void,
): void {
  const rotated = element.rotation !== 0;
  if (rotated) {
    ctx.save();
    const cx = element.x + element.w / 2;
    const cy = element.y + element.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate(element.rotation);
    ctx.translate(-cx, -cy);
  }

  ctx.globalAlpha = element.opacity;

  switch (element.type) {
    case 'path':
      drawInk(ctx, element, colors);
      break;

    case 'image':
      drawImage(ctx, element, onImageReady, colors);
      break;

    case 'sticky':
    case 'frame': {
      const fill = resolveColor(element.style.fill, colors);
      const stroke = resolveColor(element.style.stroke, colors);
      const radius = Math.min(element.style.radius, element.w / 2, element.h / 2);

      ctx.beginPath();
      if (radius > 0.5) ctx.roundRect(element.x, element.y, element.w, element.h, radius);
      else ctx.rect(element.x, element.y, element.w, element.h);

      if (element.style.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.22)';
        ctx.shadowBlur = 10 / zoom;
        ctx.shadowOffsetY = 3 / zoom;
      }
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      if (stroke && element.style.strokeWidth > 0) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = element.style.strokeWidth / zoom;
        ctx.stroke();
      }

      if (element.type === 'frame') drawFrameLabel(ctx, element, colors, zoom);
      else drawText(ctx, element, colors);
      break;
    }

    case 'text':
      drawText(ctx, element, colors);
      break;

    default:
      break;
  }

  ctx.globalAlpha = 1;
  if (rotated) ctx.restore();
}

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
  onImageReady: () => void = () => {},
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
  let runKey: string | null = null;

  const flush = (end: number) => {
    if (runKey !== null && end > runStart) paintRun(ctx, onScreen, runStart, end, colors, vp.zoom);
    runKey = null;
  };

  for (let index = 0; index < onScreen.length; index += 1) {
    const element = onScreen[index]!;

    if (CONTENT.has(element.type)) {
      flush(index);
      drawContent(ctx, element, colors, vp.zoom, onImageReady);
      continue;
    }

    const key = styleKey(element);
    if (runKey === null) {
      runStart = index;
      runKey = key;
    } else if (key !== runKey || index - runStart >= MAX_RUN) {
      flush(index);
      runStart = index;
      runKey = key;
    }
  }
  flush(onScreen.length);

  ctx.restore();
  return { total: elements.length, visible: onScreen.length };
}
