import { useEffect, useState } from 'react';
import {
  insertItem,
  LIBRARY_DRAG_TYPE,
  loadLibrary,
  removeItem,
  saveSelection,
  useLibrary,
} from '@/library/library';
import { selectCanEdit, useBoardAccess } from '@/sharing/boardAccess';
import { useBoardStore } from '@/state/boardStore';
import menu from './InsertMenu.module.css';
import styles from './LibraryPanel.module.css';

/**
 * Saved groups, to reuse on any board: save the selection under a name, then click
 * an item (or drag it onto the canvas) to drop a copy in. Shown inside Tools.
 */
export function LibraryPanel({ onDone }: { onDone: () => void }) {
  const editable = useBoardAccess(selectCanEdit);
  const hasSelection = useBoardStore((state) => state.selection.length > 0);
  const { items, loading, error } = useLibrary();
  const [name, setName] = useState('');

  useEffect(() => {
    void loadLibrary();
  }, []);

  const save = async () => {
    if (await saveSelection(name || 'Untitled')) setName('');
  };
  return (
    <div className={styles.panel} role="group" aria-label="Library">
      <form
        className={styles.save}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <input
          value={name}
          placeholder={hasSelection ? 'Name the selection' : 'Select something to save'}
          disabled={!hasSelection}
          aria-label="Library item name"
          data-testid="library-name"
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" disabled={!hasSelection} data-testid="library-save">
          Save
        </button>
      </form>
      {error ? <p className={styles.error}>{error}</p> : null}
      {loading && items.length === 0 ? <p className={menu.hint}>Loading…</p> : null}
      {!loading && items.length === 0 ? (
        <p className={menu.hint}>Nothing saved yet. Select a group and save it here.</p>
      ) : null}
      <ul className={styles.list} data-testid="library-items">
        {items.map((item, index) => (
          <li key={item.id} className={styles.item}>
            <button
              type="button"
              className={styles.insert}
              disabled={!editable}
              draggable={editable}
              title={editable ? 'Click to add, or drag onto the board' : undefined}
              data-testid={`library-insert-${index}`}
              onDragStart={(event) => {
                event.dataTransfer.setData(LIBRARY_DRAG_TYPE, item.id);
                event.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => {
                insertItem(item);
                onDone();
              }}
            >
              <span className={styles.name}>{item.name}</span>
              <span className={styles.count}>
                {item.elements.length} {item.elements.length === 1 ? 'item' : 'items'}
              </span>
            </button>
            <button
              type="button"
              className={styles.remove}
              aria-label={`Remove ${item.name} from the library`}
              data-testid={`library-remove-${index}`}
              onClick={() => void removeItem(item.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
