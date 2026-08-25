import { useEffect } from 'react';
import { useBoardStore } from '@/state/boardStore';
import styles from './ContextMenu.module.css';

interface Entry {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
  disabled?: boolean;
  separated?: boolean;
}

export function ContextMenu() {
  const menu = useBoardStore((state) => state.contextMenu);
  const close = useBoardStore((state) => state.closeContextMenu);
  const selection = useBoardStore((state) => state.selection);
  const elements = useBoardStore((state) => state.elements);
  const renderVersion = useBoardStore((state) => state.renderVersion);

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

  if (!menu) return null;

  void renderVersion;
  const store = useBoardStore.getState;
  const ids = new Set(selection);
  const first = elements.find((element) => ids.has(element.id));
  const hasSelection = selection.length > 0;

  const entries: Entry[] = [
    {
      id: 'copy',
      label: 'Copy',
      hint: '⌘C',
      disabled: !hasSelection,
      run: () => document.execCommand('copy'),
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
      id: 'front',
      label: 'Bring to front',
      hint: '⌘]',
      separated: true,
      disabled: !hasSelection,
      run: () => store().reorderSelection('front'),
    },
    {
      id: 'forward',
      label: 'Bring forward',
      hint: ']',
      disabled: !hasSelection,
      run: () => store().reorderSelection('forward'),
    },
    {
      id: 'backward',
      label: 'Send backward',
      hint: '[',
      disabled: !hasSelection,
      run: () => store().reorderSelection('backward'),
    },
    {
      id: 'back',
      label: 'Send to back',
      hint: '⌘[',
      disabled: !hasSelection,
      run: () => store().reorderSelection('back'),
    },
    {
      id: 'lock',
      label: first?.locked ? 'Unlock' : 'Lock',
      hint: '⇧⌘L',
      separated: true,
      disabled: !hasSelection,
      run: () => store().toggleLockSelection(),
    },
    {
      id: 'group',
      label: 'Group',
      hint: '⌘G',
      disabled: selection.length < 2,
      run: () => store().groupSelection(),
    },
    {
      id: 'select-all',
      label: 'Select all',
      hint: '⌘A',
      separated: true,
      run: () => store().selectAll(),
    },
  ];

  return (
    <div
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
