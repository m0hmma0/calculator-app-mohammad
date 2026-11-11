import * as Y from 'yjs';
import { PAGE_EVENT_LIMIT, PAGE_LOGS, splitPageLogKey } from './pageLogs';

/**
 * The Answer role's rule, which the room applies to every change such a person sends:
 * they may type in placeholders — the words, their formatting, and the box growing to
 * hold them — and change nothing else. Hiding the tools from them is a courtesy; this
 * is what holds.
 *
 * A change is read without being applied. Each new piece of it says where it goes: a
 * parent, or a neighbour whose parent it shares. Every piece must land in a
 * placeholder's words, or be the new height of a placeholder; every deletion must
 * remove something from a placeholder's words (or something already gone).
 *
 * They may also keep their own record of what they do in the board's web pages
 * (`pageLogs.ts`): a log under their own name, and entries added to it or taken away.
 * Never anyone else's.
 */

/** The element a placeholder's map is, if this is one: a text box with a hint. */
function isPlaceholderMap(elements: Y.Map<unknown>, type: unknown): boolean {
  if (!(type instanceof Y.Map)) return false;
  if (type.get('type') !== 'text' || typeof type.get('placeholder') !== 'string') return false;
  // An element of the board itself, not something nested elsewhere.
  return type._item?.parent === elements;
}

/** Whether a piece placed here is part of an answer. */
function isAnswerPlace(elements: Y.Map<unknown>, parent: unknown, sub: string | null): boolean {
  if (parent instanceof Y.Text && sub === null) {
    const holder = parent._item;
    return holder?.parentSub === 'text' && isPlaceholderMap(elements, holder.parent);
  }
  return sub === 'h' && isPlaceholderMap(elements, parent);
}

/** What a new piece may hold: words and formatting in the words, a number for a height. */
function isAnswerContent(item: Y.Item, sub: string | null): boolean {
  const content = item.content;
  if (sub === 'h') {
    if (!(content instanceof Y.ContentAny)) return false;
    const values = content.getContent();
    return (
      values.length === 1 &&
      typeof values[0] === 'number' &&
      Number.isFinite(values[0]) &&
      values[0] > 0 &&
      values[0] < 100_000
    );
  }
  return (
    content instanceof Y.ContentString ||
    content instanceof Y.ContentFormat ||
    content instanceof Y.ContentDeleted
  );
}

/** The struct the document already holds at this id, if any. */
function known(doc: Y.Doc, id: Y.ID): Y.Item | Y.GC | null {
  if (Y.getState(doc.store, id.client) <= id.clock) return null;
  try {
    return Y.getItem(doc.store, id) as Y.Item | Y.GC;
  } catch {
    return null;
  }
}

/** Whether a key in the page logs is this person's own. */
const ownKey = (key: unknown, person: string | null): boolean =>
  person !== null && typeof key === 'string' && splitPageLogKey(key)?.person === person;

/** An entry of a page log: plain data, not too big. */
function isPageEntry(item: Y.Item): boolean {
  if (!(item.content instanceof Y.ContentAny)) return false;
  return item.content.getContent().every((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    try {
      return JSON.stringify(value).length <= PAGE_EVENT_LIMIT;
    } catch {
      return false;
    }
  });
}

