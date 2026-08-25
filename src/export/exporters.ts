import { getCanvasColors, resolveColor } from '@/canvas/theme';
import { renderElements } from '@/canvas/renderElements';
import type { BoardElement } from '@/model/element';
import { jpegToPdf } from './pdf';
import { boundsOf, elementsToSvg } from './svg';

export type ExportFormat = 'png' | 'svg' | 'pdf';

export interface ExportOptions {
  /** Element the theme's custom properties are read from. */
  host: Element;
  /** Pixels per board unit. 2 keeps a PNG sharp on a retina screen. */
  scale?: number;
  padding?: number;
  /** PNG keeps a transparent background unless one is given. */
  background?: string | null;
}

const MAX_DIMENSION = 8192;

/** Draws the given elements onto an offscreen canvas at their own bounds. */
export function renderToCanvas(
  elements: readonly BoardElement[],
  options: ExportOptions,
): HTMLCanvasElement {
  const padding = options.padding ?? 24;
  const bounds = boundsOf(elements, padding);
  const requested = options.scale ?? 2;
  // Very large boards would otherwise ask for a canvas the browser refuses to make.
  const scale = Math.min(requested, MAX_DIMENSION / Math.max(bounds.w, bounds.h));

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bounds.w * scale));
  canvas.height = Math.max(1, Math.round(bounds.h * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const colors = getCanvasColors(options.host);
  if (options.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  // Reuse the on-screen renderer, so an export cannot drift from what was drawn.
  renderElements(
    ctx,
    { x: bounds.x, y: bounds.y, zoom: 1 },
    { width: bounds.w, height: bounds.h },
    elements,
    colors,
  );

  return canvas;
}

export function exportSvg(elements: readonly BoardElement[], options: ExportOptions): string {
  const colors = getCanvasColors(options.host);
  return elementsToSvg(elements, {
    resolve: (value) => resolveColor(value, colors),
    background: options.background ?? null,
    padding: options.padding,
  });
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function exportBlob(
  elements: readonly BoardElement[],
  format: ExportFormat,
  options: ExportOptions,
): Promise<Blob> {
  if (format === 'svg') {
    return new Blob([exportSvg(elements, options)], { type: 'image/svg+xml' });
  }

  if (format === 'png') {
    const canvas = renderToCanvas(elements, options);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ?? new Blob([], { type: 'image/png' });
  }

  // JPEG has no transparency, so a PDF always gets a white page under the content.
  const canvas = renderToCanvas(elements, {
    ...options,
    background: options.background ?? '#ffffff',
  });
  const jpeg = dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.92));
  const bytes = jpegToPdf({ jpeg, widthPx: canvas.width, heightPx: canvas.height });
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
