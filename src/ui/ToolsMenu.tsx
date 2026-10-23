import { useEffect, useRef, useState } from 'react';
import { openHistory, useHistory } from '@/collab/history';
import { usePresence } from '@/collab/presence';
import { useComments } from '@/sharing/comments';
import { selectCanEdit, useBoardAccess } from '@/sharing/boardAccess';
import { toggleLayers, useUiPrefs } from '@/state/uiPrefs';
import { LibraryPanel } from './LibraryPanel';
import menu from './InsertMenu.module.css';
import styles from './ToolsMenu.module.css';

/**
 * The board's panels in one place: version history, comments, the library, and the
 * list of everything on the board. History and comments exist only on a board with
 * a room; the local board has the library and the list.
 */
export function ToolsMenu() {
  const editable = useBoardAccess(selectCanEdit);
  const canExport = useBoardAccess((state) => state.canExport);
  const status = usePresence((state) => state.status);
  const historyOpen = useHistory((state) => state.open);
  const commentsOpen = useComments((state) => state.visible);
  const openThreads = useComments(
    (state) =>
      state.comments.filter((comment) => comment.threadId === comment.id && !comment.resolvedAt)
        .length,
  );
  const layers = useUiPrefs((state) => state.layers);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'menu' | 'library'>('menu');
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);

  const onBoard = status !== null;
  const library = editable || canExport;
  const run = (action: () => void) => () => {
    action();
    setOpen(false);
  };

  return (
    <div className={menu.wrap} ref={ref}>
      <button
        type="button"
        className={menu.trigger}
        aria-expanded={open}
        aria-haspopup="menu"
        data-active={historyOpen || commentsOpen || undefined}
        data-testid="tools-menu"
        onClick={() => {
          setView('menu');
          setOpen((current) => !current);
        }}
      >
        Tools{openThreads > 0 ? <span className={styles.count}>{openThreads}</span> : null}
      </button>
      {open && view === 'menu' ? (
        <div className={menu.menu} role="menu">
          {onBoard && editable ? (
            <button
              type="button"
              role="menuitem"
              className={menu.item}
              disabled={status !== 'connected'}
              data-testid="open-history"
              onClick={run(openHistory)}
            >
              <span>Version history</span>
            </button>
          ) : null}
          {onBoard ? (
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={commentsOpen}
              className={menu.item}
              data-testid="open-comments"
              onClick={run(() =>
                useComments.setState({ visible: !commentsOpen, placing: false, draftAt: null }),
              )}
            >
              <span>Comments</span>
              {openThreads > 0 ? <small>{openThreads} open</small> : null}
            </button>
          ) : null}
          {library ? (
            <button
              type="button"
              role="menuitem"
              className={menu.item}
              data-testid="library-menu"
              onClick={() => setView('library')}
            >
              <span>Library</span>
              <small>›</small>
            </button>
          ) : null}
          {editable ? (
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={layers}
              className={menu.item}
              data-testid="toggle-layers"
              onClick={run(toggleLayers)}
            >
              <span>{layers ? 'Hide the object list' : 'Show the object list'}</span>
            </button>
          ) : null}
        </div>
      ) : null}
      {open && view === 'library' ? (
        <div className={`${menu.menu} ${styles.wide}`} role="dialog" aria-label="Library">
          <button
            type="button"
            className={styles.back}
            data-testid="library-back"
            onClick={() => setView('menu')}
          >
            ‹ Library
          </button>
          <LibraryPanel onDone={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
