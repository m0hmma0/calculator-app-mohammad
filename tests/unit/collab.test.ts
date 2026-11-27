import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  colorFor,
  FRAME,
  FrameAssembler,
  frame,
  MAX_FRAME_BYTES,
  splitFrame,
  unzipFrame,
  zipFrame,
} from '@shared/collab';
import { searchTextInDoc } from '@shared/files';
import { createBoard, insertElements, readElements, applyPatches } from '@/doc/board';
import { textSplice } from '@/doc/schema';
import { createElement } from '@/model/element';

/**
 * Byte for byte, quickly: toEqual walks a megabyte one element at a time through its
 * deep equality, which takes seconds on a slow machine.
 */
function sameBytes(a: Uint8Array | null, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

describe('frames too large to send whole', () => {
  it('pass through untouched when small', () => {
    const small = frame(FRAME.UPDATE, new Uint8Array([1, 2, 3]));
    expect(splitFrame(small, 1)).toEqual([small]);
    expect(new FrameAssembler().accept(small)).toBe(small);
  });

  it('split into chunks under the limit and come back byte for byte, in any order', () => {
    const payload = new Uint8Array(MAX_FRAME_BYTES * 2 + 1234).map((_, index) => index % 251);
    const big = frame(FRAME.SYNC_STEP2, payload);
    const parts = splitFrame(big, 7);

    expect(parts.length).toBe(3);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(MAX_FRAME_BYTES + 9);

    const assembler = new FrameAssembler();
    expect(assembler.accept(parts[2]!)).toBeNull();
    expect(assembler.accept(parts[0]!)).toBeNull();
    expect(sameBytes(assembler.accept(parts[1]!), big)).toBe(true);
  });

  it('keeps two split frames apart', () => {
    const one = frame(FRAME.UPDATE, new Uint8Array(MAX_FRAME_BYTES + 10).fill(1));
    const two = frame(FRAME.UPDATE, new Uint8Array(MAX_FRAME_BYTES + 10).fill(2));
    const [a1, a2] = splitFrame(one, 1);
    const [b1, b2] = splitFrame(two, 2);
    const assembler = new FrameAssembler();
    expect(assembler.accept(a1!)).toBeNull();
    expect(assembler.accept(b1!)).toBeNull();
    expect(sameBytes(assembler.accept(b2!), two)).toBe(true);
    expect(sameBytes(assembler.accept(a2!), one)).toBe(true);
  });
});

describe('large frames go deflated (Phase 18)', () => {
  const big = () => {
    const out = new Uint8Array(200_000);
    for (let i = 0; i < out.length; i += 1) out[i] = i % 7;
    out[0] = FRAME.SYNC_STEP2;
    return out;
  };

  it('deflates a large frame and inflates it back exactly', () => {
    const data = big();
    const packed = zipFrame(data);
    expect(packed[0]).toBe(FRAME.ZIP);
    expect(packed.length).toBeLessThan(data.length / 10);
    expect(unzipFrame(packed)).toEqual(data);
  });

  it('leaves small frames and other frames alone', () => {
    const small = frame(FRAME.UPDATE, new Uint8Array(100));
    expect(zipFrame(small)).toBe(small);
    expect(unzipFrame(small)).toBe(small);
  });

  it('refuses a frame that inflates past its limit', () => {
    expect(() => unzipFrame(zipFrame(big()), 50_000)).toThrow();
  });

  it('a whole board survives the second encoding, deflated and split', () => {
    const board = createBoard();
    insertElements(
      board,
      Array.from({ length: 500 }, (_, i) =>
        createElement({ type: 'rect', box: { x: i, y: i, w: 10, h: 10 }, z: `a${i}` }),
      ),
    );
    const sent = splitFrame(
      zipFrame(frame(FRAME.SYNC_STEP2_V2, Y.encodeStateAsUpdateV2(board.doc))),
      1,
    );
    const assembler = new FrameAssembler();
    let whole: Uint8Array | null = null;
    for (const part of sent) whole = assembler.accept(part) ?? whole;
    const data = unzipFrame(whole!);
    expect(data[0]).toBe(FRAME.SYNC_STEP2_V2);
    const copy = new Y.Doc();
    Y.applyUpdateV2(copy, data.subarray(1));
    expect(copy.getMap('elements').size).toBe(500);
  });
});

describe('text edits as one spliced span', () => {
  it('finds a typed character, a deletion, and a paste over a selection', () => {
    expect(textSplice('helo', 'hello')).toEqual({ index: 3, remove: 0, insert: 'l' });
    expect(textSplice('hello', 'hllo')).toEqual({ index: 1, remove: 1, insert: '' });
    expect(textSplice('one two three', 'one 2 three')).toEqual({
      index: 4,
      remove: 3,
      insert: '2',
    });
  });

  it('never cuts an emoji in half', () => {
    // Two different emoji sharing their first code unit.
    const splice = textSplice('a😀b', 'a😃b');
    expect(splice.index).toBe(1);
    expect(splice.remove).toBe(2);
    expect(splice.insert).toBe('😃');
  });

  it('lets two people type into the same note without losing either', () => {
    const left = createBoard();
    const right = createBoard();
    const sticky = {
      ...createElement({ type: 'sticky', box: { x: 0, y: 0, w: 200, h: 200 }, z: 'a0', id: 's' }),
      text: 'Hi ',
    };
    insertElements(left, [sticky]);
    Y.applyUpdate(right.doc, Y.encodeStateAsUpdate(left.doc));

    // Each types at the end of what they see, at the same time.
    applyPatches(left, new Map([['s', { text: 'Hi Alice' }]]));
    applyPatches(right, new Map([['s', { text: 'Hi Bob' }]]));
    Y.applyUpdate(right.doc, Y.encodeStateAsUpdate(left.doc));
    Y.applyUpdate(left.doc, Y.encodeStateAsUpdate(right.doc));

    const merged = readElements(left)[0]!.text!;
    expect(readElements(right)[0]!.text).toBe(merged);
    expect(merged).toContain('Alice');
    expect(merged).toContain('Bob');
    expect(searchTextInDoc(left.doc)).toBe(merged.toLowerCase());
  });
});

describe('peer colours', () => {
  it('are the same for the same person everywhere, and vary between people', () => {
    expect(colorFor('alice')).toBe(colorFor('alice'));
    const colours = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(colorFor));
    expect(colours.size).toBeGreaterThan(3);
  });
});

describe('element ids', () => {
  it('differ between pages even in the same millisecond', async () => {
    // Two pages: two fresh copies of the module, each making its first id.
    vi.resetModules();
    const one = (await import('@/model/element')).createElementId;
    vi.resetModules();
    const two = (await import('@/model/element')).createElementId;
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    expect(one('rect')).not.toBe(two('rect'));
    vi.restoreAllMocks();
  });
});
