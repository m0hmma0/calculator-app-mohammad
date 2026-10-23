import type { Point } from '@/geometry';
import { createElement } from '@/model/element';
import { keyBetween } from '@/model/zorder';
import { useBoardStore } from '@/state/boardStore';

export const STAMPS = ['👍', '❤️', '⭐', '✅', '❓', '🎉', '🔥', '💡'] as const;

const STAMP_SIZE = 72;

/** Things that are inserted rather than drawn: a table. */
export function insertTable() {
  useBoardStore
    .getState()
    .insertAt('table', { w: 420, h: 160 }, { table: { rows: 4, cols: 3, cells: {} } });
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
