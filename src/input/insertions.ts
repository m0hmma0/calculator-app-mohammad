import type { Point, Rect } from '@/geometry';
import { createElement, DEFAULT_HINT, type BoardElement } from '@/model/element';
import { keyBetween } from '@/model/zorder';
import { textDefaults } from '@/settings/settings';
import { showPane } from '@/state/uiPrefs';
import { useBoardStore } from '@/state/boardStore';
import { defaultTextBox, textHeight } from '@/text/measure';

export const STAMPS = ['👍', '❤️', '⭐', '✅', '❓', '🎉', '🔥', '💡'] as const;

const STAMP_SIZE = 72;

/** Things that are inserted rather than drawn: a table. */
export function insertTable() {
  useBoardStore
    .getState()
    .insertAt('table', { w: 420, h: 160 }, { table: { rows: 4, cols: 3, cells: {} } });
}

/**
 * A placeholder where the placeholder tool was used: clicked, one line as wide as a
 * short answer; dragged, the box dragged out — never shorter than its hint needs. It is
 * left selected with the side panel open, so the hint can be written straight away.
 */
export function placePlaceholder(origin: Point, dragged: Rect | null) {
  const store = useBoardStore.getState();
  const defaults = textDefaults();
  const element = createElement({
    type: 'text',
    box: { x: origin.x, y: origin.y, w: 1, h: 1 },
    z: keyBetween(store.elements.at(-1)?.z ?? null, null),
    style: { fontSize: defaults.fontSize },
  });
  element.text = '';
  element.placeholder = DEFAULT_HINT;
  const box = dragged ?? {
    x: origin.x,
    y: origin.y,
    ...defaultTextBox(element.style, { chars: Math.min(defaults.chars, 30), lines: 1 }),
  };
  Object.assign(element, box, { w: Math.max(40, box.w) });
  element.h = Math.max(dragged?.h ?? 0, textHeight(element, DEFAULT_HINT) ?? box.h);
  // The tool is put down first: taking up another one clears the selection.
  store.setTool('select');
  store.addElement(element);
  showPane();
  requestAnimationFrame(() => {
    const field = document.querySelector<HTMLInputElement>('[data-testid="placeholder-hint"]');
    field?.focus();
    field?.select();
  });
}

/** A new hint for a placeholder, and the room for it: the box grows if the hint wraps. */
export function hintPatch(element: BoardElement, hint: string | null): Partial<BoardElement> {
  if (hint === null) return { placeholder: null };
  const needed = textHeight(element, hint || DEFAULT_HINT);
  return needed !== null && needed > element.h
    ? { placeholder: hint, h: needed }
    : { placeholder: hint };
}

/**
 * Puts the stamp tool's emoji down, centred on `at`. Nothing is selected afterwards,
 * so stamping again and again leaves no selection boxes in the way.
 */
export function placeStamp(at: Point) {
  const store = useBoardStore.getState();
  const element = createElement({
    type: 'text',
    box: { x: at.x - STAMP_SIZE / 2, y: at.y - STAMP_SIZE / 2, w: STAMP_SIZE, h: STAMP_SIZE },
    z: keyBetween(store.elements.at(-1)?.z ?? null, null),
    style: { fontSize: 52, align: 'center', textColor: null },
  });
  element.text = store.stamp;
  store.addElement(element);
  store.clearSelection();
}

/** The emoji as a pointer, so it is obvious what a click will put down. */
export function stampCursor(stamp: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><text x='16' y='25' font-size='24' text-anchor='middle'>${stamp}</text></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 16 16, crosshair`;
}
