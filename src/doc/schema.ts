import * as Y from 'yjs';
import { marksEqual, marksFromDelta, type MarkFormats, type MarkSet } from '@/text/marks';
import type { BoardElement, ElementStyle, TableData, TextMark } from '@/model/element';
import { DEFAULT_STYLE } from '@/model/element';

/**
 * One Yjs document per board.
 *
 *   elements  Y.Map<id, Y.Map>   one map per element, so two people editing
 *                                different fields of the same shape both win
 *   meta      Y.Map              board title and canvas settings
 *
 * Style lives in its own nested Y.Map for the same reason: changing a fill while
 * someone else drags the shape should not make one of those changes disappear.
 *
 * Text is a Y.Text, edited character by character, so two people typing in the same
 * note both keep what they typed. Documents from before Phase 7 hold it as a plain
 * string; both are read, and the first edit upgrades it.
 *
 * Everything else — the point run of a stroke, an image reference, a connector
 * binding — is written whole, because those are replaced rather than edited.
 */
export const ELEMENTS_KEY = 'elements';
export const META_KEY = 'meta';
export const PAGES_KEY = 'pages';

export interface PageInfo {
  id: string;
  name: string;
}

/**
 * The board's pages, in order. A board that has never had a second page has an
 * empty list here and one implicit page, which every older element belongs to.
 */
export function pagesOf(doc: Y.Doc): Y.Array<PageInfo> {
  return doc.getArray<PageInfo>(PAGES_KEY);
}

export function readPages(doc: Y.Doc): PageInfo[] {
  const stored = pagesOf(doc).toArray();
  return stored.length > 0 ? stored : [{ id: 'p1', name: 'Page 1' }];
}

export type YElement = Y.Map<unknown>;
export type YElements = Y.Map<YElement>;

/** Fields written straight onto the element map. */
const SCALAR_FIELDS = [
  'id',
  'type',
  'x',
  'y',
  'w',
  'h',
  'rotation',
  'opacity',
  'locked',
  'hidden',
  'z',
  'parentId',
] as const;

/** Fields replaced whole rather than merged field by field. */
const OPAQUE_FIELDS = ['points', 'image', 'from', 'to', 'embed', 'language'] as const;

export function elementsOf(doc: Y.Doc): YElements {
  return doc.getMap(ELEMENTS_KEY) as YElements;
}

export function metaOf(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(META_KEY);
}

export function toYElement(element: BoardElement): YElement {
  const map = new Y.Map<unknown>();

  for (const field of SCALAR_FIELDS) map.set(field, element[field]);
  for (const field of OPAQUE_FIELDS) {
    const value = element[field];
    if (value !== undefined) map.set(field, value);
  }
  if (element.text !== undefined) {
    const text = new Y.Text(element.text);
    for (const mark of element.marks ?? [])
      text.format(mark.from, mark.to - mark.from, attributesOf(mark));
    map.set('text', text);
  }
  if (element.page !== undefined) map.set('page', element.page);
  if (element.slide !== undefined) map.set('slide', element.slide);
  if (element.placeholder !== undefined) map.set('placeholder', element.placeholder);
  if (element.table) map.set('table', toYTable(element.table));

  const style = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(element.style)) style.set(key, value);
  map.set('style', style);

  return map;
}

function readStyle(map: YElement): ElementStyle {
  const stored = map.get('style');
  const raw =
    stored instanceof Y.Map
      ? (Object.fromEntries(stored.entries()) as Partial<ElementStyle>)
      : ((stored ?? {}) as Partial<ElementStyle>);
  // Merging over the defaults means a document written by an older version — or one
  // that gained a field since — still produces a complete, usable element.
  return { ...DEFAULT_STYLE, ...raw };
}

export function fromYElement(map: YElement): BoardElement {
  const element: Record<string, unknown> = {};
  for (const field of SCALAR_FIELDS) element[field] = map.get(field);
  for (const field of OPAQUE_FIELDS) {
    const value = map.get(field);
    if (value !== undefined) element[field] = value;
  }
  const page = map.get('page');
  if (typeof page === 'string') element.page = page;
  const slide = map.get('slide');
  if (typeof slide === 'string') element.slide = slide;
  const placeholder = map.get('placeholder');
  if (typeof placeholder === 'string') element.placeholder = placeholder;
  const table = map.get('table');
  if (table instanceof Y.Map) element.table = readTable(table);
  const text = map.get('text');
  if (text instanceof Y.Text) {
    element.text = text.toString();
    const marks = marksFromDelta(text.toDelta() as Array<{ insert?: unknown }>);
    if (marks.length > 0) element.marks = marks;
  } else if (typeof text === 'string') element.text = text;
  element.style = readStyle(map);
  return element as unknown as BoardElement;
}

