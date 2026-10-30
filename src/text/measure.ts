import { fontString } from '@/canvas/fonts';
import { TEXT_PADDING } from '@/canvas/renderContent';
import type { BoardElement, ElementStyle } from '@/model/element';
import { layoutText } from '@/model/textLayout';
import { runsOf } from './marks';

const SAMPLE = 'The quick brown fox jumps over the lazy dog';

let context: CanvasRenderingContext2D | null | undefined;

/** A canvas to measure with — the same one drawing uses, so wrapping agrees. */
export function measuring(): CanvasRenderingContext2D | null {
  if (context === undefined) {
    try {
      context = document.createElement('canvas').getContext('2d');
    } catch {
      context = null;
    }
  }
  return context;
}

/**
 * The size a clicked text box starts at: so many characters by so many lines of its
 * own type — 55 by 8 unless the person chose otherwise in Settings.
 */
export function defaultTextBox(
  style: ElementStyle,
  shape: { chars: number; lines: number },
): { w: number; h: number } {
  const ctx = measuring();
  let average = style.fontSize * 0.5;
  if (ctx) {
    ctx.font = fontString(style, style.fontSize);
    average = ctx.measureText(SAMPLE).width / SAMPLE.length;
  }
  return {
    w: Math.round(average * shape.chars + TEXT_PADDING * 2),
    h: Math.round(style.fontSize * style.lineHeight * shape.lines + TEXT_PADDING * 2),
  };
}

/** How tall a text box must be to show all of this text; null where nothing can measure. */
export function textHeight(element: BoardElement, text: string): number | null {
  const ctx = measuring();
  if (!ctx) return null;
  const style = element.style;
  const marks = element.marks?.length ? element.marks : undefined;
  const measure = (value: string, start?: number) => {
    if (!marks || start === undefined) {
      ctx.font = fontString(style, style.fontSize);
      return ctx.measureText(value).width;
    }
    // Bold is wider: measured run by run, as it is drawn.
    let width = 0;
    for (const run of runsOf(marks, start, start + value.length)) {
      ctx.font = fontString(
        {
          ...style,
          fontWeight: run.marks.bold ? Math.max(700, style.fontWeight) : style.fontWeight,
          italic: style.italic || Boolean(run.marks.italic),
        },
        style.fontSize,
      );
      width += ctx.measureText(value.slice(run.from - start, run.to - start)).width;
    }
    return width;
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
