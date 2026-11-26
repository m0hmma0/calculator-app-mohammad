import { centerOn, screenToBoard, visibleBounds } from '@/canvas/viewport';
import { elementAABB } from '@/model/bounds';
import { canHoldLabel, createElement, STICKY_SIZE, type BoardElement } from '@/model/element';
import { keyBetween } from '@/model/zorder';
import { textDefaults } from '@/settings/settings';
import { lockedForMe } from '@/sharing/boardAccess';
import { isShapeTool, useBoardStore } from '@/state/boardStore';
import { defaultTextBox, textHeight } from '@/text/measure';
import { isWebPage } from '@/webpage/pageStore';

/**
 * The board without a mouse (Phase 17d): Enter puts the tool's shape, note or text box
 * in the middle of the view — or, with something selected, starts typing into it —
 * and Tab, while the board has the focus, walks through what is on it in reading
 * order (top to bottom, then left to right), moving the view to each. After the last,
 * Tab goes on to the next control, so the board never traps the focus.
 */

const SHAPE = { w: 120, h: 90 };
const FRAME = { w: 400, h: 260 };

/** Whether typing should give the focus back to the board when it ends. */
let refocusBoard = false;
export const takeRefocusBoard = (): boolean => {
  const was = refocusBoard;
  refocusBoard = false;
  return was;
};

/** Where Enter came from counts: on a button, it is the button's. */
function boardHasKeys(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || active.matches('[data-testid="stage"]');
}

function viewCentre() {
  const { viewport, stageSize } = useBoardStore.getState();
  return screenToBoard(viewport, { x: stageSize.width / 2, y: stageSize.height / 2 });
}

/** Enter: put the tool's item in the middle of the view, selected (and typed into). */
export function placeFromKeyboard(): boolean {
  const store = useBoardStore.getState();
  const tool = store.tool;
  const centre = viewCentre();
  const top = keyBetween(store.elements.at(-1)?.z ?? null, null);

  if (isShapeTool(tool)) {
    const size = tool === 'frame' ? FRAME : SHAPE;
    const element = createElement({
      type: tool,
      box: { x: centre.x - size.w / 2, y: centre.y - size.h / 2, w: size.w, h: size.h },
      // A frame goes behind what it will hold.
      z: tool === 'frame' ? keyBetween(null, store.elements[0]?.z ?? null) : top,
    });
    store.addElement(element);
    store.setTool('select');
    store.selectOnly([element.id]);
    return true;
  }

  if (tool === 'sticky') {
    const element = createElement({
      type: 'sticky',
      box: {
        x: centre.x - STICKY_SIZE / 2,
        y: centre.y - STICKY_SIZE / 2,
        w: STICKY_SIZE,
        h: STICKY_SIZE,
      },
      z: top,
    });
    element.text = '';
    store.addElement(element);
    store.setTool('select');
    refocusBoard = true;
    store.beginEditing(element.id);
    return true;
  }

  if (tool === 'text') {
    const defaults = textDefaults();
    const element = createElement({
      type: 'text',
      box: { x: centre.x, y: centre.y, w: 1, h: 1 },
      z: top,
      style: { fontSize: defaults.fontSize },
    });
    const size = defaultTextBox(element.style, { chars: defaults.chars, lines: 1 });
    element.w = Math.max(40, size.w);
    element.x = centre.x - element.w / 2;
    element.text = '';
    element.autoHeight = true;
    element.h = textHeight(element, '') ?? size.h;
    element.y = centre.y - element.h / 2;
    store.addElement(element);
    store.setTool('select');
    refocusBoard = true;
    store.beginEditing(element.id);
    return true;
  }
  return false;
}

/** Enter with one thing selected: type into it, as a double-click would. */
export function editSelection(): boolean {
  const store = useBoardStore.getState();
  if (store.selection.length !== 1) return false;
  const target = store.elements.find((element) => element.id === store.selection[0]);
  if (!target || lockedForMe(target) || isWebPage(target)) return false;
  if (
    target.type === 'text' ||
    target.type === 'sticky' ||
    target.type === 'frame' ||
    target.type === 'code' ||
    canHoldLabel(target)
  ) {
    refocusBoard = true;
    store.beginEditing(target.id);
    return true;
  }
  if (target.type === 'table' && target.table) {
    refocusBoard = true;
    store.beginCellEdit(target.id, 0, 0);
    return true;
  }
  return false;
}

/** The Enter shortcut: place, or type into the selection. False leaves the key alone. */
export function enterOnBoard(): boolean {
  if (!boardHasKeys()) return false;
  return placeFromKeyboard() || editSelection();
}

/** What Tab walks through: everything on the board at the top level, in reading order. */
export function readingOrder(elements: readonly BoardElement[]): BoardElement[] {
  const items = elements.filter((element) => element.parentId === null && !element.hidden);
  const boxes = new Map(items.map((element) => [element.id, elementAABB(element)]));
  return [...items].sort((a, b) => {
    const boxA = boxes.get(a.id)!;
    const boxB = boxes.get(b.id)!;
    // Side by side (their tops within half the smaller's height): left to right.
    const row = Math.min(boxA.h, boxB.h) / 2;
    if (Math.abs(boxA.y - boxB.y) > row) return boxA.y - boxB.y;
    return boxA.x - boxB.x || boxA.y - boxB.y;
  });
}

/**
 * Tab (back with Shift) while the board has the focus: selects the next thing in
 * reading order and brings it into view. False past either end, so the focus moves on.
 */
export function tabThrough(back: boolean): boolean {
  const store = useBoardStore.getState();
  const order = readingOrder(store.elements);
  if (order.length === 0) return false;
  const current = order.findIndex((element) => element.id === store.selection[0]);
  const next = current === -1 ? (back ? order.length - 1 : 0) : current + (back ? -1 : 1);
  if (next < 0 || next >= order.length) {
    store.clearSelection();
    return false;
  }
  const element = order[next]!;
  store.selectOnly([element.id]);
  // Into view if it is not, at the same zoom.
  const box = elementAABB(element);
  const view = visibleBounds(store.viewport, store.stageSize);
  const inside =
    box.x >= view.x &&
    box.y >= view.y &&
    box.x + box.w <= view.x + view.w &&
    box.y + box.h <= view.y + view.h;
  if (!inside) {
    store.setViewport(
      centerOn(store.viewport, store.stageSize, { x: box.x + box.w / 2, y: box.y + box.h / 2 }),
    );
  }
  return true;
}

/** A name for what is selected, for a screen reader: "Rectangle, 2 of 5". */
export function describeSelection(
  elements: readonly BoardElement[],
  selection: readonly string[],
): string {
  if (selection.length === 0) return '';
  if (selection.length > 1) return `${selection.length} items selected`;
  const order = readingOrder(elements);
  const index = order.findIndex((element) => element.id === selection[0]);
  const element = elements.find((each) => each.id === selection[0]);
  if (!element) return '';
  const kind =
    {
      rect: 'Rectangle',
      ellipse: 'Ellipse',
      sticky: 'Note',
      text: 'Text',
      frame: 'Frame',
      path: 'Drawing',
      image: 'Picture',
    }[element.type as string] ?? element.type.charAt(0).toUpperCase() + element.type.slice(1);
  const words = (element.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${kind}${words ? `: ${words}` : ''}${index === -1 ? '' : `, ${index + 1} of ${order.length}`}`;
}
