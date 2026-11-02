import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  addPage,
  applyPatches,
  createBoard,
  deleteElements,
  insertElements,
  readElements,
  REMOTE_ORIGIN,
  type BoardDoc,
} from '@/doc/board';
import { bindBoard } from '@/doc/binding';
import {
  diffElement,
  HISTORY_LIMIT,
  trackHistory,
  type HistoryStep,
  type HistoryStorage,
} from '@/doc/history';
import { patchYElement, readPages } from '@/doc/schema';
import { createElement, type BoardElement } from '@/model/element';

const shape = (id: string, overrides: Partial<BoardElement> = {}): BoardElement => ({
  ...createElement({ type: 'rect', box: { x: 10, y: 20, w: 100, h: 50 }, z: 'a0', id }),
  ...overrides,
});

/** The browser's IndexedDB, as a map: what one visit writes, the next one reads. */
function memoryStorage(): HistoryStorage & { saved: Map<string, HistoryStep[]> } {
  const saved = new Map<string, HistoryStep[]>();
  return {
    saved,
    read: async (key) => structuredClone(saved.get(key) ?? []),
    write: async (key, steps) => {
      saved.set(key, structuredClone(steps));
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Opens the board as the app does: a document, its history, and the binding. */
async function visit(storage: HistoryStorage, state?: Uint8Array) {
  const board = createBoard();
  if (state) Y.applyUpdate(board.doc, state, REMOTE_ORIGIN);
  const history = trackHistory(board, 'person/board', () => {}, storage);
  const binding = bindBoard(board, () => {}, history.noteChanges);
  await settle();
  return {
    board,
    history,
    /** Ctrl+Z as the store does it: this visit's steps, then earlier ones. */
    undo: () => (board.undoManager.canUndo() ? board.undoManager.undo() : history.undo()),
    redo: () => history.redo() || board.undoManager.redo(),
    element: (id: string) => readElements(board).find((element) => element.id === id),
    /** Closes the board, handing back what the next visit starts from. */
    close: () => {
      history.flush();
      const saved = Y.encodeStateAsUpdate(board.doc);
      history.destroy();
      binding.destroy();
      board.destroy();
      return saved;
    },
  };
}

/** One step: a change, then the step closed, as a discrete action in the app is. */
function step(board: BoardDoc, patches: Record<string, Partial<BoardElement>>) {
  applyPatches(board, new Map(Object.entries(patches)));
  board.undoManager.stopCapturing();
}

describe('written-down steps', () => {
  it('hold only what changed, and all of an element made or removed', () => {
    const before = shape('a');
    const after = { ...before, x: 50, style: { ...before.style, stroke: '#e03131' } };
    expect(diffElement(before, after)).toEqual({
      before: { x: 10, style: before.style },
      after: { x: 50, style: after.style },
    });
    expect(diffElement(before, before)).toBeNull();
    expect(diffElement(undefined, before)?.before).toBeNull();
    expect(diffElement(before, undefined)?.after).toBeNull();
    // A field that was not there is written as null.
    expect(diffElement(before, { ...before, placeholder: 'Name' })).toEqual({
      before: { placeholder: null },
      after: { placeholder: 'Name' },
    });
  });
});

describe('undo across visits', () => {
  it('walks back the steps of a closed board, newest first, and redoes them', async () => {
    const storage = memoryStorage();
    const first = await visit(storage);
    insertElements(first.board, [shape('a')]);
    step(first.board, { a: { x: 50 } });
    step(first.board, { a: { style: { ...shape('a').style, stroke: '#e03131' } } });
    const state = first.close();

    const second = await visit(storage, state);
    expect(second.history.canUndo()).toBe(true);
    second.undo();
    expect(second.element('a')?.style.stroke).not.toBe('#e03131');
    expect(second.element('a')?.x).toBe(50);
    second.undo();
    expect(second.element('a')?.x).toBe(10);
    second.undo();
    expect(second.element('a')).toBeUndefined();
    expect(second.history.canUndo()).toBe(false);

    second.redo();
    second.redo();
    second.redo();
    expect(second.element('a')).toMatchObject({ x: 50, style: { stroke: '#e03131' } });
    second.close();
  });

  it("puts this visit's steps first, then carries on into the earlier ones", async () => {
    const storage = memoryStorage();
    const first = await visit(storage);
    insertElements(first.board, [shape('a')]);
    step(first.board, { a: { x: 50 } });
    const state = first.close();

    const second = await visit(storage, state);
    step(second.board, { a: { y: 99 } });
    second.undo();
    expect(second.element('a')).toMatchObject({ x: 50, y: 20 });
    second.undo();
    expect(second.element('a')).toMatchObject({ x: 10, y: 20 });

    // Both visits' steps are kept for the next one.
    second.redo();
    second.redo();
    const third = await visit(storage, second.close());
    third.undo();
    expect(third.element('a')).toMatchObject({ x: 50, y: 20 });
    third.close();
  });

  it('brings back what was deleted, words included', async () => {
    const storage = memoryStorage();
    const first = await visit(storage);
    insertElements(first.board, [shape('a', { text: 'Keep me' })]);
    deleteElements(first.board, ['a']);
    const second = await visit(storage, first.close());
    expect(second.element('a')).toBeUndefined();
    second.undo();
    expect(second.element('a')).toMatchObject({ x: 10, text: 'Keep me' });
    second.close();
  });

  it('takes words and pages back too', async () => {
    const storage = memoryStorage();
    const first = await visit(storage);
    insertElements(first.board, [shape('a', { text: 'Hello' })]);
    step(first.board, { a: { text: 'Hello there' } });
    addPage(first.board, 'Page 2');
    const second = await visit(storage, first.close());
    expect(readPages(second.board.doc)).toHaveLength(2);
    second.undo();
    expect(readPages(second.board.doc).map((page) => page.name)).toEqual(['Page 1']);
    second.undo();
    expect(second.element('a')?.text).toBe('Hello');
    second.close();
  });

  it('leaves alone what someone else changed since, and what has been locked', async () => {
    const storage = memoryStorage();
    const first = await visit(storage);
    insertElements(first.board, [shape('a'), shape('b')]);
    step(first.board, { a: { x: 50, w: 200 }, b: { x: 60 } });
    const second = await visit(storage, first.close());

    // Someone else, meanwhile, moved a again and locked b.
    second.board.doc.transact(() => {
      patchYElement(second.board.elements.get('a')!, { x: 70 });
      patchYElement(second.board.elements.get('b')!, { locked: true });
    }, REMOTE_ORIGIN);
    second.undo();
    // Their move stays; the width, which nobody touched since, goes back.
    expect(second.element('a')).toMatchObject({ x: 70, w: 100 });
    expect(second.element('b')).toMatchObject({ x: 60, locked: true });
    second.close();
  });

  it('forgets earlier steps undone once something new is done', async () => {
    const storage = memoryStorage();
    const first = await visit(storage);
    insertElements(first.board, [shape('a')]);
    step(first.board, { a: { x: 50 } });
    const second = await visit(storage, first.close());
    second.undo();
    expect(second.history.canRedo()).toBe(true);
    step(second.board, { a: { y: 5 } });
    expect(second.history.canRedo()).toBe(false);
    second.close();
  });

  it(`keeps the last ${HISTORY_LIMIT} steps`, async () => {
    const storage = memoryStorage();
    const first = await visit(storage);
    insertElements(first.board, [shape('a')]);
    for (let index = 1; index <= HISTORY_LIMIT + 20; index += 1) {
      step(first.board, { a: { x: index } });
    }
    first.close();
    const steps = storage.saved.get('person/board')!;
    expect(steps).toHaveLength(HISTORY_LIMIT);
    expect(steps.at(-1)!.elements.a!.after).toEqual({ x: HISTORY_LIMIT + 20 });
  });

  it('writes nothing over the earlier steps before they have been read', async () => {
    const storage = memoryStorage();
    storage.saved.set('person/board', [{ elements: { a: { before: { x: 1 }, after: { x: 2 } } } }]);
    let release: () => void = () => {};
    const slow: HistoryStorage = {
      read: (key) =>
        new Promise((resolve) => {
          release = () => void storage.read(key).then(resolve);
        }),
      write: storage.write,
    };
    const board = createBoard();
    const history = trackHistory(board, 'person/board', () => {}, slow);
    const binding = bindBoard(board, () => {}, history.noteChanges);
    insertElements(board, [shape('b')]);
    history.flush();
    expect(storage.saved.get('person/board')).toHaveLength(1);
    release();
    await settle();
    await settle();
    history.flush();
    expect(storage.saved.get('person/board')).toHaveLength(2);
    history.destroy();
    binding.destroy();
    board.destroy();
  });
});