export function isOnlyAnswers(
  doc: Y.Doc,
  update: Uint8Array,
  /** Who sent it (their uid): the page logs they may write are theirs alone. */
  person: string | null = null,
): boolean {
  const logs = doc.getMap(PAGE_LOGS);
  // Asked for first, before anything is compared with it. A document rebuilt from stored
  // changes — a room waking up — holds its elements in a stand-in until something asks
  // for them by name; the asking swaps in the real map and moves the children to it, so
  // a parent read before the swap would never match. That refused a room's first answer.
  const elements = doc.getMap('elements');
  let decoded: ReturnType<typeof Y.decodeUpdate>;
  try {
    decoded = Y.decodeUpdate(update);
  } catch {
    return false;
  }

  // The pieces this change brings, so a neighbour inside it can be found.
  const brought = decoded.structs.filter((struct): struct is Y.Item => struct instanceof Y.Item);
  const inChange = (id: Y.ID): Y.Item | null =>
    brought.find(
      (item) =>
        item.id.client === id.client &&
        item.id.clock <= id.clock &&
        id.clock < item.id.clock + item.length,
    ) ?? null;

  /** Where a new piece goes: its parent type and the key under it, if it can be told. */
  const placeOf = (item: Y.Item, depth = 0): { parent: unknown; sub: string | null } | null => {
    if (depth > brought.length + 1) return null;
    if (typeof item.parent === 'string') return null; // a whole root: never an answer
    if (item.parent) {
      const holder = known(doc, item.parent as Y.ID);
      if (!(holder instanceof Y.Item) || !(holder.content instanceof Y.ContentType)) return null;
      return { parent: holder.content.type, sub: item.parentSub };
    }
    const neighbour = item.origin ?? item.rightOrigin;
    if (!neighbour) return null;
    const existing = known(doc, neighbour);
    if (existing instanceof Y.Item) {
      return { parent: existing.parent, sub: existing.parentSub };
    }
    if (existing) return null; // collected: nothing new is placed by it
    const sibling = inChange(neighbour);
    return sibling && sibling !== item ? placeOf(sibling, depth + 1) : null;
  };

  /** A list that is someone's page log, theirs being this person's. */
  const isOwnLogList = (type: unknown): boolean => {
    if (!(type instanceof Y.Array)) return false;
    const holder = type._item;
    return holder?.parent === logs && ownKey(holder.parentSub, person);
  };

  /**
   * Whether a piece goes into a page log: undefined if it goes anywhere else, true if
   * into this person's own log, false if into someone else's. The log may be made in
   * this same change, or already be in the document.
   */
  const pageLogOf = (item: Y.Item): boolean | undefined => {
    let target: Y.Item | Y.AbstractType<unknown> | null = null;
    if (item.parent && typeof item.parent !== 'string') {
      const id = item.parent as Y.ID;
      const holder = known(doc, id) ?? inChange(id);
      if (holder instanceof Y.Item && holder.content instanceof Y.ContentType) {
        target = holder.content.type;
        if (!known(doc, id)) {
          // Made in this change: its own place says whose it is.
          return (holder.parent as unknown) === PAGE_LOGS
            ? ownKey(holder.parentSub, person)
            : undefined;
        }
      }
    } else if (!item.parent) {
      const neighbour = item.origin ?? item.rightOrigin;
      const existing = neighbour ? known(doc, neighbour) : null;
      if (existing instanceof Y.Item) target = existing.parent as Y.AbstractType<unknown>;
      else if (neighbour) {
        const sibling = inChange(neighbour);
        if (sibling) return pageLogOf(sibling);
      }
    }
    if (!(target instanceof Y.Array)) return undefined;
    const holder = target._item;
    if (holder?.parent !== logs) return undefined;
    return ownKey(holder.parentSub, person);
  };

  for (const struct of decoded.structs) {
    if (struct instanceof Y.Skip) continue;
    // Already here: sent again when a page reconnects, and changes nothing.
    if (Y.getState(doc.store, struct.id.client) >= struct.id.clock + struct.length) continue;
    if (!(struct instanceof Y.Item)) return false;
    // Their own page log: made (a list under their own key), or added to.
    if ((struct.parent as unknown) === PAGE_LOGS) {
      if (!ownKey(struct.parentSub, person) || !(struct.content instanceof Y.ContentType)) {
        return false;
      }
      if (!(struct.content.type instanceof Y.Array)) return false;
      continue;
    }
    const logPlace = pageLogOf(struct);
    if (logPlace !== undefined) {
      if (!logPlace || !isPageEntry(struct)) return false;
      continue;
    }
    const place = placeOf(struct);
    if (!place || !isAnswerPlace(elements, place.parent, place.sub)) return false;
    if (!isAnswerContent(struct, place.sub)) return false;
  }

  for (const [client, ranges] of decoded.ds.clients) {
    for (const range of ranges) {
      let clock = range.clock;
      const end = range.clock + range.len;
      while (clock < end) {
        const id = Y.createID(client, clock);
        const existing = known(doc, id);
        if (existing) {
          if (existing instanceof Y.Item && !existing.deleted) {
            const ownLog =
              (existing.parent === logs && ownKey(existing.parentSub, person)) ||
              isOwnLogList(existing.parent);
            if (!ownLog && !isAnswerPlace(elements, existing.parent, existing.parentSub)) {
              return false;
            }
          }
          clock = existing.id.clock + existing.length;
          continue;
        }
        // Brought by this same change: allowed if the piece itself was.
        const own = inChange(id);
        if (!own) return false;
        clock = own.id.clock + own.length;
      }
    }
  }
  return true;
}
