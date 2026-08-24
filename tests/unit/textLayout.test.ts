import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE, type ElementStyle } from '@/model/element';
import {
  containsRtl,
  detectDirection,
  fitFontSize,
  layoutText,
  wrapText,
} from '@/model/textLayout';

/** Every character is one unit wide — enough to test wrapping deterministically. */
const monospace = (text: string) => text.length;
const monospaceAt = (size: number) => (text: string) => text.length * size;

const style = (overrides: Partial<ElementStyle> = {}): ElementStyle => ({
  ...DEFAULT_STYLE,
  ...overrides,
});

// Checklist item 6 — the gate.
describe('direction', () => {
  it('reads Arabic as right-to-left', () => {
    expect(detectDirection('مرحبا بالعالم')).toBe('rtl');
    expect(detectDirection('السبورة')).toBe('rtl');
  });

  it('reads Latin as left-to-right', () => {
    expect(detectDirection('hello world')).toBe('ltr');
  });

  it('skips neutral characters and takes the first strong one', () => {
    expect(detectDirection('123 — مرحبا')).toBe('rtl');
    expect(detectDirection('  "hello"')).toBe('ltr');
    expect(detectDirection('99 bottles')).toBe('ltr');
  });

  it('defaults to left-to-right with nothing to go on', () => {
    expect(detectDirection('')).toBe('ltr');
    expect(detectDirection('123 456')).toBe('ltr');
  });

  it('follows the first strong character in mixed text', () => {
    expect(detectDirection('Sabboura سبورة')).toBe('ltr');
    expect(detectDirection('سبورة Sabboura')).toBe('rtl');
  });

  it('detects Arabic anywhere for shaping decisions', () => {
    expect(containsRtl('board سبورة')).toBe(true);
    expect(containsRtl('board')).toBe(false);
  });

  it('handles Hebrew and Arabic presentation forms too', () => {
    expect(detectDirection('שלום')).toBe('rtl');
    expect(detectDirection('ﻻ')).toBe('rtl');
  });
});

describe('wrapText', () => {
  it('breaks on spaces', () => {
    const lines = wrapText('aaa bbb ccc', 7, monospace);
    expect(lines.map((line) => line.text)).toEqual(['aaa bbb', 'ccc']);
  });

  it('keeps explicit newlines', () => {
    expect(wrapText('one\ntwo', 100, monospace).map((line) => line.text)).toEqual(['one', 'two']);
  });

  it('preserves an empty line', () => {
    expect(wrapText('a\n\nb', 100, monospace)).toHaveLength(3);
  });

  it('breaks inside a word that cannot fit at all', () => {
    const lines = wrapText('abcdefghij', 4, monospace);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.text.length).toBeLessThanOrEqual(4);
  });

  it('numbers list items and indents their wrapped continuations', () => {
    const lines = wrapText('first item here\nsecond', 10, monospace, style({ list: 'number' }));
    expect(lines[0]!.marker).toBe('1. ');
    const continuation = lines.find((line) => line.marker.trim() === '' && line.text !== '');
    expect(continuation).toBeDefined();
    expect(lines.find((line) => line.marker === '2. ')).toBeDefined();
  });

  it('bullets every paragraph', () => {
    const lines = wrapText('one\ntwo', 100, monospace, style({ list: 'bullet' }));
    expect(lines.map((line) => line.marker)).toEqual(['• ', '• ']);
  });
});

describe('layoutText', () => {
  it('reports height from the line count and line height', () => {
    const result = layoutText(
      'aaa bbb ccc',
      7,
      style({ fontSize: 10, lineHeight: 1.5 }),
      monospace,
    );
    expect(result.lines).toHaveLength(2);
    expect(result.lineHeight).toBe(15);
    expect(result.height).toBe(30);
  });

  it('carries the direction through', () => {
    expect(layoutText('مرحبا', 100, style(), monospace).direction).toBe('rtl');
  });
});

// Checklist item 7.
describe('fitFontSize', () => {
  it('keeps the requested size when the text already fits', () => {
    const size = fitFontSize('hi', { w: 400, h: 400 }, style({ fontSize: 20 }), monospaceAt);
    expect(size).toBe(20);
  });

  it('shrinks the text rather than overflowing the note', () => {
    const long = 'a fairly long sticky note that will not fit at full size';
    const size = fitFontSize(long, { w: 120, h: 120 }, style({ fontSize: 40 }), monospaceAt);
    expect(size).toBeLessThan(40);
    expect(size).toBeGreaterThanOrEqual(8);
  });

  it('produces a size that genuinely fits', () => {
    const long = 'the quick brown fox jumps over the lazy dog again and again';
    const box = { w: 150, h: 100 };
    const chosen = fitFontSize(long, box, style({ fontSize: 40, lineHeight: 1.2 }), monospaceAt);

    const lines = wrapText(long, box.w, monospaceAt(chosen), style());
    expect(lines.length * chosen * 1.2).toBeLessThanOrEqual(box.h);
  });

  it('stops at the floor rather than vanishing', () => {
    const size = fitFontSize(
      'x'.repeat(4000),
      { w: 40, h: 40 },
      style({ fontSize: 40 }),
      monospaceAt,
      {
        min: 6,
      },
    );
    expect(size).toBe(6);
  });

  it('respects padding', () => {
    const text = 'some words to wrap here';
    const roomy = fitFontSize(text, { w: 200, h: 200 }, style({ fontSize: 30 }), monospaceAt);
    const padded = fitFontSize(text, { w: 200, h: 200 }, style({ fontSize: 30 }), monospaceAt, {
      padding: 40,
    });
    expect(padded).toBeLessThanOrEqual(roomy);
  });
});
