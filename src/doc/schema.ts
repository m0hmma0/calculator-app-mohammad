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
const OPAQUE_FIELDS = ['points', 'text', 'image', 'from', 'to'] as const;

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

    if (map.get(key) !== value) map.set(key, value);
  }
}
