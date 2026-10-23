import { fontString } from '@/canvas/fonts';
import { TEXT_PADDING } from '@/canvas/renderContent';
import type { BoardElement, ElementStyle } from '@/model/element';
import { layoutText } from '@/model/textLayout';

/** A new text box, clicked rather than dragged out: this many characters wide… */
export const TEXT_BOX_CHARS = 55;
/** …and this many lines tall. */
export const TEXT_BOX_LINES = 8;

const SAMPLE = 'The quick brown fox jumps over the lazy dog';

let context: CanvasRenderingContext2D | null | undefined;

/** A canvas to measure with — the same one drawing uses, so wrapping agrees. */
function measuring(): CanvasRenderingContext2D | null {
  if (context === undefined) {
    try {
      context = document.createElement('canvas').getContext('2d');
    } catch {
      context = null;
    }
  }
  return context;
}

/** The size a clicked text box starts at: 55 characters by 8 lines of its own type. */
export function defaultTextBox(style: ElementStyle): { w: number; h: number } {
  const ctx = measuring();
  let average = style.fontSize * 0.5;
  if (ctx) {
    ctx.font = fontString(style, style.fontSize);
    average = ctx.measureText(SAMPLE).width / SAMPLE.length;
  }
  return {
    w: Math.round(average * TEXT_BOX_CHARS + TEXT_PADDING * 2),
    h: Math.round(style.fontSize * style.lineHeight * TEXT_BOX_LINES + TEXT_PADDING * 2),
  };
}

/** How tall a text box must be to show all of this text; null where nothing can measure. */
export function textHeight(element: BoardElement, text: string): number | null {
  const ctx = measuring();
  if (!ctx) return null;
  const style = element.style;
  const measure = (value: string) => {
    ctx.font = fontString(style, style.fontSize);
    return ctx.measureText(value).width;
  };
  const layout = layoutText(text, Math.max(1, element.w - TEXT_PADDING * 2), style, measure);
  return Math.ceil(Math.max(1, layout.lines.length) * layout.lineHeight + TEXT_PADDING * 2);
}

/** The width a line of text needs, for sizing pasted text to what it holds. */
export function textWidth(style: ElementStyle, text: string): number | null {
  const ctx = measuring();
  if (!ctx) return null;
  ctx.font = fontString(style, style.fontSize);
  return Math.ceil(ctx.measureText(text).width + TEXT_PADDING * 2);
}
