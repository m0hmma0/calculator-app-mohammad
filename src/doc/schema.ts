import * as Y from 'yjs';
import type { BoardElement, ElementStyle } from '@/model/element';
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
const OPAQUE_FIELDS = ['points', 'image', 'from', 'to'] as const;

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
  if (element.text !== undefined) map.set('text', new Y.Text(element.text));

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
  const text = map.get('text');
  if (text instanceof Y.Text) element.text = text.toString();
  else if (typeof text === 'string') element.text = text;
  element.style = readStyle(map);
  return element as unknown as BoardElement;
}

/** Applies a partial update, touching only the fields that actually changed. */
export function patchYElement(map: YElement, patch: Partial<BoardElement>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;

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

    if (map.get(key) !== value) map.set(key, value);
  }
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
