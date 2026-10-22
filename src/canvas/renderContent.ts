import getStroke from 'perfect-freehand';
import { fromFlat } from '@/ink/stroke';
import type { BoardElement } from '@/model/element';
import { fitFontSize, layoutText } from '@/model/textLayout';
import { getImage } from '@/media/images';
import { uploadStateOf, type UploadState } from '@/media/uploads';
import { fontString } from './fonts';
import { resolveColor, type CanvasColors } from './theme';

export const STICKY_PADDING = 14;
export const TEXT_PADDING = 2;

/**
 * perfect-freehand turns samples into an outline polygon whose width follows
 * pressure, which is the difference between ink and a flat polyline.
 */
export function inkOutline(element: BoardElement): number[][] {
  const points = fromFlat(element.points ?? []);
  if (points.length === 0) return [];

  return getStroke(
    points.map((point) => [point.x, point.y, point.pressure]),
    {
      size: element.style.strokeWidth,
      thinning: 0.55,
      smoothing: 0.55,
      streamline: 0.4,
      simulatePressure: false,
      last: true,
    },
  ) as number[][];
}

export function drawInk(
  ctx: CanvasRenderingContext2D,
  element: BoardElement,
  colors: CanvasColors,
): void {
  const outline = inkOutline(element);
  if (outline.length < 3) return;

  ctx.beginPath();
  ctx.moveTo(element.x + outline[0]![0]!, element.y + outline[0]![1]!);
  for (let index = 1; index < outline.length; index += 1) {
    ctx.lineTo(element.x + outline[index]![0]!, element.y + outline[index]![1]!);
  }
  ctx.closePath();
  ctx.fillStyle = resolveColor(element.style.fill ?? element.style.stroke, colors) ?? '#000';
  ctx.fill();
}

export interface TextRender {
  fontSize: number;
  lineCount: number;
}

