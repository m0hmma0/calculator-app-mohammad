import type { Point, Rect } from '@/geometry';
import { elementCorners, localToWorld } from '@/model/bounds';
import { wholePicture } from '@/model/crop';
import { getImage } from '@/media/images';
import type { BoardElement } from '@/model/element';
import { frameCorners, handlePoint, type SelectionFrame } from '@/model/handles';
import { HANDLES, handleSign } from '@/model/transform';
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
  /** Locked, but not for this person — the owner: a padlock, and handles as usual. */
  lockedForOthers?: boolean;
  /** A picture being cropped: its whole shown faded around the crop, and crop handles. */
  cropping?: BoardElement | null;
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

  if (input.cropping) drawCropping(ctx, vp, input.cropping, toScreen, colors);

  if (input.frame && !input.cropping) {
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
    if (input.lockedForOthers || input.lockedSelection) drawPadlock(ctx, corners[0]!, colors);
  }

  if (input.marquee) drawMarquee(ctx, input.marquee, toScreen, colors);

  if (input.rotationReadout !== null && input.frame) {
    drawRotationReadout(ctx, input.frame, input.rotationReadout, toScreen, colors);
  }

  ctx.restore();
}

/**
 * Cropping: the rest of the picture, faded, around the part shown; a dashed outline of
 * the whole; the crop's own outline; and its handles drawn as crop marks, unlike the
 * squares that resize.
 */
function drawCropping(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  element: BoardElement,
  toScreen: (p: Point) => Point,
  colors: CanvasColors,
): void {
  const whole = wholePicture(element);
  const bitmap = element.image?.src ? getImage(element.image.src) : null;

  ctx.save();
  // In the picture's own frame, on the board.
  ctx.translate(-vp.x * vp.zoom, -vp.y * vp.zoom);
  ctx.scale(vp.zoom, vp.zoom);
  ctx.translate(element.x + element.w / 2, element.y + element.h / 2);
  ctx.rotate(element.rotation);
  ctx.translate(-element.w / 2, -element.h / 2);
  ctx.beginPath();
  ctx.rect(whole.x, whole.y, whole.w, whole.h);
  ctx.rect(0, 0, element.w, element.h);
  ctx.clip('evenodd');
  ctx.globalAlpha = 0.35;
  if (bitmap) {
    ctx.drawImage(bitmap, whole.x, whole.y, whole.w, whole.h);
  } else {
    ctx.fillStyle = colors.byToken.get('--surface-2') ?? '#d9d9d9';
    ctx.fillRect(whole.x, whole.y, whole.w, whole.h);
  }
  ctx.restore();

  const corner = (x: number, y: number) => toScreen(localToWorld(element, { x, y }));
  ctx.lineWidth = 1;
  ctx.strokeStyle = colors.accent;
  ctx.setLineDash([4, 4]);
  outline(ctx, [
    corner(whole.x, whole.y),
    corner(whole.x + whole.w, whole.y),
    corner(whole.x + whole.w, whole.y + whole.h),
    corner(whole.x, whole.y + whole.h),
  ]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 1.5;
  outline(ctx, elementCorners(element).map(toScreen));
  ctx.stroke();

  // Crop marks: a thick bar at each edge's middle, an L at each corner.
  const frame = {
    box: { x: element.x, y: element.y, w: element.w, h: element.h },
    rotation: element.rotation,
    single: true,
  };
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.strokeStyle = colors.accent;
  for (const handle of HANDLES) {
    const at = toScreen(handlePoint(frame, handle));
    const { sx, sy } = handleSign(handle);
    const turn = (dx: number, dy: number) => {
      const cos = Math.cos(element.rotation);
      const sin = Math.sin(element.rotation);
      return { x: at.x + dx * cos - dy * sin, y: at.y + dx * sin + dy * cos };
    };
    ctx.beginPath();
    if (sx !== 0 && sy !== 0) {
      const a = turn(-sx * CROP_MARK, 0);
      const b = turn(0, -sy * CROP_MARK);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(at.x, at.y);
      ctx.lineTo(b.x, b.y);
    } else {
      const a = turn(sy !== 0 ? -CROP_MARK / 2 : 0, sx !== 0 ? -CROP_MARK / 2 : 0);
      const b = turn(sy !== 0 ? CROP_MARK / 2 : 0, sx !== 0 ? CROP_MARK / 2 : 0);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

/** How long a crop mark's arms are, in screen px. */
const CROP_MARK = 14;

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

/** A small padlock just above a selection's top-left corner: this is locked. */
function drawPadlock(ctx: CanvasRenderingContext2D, corner: Point, colors: CanvasColors): void {
  const x = corner.x;
  const y = corner.y - 20;
  ctx.save();
  ctx.fillStyle = colors.accent;
  ctx.beginPath();
  ctx.roundRect(x, y, 16, 14, 3);
  ctx.fill();
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(x + 8, y + 1, 4, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + 7, y + 5, 2, 5);
  ctx.restore();
}
