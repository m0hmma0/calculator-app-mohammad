import { useMemo, useState } from 'react';
import { exportBlob, downloadBlob, type ExportFormat } from '@/export/exporters';
import { useBoardStore, type Tool } from '@/state/boardStore';
import styles from './CommandPalette.module.css';

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void | Promise<void>;
}

/** Matches on subsequence, so "zf" finds "Zoom to fit". */
function matches(query: string, label: string): boolean {
  if (query === '') return true;
  const haystack = label.toLowerCase();
  let index = 0;
  for (const character of query.toLowerCase()) {
    index = haystack.indexOf(character, index);
    if (index === -1) return false;
    index += 1;
  }
  return true;
}

/**
 * Mounted only while open, so its query and highlight start fresh every time rather
 * than needing to be reset — which is also why the input can simply autofocus.
 */
export function CommandPalette() {
  const open = useBoardStore((state) => state.paletteOpen);
  const toggle = useBoardStore((state) => state.togglePalette);
  return open ? <PaletteDialog onClose={toggle} /> : null;
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const commands = useMemo<Command[]>(() => {
    const store = useBoardStore.getState;

    const tool = (id: Tool, label: string, hint: string): Command => ({
      id: `tool-${id}`,
      label,
      hint,
      run: () => store().setTool(id),
    });

    const save = async (format: ExportFormat, selectionOnly: boolean) => {
      const state = store();
      const ids = new Set(state.selection);
      const chosen = selectionOnly
        ? state.elements.filter(
            (element) => ids.has(element.id) || (element.parentId && ids.has(element.parentId)),
          )
        : state.elements;
      if (chosen.length === 0) return;

      const host = document.querySelector('[data-testid="stage"]') ?? document.documentElement;
      const blob = await exportBlob(chosen, format, { host });
      downloadBlob(blob, `sabboura-board.${format}`);
    };

    return [
      tool('select', 'Select tool', 'V'),
      tool('hand', 'Hand tool', 'H'),
      tool('rect', 'Rectangle', 'R'),
      tool('ellipse', 'Ellipse', 'O'),
      tool('line', 'Line', 'L'),
      tool('arrow', 'Arrow', 'A'),
      tool('pen', 'Pen', 'P'),
      tool('eraser', 'Eraser', 'E'),
      tool('text', 'Text', 'T'),
      tool('sticky', 'Sticky note', 'N'),
      tool('frame', 'Frame', 'F'),
      tool('laser', 'Laser pointer', 'K'),
      { id: 'undo', label: 'Undo', hint: '⌘Z', run: () => store().undo() },
      { id: 'redo', label: 'Redo', hint: '⇧⌘Z', run: () => store().redo() },
      { id: 'fit', label: 'Zoom to fit', hint: '⇧1', run: () => store().zoomToFit() },
      { id: 'hundred', label: 'Zoom to 100%', hint: '⇧0', run: () => store().zoomTo100() },
      { id: 'select-all', label: 'Select all', hint: '⌘A', run: () => store().selectAll() },
      { id: 'group', label: 'Group selection', hint: '⌘G', run: () => store().groupSelection() },
      { id: 'export-png', label: 'Export board as PNG', run: () => save('png', false) },
      { id: 'export-svg', label: 'Export board as SVG', run: () => save('svg', false) },
      { id: 'export-pdf', label: 'Export board as PDF', run: () => save('pdf', false) },
      {
        id: 'export-png-selection',
        label: 'Export selection as PNG',
        run: () => save('png', true),
      },
      {
        id: 'shortcuts',
        label: 'Keyboard shortcuts',
        hint: '?',
        run: () => store().toggleShortcuts(),
      },
      { id: 'clear', label: 'Clear the board', run: () => store().clearBoard() },
    ];
  }, []);

  const results = useMemo(
    () => commands.filter((command) => matches(query, command.label)),
    [commands, query],
  );

  const runActive = () => {
    const command = results[active];
    onClose();
    void command?.run();
  };

  return (
    <div className={styles.backdrop} data-hud data-testid="command-palette" onClick={onClose}>
      <div
        className={styles.panel}
        role="dialog"
        aria-label="Command palette"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          className={styles.input}
          placeholder="Type a command…"
          value={query}
          data-testid="command-input"
          aria-label="Command"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((current) => Math.min(current + 1, results.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((current) => Math.max(current - 1, 0));
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              runActive();
            }
          }}
        />

        <ul className={styles.results} data-testid="command-results">
          {results.map((command, index) => (
            <li key={command.id}>
              <button
                type="button"
                className={styles.result}
                aria-selected={index === active}
                data-testid={`command-${command.id}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => {
                  onClose();
                  void command.run();
                }}
              >
                <span>{command.label}</span>
                {command.hint ? <kbd className={styles.hint}>{command.hint}</kbd> : null}
              </button>
            </li>
          ))}
          {results.length === 0 ? <li className={styles.empty}>No matching command</li> : null}
        </ul>
      </div>
    </div>
  );
}
