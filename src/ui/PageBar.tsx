import { selectCanEdit, useBoardAccess } from '@/sharing/boardAccess';
import { useBoardStore } from '@/state/boardStore';
import styles from './PageBar.module.css';

/**
 * The board's pages. Everyone sees the same pages; which one is in view is each
 * person's own, and each page remembers its own camera.
 */
export function PageBar({ embedded = false }: { embedded?: boolean }) {
  const pages = useBoardStore((state) => state.pages);
  const page = useBoardStore((state) => state.page);
  const setPage = useBoardStore((state) => state.setPage);
  const addPage = useBoardStore((state) => state.addPage);
  const renamePage = useBoardStore((state) => state.renamePage);
  const deletePage = useBoardStore((state) => state.deletePage);
  const editable = useBoardAccess(selectCanEdit);

  // One page and nothing to add it with: no bar at all.
  if (pages.length < 2 && !editable) return null;

  return (
    <nav
      className={embedded ? `${styles.bar} ${styles.embedded}` : styles.bar}
      data-hud
      aria-label="Pages"
      data-testid="page-bar"
    >
      {pages.map((entry, index) => (
        <span
          key={entry.id}
          className={styles.tab}
          aria-current={entry.id === page ? 'page' : undefined}
        >
          <button
            type="button"
            className={styles.name}
            data-testid={`page-tab-${index}`}
            title={editable ? 'Double-click to rename' : entry.name}
            onClick={() => setPage(entry.id)}
            onDoubleClick={() => {
              if (!editable) return;
              const name = window.prompt('Rename page', entry.name);
              if (name !== null) renamePage(entry.id, name);
            }}
          >
            {entry.name}
          </button>
          {editable && pages.length > 1 && entry.id === page ? (
            <button
              type="button"
              className={styles.remove}
              aria-label={`Delete ${entry.name}`}
              data-testid={`page-delete-${index}`}
              onClick={() => {
                if (
                  window.confirm(
                    `Delete “${entry.name}” and everything on it? Undo brings it back.`,
                  )
                ) {
                  deletePage(entry.id);
                }
              }}
            >
              ×
            </button>
          ) : null}
        </span>
      ))}
      {editable ? (
        <button
          type="button"
          className={styles.add}
          aria-label="Add a page"
          data-testid="add-page"
          onClick={addPage}
        >
          +
        </button>
      ) : null}
    </nav>
  );
}
