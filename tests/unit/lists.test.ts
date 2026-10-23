import { describe, expect, it } from 'vitest';
import {
  autoFormat,
  listKindOf,
  onBackspace,
  onEnter,
  renumberAfter,
  toggleList,
} from '@/text/lists';

/** Where "|" is in the text is where the caret is. */
function at(marked: string) {
  const caret = marked.indexOf('|');
  return { text: marked.replace('|', ''), caret };
}
function show(edit: { text: string; start: number } | null) {
  return edit ? edit.text.slice(0, edit.start) + '|' + edit.text.slice(edit.start) : null;
}

describe('lists in a text box', () => {
  it('Enter continues a numbered list and renumbers what follows', () => {
    const { text, caret } = at('1. milk|\n2. eggs');
    expect(show(onEnter(text, caret, caret, false))).toBe('1. milk\n2. |\n3. eggs');
  });

  it('Enter continues bullets', () => {
    const { text, caret } = at('• one|');
    expect(show(onEnter(text, caret, caret, false))).toBe('• one\n• |');
  });

  it('Enter on an empty item ends the list', () => {
    const { text, caret } = at('1. milk\n2. |');
    expect(show(onEnter(text, caret, caret, false))).toBe('1. milk\n|');
  });

  it('Enter on a plain line is just a new line', () => {
    const { text, caret } = at('hello|');
    expect(onEnter(text, caret, caret, false)).toBeNull();
  });

  it('Shift+Enter stays in the item: a new line, indented, no number', () => {
    const { text, caret } = at('1. milk|\n2. eggs');
    expect(show(onEnter(text, caret, caret, true))).toBe('1. milk\n   |\n2. eggs');
    // Enter at the end of that line starts the next item, and the rest renumber.
    const typed = at('1. milk\n   semi-skimmed|\n2. eggs');
    expect(show(onEnter(typed.text, typed.caret, typed.caret, false))).toBe(
      '1. milk\n   semi-skimmed\n2. |\n3. eggs',
    );
  });

  it('Shift+Enter on a plain line is left to the textarea', () => {
    const { text, caret } = at('hello|');
    expect(onEnter(text, caret, caret, true)).toBeNull();
  });

  it('Backspace straight after a marker removes it and renumbers the rest', () => {
    const { text, caret } = at('1. milk\n2. |eggs\n3. bread');
    expect(show(onBackspace(text, caret, caret))).toBe('1. milk\n|eggs\n2. bread');
  });

  it('Backspace anywhere else is ordinary', () => {
    const { text, caret } = at('1. mi|lk');
    expect(onBackspace(text, caret, caret)).toBeNull();
  });

  it('a changed number carries on through the list', () => {
    expect(renumberAfter('5. a\n2. b\n3. c', 0)).toBe('5. a\n6. b\n7. c');
    // A blank line ends the list.
    expect(renumberAfter('5. a\n\n1. b', 0)).toBe('5. a\n\n1. b');
  });

  it('"- " and "* " at the start of a line become bullets', () => {
    expect(show(autoFormat('- ', 2))).toBe('• |');
    expect(show(autoFormat('text\n* ', 7))).toBe('text\n• |');
    expect(autoFormat('a - ', 4)).toBeNull();
  });

  it('the panel buttons turn every paragraph into an item, and back', () => {
    const plain = 'milk\neggs\n\nbread';
    const numbered = toggleList(plain, 'number');
    expect(numbered).toBe('1. milk\n2. eggs\n\n3. bread');
    expect(listKindOf(numbered)).toBe('number');
    expect(toggleList(numbered, 'number')).toBe(plain);
    expect(toggleList(numbered, 'bullet')).toBe('• milk\n• eggs\n\n• bread');
  });
});
