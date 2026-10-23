import type { TextMark } from '@/model/element';

/**
 * Bold, italic and underline on part of a text. In the shared document they are
 * formatting on the text itself, so they move with the words as anyone types; in
 * the app they are a list of ranges, which is what drawing and editing need.
 */
export type MarkName = 'bold' | 'italic' | 'underline';
export const MARK_NAMES: readonly MarkName[] = ['bold', 'italic', 'underline'];

export interface MarkSet {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

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
  return MARK_NAMES.every((name) => Boolean(a[name]) === Boolean(b[name]));
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
