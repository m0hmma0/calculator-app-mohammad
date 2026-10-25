import { create } from 'zustand';
import type { MarkFormats, MarkName, MarkSet } from './marks';

/**
 * The text being typed in, as the formatting controls see it: what is selected and
 * how it is formatted, and the ways to format it. The side panel and the floating
 * bar above the box read and call this; the editor fills it in.
 */
interface TextSelection {
  id: string | null;
  start: number;
  end: number;
  /** What the buttons show as on: the selection's formatting, or what typing will get. */
  active: MarkSet;
  /** The link the caret is in, or that the selection is part of. */
  link: { url: string; from: number; to: number } | null;
  /** The field for typing an address is open. */
  linkOpen: boolean;
  toggle: ((name: MarkName) => void) | null;
  /** A colour or highlight: on the selection, or on what is typed next. */
  format: ((formats: MarkFormats) => void) | null;
  /** Links the selection (or the link the caret is in) to an address; null unlinks. */
  setLink: ((url: string | null) => void) | null;
  /** Puts the caret back in the box, where it was — after the address field, say. */
  refocus: (() => void) | null;
}

/** Nothing being typed: the controls act on whole elements. */
export const CLOSED_SELECTION: TextSelection = {
  id: null,
  start: 0,
  end: 0,
  active: {},
  link: null,
  linkOpen: false,
  toggle: null,
  format: null,
  setLink: null,
  refocus: null,
};

export const useTextSelection = create<TextSelection>(() => ({ ...CLOSED_SELECTION }));
