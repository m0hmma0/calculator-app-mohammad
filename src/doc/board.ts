import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import type { BoardElement, ElementId } from '@/model/element';
import { elementsOf, fromYElement, patchYElement, toYElement, type YElement } from './schema';

/**
 * Marks every change this tab makes. The undo manager tracks only this origin, so
 * Ctrl+Z walks back your own edits and leaves everyone else's alone — the behaviour
 * asked for, and the reason undo is built on the document rather than on a stack of
 * UI actions.
 */
export const LOCAL_ORIGIN = { local: true };

/** Changes replayed from storage or from a peer, which must never be undoable. */
export const REMOTE_ORIGIN = { remote: true };

export interface BoardDoc {
  doc: Y.Doc;
  elements: Y.Map<YElement>;
  undoManager: Y.UndoManager;
  /** Resolves once anything already in storage has been loaded. */
  whenReady: Promise<void>;
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

  const undoManager = new Y.UndoManager(elements, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: options.captureTimeout ?? 400,
  });

  let persistence: IndexeddbPersistence | null = null;
  let whenReady = Promise.resolve();

  if (options.persistenceKey) {
    persistence = new IndexeddbPersistence(options.persistenceKey, doc);
    whenReady = persistence.whenSynced.then(() => undefined);
  }

  return {
    doc,
    elements,
    undoManager,
    whenReady,
    destroy: () => {
      undoManager.destroy();
      persistence?.destroy();
      doc.destroy();
    },
  };
}

/** Every local mutation goes through here so it carries the right origin. */
export function transactLocal(board: BoardDoc, mutate: () => void): void {
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
    for (const element of incoming) board.elements.set(element.id, toYElement(element));
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

/** Replaces the whole board — used by "clear" and by loading demo content. */
export function replaceAll(board: BoardDoc, incoming: readonly BoardElement[]): void {
  transactLocal(board, () => {
    board.elements.clear();
    for (const element of incoming) board.elements.set(element.id, toYElement(element));
  });
  board.undoManager.stopCapturing();
}
