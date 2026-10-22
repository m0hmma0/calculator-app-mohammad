import { useEffect, useRef } from 'react';
import { fontString } from '@/canvas/fonts';
import { CELL_PADDING, tableGrid } from '@/canvas/renderContent';
import { boardToScreen, type Viewport } from '@/canvas/viewport';
import { useBoardStore } from '@/state/boardStore';
import styles from './TableCellEditor.module.css';

/**
 * Typing in a table: one cell at a time, in a box laid exactly over it. Tab and
 * Shift+Tab move across, Enter moves down, and Tab past the last cell adds a row —
 * the way a spreadsheet behaves, so it feels like a table rather than a picture of one.
 */
export function TableCellEditor({ viewport }: { viewport: Viewport }) {
  const editing = useBoardStore((state) => state.editingCell);
  const elements = useBoardStore((state) => state.elements);
  const setCell = useBoardStore((state) => state.setCell);
  const begin = useBoardStore((state) => state.beginCellEdit);
  const end = useBoardStore((state) => state.endCellEdit);
  const resizeTable = useBoardStore((state) => state.resizeTable);
  const ref = useRef<HTMLInputElement | null>(null);

  const element = editing ? elements.find((candidate) => candidate.id === editing.id) : undefined;

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, [editing?.id, editing?.row, editing?.col]);

  if (!editing || !element?.table) return null;
  const { rows, cols, rowHeight, colWidth } = tableGrid(element);
  const { row, col } = editing;
  const topLeft = boardToScreen(viewport, {
    x: element.x + col * colWidth,
    y: element.y + row * rowHeight,
  });
  const value = element.table.cells[`${row},${col}`] ?? '';
  const size = Math.min(element.style.fontSize, rowHeight * 0.6);

  const move = (nextRow: number, nextCol: number) => {
    if (nextRow >= rows) resizeTable(element.id, { rows: nextRow + 1 });
    begin(element.id, Math.max(0, nextRow), Math.max(0, nextCol));
  };

  return (
    <input
      ref={ref}
      className={styles.cell}
      data-hud
      data-testid="cell-editor"
      value={value}
      spellCheck={false}
      style={{
        left: topLeft.x,
        top: topLeft.y,
        width: colWidth * viewport.zoom,
        height: rowHeight * viewport.zoom,
        padding: `0 ${CELL_PADDING * viewport.zoom}px`,
        font: fontString(
          { ...element.style, fontWeight: row === 0 ? 650 : element.style.fontWeight },
          size * viewport.zoom,
        ),
      }}
      onChange={(event) => setCell(element.id, row, col, event.target.value)}
      onBlur={end}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          end();
        } else if (event.key === 'Tab') {
          event.preventDefault();
          const index = row * cols + col + (event.shiftKey ? -1 : 1);
          if (index < 0) return;
          move(Math.floor(index / cols), index % cols);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          move(row + 1, col);
        }
      }}
    />
  );
}
