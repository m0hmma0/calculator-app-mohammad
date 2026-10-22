import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { fileIdsInUpdate, fileUrl, isFileId } from '@shared/files';
import { createBoard, deleteElements, insertElements } from '@/doc/board';
import { createElement, type BoardElement } from '@/model/element';

const HASH_A = 'a'.repeat(64);
const HASH_B = '0123456789abcdef'.repeat(4);

const image = (id: string, ref: BoardElement['image']): BoardElement => ({
  ...createElement({ type: 'image', box: { x: 0, y: 0, w: 100, h: 80 }, z: 'a0', id }),
  image: ref,
});

const stored = (id: string, fileId: string) =>
  image(id, { src: fileUrl(fileId), fileId, naturalWidth: 100, naturalHeight: 80 });

describe('which images a board uses', () => {
  it('reads them from the saved document itself', () => {
    const board = createBoard();
    insertElements(board, [stored('one', HASH_A), stored('two', HASH_B)]);

    expect(fileIdsInUpdate(Y.encodeStateAsUpdate(board.doc)).sort()).toEqual(
      [HASH_A, HASH_B].sort(),
    );
  });

  it('counts an image used twice once', () => {
    const board = createBoard();
    insertElements(board, [stored('one', HASH_A), stored('two', HASH_A)]);

    expect(fileIdsInUpdate(Y.encodeStateAsUpdate(board.doc))).toEqual([HASH_A]);
  });

  it('forgets an image once it is deleted from the board', () => {
    const board = createBoard();
    insertElements(board, [stored('one', HASH_A), stored('two', HASH_B)]);
    deleteElements(board, ['one']);

    expect(fileIdsInUpdate(Y.encodeStateAsUpdate(board.doc))).toEqual([HASH_B]);
  });

  it('ignores inline images and anything that is not a real file id', () => {
    const board = createBoard();
    insertElements(board, [
      image('inline', { src: 'data:image/png;base64,AAAA', naturalWidth: 1, naturalHeight: 1 }),
      image('forged', {
        src: '/api/files/../../boards',
        fileId: '../../boards/someone-else/snapshot.bin',
        naturalWidth: 1,
        naturalHeight: 1,
      }),
    ]);

    expect(fileIdsInUpdate(Y.encodeStateAsUpdate(board.doc))).toEqual([]);
  });
});

describe('file ids', () => {
  it('accepts only a lowercase hex SHA-256', () => {
    expect(isFileId(HASH_B)).toBe(true);
    expect(isFileId(HASH_B.toUpperCase())).toBe(false);
    expect(isFileId(HASH_B.slice(1))).toBe(false);
    expect(isFileId(`${HASH_B.slice(1)}/`)).toBe(false);
    expect(isFileId(undefined)).toBe(false);
  });
});
