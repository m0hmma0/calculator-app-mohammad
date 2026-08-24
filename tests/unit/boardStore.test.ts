import { beforeEach, describe, expect, it } from 'vitest';
import { createElement, type BoardElement } from '@/model/element';
import { keysBetween } from '@/model/zorder';
import { useBoardStore } from '@/state/boardStore';

const store = () => useBoardStore.getState();

function seed(boxes: Array<{ x: number; y: number; w?: number; h?: number }>): BoardElement[] {
  const keys = keysBetween(null, null, boxes.length);
  const elements = boxes.map((box, index) =>
    createElement({
      type: 'rect',
      box: { x: box.x, y: box.y, w: box.w ?? 50, h: box.h ?? 40 },
      z: keys[index]!,
      id: `e${index}`,
    }),
  );
  store().replaceElements(elements);
  return elements;
}

const byId = (id: string) => store().elements.find((element) => element.id === id)!;

beforeEach(() => {
  useBoardStore.setState({
    elements: [],
    selection: [],
    draft: null,
    marquee: null,
    guides: [],
    spacing: [],
    tool: 'select',
    stageSize: { width: 800, height: 600 },
  });
});

describe('selection', () => {
  it('replaces and toggles', () => {
    seed([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    store().selectOnly(['e0']);
    expect(store().selection).toEqual(['e0']);

    store().toggleSelected('e1');
    expect(store().selection).toEqual(['e0', 'e1']);

    store().toggleSelected('e0');
    expect(store().selection).toEqual(['e1']);
  });

  it('selects all top-level elements but skips locked ones', () => {
    seed([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    store().selectOnly(['e0']);
    store().toggleLockSelection();

    store().selectAll();
    expect(store().selection).toEqual(['e1']);
  });
});

describe('align', () => {
  it('lines up left edges', () => {
    seed([
      { x: 0, y: 0 },
      { x: 40, y: 100 },
      { x: 90, y: 200 },
    ]);
    store().selectOnly(['e0', 'e1', 'e2']);
    store().alignSelection('left');
    expect([byId('e0').x, byId('e1').x, byId('e2').x]).toEqual([0, 0, 0]);
  });

  it('lines up right edges by their own widths', () => {
    seed([
      { x: 0, y: 0, w: 50 },
      { x: 40, y: 100, w: 20 },
    ]);
    store().selectOnly(['e0', 'e1']);
    store().alignSelection('right');
    expect(byId('e0').x + byId('e0').w).toBeCloseTo(byId('e1').x + byId('e1').w, 6);
  });

  it('needs at least two elements', () => {
    seed([{ x: 7, y: 7 }]);
    store().selectOnly(['e0']);
    store().alignSelection('left');
    expect(byId('e0').x).toBe(7);
  });
});

describe('distribute', () => {
  // Checklist item 12.
  it('equalises the gaps', () => {
    seed([
      { x: 0, y: 0, w: 50 },
      { x: 70, y: 0, w: 50 },
      { x: 400, y: 0, w: 50 },
    ]);
    store().selectOnly(['e0', 'e1', 'e2']);
    store().distributeSelection('x');

    const gapOne = byId('e1').x - (byId('e0').x + byId('e0').w);
    const gapTwo = byId('e2').x - (byId('e1').x + byId('e1').w);
    expect(gapOne).toBeCloseTo(gapTwo, 6);
  });

  it('leaves the outermost elements where they are', () => {
    seed([
      { x: 0, y: 0, w: 50 },
      { x: 70, y: 0, w: 50 },
      { x: 400, y: 0, w: 50 },
    ]);
    store().selectOnly(['e0', 'e1', 'e2']);
    store().distributeSelection('x');
    expect(byId('e0').x).toBeCloseTo(0, 6);
    expect(byId('e2').x).toBeCloseTo(400, 6);
  });

  it('needs at least three elements', () => {
    seed([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]);
    store().selectOnly(['e0', 'e1']);
    store().distributeSelection('x');
    expect(byId('e1').x).toBe(200);
  });
});

describe('grouping', () => {
  it('adopts the children and selects the group', () => {
    seed([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    store().selectOnly(['e0', 'e1']);
    store().groupSelection();

    const group = store().elements.find((element) => element.type === 'group')!;
    expect(group).toBeDefined();
    expect(store().selection).toEqual([group.id]);
    expect(byId('e0').parentId).toBe(group.id);
    expect(byId('e1').parentId).toBe(group.id);
  });

  it('moves its children with it', () => {
    seed([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    store().selectOnly(['e0', 'e1']);
    store().groupSelection();
    store().nudgeSelection(10, 5);

    expect(byId('e0').x).toBe(10);
    expect(byId('e1').x).toBe(110);
    expect(byId('e0').y).toBe(5);
  });

  it('releases the children and drops the group', () => {
    seed([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    store().selectOnly(['e0', 'e1']);
    store().groupSelection();
    store().ungroupSelection();

    expect(store().elements.some((element) => element.type === 'group')).toBe(false);
    expect(byId('e0').parentId).toBeNull();
    expect(store().selection.sort()).toEqual(['e0', 'e1']);
  });

  it('refuses to group a single element', () => {
    seed([{ x: 0, y: 0 }]);
    store().selectOnly(['e0']);
    store().groupSelection();
    expect(store().elements.some((element) => element.type === 'group')).toBe(false);
  });

  it('deletes a group together with its children', () => {
    seed([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    store().selectOnly(['e0', 'e1']);
    store().groupSelection();
    store().deleteSelection();
    expect(store().elements).toHaveLength(0);
  });
});

describe('lock and hide', () => {
  it('locks, then unlocks, the whole selection', () => {
    seed([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    store().selectOnly(['e0', 'e1']);

    store().toggleLockSelection();
    expect([byId('e0').locked, byId('e1').locked]).toEqual([true, true]);

    store().toggleLockSelection();
    expect([byId('e0').locked, byId('e1').locked]).toEqual([false, false]);
  });

  it('locks a mixed selection rather than unlocking it', () => {
    seed([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    store().selectOnly(['e0']);
    store().toggleLockSelection();

    store().selectOnly(['e0', 'e1']);
    store().toggleLockSelection();
    expect([byId('e0').locked, byId('e1').locked]).toEqual([true, true]);
  });

  it('will not nudge a locked element', () => {
    seed([{ x: 5, y: 5 }]);
    store().selectOnly(['e0']);
    store().toggleLockSelection();
    store().nudgeSelection(10, 10);
    expect(byId('e0').x).toBe(5);
  });
});

describe('duplicate and delete', () => {
  it('offsets the copy and selects it', () => {
    seed([{ x: 10, y: 10 }]);
    store().selectOnly(['e0']);
    store().duplicateSelection(16);

    expect(store().elements).toHaveLength(2);
    const copy = byId(store().selection[0]!);
    expect(copy.id).not.toBe('e0');
    expect(copy.x).toBe(26);
    expect(copy.y).toBe(26);
  });

  it('puts the copy on top', () => {
    seed([
      { x: 10, y: 10 },
      { x: 200, y: 10 },
    ]);
    store().selectOnly(['e0']);
    store().duplicateSelection();
    expect(store().elements.at(-1)!.id).toBe(store().selection[0]);
  });

  it('removes only the selection', () => {
    seed([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    store().selectOnly(['e0']);
    store().deleteSelection();
    expect(store().elements.map((element) => element.id)).toEqual(['e1']);
    expect(store().selection).toEqual([]);
  });
});

describe('styling', () => {
  it('applies to everything selected', () => {
    seed([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    store().selectOnly(['e0', 'e1']);
    store().styleSelection({ fill: 'var(--shape-3)', dash: 'dashed' });

    expect(byId('e0').style.fill).toBe('var(--shape-3)');
    expect(byId('e1').style.dash).toBe('dashed');
    // Untouched properties survive.
    expect(byId('e0').style.strokeWidth).toBe(2);
  });
});
