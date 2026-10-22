import getStroke from 'perfect-freehand';
import { detectLanguage, tokenizeLine, TOKEN_COLORS, type Language } from '@/model/highlight';
import { fromFlat } from '@/ink/stroke';
import type { BoardElement } from '@/model/element';
import { fitFontSize, layoutText } from '@/model/textLayout';
import { getImage } from '@/media/images';
import { uploadStateOf, type UploadState } from '@/media/uploads';
import { fontStack, fontString } from './fonts';
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

/** Draws text cut to a width with an ellipsis, so it never spills out of its box. */
function fitLine(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= width) low = mid;
    else high = mid - 1;
  }
  return low > 0 ? `${text.slice(0, low)}…` : '';
}

function cardBox(
  ctx: CanvasRenderingContext2D,
  element: BoardElement,
  colors: CanvasColors,
  zoom: number,
) {
  const radius = Math.min(element.style.radius, element.w / 2, element.h / 2);
  ctx.beginPath();
  ctx.roundRect(element.x, element.y, element.w, element.h, radius);
  const fill = resolveColor(element.style.fill, colors);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  const stroke = resolveColor(element.style.stroke, colors);
  if (stroke && element.style.strokeWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = element.style.strokeWidth / zoom;
    ctx.stroke();
  }
}

/** Where a table's lines fall: evenly divided, so resizing the table resizes its cells. */
export function tableGrid(element: BoardElement) {
  const rows = Math.max(1, element.table?.rows ?? 1);
  const cols = Math.max(1, element.table?.cols ?? 1);
  return { rows, cols, rowHeight: element.h / rows, colWidth: element.w / cols };
}

export const CELL_PADDING = 8;

export function drawTable(
  ctx: CanvasRenderingContext2D,
  element: BoardElement,
  colors: CanvasColors,
  zoom: number,
): void {
  const table = element.table;
  if (!table) return;
  const { rows, cols, rowHeight, colWidth } = tableGrid(element);
  ctx.save();
  cardBox(ctx, element, colors, zoom);

  // The first row is the header.
  ctx.fillStyle = colors.byToken.get('--surface-2') ?? '#f1f2f6';
  ctx.save();
  ctx.beginPath();
  const radius = Math.min(element.style.radius, element.w / 2, element.h / 2);
  ctx.roundRect(element.x, element.y, element.w, element.h, radius);
  ctx.clip();
  ctx.fillRect(element.x, element.y, element.w, rowHeight);
  ctx.restore();

  ctx.strokeStyle = resolveColor(element.style.stroke, colors) ?? '#ccc';
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  for (let row = 1; row < rows; row += 1) {
    ctx.moveTo(element.x, element.y + row * rowHeight);
    ctx.lineTo(element.x + element.w, element.y + row * rowHeight);
  }
  for (let col = 1; col < cols; col += 1) {
    ctx.moveTo(element.x + col * colWidth, element.y);
    ctx.lineTo(element.x + col * colWidth, element.y + element.h);
  }
  ctx.stroke();

  const size = Math.min(element.style.fontSize, rowHeight * 0.6);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = resolveColor(element.style.textColor, colors) ?? '#222';
  for (let row = 0; row < rows; row += 1) {
    ctx.font = fontString(
      { ...element.style, fontWeight: row === 0 ? 650 : element.style.fontWeight },
      size,
    );
    for (let col = 0; col < cols; col += 1) {
      const value = table.cells[`${row},${col}`];
      if (!value) continue;
      const line = value.split('\n')[0] ?? '';
      ctx.fillText(
        fitLine(ctx, line, colWidth - CELL_PADDING * 2),
        element.x + col * colWidth + CELL_PADDING,
        element.y + row * rowHeight + rowHeight / 2,
      );
    }
  }
  ctx.restore();
}

export const CODE_PADDING = 14;

