import type * as Y from 'yjs';
import type { BoardElement, ElementId } from '@/model/element';
import { lockedForMe } from '@/sharing/boardAccess';
import type { BoardDoc } from './board';
import {
  fromYElement,
  pagesOf,
  patchYElement,
  readPages,
  toYElement,
  type PageInfo,
} from './schema';

/**
 * Undo that outlives the tab. Within a visit, undo is the document's own (Yjs's undo
 * manager, which walks back only this tab's changes). Its steps name pieces of the
 * document by their place in its history, which means nothing once the tab is gone,
 * so each step is also written down as what it did: every element it touched, as it
 * was before and after, and the page list if that changed. The last hundred are kept
 * in this browser, per board and per account, and when the board opens again they
 * sit beneath the new visit's steps — undo carries on into them once those run out.
 *
 * Replaying a step written down this way puts back only what still is as the step
 * left it: anything someone else has changed since is left alone, as Yjs's own undo
 * leaves alone what others did.
 */

/** How many steps are kept for a board, oldest dropped first. */
export const HISTORY_LIMIT = 100;

/** How long after the last change the history is written. */
const SAVE_DELAY_MS = 1000;

/** Changes replayed from the written-down history: saved and shared, never captured. */
export const HISTORY_ORIGIN = { history: true };

/**
 * One element's part in a step. Null on either side means it did not exist: created
 * by the step (before is null, after is all of it) or deleted (the reverse). Otherwise
 * each side holds only the fields that changed, a field that was absent as null.
 */
export interface ElementChange {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface HistoryStep {
  elements: Record<ElementId, ElementChange>;
  pages?: { before: PageInfo[]; after: PageInfo[] };
}

/** A step as it builds up during a visit: the first "before" and latest "after" seen. */
interface LiveStep {
  before: Map<ElementId, BoardElement | null>;
  after: Map<ElementId, BoardElement | null>;
  pagesBefore?: PageInfo[];
  pagesAfter?: PageInfo[];
  /** Its written-down form, worked out once and kept until the step changes again. */
  settled?: HistoryStep | null;
}

const LIVE = 'sabboura-history';

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A deep copy that is plain data, so it can be stored and compared. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** What changed between two states of one element; null when nothing did. */
export function diffElement(
  before: BoardElement | null | undefined,
  after: BoardElement | null | undefined,
): ElementChange | null {
  if (!before && !after) return null;
  if (!before) return { before: null, after: plain(after) as unknown as Record<string, unknown> };
  if (!after) return { before: plain(before) as unknown as Record<string, unknown>, after: null };
  const was = before as unknown as Record<string, unknown>;
  const now = after as unknown as Record<string, unknown>;
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (same(was[key], now[key])) continue;
    changedBefore[key] = plain(was[key] ?? null);
    changedAfter[key] = plain(now[key] ?? null);
  }
  return Object.keys(changedAfter).length === 0
    ? null
    : { before: changedBefore, after: changedAfter };
}

/** A visit's step, written down as what it did; null if, in the end, it did nothing. */
function settle(live: LiveStep): HistoryStep | null {
  if (live.settled !== undefined) return live.settled;
  live.settled = writeDown(live);
  return live.settled;
}

function writeDown(live: LiveStep): HistoryStep | null {
  const elements: Record<ElementId, ElementChange> = {};
  for (const [id, before] of live.before) {
    const change = diffElement(before, live.after.get(id));
    if (change) elements[id] = change;
  }
  const step: HistoryStep = { elements };
  if (live.pagesBefore && live.pagesAfter && !same(live.pagesBefore, live.pagesAfter)) {
    step.pages = { before: live.pagesBefore, after: live.pagesAfter };
  }
  return Object.keys(elements).length > 0 || step.pages ? step : null;
}

function isStep(value: unknown): value is HistoryStep {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as HistoryStep).elements === 'object' &&
    (value as HistoryStep).elements !== null
  );
}

/**
 * Puts one side of a step back onto the board: `from` is the side the board should be
 * at now, `to` the side it is going to. Fields are only changed where they still read
 * as `from` left them; an element is only created where it is missing and only deleted
 * where it is there. Locked things stay as they are unless the step itself is the lock.
 */
export function replay(board: BoardDoc, step: HistoryStep, direction: 'undo' | 'redo'): void {
  const answering = board.readOnly && board.answers;
  if (board.readOnly && !answering) return;

  board.doc.transact(() => {
    for (const [id, change] of Object.entries(step.elements)) {
      const from = direction === 'undo' ? change.after : change.before;
      const to = direction === 'undo' ? change.before : change.after;
      const map = board.elements.get(id);

      if (answering) {
        // Someone who answers changes only a placeholder's words and height.
        if (!map || !from || !to || typeof map.get('placeholder') !== 'string') continue;
        putFields(map, from, to, new Set(['text', 'marks', 'h']));
        continue;
      }

      if (to === null) {
        if (map) board.elements.delete(id);
        continue;
      }
      if (from === null) {
        if (!map) board.elements.set(id, toYElement(to as unknown as BoardElement));
        continue;
      }
      if (!map) continue;
      if (lockedForMe(fromYElement(map)) && !('locked' in to)) continue;
      putFields(map, from, to);
    }

    if (step.pages && !answering) {
      const from = direction === 'undo' ? step.pages.after : step.pages.before;
      const to = direction === 'undo' ? step.pages.before : step.pages.after;
      const pages = pagesOf(board.doc);
      if (same(pages.toArray(), from)) {
        pages.delete(0, pages.length);
        pages.push(to.map((page) => ({ ...page })));
      }
    }
  }, HISTORY_ORIGIN);
}

