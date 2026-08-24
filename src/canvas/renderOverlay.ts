import type { Point, Rect } from '@/geometry';
import { elementCorners } from '@/model/bounds';
import type { BoardElement } from '@/model/element';
import { frameCorners, handlePoint, type SelectionFrame } from '@/model/handles';
import { HANDLES } from '@/model/transform';
import type { SnapGuide, SpacingMark } from '@/snapping/snap';
import type { CanvasColors } from './theme';
import { boardToScreen, type Size, type Viewport } from './viewport';

export const HANDLE_SIZE = 9;
export const ROTATE_ZONE = 20;

export interface OverlayInput {
  selected: readonly BoardElement[];
  frame: SelectionFrame | null;
  marquee: Rect | null;
  guides: readonly SnapGuide[];
  spacing: readonly SpacingMark[];
  rotationReadout: number | null;
  lockedSelection: boolean;
}

/**
 * Everything here is drawn in *screen* space, so handles, outlines and guides keep
 * the same weight at 5% and at 6400% — they are chrome, not content.
 */
export function renderOverlay(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  size: Size,
  input: OverlayInput,
  colors: CanvasColors,
): void {
  const toScreen = (p: Point) => boardToScreen(vp, p);

  ctx.save();
  ctx.lineJoin = 'round';

  drawGuides(ctx, vp, size, input.guides, colors);
  drawSpacing(ctx, toScreen, input.spacing, colors);

  if (input.selected.length > 1) {
    ctx.strokeStyle = colors.accent;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    for (const element of input.selected) {
      outline(ctx, elementCorners(element).map(toScreen));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  if (input.frame) {
    const corners = frameCorners(input.frame).map(toScreen);
    ctx.strokeStyle = input.lockedSelection ? colors.dot : colors.accent;
    ctx.lineWidth = 1.5;
    if (input.lockedSelection) ctx.setLineDash([5, 4]);
    outline(ctx, corners);
    ctx.stroke();
    ctx.setLineDash([]);

    if (!input.lockedSelection) {
      drawHandles(ctx, input.frame, toScreen, colors);
    }
  }

  if (input.marquee) drawMarquee(ctx, input.marquee, toScreen, colors);

  if (input.rotationReadout !== null && input.frame) {
    drawRotationReadout(ctx, input.frame, input.rotationReadout, toScreen, colors);
  }

  ctx.restore();
}

function outline(ctx: CanvasRenderingContext2D, corners: readonly Point[]): void {
  ctx.beginPath();
  corners.forEach((corner, index) => {
    if (index === 0) ctx.moveTo(corner.x, corner.y);
    else ctx.lineTo(corner.x, corner.y);
  });
  ctx.closePath();
}

function drawHandles(
  ctx: CanvasRenderingContext2D,
  frame: SelectionFrame,
  toScreen: (p: Point) => Point,
  colors: CanvasColors,
): void {
  const half = HANDLE_SIZE / 2;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = colors.accent;
  ctx.fillStyle = colors.handleFill;

  for (const handle of HANDLES) {
    const point = toScreen(handlePoint(frame, handle));
    ctx.beginPath();
    ctx.rect(point.x - half, point.y - half, HANDLE_SIZE, HANDLE_SIZE);
    ctx.fill();
    ctx.stroke();
  }
}

function drawMarquee(
  ctx: CanvasRenderingContext2D,
  marquee: Rect,
  toScreen: (p: Point) => Point,
  colors: CanvasColors,
): void {
  const topLeft = toScreen({ x: marquee.x, y: marquee.y });
  const bottomRight = toScreen({ x: marquee.x + marquee.w, y: marquee.y + marquee.h });
  const w = bottomRight.x - topLeft.x;
  const h = bottomRight.y - topLeft.y;

  ctx.fillStyle = colors.accent;
  ctx.globalAlpha = 0.1;
  ctx.fillRect(topLeft.x, topLeft.y, w, h);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 1;
  ctx.strokeRect(topLeft.x + 0.5, topLeft.y + 0.5, w, h);
}

function drawGuides(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  size: Size,
  guides: readonly SnapGuide[],
  colors: CanvasColors,
): void {
  if (guides.length === 0) return;

  ctx.strokeStyle = colors.guide;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();

  for (const guide of guides) {
    if (guide.axis === 'x') {
      const x = Math.round(boardToScreen(vp, { x: guide.position, y: 0 }).x) + 0.5;
      const from = boardToScreen(vp, { x: 0, y: guide.from }).y;
      const to = boardToScreen(vp, { x: 0, y: guide.to }).y;
      ctx.moveTo(x, Math.max(-10, from - 12));
      ctx.lineTo(x, Math.min(size.height + 10, to + 12));
    } else {
      const y = Math.round(boardToScreen(vp, { x: 0, y: guide.position }).y) + 0.5;
      const from = boardToScreen(vp, { x: guide.from, y: 0 }).x;
      const to = boardToScreen(vp, { x: guide.to, y: 0 }).x;
      ctx.moveTo(Math.max(-10, from - 12), y);
      ctx.lineTo(Math.min(size.width + 10, to + 12), y);
    }
  }

  ctx.stroke();
  ctx.setLineDash([]);
}

function drawSpacing(
  ctx: CanvasRenderingContext2D,
  toScreen: (p: Point) => Point,
  spacing: readonly SpacingMark[],
  colors: CanvasColors,
): void {
  if (spacing.length === 0) return;

  ctx.strokeStyle = colors.guide;
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (const mark of spacing) {
    const start =
      mark.axis === 'x'
        ? toScreen({ x: mark.start, y: mark.at })
        : toScreen({ x: mark.at, y: mark.start });
    const end =
      mark.axis === 'x'
        ? toScreen({ x: mark.end, y: mark.at })
        : toScreen({ x: mark.at, y: mark.end });

    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);

    // End caps, so a gap reads as a measurement rather than a stray line.
    const cap = 4;
    if (mark.axis === 'x') {
      ctx.moveTo(start.x, start.y - cap);
      ctx.lineTo(start.x, start.y + cap);
      ctx.moveTo(end.x, end.y - cap);
      ctx.lineTo(end.x, end.y + cap);
    } else {
      ctx.moveTo(start.x - cap, start.y);
      ctx.lineTo(start.x + cap, start.y);
      ctx.moveTo(end.x - cap, end.y);
      ctx.lineTo(end.x + cap, end.y);
    }
  }

  ctx.stroke();
}

function drawRotationReadout(
  ctx: CanvasRenderingContext2D,
  frame: SelectionFrame,
  degrees: number,
  toScreen: (p: Point) => Point,
  colors: CanvasColors,
): void {
  const anchor = toScreen(handlePoint(frame, 's'));
  const label = `${degrees}°`;

  ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
  const width = ctx.measureText(label).width + 14;
  const x = anchor.x - width / 2;
  const y = anchor.y + 18;

  ctx.fillStyle = colors.accent;
  ctx.beginPath();
  ctx.roundRect(x, y, width, 20, 5);
  ctx.fill();

  ctx.fillStyle = colors.handleFill;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + width / 2, y + 10);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}