export function drawCode(
  ctx: CanvasRenderingContext2D,
  element: BoardElement,
  colors: CanvasColors,
  zoom: number,
): void {
  ctx.save();
  cardBox(ctx, element, colors, zoom);
  const radius = Math.min(element.style.radius, element.w / 2, element.h / 2);
  ctx.beginPath();
  ctx.roundRect(element.x, element.y, element.w, element.h, radius);
  ctx.clip();

  const code = element.text ?? '';
  const language =
    !element.language || element.language === 'auto'
      ? detectLanguage(code)
      : (element.language as Exclude<Language, 'auto'>);
  const size = element.style.fontSize;
  const lineHeight = size * element.style.lineHeight;
  ctx.font = fontString(element.style, size);
  ctx.textBaseline = 'top';

  const lines = code.split('\n');
  const visible = Math.floor((element.h - CODE_PADDING * 2) / lineHeight) + 1;
  lines.slice(0, visible).forEach((line, index) => {
    let x = element.x + CODE_PADDING;
    const y = element.y + CODE_PADDING + index * lineHeight;
    for (const token of tokenizeLine(line.replace(/\t/g, '  '), language)) {
      ctx.fillStyle = TOKEN_COLORS[token.kind];
      ctx.fillText(token.text, x, y);
      x += ctx.measureText(token.text).width;
      if (x > element.x + element.w) break;
    }
  });

  // Which language it is being read as, small in the corner.
  ctx.font = `500 ${Math.max(9, size * 0.72)}px ${fontStack('mono')}`;
  ctx.fillStyle = '#7f849c';
  ctx.textAlign = 'right';
  ctx.fillText(language, element.x + element.w - 10, element.y + 8);
  ctx.restore();
}

/** Room the card leaves for its picture, which the page draws over it. */
export function embedImageHeight(element: BoardElement): number {
  return element.embed?.kind === 'video' ? element.h : element.embed?.image ? element.h * 0.55 : 0;
}

export function drawEmbed(
  ctx: CanvasRenderingContext2D,
  element: BoardElement,
  colors: CanvasColors,
  zoom: number,
): void {
  const embed = element.embed;
  if (!embed) return;
  ctx.save();

  if (embed.kind === 'video') {
    const radius = Math.min(element.style.radius, element.w / 2, element.h / 2);
    ctx.beginPath();
    ctx.roundRect(element.x, element.y, element.w, element.h, radius);
    ctx.fillStyle = '#0f0f12';
    ctx.fill();
    const r = Math.min(element.w, element.h) * 0.12;
    const cx = element.x + element.w / 2;
    const cy = element.y + element.h / 2;
    ctx.fillStyle = '#ff0033';
    ctx.beginPath();
    ctx.roundRect(cx - r * 1.4, cy - r, r * 2.8, r * 2, r * 0.5);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.4, cy - r * 0.55);
    ctx.lineTo(cx + r * 0.6, cy);
    ctx.lineTo(cx - r * 0.4, cy + r * 0.55);
    ctx.fill();
    ctx.restore();
    return;
  }

  cardBox(ctx, element, colors, zoom);
  const top = element.y + embedImageHeight(element);
  const width = element.w - 28;
  const size = element.style.fontSize;
  ctx.textBaseline = 'top';
  ctx.fillStyle = resolveColor(element.style.textColor, colors) ?? '#222';
  ctx.font = fontString({ ...element.style, fontWeight: 650 }, size);
  let y = top + 12;
  ctx.fillText(fitLine(ctx, embed.title || embed.url, width), element.x + 14, y);
  y += size * 1.45;
  if (embed.description) {
    ctx.font = fontString(element.style, size * 0.82);
    ctx.fillStyle = colors.byToken.get('--text-2') ?? '#555';
    ctx.fillText(fitLine(ctx, embed.description, width), element.x + 14, y);
    y += size * 1.3;
  }
  ctx.font = fontString(element.style, size * 0.75);
  ctx.fillStyle = colors.byToken.get('--text-muted') ?? '#888';
  ctx.fillText(fitLine(ctx, embed.site || new URL(embed.url).hostname, width), element.x + 14, y);
  ctx.restore();
}
