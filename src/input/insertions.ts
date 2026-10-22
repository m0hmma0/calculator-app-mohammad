import { useBoardStore } from '@/state/boardStore';

export const STAMPS = ['👍', '❤️', '⭐', '✅', '❓', '🎉', '🔥', '💡'] as const;

const SAMPLE_CODE = `function greet(name) {
  // Say hello
  return \`Hello, \${name}!\`;
}`;

/** Things that are inserted rather than drawn: a table, a code block, a stamp. */
export function insertTable() {
  useBoardStore
    .getState()
    .insertAt('table', { w: 420, h: 160 }, { table: { rows: 4, cols: 3, cells: {} } });
}

export function insertCode() {
  useBoardStore
    .getState()
    .insertAt('code', { w: 420, h: 150 }, { text: SAMPLE_CODE, language: 'auto' });
}

export function insertStamp(stamp: string) {
  useBoardStore
    .getState()
    .insertAt(
      'text',
      { w: 72, h: 72 },
      { text: stamp, style: { fontSize: 52, align: 'center', textColor: null } },
    );
}
