import type { TextMark } from '@/model/element';

/**
 * Formatting on part of a text: bold, italic, underline and strikethrough, on or off, and
 * a colour, a highlight and a link, which carry a value. In the shared document they
 * are formatting on the text itself, so they move with the words as anyone types; in
 * the app they are a list of ranges, which is what drawing and editing need.
 */
export type MarkName = 'bold' | 'italic' | 'underline' | 'strike';
export const MARK_NAMES: readonly MarkName[] = ['bold', 'italic', 'underline', 'strike'];

export type ValuedMark = 'color' | 'highlight' | 'link';
export const VALUED_MARKS: readonly ValuedMark[] = ['color', 'highlight', 'link'];

export interface MarkSet {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  highlight?: string;
  link?: string;
}

/** A change to formatting: B, I and U turned on or off; a value set, or null to clear it. */
export type MarkFormats = Partial<Record<MarkName, boolean>> &
  Partial<Record<ValuedMark, string | null>>;

interface DeltaOp {
  insert?: unknown;
  attributes?: Record<string, unknown>;
}

/** Ranges from a Y.Text delta; empty when nothing is formatted. */
export function marksFromDelta(delta: readonly DeltaOp[]): TextMark[] {
  const marks: TextMark[] = [];
  let at = 0;
  for (const op of delta) {
    const length = typeof op.insert === 'string' ? op.insert.length : 0;
    const attributes = op.attributes ?? {};
    const mark: TextMark = { from: at, to: at + length };
    let any = false;
    for (const name of MARK_NAMES) {
      if (attributes[name]) {
        mark[name] = true;
        any = true;
      }
    }
    for (const name of VALUED_MARKS) {
      const value = attributes[name];
      if (typeof value === 'string' && value !== '') {
        mark[name] = value;
        any = true;
      }
    }
    if (any && length > 0) {
      const last = marks.at(-1);
      // Neighbouring runs with the same formatting are one range.
      if (last && last.to === mark.from && sameMarks(last, mark)) last.to = mark.to;
      else marks.push(mark);
    }
    at += length;
  }
  return marks;
}

export function sameMarks(a: MarkSet, b: MarkSet): boolean {
  return (
    MARK_NAMES.every((name) => Boolean(a[name]) === Boolean(b[name])) &&
    VALUED_MARKS.every((name) => (a[name] ?? null) === (b[name] ?? null))
  );
}

export function marksEqual(a: readonly TextMark[] = [], b: readonly TextMark[] = []): boolean {
  return (
    a.length === b.length &&
    a.every((mark, index) => {
      const other = b[index]!;
      return mark.from === other.from && mark.to === other.to && sameMarks(mark, other);
    })
  );
}

/** The formatting of the character at `index`. */
export function marksAt(marks: readonly TextMark[] | undefined, index: number): MarkSet {
  if (!marks) return {};
  for (const mark of marks) {
    if (index >= mark.from && index < mark.to) return mark;
  }
  return {};
}

/** True when every character in [from, to) has this formatting. */
export function rangeHas(
  marks: readonly TextMark[] | undefined,
  from: number,
  to: number,
  name: MarkName,
): boolean {
  if (to <= from) return false;
  for (let index = from; index < to; index += 1) {
    if (!marksAt(marks, index)[name]) return false;
  }
  return true;
}

/** The value every character in [from, to) shares — a colour, say — or undefined. */
export function rangeValue(
  marks: readonly TextMark[] | undefined,
  from: number,
  to: number,
  name: ValuedMark,
): string | undefined {
  if (to <= from) return undefined;
  const first = marksAt(marks, from)[name];
  for (let index = from + 1; index < to; index += 1) {
    if (marksAt(marks, index)[name] !== first) return undefined;
  }
  return first;
}

/**
 * The link around a position: the whole run of characters carrying the same address,
 * found from the character after the caret or, at the end of a link, the one before.
 */
export function linkAround(
  marks: readonly TextMark[] | undefined,
  index: number,
): { url: string; from: number; to: number } | null {
  const url = marksAt(marks, index).link ?? marksAt(marks, index - 1).link;
  if (!url || !marks) return null;
  const at = marksAt(marks, index).link === url ? index : index - 1;
  let from = at;
  while (from > 0 && marksAt(marks, from - 1).link === url) from -= 1;
  let to = at + 1;
  while (marksAt(marks, to).link === url) to += 1;
  return { url, from, to };
}

/**
 * Splits [from, to) of the text into runs that share formatting — what is drawn,
 * and measured, one font at a time.
 */
export function runsOf(
  marks: readonly TextMark[] | undefined,
  from: number,
  to: number,
): Array<{ from: number; to: number; marks: MarkSet }> {
  const runs: Array<{ from: number; to: number; marks: MarkSet }> = [];
  let start = from;
  while (start < to) {
    const here = marksAt(marks, start);
    let end = start + 1;
    while (end < to && sameMarks(marksAt(marks, end), here)) end += 1;
    runs.push({ from: start, to: end, marks: here });
    start = end;
  }
  return runs;
}

/**
 * What a typed address becomes as a link: with its scheme, and only if it is a web
 * page or an email address. Anything else — a `javascript:` address above all — is
 * refused, because a link on a shared board is clicked by people who did not write it.
 */
export function normaliseLink(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const email = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(trimmed);
  const withScheme = email
    ? `mailto:${trimmed}`
    : /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null;
    if (url.protocol !== 'mailto:' && !url.hostname.includes('.') && url.hostname !== 'localhost')
      return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Whether pasted text is just an address — pasted over words, it links them. */
export function looksLikeLink(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '' || /\s/.test(trimmed)) return false;
  return /^(https?:\/\/|www\.)/i.test(trimmed) && normaliseLink(trimmed) !== null;
}

/** Where a link goes, short: its site, or the address for an email. */
export function linkLabel(href: string): string {
  try {
    const url = new URL(href);
    return url.protocol === 'mailto:' ? url.pathname : url.hostname.replace(/^www\./, '');
  } catch {
    return href;
  }
}

/** A link opens in a new tab, cut off from this page. */
export function openLink(url: string): void {
  const safe = normaliseLink(url);
  if (safe) window.open(safe, '_blank', 'noopener,noreferrer');
}
