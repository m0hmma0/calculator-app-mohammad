import { create } from 'zustand';
import type { MarkName, MarkSet } from './marks';

/**
 * The text being typed in, as the formatting controls see it: what is selected and
 * how it is formatted, and the way to format it. The side panel and the floating
 * B / I / U buttons read and call this; the editor fills it in.
 */
interface TextSelection {
  id: string | null;
  start: number;
  end: number;
  /** What a B, I or U button shows as on: the selection's, or what typing will get. */
  active: MarkSet;
  toggle: ((name: MarkName) => void) | null;
}

export const useTextSelection = create<TextSelection>(() => ({
  id: null,
  start: 0,
  end: 0,
  active: {},
  toggle: null,
}));
