/**
 * Lists the way a word processor does them, in plain text. A list item is a line
 * that starts with its marker — "• " or "1. " — written into the text itself, so
 * the marker can be deleted, or its number changed, like any other characters, and
 * so everyone editing the box sees the same thing.
 *
 *   Enter          on an item: a new item, numbered one on; on an empty item: the list ends
 *   Shift+Enter    a new line inside the same item, indented and without a marker
 *   Backspace      straight after a marker: the marker goes, the words stay
 *   "- " or "* "   typed at the start of a line: a bulleted item
 *   "1. "          typed at the start of a line: a numbered item, already
 *
 * Each returns the new text and caret, or null to let the textarea do its default.
 */
export interface TextEdit {
  text: string;
  start: number;
  end: number;
}

export type ListKind = 'bullet' | 'number';

export const BULLET = '•';
const ITEM = /^([ \t]*)(•|(\d+)([.)]))[ \t]/;

interface Item {
  indent: string;
  kind: ListKind;
  number: number;
  punctuation: string;
  /** Characters up to and including the space after the marker. */
  prefix: number;
}

export function itemOf(line: string): Item | null {
  const match = ITEM.exec(line);
  if (!match) return null;
  return {
    indent: match[1]!,
    kind: match[3] ? 'number' : 'bullet',
    number: match[3] ? Number(match[3]) : 0,
    punctuation: match[4] ?? '',
    prefix: match[0].length,
  };
}

/** The marker text a line starts with — what wrapped lines hang under. */
export function listPrefix(line: string): string | null {
  return ITEM.exec(line)?.[0] ?? null;
}

const lineStartOf = (text: string, at: number) => text.lastIndexOf('\n', at - 1) + 1;
const lineEndOf = (text: string, at: number) => {
  const end = text.indexOf('\n', at);
  return end === -1 ? text.length : end;
};

const marker = (item: Pick<Item, 'kind' | 'punctuation'>, number: number) =>
  item.kind === 'bullet' ? `${BULLET} ` : `${number}${item.punctuation || '.'} `;

/** A line that belongs to the item above it: indented, and not an item itself. */
const isContinuation = (line: string) => /^[ \t]+\S/.test(line) && !itemOf(line);

/**
 * Numbers every numbered item after `lineIndex` in the same list one on from the
 * item before it — so inserting or removing an item, or changing a number, carries
 * through the rest of the list. Lines without a number in between are passed over,
 * as a word processor continues a list around them; a blank line ends the list.
 */
export function renumberAfter(text: string, lineIndex: number): string {
  const lines = text.split('\n');
  let previous: number | null = null;
  for (let index = lineIndex; index >= 0; index -= 1) {
    const line = lines[index]!;
    if (line.trim() === '') break;
    const item = itemOf(line);
    if (item) {
      if (item.kind === 'number') previous = item.number;
      break;
    }
  }
  if (previous === null) return text;
  for (let index = lineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim() === '') break;
    const item = itemOf(line);
    if (!item) continue;
    if (item.kind !== 'number') break;
    previous += 1;
    lines[index] = item.indent + marker(item, previous) + line.slice(item.prefix);
  }
  return lines.join('\n');
}

/** The item a continuation line belongs to, by walking up to it. */
function owningItem(text: string, lineStart: number): Item | null {
  if (lineStart === 0) return null;
  const lines = text.slice(0, lineStart - 1).split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!;
    const item = itemOf(line);
    if (item) return item;
    if (!isContinuation(line)) return null;
  }
  return null;
}

const lineIndexAt = (text: string, at: number) => text.slice(0, at).split('\n').length - 1;

