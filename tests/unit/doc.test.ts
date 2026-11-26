import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyPatches,
  createBoard,
  deleteElements,
  dropExtraPages,
  insertElements,
  readElements,
  replaceAll,
  transactLocal,
  REMOTE_ORIGIN,
} from '@/doc/board';
import { formatYText, fromYElement, pagesOf, toYElement } from '@/doc/schema';
import { createElement, type BoardElement } from '@/model/element';

const shape = (id: string, overrides: Partial<BoardElement> = {}): BoardElement => ({
  ...createElement({ type: 'rect', box: { x: 10, y: 20, w: 100, h: 50 }, z: 'a0', id }),
  ...overrides,
});

const byId = (elements: BoardElement[], id: string) => elements.find((e) => e.id === id)!;

/**
 * A Y.Map only holds its values once it is attached to a document — before that it
 * is a prelim type with nothing to read. So conversion is tested through a real
 * board, which is also the only path production ever takes.
 */
function roundTrip(element: BoardElement): BoardElement {
  const board = createBoard();
  insertElements(board, [element]);
  const [result] = readElements(board);
  board.destroy();
  return result!;
}

describe('element conversion', () => {
  it('round-trips a plain shape', () => {
    const element = shape('one');
    expect(roundTrip(element)).toEqual(element);
  });

  it('round-trips ink, text, images and bindings', () => {
    const ink = shape('ink', { type: 'path', points: [0, 0, 0.5, 10, 10, 0.9] });
    const text = shape('text', { type: 'text', text: 'مرحبا' });
    const image = shape('img', {
      type: 'image',
      image: { src: 'data:image/png;base64,AA', naturalWidth: 4, naturalHeight: 2 },
    });
    const arrow = shape('arrow', {
      type: 'arrow',
      from: { elementId: 'one' },
      to: { elementId: 'text' },
    });

    for (const element of [ink, text, image, arrow]) {
      expect(roundTrip(element), element.id).toEqual(element);
    }
  });

  it('omits absent optional fields rather than storing undefined', () => {
    const board = createBoard();
    insertElements(board, [shape('plain')]);
    const map = board.elements.get('plain')!;

    expect(map.get('points')).toBeUndefined();
    expect(map.get('text')).toBeUndefined();
    expect('points' in fromYElement(map)).toBe(false);
    board.destroy();
  });

  it('fills in style fields a stored document never had', () => {
    // A document written before a style field existed must still open cleanly.
    const board = createBoard();
    insertElements(board, [shape('old')]);
    const map = board.elements.get('old')!;
    (map.get('style') as Y.Map<unknown>).delete('letterSpacing');

    expect(fromYElement(map).style.letterSpacing).toBe(0);
    board.destroy();
  });
});

describe('board operations', () => {
  it('inserts and reads back', () => {
    const board = createBoard();
    insertElements(board, [shape('a'), shape('b')]);
    expect(
      readElements(board)
        .map((element) => element.id)
        .sort(),
    ).toEqual(['a', 'b']);
    board.destroy();
  });

  it('patches only the fields given', () => {
    const board = createBoard();
    insertElements(board, [shape('a')]);
    applyPatches(board, new Map([['a', { x: 999 }]]));

    const element = byId(readElements(board), 'a');
    expect(element.x).toBe(999);
    expect(element.y).toBe(20);
    expect(element.w).toBe(100);
    board.destroy();
  });

  it('merges style changes without dropping the rest', () => {
    const board = createBoard();
    insertElements(board, [shape('a')]);
    applyPatches(board, new Map([['a', { style: { fill: 'var(--shape-3)' } as never }]]));

    const element = byId(readElements(board), 'a');
    expect(element.style.fill).toBe('var(--shape-3)');
    expect(element.style.strokeWidth).toBe(2);
    board.destroy();
  });

  it('deletes and clears', () => {
    const board = createBoard();
    insertElements(board, [shape('a'), shape('b')]);
    deleteElements(board, ['a']);
    expect(readElements(board)).toHaveLength(1);

    replaceAll(board, []);
    expect(readElements(board)).toHaveLength(0);
    board.destroy();
  });
});

