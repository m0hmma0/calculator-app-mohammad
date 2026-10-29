import { useEffect, useLayoutEffect, useRef } from 'react';
import { screenToBoard } from '@/canvas/viewport';
import { usePresence } from '@/collab/presence';
import { pasteFromClipboard } from '@/input/useClipboard';
import { selectCanComment, selectCanEdit, useBoardAccess } from '@/sharing/boardAccess';
import { useComments } from '@/sharing/comments';
import { boardDoc, useBoardStore } from '@/state/boardStore';
import { togglePane, useUiPrefs } from '@/state/uiPrefs';
import styles from './ContextMenu.module.css';

interface Entry {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
  disabled?: boolean;
  separated?: boolean;
}

/** Kept this far inside the board's edges. */
const MARGIN = 6;

export function ContextMenu() {
  const menu = useBoardStore((state) => state.contextMenu);
  const close = useBoardStore((state) => state.closeContextMenu);
  const selection = useBoardStore((state) => state.selection);
  const elements = useBoardStore((state) => state.elements);
  const renderVersion = useBoardStore((state) => state.renderVersion);
  const paneOpen = useUiPrefs((state) => state.pane);
  const editable = useBoardAccess(selectCanEdit);
  const canComment = useBoardAccess(selectCanComment);
  // Comments live on a board with a room; the signed-out board has none.
  const onBoard = usePresence((state) => state.status !== null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menu) return;
    const dismiss = () => close();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu, close]);

  // Opened near an edge, the menu goes the other way — left of the pointer, or up —
  // so none of it is ever off the board.
  useLayoutEffect(() => {
    const node = ref.current;
    const host = node?.offsetParent as HTMLElement | null;
    if (!node || !host || !menu) return;
    const { width, height } = node.getBoundingClientRect();
    const roomX = host.clientWidth - MARGIN;
    const roomY = host.clientHeight - MARGIN;
    const left = menu.x + width > roomX ? Math.max(MARGIN, menu.x - width) : menu.x;
    const top = menu.y + height > roomY ? Math.max(MARGIN, roomY - height) : menu.y;
    node.style.left = `${Math.min(left, Math.max(MARGIN, roomX - width))}px`;
    node.style.top = `${top}px`;
  }, [menu]);

  if (!menu) return null;

  void renderVersion;
  const store = useBoardStore.getState;
  const ids = new Set(selection);
  const chosen = elements.filter((element) => ids.has(element.id));
  const hasSelection = chosen.length > 0;
  const readOnly = boardDoc().readOnly;

  const comment: Entry = {
    id: 'comment',
    label: 'Comment here',
    run: () => {
      const at = screenToBoard(useBoardStore.getState().viewport, menu);
      useComments.setState({
        visible: true,
        placing: false,
        openThread: null,
        draftAt: { x: at.x, y: at.y },
      });
    },
  };
  const commenting = onBoard && canComment ? [comment] : [];

  // Someone who can only comment has one thing to do here.
  const entries: Entry[] = !editable
    ? commenting
    : [
        {
          id: 'copy',
          label: 'Copy',
          hint: '⌘C',
          disabled: !hasSelection,
          run: () => document.execCommand('copy'),
        },
        {
          id: 'paste',
          label: 'Paste',
          hint: '⌘V',
          disabled: readOnly,
          run: () => void pasteFromClipboard(),
        },
        {
          id: 'duplicate',
          label: 'Duplicate',
          hint: '⌘D',
          disabled: !hasSelection,
          run: () => store().duplicateSelection(),
        },
        {
          id: 'delete',
          label: 'Delete',
          hint: 'Del',
          disabled: !hasSelection,
          run: () => store().deleteSelection(),
        },
        {
          id: 'lock',
          label: 'Lock',
          hint: '⇧⌘L',
          separated: true,
          disabled: !chosen.some((element) => !element.locked),
          run: () => store().setSelectionLocked(true),
        },
        {
          id: 'unlock',
          label: 'Unlock',
          disabled: !chosen.some((element) => element.locked),
          run: () => store().setSelectionLocked(false),
        },
        {
          id: 'group',
          label: 'Group',
          hint: '⌘G',
          disabled: chosen.length < 2,
          run: () => store().groupSelection(),
        },
        {
          id: 'ungroup',
          label: 'Ungroup',
          hint: '⇧⌘G',
          disabled: !chosen.some((element) => element.type === 'group'),
          run: () => store().ungroupSelection(),
        },
        ...commenting.map((entry) => ({ ...entry, separated: true })),
        {
          id: 'pane',
          label: paneOpen ? 'Hide the side panel' : 'Side panel',
          separated: true,
          run: togglePane,
        },
      ];
  if (entries.length === 0) return null;

  return (
    <div
      ref={ref}
      className={styles.menu}
      data-hud
      data-testid="context-menu"
      role="menu"
      style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {entries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="menuitem"
          className={`${styles.item} ${entry.separated ? styles.separated : ''}`}
          disabled={entry.disabled}
          data-testid={`menu-${entry.id}`}
          onClick={() => {
            entry.run();
            close();
          }}
        >
          <span>{entry.label}</span>
          {entry.hint ? <kbd className={styles.hint}>{entry.hint}</kbd> : null}
        </button>
      ))}
    </div>
  );
}