/** Writes `to`'s fields onto an element where they still read as `from`. */
function putFields(
  map: Y.Map<unknown>,
  from: Record<string, unknown>,
  to: Record<string, unknown>,
  only?: ReadonlySet<string>,
): void {
  // Read as the binding reads it, which is how the step was recorded.
  const element = fromYElement(map) as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(to)) {
    if (only && !only.has(key)) continue;
    if (!same(element[key], from[key])) continue;
    if (value !== null) {
      patch[key] = value;
    } else if (key === 'text') {
      patch.text = '';
    } else if (key === 'marks') {
      patch.marks = [];
    } else if (key !== 'style' && key !== 'table') {
      map.delete(key);
    }
  }
  patchYElement(map, patch as Partial<BoardElement>);
}

// ---------------------------------------------------------------------------------
// Storage: one record per board and account, in this browser's IndexedDB.

const DB_NAME = 'sabboura-history';
const STORE = 'boards';

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

/**
 * IndexedDB writes a moment after it is asked, and a page closing inside that moment
 * loses the write. So steps not yet confirmed there are also put in localStorage as
 * the page goes, which saves at once; the next visit takes them from there first.
 */
const HELD = 'sabboura-history:';

function takeHeld(key: string): HistoryStep[] | null {
  try {
    const raw = localStorage.getItem(HELD + key);
    if (raw === null) return null;
    localStorage.removeItem(HELD + key);
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isStep).slice(-HISTORY_LIMIT) : null;
  } catch {
    return null;
  }
}

function hold(key: string, steps: HistoryStep[]): void {
  try {
    localStorage.setItem(HELD + key, JSON.stringify(steps));
  } catch {
    // Too big for localStorage: IndexedDB may still have finished in time.
  }
}

async function readStored(key: string): Promise<HistoryStep[]> {
  const held = takeHeld(key);
  if (held) return held;
  const db = await open();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => {
        const value: unknown = request.result;
        resolve(Array.isArray(value) ? value.filter(isStep).slice(-HISTORY_LIMIT) : []);
      };
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

async function writeStored(key: string, steps: HistoryStep[]): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(steps, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      // Out of space or unavailable: this visit's undo still works, it just ends here.
      resolve();
    }
  });
}

/** Where steps are kept between visits. IndexedDB in the app; a map in unit tests. */
export interface HistoryStorage {
  read: (key: string) => Promise<HistoryStep[]>;
  /** Resolves once the steps are safely stored. */
  write: (key: string, steps: HistoryStep[]) => Promise<void>;
  /** Stores at once, for a page that is going away before a write could finish. */
  hold?: (key: string, steps: HistoryStep[]) => void;
}

const browserStorage: HistoryStorage = { read: readStored, write: writeStored, hold };

// ---------------------------------------------------------------------------------

export interface History {
  /** Whether an older step, from before this visit, is there to undo. */
  canUndo: () => boolean;
  /** Whether an older step that was undone in this visit can be redone. */
  canRedo: () => boolean;
  /** Undoes the newest older step. False when there is none. */
  undo: () => boolean;
  redo: () => boolean;
  /** Called with every element change the binding sees, before undo captures it. */
  noteChanges: (
    transaction: Y.Transaction,
    changes: ReadonlyArray<[ElementId, BoardElement | undefined, BoardElement | undefined]>,
  ) => void;
  /** Writes what is held now, at once (the page is going away). */
  flush: () => void;
  destroy: () => void;
}

/**
 * Follows a board's undo manager, writes its steps down, and loads the steps written
 * on earlier visits. `key` names the board and the person; without one (no IndexedDB,
 * a preview), nothing is stored and undo behaves as it always has.
 */
