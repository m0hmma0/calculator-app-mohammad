import type { BoardElement } from '@/model/element';

/**
 * Frame shapes that fill a screen when presented (asked for on 20 November): a phone
 * either way round, a laptop, and the screen this is on. A frame keeps its top-left
 * corner and roughly its area, so it stays about the size it was; what is in it is
 * left where it is.
 */
export interface FrameSize {
  id: string;
  label: string;
  /** Width over height; null for this screen, worked out when chosen. */
  ratio: number | null;
}

export const FRAME_SIZES: readonly FrameSize[] = [
  { id: 'screen', label: 'This screen', ratio: null },
  { id: 'phone-landscape', label: 'Phone landscape', ratio: 19.5 / 9 },
  { id: 'phone-portrait', label: 'Phone portrait', ratio: 9 / 19.5 },
  { id: 'laptop', label: 'Laptop 16:9', ratio: 16 / 9 },
  { id: 'laptop-tall', label: 'Laptop 16:10', ratio: 16 / 10 },
];

/** The whole screen's shape as it is held now (a phone's `screen` may not turn with it). */
export function screenRatio(): number {
  const { width, height } = window.screen;
  const long = Math.max(width, height);
  const short = Math.max(1, Math.min(width, height));
  const landscape = window.matchMedia?.('(orientation: landscape)').matches ?? width >= height;
  return landscape ? long / short : short / long;
}

/** A frame of `ratio`, the same area as `frame`, from the same top-left corner. */
export function resizedFrame(
  frame: Pick<BoardElement, 'w' | 'h'>,
  ratio: number,
): { w: number; h: number } {
  const area = Math.max(1, frame.w * frame.h);
  const w = Math.round(Math.sqrt(area * ratio));
  return { w, h: Math.round(w / ratio) };
}

/** Whether a frame already has this shape, near enough to show as chosen. */
export function hasRatio(frame: Pick<BoardElement, 'w' | 'h'>, ratio: number): boolean {
  return frame.h > 0 && Math.abs(frame.w / frame.h / ratio - 1) < 0.01;
}
