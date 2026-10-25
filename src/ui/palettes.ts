/**
 * The colours offered for words and for highlighting. Theme tokens follow light and
 * dark; the literal colours stay the same on both (a red is red).
 */
export const TEXT_COLOURS: ReadonlyArray<{ value: string; name: string }> = [
  { value: 'var(--text)', name: 'Ink' },
  { value: '#e03131', name: 'Red' },
  { value: 'var(--shape-3)', name: 'Orange' },
  { value: 'var(--shape-2)', name: 'Green' },
  { value: 'var(--shape-6)', name: 'Blue' },
  { value: 'var(--shape-1)', name: 'Indigo' },
  { value: 'var(--shape-5)', name: 'Purple' },
  { value: '#ffffff', name: 'White' },
];

/** Highlighter colours: bright, light, and the same for the pen and for words. */
export const HIGHLIGHTS: ReadonlyArray<{ value: string; name: string }> = [
  { value: '#ffe14d', name: 'Yellow' },
  { value: '#8ef0a0', name: 'Green' },
  { value: '#ff9ccf', name: 'Pink' },
  { value: '#8fd3ff', name: 'Blue' },
  { value: '#ffbe6b', name: 'Orange' },
  { value: '#c9a8ff', name: 'Purple' },
];