export function trackHistory(
  board: BoardDoc,
  key: string | null,
  onChange: () => void,
  storage: HistoryStorage = browserStorage,
): History {
  const { undoManager, doc } = board;
  /** Steps from earlier visits, oldest first, not yet undone. */
  let older: HistoryStep[] = [];
  /** Older steps undone in this visit, the most recently undone last. */
  let undone: HistoryStep[] = [];
  let loaded = key === null;
  let destroyed = false;

  // What the transaction under way did, waiting for the undo manager to say which step
  // it went into. Cleared once the transaction is over either way.
  let pending: {
    transaction: Y.Transaction;
    elements: Map<ElementId, [BoardElement | null, BoardElement | null]>;
    pages?: [PageInfo[], PageInfo[]];
  } | null = null;
  let pagesSeen = plain(readPages(doc));

  const pendingFor = (transaction: Y.Transaction) => {
    if (pending?.transaction !== transaction) pending = { transaction, elements: new Map() };
    return pending;
  };

  const noteChanges: History['noteChanges'] = (transaction, changes) => {
    const into = pendingFor(transaction);
    for (const [id, before, after] of changes) {
      const held = into.elements.get(id);
      into.elements.set(id, [held ? held[0] : (before ?? null), after ?? null]);
    }
  };

  const onPages = (_event: Y.YArrayEvent<PageInfo>, transaction: Y.Transaction) => {
    const now = plain(readPages(doc));
    const into = pendingFor(transaction);
    into.pages = [into.pages ? into.pages[0] : pagesSeen, now];
    pagesSeen = now;
  };
  pagesOf(doc).observe(onPages);

  const onStackItem = (event: {
    stackItem: { meta: Map<unknown, unknown> };
    origin: unknown;
    type: 'undo' | 'redo';
  }) => {
    // A new change of this person's own: older steps undone are gone for good, as the
    // undo manager forgets its own redo steps.
    if (event.type === 'undo' && event.origin !== undoManager && undone.length > 0) {
      undone = [];
      onChange();
    }
    if (!pending) return;
    const meta = event.stackItem.meta;
    let live = meta.get(LIVE) as LiveStep | undefined;
    if (!live) {
      live = { before: new Map(), after: new Map() };
      meta.set(LIVE, live);
    }
    for (const [id, [before, after]] of pending.elements) {
      if (!live.before.has(id)) live.before.set(id, before);
      live.after.set(id, after);
    }
    live.settled = undefined;
    if (pending.pages) {
      live.pagesBefore ??= pending.pages[0];
      live.pagesAfter = pending.pages[1];
    }
    pending = null;
    schedule();
  };
  const onCleanup = () => {
    pending = null;
  };
  const onPopped = () => schedule();

  undoManager.on('stack-item-added', onStackItem);
  undoManager.on('stack-item-updated', onStackItem);
  undoManager.on('stack-item-popped', onPopped);
  doc.on('afterTransactionCleanup', onCleanup);

  /** Everything still undoable, oldest first: earlier visits', then this one's. */
  const allSteps = (): HistoryStep[] => {
    const current: HistoryStep[] = [];
    const stack = undoManager.undoStack;
    for (let index = stack.length - 1; index >= 0 && current.length < HISTORY_LIMIT; index -= 1) {
      const live = stack[index]!.meta.get(LIVE) as LiveStep | undefined;
      const step = live ? settle(live) : null;
      if (step) current.unshift(step);
    }
    return [...older, ...current].slice(-HISTORY_LIMIT);
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Changes not yet confirmed stored; `writes` tells the last write from earlier ones. */
  let dirty = false;
  let writes = 0;
  const save = () => {
    timer = null;
    // Until the earlier steps are in, writing would replace them with this visit's.
    if (key === null || !loaded) return;
    const write = ++writes;
    void storage.write(key, allSteps()).then(() => {
      if (write === writes) dirty = false;
    });
  };
  function schedule() {
    if (key === null) return;
    dirty = true;
    if (timer) clearTimeout(timer);
    // Each write is the whole history, so not on every frame of a drag; a page going
    // away writes at once.
    timer = setTimeout(save, SAVE_DELAY_MS);
  }
  const flush = () => {
    if (timer) clearTimeout(timer);
    save();
  };
  const onPageHide = () => {
    if (key !== null && loaded && dirty) storage.hold?.(key, allSteps());
    flush();
  };
  const onHide = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onHide);
  }

  if (key !== null) {
    void storage.read(key).then((steps) => {
      if (destroyed) return;
      older = steps;
      loaded = true;
      onChange();
      // Anything done before they arrived is written down now, after them.
      schedule();
    });
  }

  return {
    canUndo: () => older.length > 0,
    canRedo: () => undone.length > 0,
    undo: () => {
      const step = older.pop();
      if (!step) return false;
      replay(board, step, 'undo');
      undone.push(step);
      onChange();
      schedule();
      return true;
    },
    redo: () => {
      const step = undone.pop();
      if (!step) return false;
      replay(board, step, 'redo');
      older.push(step);
      onChange();
      schedule();
      return true;
    },
    noteChanges,
    flush,
    destroy: () => {
      flush();
      destroyed = true;
      undoManager.off('stack-item-added', onStackItem);
      undoManager.off('stack-item-updated', onStackItem);
      undoManager.off('stack-item-popped', onPopped);
      doc.off('afterTransactionCleanup', onCleanup);
      pagesOf(doc).unobserve(onPages);
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', onPageHide);
        document.removeEventListener('visibilitychange', onHide);
      }
    },
  };
}
