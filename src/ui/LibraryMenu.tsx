import { useEffect, useRef, useState } from 'react';
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
import styles from './LibraryMenu.module.css';

/**
 * Saved groups, to reuse on any board: save the selection under a name, then click
 * an item (or drag it onto the canvas) to drop a copy in.
 */
export function LibraryMenu() {
  const editable = useBoardAccess(selectCanEdit);
  const canExport = useBoardAccess((state) => state.canExport);
  const hasSelection = useBoardStore((state) => state.selection.length > 0);
  const { items, loading, error } = useLibrary();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    void loadLibrary();
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  if (!editable && !canExport) return null;

  const save = async () => {
    if (await saveSelection(name || 'Untitled')) setName('');
  };

  return (
    <div className={menu.wrap} ref={ref}>
      <button
        type="button"
        className={menu.trigger}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="library-menu"
        onClick={() => setOpen((current) => !current)}
      >
        Library
      </button>
      {open ? (
        <div className={`${menu.menu} ${styles.panel}`} role="dialog" aria-label="Library">
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
                    setOpen(false);
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
      ) : null}
    </div>
  );
}
