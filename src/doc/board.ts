import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { FIRST_PAGE, type BoardElement, type ElementId } from '@/model/element';
import {
  elementsOf,
  fromYElement,
  pagesOf,
  patchYElement,
  toYElement,
  type YElement,
} from './schema';

/**
 * Marks every change this tab makes. The undo manager tracks only this origin, so
 * Ctrl+Z walks back your own edits and leaves everyone else's alone — the behaviour
 * asked for, and the reason undo is built on the document rather than on a stack of
 * UI actions.
 */
export const LOCAL_ORIGIN = { local: true };

/** Changes replayed from storage or from a peer, which must never be undoable. */
export const REMOTE_ORIGIN = { remote: true };

/**
 * Housekeeping the app does on its own — moving an old inline image into storage.
 * It is saved like any edit, but it is nobody's action, so undo must not see it.
 */
export const SYSTEM_ORIGIN = { system: true };

export interface BoardDoc {
  doc: Y.Doc;
  elements: Y.Map<YElement>;
  undoManager: Y.UndoManager;
  /** Resolves once anything already in storage has been loaded. */
  whenReady: Promise<void>;
  /**
   * Set for someone who may view or comment but not edit. Local edits are ignored
   * here, at the one place they all pass through — the room refuses them anyway, but
   * without this a viewer would see changes that nobody else ever does.
   */
  readOnly: boolean;
  /** The page this tab is looking at. New elements land on it; others are left alone. */
  currentPage: string;
  destroy: () => void;
}

export interface CreateBoardOptions {
  /** IndexedDB database name; omit for an in-memory document (tests, previews). */
  persistenceKey?: string;
  /**
   * How long rapid edits are folded into one undo step. A drag emits a change per
   * frame; without this, undo would rewind one frame at a time.
   */
  captureTimeout?: number;
}

export function createBoard(options: CreateBoardOptions = {}): BoardDoc {
  const doc = new Y.Doc();
  const elements = elementsOf(doc);

  // Pages are in scope too, so deleting a page — and everything on it — can be undone.
  const undoManager = new Y.UndoManager([elements, pagesOf(doc)], {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: options.captureTimeout ?? 400,
  });

  let persistence: IndexeddbPersistence | null = null;
  let whenReady = Promise.resolve();
  let stopGuarding = () => {};

  if (options.persistenceKey) {
    persistence = new IndexeddbPersistence(options.persistenceKey, doc);
    stopGuarding = guardUnsaved(doc, persistence, options.persistenceKey);
    whenReady = persistence.whenSynced.then(() => undefined);
  }

  return {
    doc,
    elements,
    undoManager,
    whenReady,
    readOnly: false,
    currentPage: FIRST_PAGE,
    destroy: () => {
      stopGuarding();
      undoManager.destroy();
      persistence?.destroy();
      doc.destroy();
    },
  };
}

/**
 * IndexedDB saves each change a moment after it is made, and a page that is reloaded
 * or closed inside that moment can lose it — the last stroke drawn before a refresh.
 * So every change is also held here until IndexedDB has it, and whatever is still held
 * when the page goes away is written to localStorage, which saves at once. The next
 * time the board opens, that is applied on top of what IndexedDB had. Applying a
 * change twice does nothing, so nothing is ever doubled.
 */
function guardUnsaved(doc: Y.Doc, persistence: IndexeddbPersistence, key: string): () => void {
  if (typeof window === 'undefined') return () => {};
  const backupKey = `sabboura:unsaved:${key}`;
  /** Changes not yet known to be in IndexedDB, by the order they were made. */
  const unsaved = new Map<number, Uint8Array>();
  let made = 0;
  let checking = false;

  // IndexedDB runs transactions on one store in order, so a read begun after a write
  // finishes only once that write has. When it does, everything made before is saved.
  const confirm = () => {
    checking = false;
    const db = persistence.db;
    if (!db) return;
    const upTo = made;
    try {
      db.transaction('updates', 'readonly').oncomplete = () => {
        for (const order of unsaved.keys()) if (order <= upTo) unsaved.delete(order);
      };
    } catch {
      // The database closed (the board was switched); its writes are its own now.
    }
  };
  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === persistence) return;
    made += 1;
    unsaved.set(made, update);
    // If IndexedDB never answers, what is held stays one compact change, not thousands.
    if (unsaved.size > 500) {
      const merged = Y.mergeUpdates([...unsaved.values()]);
      unsaved.clear();
      unsaved.set(made, merged);
    }
    if (!checking) {
      checking = true;
      setTimeout(confirm, 0);
    }
  };
  doc.on('update', onUpdate);

  const keep = () => {
    if (unsaved.size === 0) return;
    try {
      localStorage.setItem(backupKey, toBase64(Y.mergeUpdates([...unsaved.values()])));
    } catch {
      // Full or refused: IndexedDB is still the main copy.
    }
  };
  // A phone may close a page it has hidden without telling it, so hiding counts too.
  const onHidden = () => {
    if (document.visibilityState === 'hidden') keep();
  };
  window.addEventListener('pagehide', keep);
  document.addEventListener('visibilitychange', onHidden);

  // Opening: anything kept from last time goes in, then the note is thrown away.
  void persistence.whenSynced.then(() => {
    try {
      const kept = localStorage.getItem(backupKey);
      if (kept) Y.applyUpdate(doc, fromBase64(kept), SYSTEM_ORIGIN);
      localStorage.removeItem(backupKey);
    } catch {
      // Unreadable: leave it; IndexedDB has the rest.
    }
  });

  return () => {
    doc.off('update', onUpdate);
    window.removeEventListener('pagehide', keep);
    document.removeEventListener('visibilitychange', onHidden);
  };
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Every local mutation goes through here so it carries the right origin. */
export function transactLocal(board: BoardDoc, mutate: () => void): void {
  if (board.readOnly) return;
  board.doc.transact(mutate, LOCAL_ORIGIN);
}