/**
 * Text is measured and drawn with the same context that everything else uses, so
 * wrapping matches exactly what appears. Direction comes from the content, which is
 * what makes Arabic lay out right-to-left without the author setting anything.
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  element: BoardElement,
  colors: CanvasColors,
): TextRender {
  const content = element.text ?? '';
  const sticky = element.type === 'sticky';
  const padding = sticky ? STICKY_PADDING : TEXT_PADDING;
  const style = element.style;

  const measureAt = (size: number) => (text: string) => {
    ctx.font = fontString(style, size);
    return ctx.measureText(text).width;
  };

  // A sticky note is a fixed box, so the text shrinks to fit rather than spilling.
  const fontSize = sticky
    ? fitFontSize(content, element, style, measureAt, { padding, min: 9 })
    : style.fontSize;

  const available = Math.max(1, element.w - padding * 2);
  const layout = layoutText(content, available, { ...style, fontSize }, measureAt(fontSize));

  if (content.length === 0) return { fontSize, lineCount: 0 };

  ctx.save();
  ctx.font = fontString(style, fontSize);
  ctx.direction = layout.direction;
  ctx.textBaseline = 'middle';
  ctx.fillStyle =
    resolveColor(style.textColor ?? style.fill, colors) ?? colors.byToken.get('--text') ?? '#000';
  if (style.letterSpacing) ctx.letterSpacing = `${style.letterSpacing}px`;

  // 'start' and 'end' follow the text direction; 'center' is the same either way.
  ctx.textAlign = style.align;

  const anchorX =
    style.align === 'center'
      ? element.x + element.w / 2
      : (style.align === 'start') === (layout.direction === 'ltr')
        ? element.x + padding
        : element.x + element.w - padding;

  const blockHeight = layout.lines.length * layout.lineHeight;
  const top = sticky
    ? element.y + Math.max(padding, (element.h - blockHeight) / 2)
    : element.y + padding;

  layout.lines.forEach((line, index) => {
    const y = top + index * layout.lineHeight + layout.lineHeight / 2;
    const text = line.marker + line.text;
    ctx.fillText(text, anchorX, y);

    if (style.underline && text.trim() !== '') {
      const width = ctx.measureText(text).width;
      const underlineX =
        ctx.textAlign === 'center'
          ? anchorX - width / 2
          : (ctx.textAlign === 'start') === (layout.direction === 'ltr')
            ? anchorX
            : anchorX - width;
      ctx.fillRect(underlineX, y + fontSize * 0.42, width, Math.max(1, fontSize / 16));
    }
  });

  ctx.restore();
  return { fontSize, lineCount: layout.lines.length };
}

export function drawImage(
  ctx: CanvasRenderingContext2D,
  element: BoardElement,
  onReady: () => void,
  colors: CanvasColors,
): void {
  const source = element.image?.src;
  if (!source) return;

  const upload = uploadStateOf(element.image?.fileId);
  // While this tab is still uploading, the stored copy does not exist yet; asking
  // for it would only fail.
  const bitmap = upload ? null : getImage(source, onReady);
  const preview = bitmap ? null : placeholderBitmap(element, onReady);

  const radius = Math.min(element.style.radius, element.w / 2, element.h / 2);
  ctx.save();
  if (radius > 0.5) {
    ctx.beginPath();
    ctx.roundRect(element.x, element.y, element.w, element.h, radius);
    ctx.clip();
  }

  if (bitmap) {
    ctx.drawImage(bitmap, element.x, element.y, element.w, element.h);
  } else if (preview) {
    // A 20px preview stretched with smoothing reads as a blur of the real picture.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(preview, element.x, element.y, element.w, element.h);
  } else {
    // Nothing to show yet, but the shape appears the instant it is dropped.
    ctx.fillStyle = colors.byToken.get('--surface-2') ?? '#e8e8e8';
    ctx.fillRect(element.x, element.y, element.w, element.h);
  }
  ctx.restore();

  if (upload) drawUploadProgress(ctx, element, upload);
}

function placeholderBitmap(element: BoardElement, onReady: () => void) {
  const placeholder = element.image?.placeholder;
  return placeholder ? getImage(placeholder, onReady) : null;
}

/** A ring over the image, sized in screen pixels so it reads at any zoom. */
function drawUploadProgress(
  ctx: CanvasRenderingContext2D,
  element: BoardElement,
  upload: UploadState,
): void {
  const zoom = Math.hypot(ctx.getTransform().a, ctx.getTransform().b) || 1;
  const radius = Math.min(16 / zoom, element.w / 3, element.h / 3);
  if (radius <= 0) return;
  const cx = element.x + element.w / 2;
  const cy = element.y + element.h / 2;
  const fraction = upload.total > 0 ? Math.min(1, upload.loaded / upload.total) : 0;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 5 / zoom, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(15, 17, 24, 0.55)';
  ctx.fill();

  ctx.lineWidth = 3 / zoom;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  if (upload.status === 'uploading') {
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.04, fraction));
    ctx.stroke();
  } else {
    // Waiting to retry, or refused: a bar across the ring rather than progress.
    ctx.strokeStyle = upload.status === 'rejected' ? '#ff8a8a' : '#ffd27a';
    ctx.beginPath();
    ctx.moveTo(cx - radius / 2, cy);
    ctx.lineTo(cx + radius / 2, cy);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawFrameLabel(
  ctx: CanvasRenderingContext2D,
  element: BoardElement,
  colors: CanvasColors,
  zoom: number,
): void {
  const label = element.text?.trim() || 'Frame';
  const size = 12 / zoom;

  ctx.save();
  ctx.font = `500 ${size}px ${'ui-monospace, SFMono-Regular, Menlo, monospace'}`;
  ctx.fillStyle = colors.byToken.get('--text-muted') ?? '#888';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(label, element.x, element.y - size * 0.45);
  ctx.restore();
}