/** Applies a partial update, touching only the fields that actually changed. */
export function patchYElement(map: YElement, patch: Partial<BoardElement>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || key === 'marks') continue;

    if (key === 'style') {
      const style = map.get('style');
      const next = value as Partial<ElementStyle>;
      if (style instanceof Y.Map) {
        for (const [styleKey, styleValue] of Object.entries(next)) {
          if (style.get(styleKey) !== styleValue) style.set(styleKey, styleValue);
        }
      } else {
        const created = new Y.Map<unknown>();
        for (const [styleKey, styleValue] of Object.entries(next))
          created.set(styleKey, styleValue);
        map.set('style', created);
      }
      continue;
    }

    if (key === 'text') {
      patchText(map, value as string);
      continue;
    }

    if (key === 'table') {
      patchTable(map, value as TableData);
      continue;
    }

    if (map.get(key) !== value) map.set(key, value);
  }
  // After the words, so the ranges land on the text as it now stands.
  if ('marks' in patch) patchMarks(map, patch.marks ?? []);
}

const attributesOf = (mark: MarkSet) => ({
  bold: mark.bold ? true : null,
  italic: mark.italic ? true : null,
  underline: mark.underline ? true : null,
  color: mark.color ?? null,
  highlight: mark.highlight ?? null,
  link: mark.link ?? null,
});

const CLEARED = {
  bold: null,
  italic: null,
  underline: null,
  color: null,
  highlight: null,
  link: null,
};

/** Makes the text's formatting exactly these ranges — touching it only if it differs. */
function patchMarks(map: YElement, marks: readonly TextMark[]): void {
  const text = map.get('text');
  if (!(text instanceof Y.Text)) return;
  const current = marksFromDelta(text.toDelta() as Array<{ insert?: unknown }>);
  if (marksEqual(current, marks)) return;
  text.format(0, text.length, CLEARED);
  for (const mark of marks) {
    const to = Math.min(mark.to, text.length);
    if (to > mark.from) text.format(mark.from, to - mark.from, attributesOf(mark));
  }
}

/** Sets or clears formatting on [from, to) of an element's text. */
export function formatYText(map: YElement, from: number, to: number, formats: MarkFormats): void {
  const text = map.get('text');
  if (!(text instanceof Y.Text) || to <= from) return;
  const attributes: Record<string, string | true | null> = {};
  for (const [name, value] of Object.entries(formats)) {
    if (value === undefined) continue;
    attributes[name] = typeof value === 'string' ? value || null : value ? true : null;
  }
  text.format(from, Math.min(to, text.length) - from, attributes);
}

/**
 * The difference between two versions of a string, as one replaced span: whatever
 * lies between their common start and common end. A keystroke, a paste or a
 * deletion is exactly one such span, so this is all a text box ever needs.
 */
export function textSplice(before: string, after: string) {
  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && before[start] === after[start]) start += 1;

  let end = 0;
  while (
    end < shortest - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end += 1;
  }

  // Never split a surrogate pair: half an emoji is not a character anyone typed.
  const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;
  if (start > 0 && isLow(before.charCodeAt(start))) start -= 1;
  if (end > 0 && isLow(before.charCodeAt(before.length - end))) end -= 1;

  return {
    index: start,
    remove: before.length - start - end,
    insert: after.slice(start, after.length - end),
  };
}

function patchText(map: YElement, next: string): void {
  const current = map.get('text');
  if (!(current instanceof Y.Text)) {
    if (current !== next) map.set('text', new Y.Text(next));
    return;
  }
  const splice = textSplice(current.toString(), next);
  if (splice.remove > 0) current.delete(splice.index, splice.remove);
  if (splice.insert) current.insert(splice.index, splice.insert);
}

/** A table is a map with its size and a nested map of cells, one entry per cell. */
function toYTable(table: TableData): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set('rows', table.rows);
  map.set('cols', table.cols);
  const cells = new Y.Map<string>();
  for (const [key, value] of Object.entries(table.cells)) if (value) cells.set(key, value);
  map.set('cells', cells);
  return map;
}

function readTable(map: Y.Map<unknown>): TableData {
  const cells = map.get('cells');
  return {
    rows: Number(map.get('rows') ?? 1),
    cols: Number(map.get('cols') ?? 1),
    cells:
      cells instanceof Y.Map ? (Object.fromEntries(cells.entries()) as Record<string, string>) : {},
  };
}

/** Writes only the cells that changed, so one person's cell never overwrites another's. */
function patchTable(map: YElement, next: TableData): void {
  const current = map.get('table');
  if (!(current instanceof Y.Map)) {
    map.set('table', toYTable(next));
    return;
  }
  if (current.get('rows') !== next.rows) current.set('rows', next.rows);
  if (current.get('cols') !== next.cols) current.set('cols', next.cols);
  let cells = current.get('cells');
  if (!(cells instanceof Y.Map)) {
    cells = new Y.Map<string>();
    current.set('cells', cells);
  }
  const live = cells as Y.Map<string>;
  for (const [key, value] of Object.entries(next.cells)) {
    if (!value) {
      if (live.has(key)) live.delete(key);
    } else if (live.get(key) !== value) {
      live.set(key, value);
    }
  }
  // Cells not mentioned are left alone: this copy may simply not have seen a cell
  // someone else filled a moment ago. Emptying a cell writes it as empty instead.
}