export function readElements(board: BoardDoc): BoardElement[] {
  const list: BoardElement[] = [];
  board.elements.forEach((map) => list.push(fromYElement(map)));
  return list;
}

/**
 * Adding or removing elements is always a discrete act — never a continuous gesture —
 * so each one closes its own undo step. Without this, two shapes drawn in quick
 * succession fall inside the same capture window and a single undo takes both.
 */
export function insertElements(board: BoardDoc, incoming: readonly BoardElement[]): void {
  transactLocal(board, () => {
    // Whatever page it was copied from, something new arrives on the page in view.
    // The first page stays implicit, as it is for everything from before pages.
    const page = board.currentPage === FIRST_PAGE ? undefined : board.currentPage;
    for (const element of incoming) {
      board.elements.set(element.id, toYElement({ ...element, page }));
    }
  });
  board.undoManager.stopCapturing();
}

export function deleteElements(board: BoardDoc, ids: readonly ElementId[]): void {
  transactLocal(board, () => {
    for (const id of ids) board.elements.delete(id);
  });
  board.undoManager.stopCapturing();
}

export function applyPatches(
  board: BoardDoc,
  patches: ReadonlyMap<ElementId, Partial<BoardElement>>,
): void {
  if (patches.size === 0) return;
  transactLocal(board, () => {
    for (const [id, patch] of patches) {
      const map = board.elements.get(id);
      if (map) patchYElement(map, patch);
    }
  });
}

/** Replaces the page in view — used by "clear" and by loading demo content. */
export function replaceAll(board: BoardDoc, incoming: readonly BoardElement[]): void {
  transactLocal(board, () => {
    const doomed: string[] = [];
    board.elements.forEach((map, id) => {
      if ((map.get('page') ?? FIRST_PAGE) === board.currentPage) doomed.push(id);
    });
    for (const id of doomed) board.elements.delete(id);
    // The first page stays implicit, as it is for everything from before pages.
    const page = board.currentPage === FIRST_PAGE ? undefined : board.currentPage;
    for (const element of incoming) {
      board.elements.set(element.id, toYElement({ ...element, page }));
    }
  });
  board.undoManager.stopCapturing();
}

/**
 * Pages. The list lives in the document, so everyone sees the same pages; which one
 * a person is looking at is theirs alone. The implicit first page is written out the
 * first time a second one is added.
 */
export function addPage(board: BoardDoc, name: string): string | null {
  if (board.readOnly) return null;
  const id = `pg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  transactLocal(board, () => {
    const pages = pagesOf(board.doc);
    if (pages.length === 0) pages.push([{ id: FIRST_PAGE, name: 'Page 1' }]);
    pages.push([{ id, name }]);
  });
  board.undoManager.stopCapturing();
  return id;
}

export function renamePage(board: BoardDoc, id: string, name: string): void {
  transactLocal(board, () => {
    const pages = pagesOf(board.doc);
    if (pages.length === 0) pages.push([{ id: FIRST_PAGE, name: 'Page 1' }]);
    const index = pages.toArray().findIndex((page) => page.id === id);
    if (index === -1) return;
    pages.delete(index, 1);
    pages.insert(index, [{ id, name }]);
  });
  board.undoManager.stopCapturing();
}

/** Removes a page and everything on it. The last page cannot go. */
export function deletePage(board: BoardDoc, id: string): void {
  transactLocal(board, () => {
    const pages = pagesOf(board.doc);
    const list = pages.toArray();
    const index = list.findIndex((page) => page.id === id);
    if (index === -1 || list.length < 2) return;
    pages.delete(index, 1);
    const doomed: string[] = [];
    board.elements.forEach((map, elementId) => {
      if ((map.get('page') ?? FIRST_PAGE) === id) doomed.push(elementId);
    });
    for (const elementId of doomed) board.elements.delete(elementId);
  });
  board.undoManager.stopCapturing();
}
