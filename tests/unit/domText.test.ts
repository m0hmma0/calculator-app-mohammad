import { describe, expect, it } from 'vitest';
import { readBox, renderInto, selectionIn, selectRange } from '@/text/domText';

function box() {
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.append(root);
  return root;
}

describe('the rich text box', () => {
  it('reads back exactly what it was given, formatting included', () => {
    const root = box();
    const marks = [
      { from: 0, to: 5, bold: true as const },
      { from: 6, to: 11, underline: true as const, italic: true as const },
    ];
    renderInto(root, 'Hello world\nsecond', marks);
    const read = readBox(root);
    expect(read.text).toBe('Hello world\nsecond');
    expect(read.marks).toEqual(marks);
  });

  it('an empty box, or one ending on a new line, still reads as its text', () => {
    const root = box();
    renderInto(root, '');
    expect(readBox(root).text).toBe('');
    renderInto(root, 'line\n');
    expect(readBox(root).text).toBe('line\n');
  });

  it('a selection round-trips between the text and the box', () => {
    const root = box();
    renderInto(root, 'Hello world\nsecond', [{ from: 0, to: 5, bold: true }]);
    for (const [start, end] of [
      [0, 0],
      [2, 8],
      [5, 5],
      [11, 12],
      [12, 18],
      [18, 18],
    ] as const) {
      selectRange(root, start, end);
      expect(selectionIn(root)).toEqual({ start, end });
    }
  });

  it('reads what a browser leaves behind: its own bold and line blocks', () => {
    const root = box();
    root.innerHTML = 'one <b>two</b><div>three</div>';
    const read = readBox(root);
    expect(read.text).toBe('one two\nthree');
    expect(read.marks).toEqual([{ from: 4, to: 7, bold: true }]);
  });
});
