import { listPrefix } from '@/text/lists';
import type { ElementStyle } from './element';

/**
 * Arabic, Hebrew, Syriac, Thaana and the Arabic supplement/extended blocks, plus
 * the Arabic presentation forms. Enough to tell an Arabic board apart from a Latin
 * one, which is all the direction guess needs.
 */
const RTL_PATTERN =
  /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u0780-\u07BF\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

/** Latin, Greek, Cyrillic — anything that would argue for left-to-right. */
const LTR_PATTERN = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;

export type Direction = 'ltr' | 'rtl';

/**
 * Direction from the first strong character, the way the Unicode bidi algorithm
 * decides it. Numbers and punctuation are neutral, so "123 مرحبا" is still RTL.
 */
export function detectDirection(text: string): Direction {
  for (const character of text) {
    if (RTL_PATTERN.test(character)) return 'rtl';
    if (LTR_PATTERN.test(character)) return 'ltr';
  }
  return 'ltr';
}

export function containsRtl(text: string): boolean {
  return RTL_PATTERN.test(text);
}

export interface WrappedLine {
  text: string;
  /** Prefix for a list item, already numbered where relevant. */
  marker: string;
  /**
   * How far a wrapped line of a list item is set in, so it hangs under the item's
   * words rather than under its number.
   */
  indent?: number;
  /** Where `text` begins in the whole text — so formatting can be found for it. */
  start: number;
}

/**
 * Width of a piece of the text. `start` is where the piece begins in the whole
 * text, for measures that know about formatting (a bold word is wider); plain
 * measures ignore it.
 */
export type MeasureText = (text: string, start?: number) => number;

/**
 * Greedy word wrap. Falls back to breaking inside a word only when a single word
 * cannot fit, so a long URL wraps instead of overflowing the box.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: MeasureText,
  style?: Pick<ElementStyle, 'list'>,
): WrappedLine[] {
  const lines: WrappedLine[] = [];
  const paragraphs = text.split('\n');
  const list = style?.list ?? 'none';
  let itemNumber = 0;
  let paragraphStart = 0;

  for (const paragraph of paragraphs) {
    itemNumber += 1;
    const marker = list === 'bullet' ? '• ' : list === 'number' ? `${itemNumber}. ` : '';
    const markerWidth = marker ? measure(marker) : 0;
    // An item whose marker is written in the text hangs its wrapped lines under its words.
    const prefix = marker ? null : listPrefix(paragraph);
    const hang = prefix ? measure(prefix, paragraphStart) : 0;
    let available = Math.max(1, maxWidth - markerWidth);

    if (paragraph.length === 0) {
      lines.push({ text: '', marker, start: paragraphStart });
      paragraphStart += 1;
      continue;
    }

    let current = '';
    let currentStart = paragraphStart;
    let first = true;

    const push = () => {
      lines.push({
        text: current,
        marker: first ? marker : ' '.repeat(marker.length),
        start: currentStart,
        ...(hang && !first ? { indent: hang } : {}),
      });
      if (first && hang) available = Math.max(1, maxWidth - hang);
      first = false;
      current = '';
    };

    let wordStart = paragraphStart;
    for (const word of paragraph.split(' ')) {
      const candidate = current === '' ? word : `${current} ${word}`;
      const candidateStart = current === '' ? wordStart : currentStart;
      const width = measure(candidate, candidateStart);
      if (width <= available || current === '') {
        if (width > available && current === '') {
          // A single word wider than the box: break it character by character.
          let chunk = '';
          let chunkStart = wordStart;
          let offset = wordStart;
          for (const character of word) {
            if (measure(chunk + character, chunkStart) > available && chunk !== '') {
              current = chunk;
              currentStart = chunkStart;
              push();
              chunk = character;
              chunkStart = offset;
            } else {
              chunk += character;
            }
            offset += character.length;
          }
          current = chunk;
          currentStart = chunkStart;
          wordStart += word.length + 1;
          continue;
        }
        current = candidate;
        currentStart = candidateStart;
      } else {
        push();
        current = word;
        currentStart = wordStart;
      }
      wordStart += word.length + 1;
    }
    push();
    paragraphStart += paragraph.length + 1;
  }

  return lines;
}

export interface LayoutResult {
  lines: WrappedLine[];
  lineHeight: number;
  height: number;
  direction: Direction;
}

export function layoutText(
  text: string,
  maxWidth: number,
  style: ElementStyle,
  measure: MeasureText,
): LayoutResult {
  const lines = wrapText(text, maxWidth, measure, style);
  const lineHeight = style.fontSize * style.lineHeight;
  return {
    lines,
    lineHeight,
    height: lines.length * lineHeight,
    direction: detectDirection(text),
  };
}

/**
 * Largest font size at which the text still fits the box — what makes a sticky note
 * shrink its text instead of overflowing. Binary search over integer sizes, because
 * measurement is the expensive part and one pixel of precision is invisible.
 */
export function fitFontSize(
  text: string,
  box: { w: number; h: number },
  style: ElementStyle,
  measureAt: (size: number) => MeasureText,
  options: { min?: number; max?: number; padding?: number } = {},
): number {
  const min = options.min ?? 8;
  const max = options.max ?? style.fontSize;
  const padding = options.padding ?? 0;
  const availableWidth = Math.max(1, box.w - padding * 2);
  const availableHeight = Math.max(1, box.h - padding * 2);

  const fits = (size: number): boolean => {
    const lines = wrapText(text, availableWidth, measureAt(size), style);
    return lines.length * size * style.lineHeight <= availableHeight;
  };

  if (fits(max)) return max;

  let low = min;
  let high = max;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}
