import getStroke from 'perfect-freehand';
import { fromFlat } from '@/ink/stroke';
import type { BoardElement } from '@/model/element';
import { fitFontSize, layoutText } from '@/model/textLayout';
import { getImage } from '@/media/images';
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

  const bitmap = getImage(source, onReady);
  if (!bitmap) {
    // Placeholder while decoding, so the shape appears the instant it is dropped.
    ctx.fillStyle = colors.byToken.get('--surface-2') ?? '#e8e8e8';
    ctx.fillRect(element.x, element.y, element.w, element.h);
    return;
  }

  const radius = Math.min(element.style.radius, element.w / 2, element.h / 2);
  if (radius > 0.5) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(element.x, element.y, element.w, element.h, radius);
    ctx.clip();
    ctx.drawImage(bitmap, element.x, element.y, element.w, element.h);
    ctx.restore();
  } else {
    ctx.drawImage(bitmap, element.x, element.y, element.w, element.h);
  }
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
