import type { Point } from '@/geometry';
import { createElement, DEFAULT_HINT, DEFAULT_STYLE, TEXT_STYLE } from '@/model/element';
import { keyBetween } from '@/model/zorder';
import { textDefaults } from '@/settings/settings';
import { showPane } from '@/state/uiPrefs';
import { useBoardStore } from '@/state/boardStore';
import { defaultTextBox } from '@/text/measure';

export const STAMPS = ['👍', '❤️', '⭐', '✅', '❓', '🎉', '🔥', '💡'] as const;

const STAMP_SIZE = 72;

/** Things that are inserted rather than drawn: a table. */
export function insertTable() {
  useBoardStore
    .getState()
    .insertAt('table', { w: 420, h: 160 }, { table: { rows: 4, cols: 3, cells: {} } });
}

/**
 * A placeholder in the middle of the view: a text box with a hint, for someone to
 * answer in with one click. It is left selected with the side panel open, so the hint
 * can be written straight away.
 */
export function insertPlaceholder() {
  const defaults = textDefaults();
  const style = { ...DEFAULT_STYLE, ...TEXT_STYLE, fontSize: defaults.fontSize };
  const size = defaultTextBox(style, { chars: Math.min(defaults.chars, 30), lines: 2 });
  const element = useBoardStore.getState().insertAt('text', size, {
    text: '',
    placeholder: DEFAULT_HINT,
    style: { fontSize: defaults.fontSize },
  });
  if (!element) return;
  showPane();
  requestAnimationFrame(() => {
    const field = document.querySelector<HTMLInputElement>('[data-testid="placeholder-hint"]');
    field?.focus();
    field?.select();
  });
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