export function onEnter(text: string, start: number, end: number, soft: boolean): TextEdit | null {
  if (start !== end) return null;
  const lineStart = lineStartOf(text, start);
  const line = text.slice(lineStart, lineEndOf(text, start));
  const item = itemOf(line);
  // A soft break inside an item, or inside a line that already continues one.
  if (soft) {
    const hang = item
      ? line.slice(0, item.prefix)
      : isContinuation(line)
        ? /^[ \t]+/.exec(line)![0]
        : null;
    if (hang === null) return null;
    const indent = ' '.repeat(hang.length);
    const next = `${text.slice(0, start)}\n${indent}${text.slice(end)}`;
    const caret = start + 1 + indent.length;
    return { text: next, start: caret, end: caret };
  }
  if (!item) {
    // Enter at the end of a line that continues an item starts the next item.
    const owner = isContinuation(line) ? owningItem(text, lineStart) : null;
    if (!owner || line.trim() === '') return null;
    const inserted = `\n${owner.indent}${marker(owner, owner.number + 1)}`;
    const joined = text.slice(0, start) + inserted + text.slice(end);
    const caret = start + inserted.length;
    return { text: renumberAfter(joined, lineIndexAt(joined, caret)), start: caret, end: caret };
  }

  // Enter on an item with nothing in it ends the list, as in any word processor.
  if (line.slice(item.prefix).trim() === '') {
    const next = text.slice(0, lineStart) + item.indent + text.slice(lineStart + line.length);
    const caret = lineStart + item.indent.length;
    return { text: renumberAfter(next, lineIndexAt(next, caret)), start: caret, end: caret };
  }

  const inserted = `\n${item.indent}${marker(item, item.number + 1)}`;
  const joined = text.slice(0, start) + inserted + text.slice(end);
  const caret = start + inserted.length;
  return { text: renumberAfter(joined, lineIndexAt(joined, caret)), start: caret, end: caret };
}

export function onBackspace(text: string, start: number, end: number): TextEdit | null {
  if (start !== end) return null;
  const lineStart = lineStartOf(text, start);
  const line = text.slice(lineStart, lineEndOf(text, start));
  const item = itemOf(line);
  if (!item || start !== lineStart + item.prefix) return null;
  const next = text.slice(0, lineStart + item.indent.length) + text.slice(start);
  const caret = lineStart + item.indent.length;
  // The items after it now follow the one before it.
  const index = lineIndexAt(next, caret);
  return { text: renumberAfter(next, Math.max(0, index - 1)), start: caret, end: caret };
}

/** After a space is typed: "- " or "* " at the start of a line becomes a bullet. */
export function autoFormat(text: string, caret: number): TextEdit | null {
  const lineStart = lineStartOf(text, caret);
  const typed = text.slice(lineStart, caret);
  const match = /^([ \t]*)[-*] $/.exec(typed);
  if (!match) return null;
  const replaced = `${match[1]}${BULLET} `;
  const next = text.slice(0, lineStart) + replaced + text.slice(caret);
  const at = lineStart + replaced.length;
  return { text: next, start: at, end: at };
}

/** What kind of list the whole box is, if it is one. */
export function listKindOf(text: string): ListKind | 'none' {
  const lines = text.split('\n').filter((line) => line.trim() !== '' && !isContinuation(line));
  if (lines.length === 0) return 'none';
  const kinds = new Set(lines.map((line) => itemOf(line)?.kind ?? 'none'));
  return kinds.size === 1 ? ([...kinds][0] as ListKind | 'none') : 'none';
}

/**
 * The side panel's list buttons: makes every paragraph an item of this kind,
 * numbered from 1 — or, when the box is already that kind of list, plain again.
 */
export function toggleList(text: string, kind: ListKind): string {
  const removing = listKindOf(text) === kind;
  let number = 0;
  return text
    .split('\n')
    .map((line) => {
      if (line.trim() === '' || isContinuation(line)) return line;
      const item = itemOf(line);
      const body = item ? line.slice(item.prefix) : line.replace(/^[ \t]+/, '');
      const indent = item?.indent ?? '';
      if (removing) return indent + body;
      number += 1;
      return indent + (kind === 'bullet' ? `${BULLET} ` : `${number}. `) + body;
    })
    .join('\n');
}