describe('undo', () => {
  const board = () => createBoard({ captureTimeout: 0 });

  it('walks back one action at a time', () => {
    const instance = board();
    insertElements(instance, [shape('a')]);
    insertElements(instance, [shape('b')]);
    insertElements(instance, [shape('c')]);

    expect(readElements(instance)).toHaveLength(3);
    instance.undoManager.undo();
    expect(readElements(instance)).toHaveLength(2);
    instance.undoManager.undo();
    expect(readElements(instance)).toHaveLength(1);
    instance.destroy();
  });

  it('redoes what it undid', () => {
    const instance = board();
    insertElements(instance, [shape('a')]);
    instance.undoManager.undo();
    expect(readElements(instance)).toHaveLength(0);

    instance.undoManager.redo();
    expect(readElements(instance).map((element) => element.id)).toEqual(['a']);
    instance.destroy();
  });

  // Checklist item 2.
  it('restores an exact position after a move', () => {
    const instance = board();
    insertElements(instance, [shape('a', { x: 10, y: 20 })]);
    applyPatches(instance, new Map([['a', { x: 400, y: 300 }]]));
    expect(byId(readElements(instance), 'a')).toMatchObject({ x: 400, y: 300 });

    instance.undoManager.undo();
    expect(byId(readElements(instance), 'a')).toMatchObject({ x: 10, y: 20 });
    instance.destroy();
  });

  it('folds a rapid drag into a single undo step', () => {
    // The capture window is what stops one drag becoming sixty undo entries.
    const instance = createBoard({ captureTimeout: 5000 });
    insertElements(instance, [shape('a', { x: 0 })]);
    for (let frame = 1; frame <= 30; frame += 1) {
      applyPatches(instance, new Map([['a', { x: frame * 10 }]]));
    }
    expect(byId(readElements(instance), 'a').x).toBe(300);

    instance.undoManager.undo();
    // The whole drag goes back at once — and only the drag. The element is still
    // there, because inserting it closed its own step.
    expect(readElements(instance)).toHaveLength(1);
    expect(byId(readElements(instance), 'a').x).toBe(0);
    instance.destroy();
  });

  // The bug this guards: two shapes drawn quickly shared a capture window, so one
  // undo removed both of them.
  it('undoes two quick actions separately', () => {
    const instance = createBoard({ captureTimeout: 5000 });
    insertElements(instance, [shape('first')]);
    insertElements(instance, [shape('second')]);

    instance.undoManager.undo();
    expect(readElements(instance).map((element) => element.id)).toEqual(['first']);

    instance.undoManager.undo();
    expect(readElements(instance)).toHaveLength(0);
    instance.destroy();
  });

  // The behaviour the whole design exists for.
  it('leaves another origin edits alone', () => {
    const instance = board();
    insertElements(instance, [shape('mine', { x: 0 })]);

    // Someone else moves a different shape — a replayed or remote change.
    instance.doc.transact(() => {
      instance.elements.set('theirs', toYElement(shape('theirs', { x: 500 })));
    }, REMOTE_ORIGIN);

    instance.undoManager.undo();

    const remaining = readElements(instance);
    expect(remaining.map((element) => element.id)).toEqual(['theirs']);
    expect(byId(remaining, 'theirs').x).toBe(500);
    instance.destroy();
  });

  it('has nothing to undo on a fresh board', () => {
    const instance = board();
    expect(instance.undoManager.canUndo()).toBe(false);
    instance.undoManager.undo();
    expect(readElements(instance)).toHaveLength(0);
    instance.destroy();
  });
});

describe('merging two documents', () => {
  it('keeps both sides of a concurrent edit to different fields', () => {
    const first = createBoard();
    const second = createBoard();

    insertElements(first, [shape('a')]);
    Y.applyUpdate(second.doc, Y.encodeStateAsUpdate(first.doc));

    // Two people, at the same time: one moves it, the other recolours it.
    applyPatches(first, new Map([['a', { x: 900 }]]));
    applyPatches(second, new Map([['a', { style: { fill: 'var(--shape-2)' } as never }]]));

    Y.applyUpdate(first.doc, Y.encodeStateAsUpdate(second.doc));
    Y.applyUpdate(second.doc, Y.encodeStateAsUpdate(first.doc));

    for (const board of [first, second]) {
      const element = byId(readElements(board), 'a');
      expect(element.x).toBe(900);
      expect(element.style.fill).toBe('var(--shape-2)');
    }

    first.destroy();
    second.destroy();
  });

  it('converges when both sides edit while apart', () => {
    const first = createBoard();
    const second = createBoard();
    insertElements(first, [shape('shared')]);
    Y.applyUpdate(second.doc, Y.encodeStateAsUpdate(first.doc));

    insertElements(first, [shape('only-first')]);
    insertElements(second, [shape('only-second')]);

    Y.applyUpdate(first.doc, Y.encodeStateAsUpdate(second.doc));
    Y.applyUpdate(second.doc, Y.encodeStateAsUpdate(first.doc));

    const ids = (board: ReturnType<typeof createBoard>) =>
      readElements(board)
        .map((element) => element.id)
        .sort();
    expect(ids(first)).toEqual(['only-first', 'only-second', 'shared']);
    expect(ids(first)).toEqual(ids(second));

    first.destroy();
    second.destroy();
  });
});

describe('transactLocal', () => {
  it('tags changes so they are undoable', () => {
    const instance = createBoard({ captureTimeout: 0 });
    transactLocal(instance, () => {
      instance.elements.set('x', toYElement(shape('x')));
    });
    expect(instance.undoManager.canUndo()).toBe(true);
    instance.destroy();
  });
});

describe('formatting on part of a text', () => {
  it('round-trips, and typing after a bold word carries the bold on', () => {
    const marks = [{ from: 0, to: 4, bold: true as const }];
    const element = { ...shape('label', { type: 'text' }), text: 'Bold then plain', marks };
    expect(roundTrip(element).marks).toEqual(marks);

    const board = createBoard();
    insertElements(board, [element]);
    applyPatches(board, new Map([['label', { text: 'Bolder then plain' }]]));
    expect(byId(readElements(board), 'label').marks).toEqual([{ from: 0, to: 6, bold: true }]);

    // A patch with other marks replaces them; one with the same marks writes nothing.
    applyPatches(
      board,
      new Map([['label', { marks: [{ from: 7, to: 11, italic: true as const }] }]]),
    );
    expect(byId(readElements(board), 'label').marks).toEqual([{ from: 7, to: 11, italic: true }]);
    board.destroy();
  });

  it('carries colours, highlights and links, and a null clears just that one', () => {
    const marks = [
      { from: 0, to: 4, color: '#e03131', link: 'https://example.com/' },
      { from: 5, to: 9, highlight: '#ffe14d', bold: true as const },
    ];
    const element = { ...shape('rich', { type: 'text' }), text: 'Read this page', marks };
    expect(roundTrip(element).marks).toEqual(marks);

    const board = createBoard();
    insertElements(board, [element]);
    const map = board.elements.get('rich')!;
    transactLocal(board, () => formatYText(map, 0, 4, { link: null }));
    transactLocal(board, () => formatYText(map, 5, 9, { highlight: '#8ef0a0' }));
    expect(byId(readElements(board), 'rich').marks).toEqual([
      { from: 0, to: 4, color: '#e03131' },
      { from: 5, to: 9, highlight: '#8ef0a0', bold: true },
    ]);
    board.destroy();
  });
});

describe('a board that had pages', () => {
  /** As the board was written before pages were removed: a page list, things on each. */
  function withPages(first: string, elements: BoardElement[]) {
    const board = createBoard();
    board.doc.transact(() => {
      pagesOf(board.doc).push([
        { id: first, name: 'Page 1' },
        { id: 'pg_2', name: 'Page 2' },
      ]);
      for (const element of elements) board.elements.set(element.id, toYElement(element));
    }, REMOTE_ORIGIN);
    return board;
  }

  it('keeps its first page and loses the rest, as nobody’s undo step', () => {
    const board = withPages('p1', [shape('a'), shape('b', { page: 'pg_2' })]);
    expect(dropExtraPages(board)).toBe(true);
    expect(readElements(board).map((element) => element.id)).toEqual(['a']);
    expect(pagesOf(board.doc).length).toBe(0);
    expect(board.undoManager.canUndo()).toBe(false);
    expect(dropExtraPages(board)).toBe(false);
    board.destroy();
  });

  it('keeps a first page that was not the original one, its things now plain', () => {
    // Page 1 was deleted once, so the list starts with a later page.
    const board = withPages('pg_9', [shape('a', { page: 'pg_9' }), shape('b')]);
    dropExtraPages(board);
    const left = readElements(board);
    expect(left.map((element) => element.id)).toEqual(['a']);
    expect(left[0]!.page).toBeUndefined();
    board.destroy();
  });

  it('is left alone without a page list, and by someone who only reads', () => {
    const plain = createBoard();
    insertElements(plain, [shape('a')]);
    expect(dropExtraPages(plain)).toBe(false);
    expect(readElements(plain)).toHaveLength(1);
    plain.destroy();

    const viewer = withPages('p1', [shape('a'), shape('b', { page: 'pg_2' })]);
    viewer.readOnly = true;
    expect(dropExtraPages(viewer)).toBe(false);
    expect(readElements(viewer)).toHaveLength(2);
    viewer.destroy();
  });
});
