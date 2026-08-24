import { useEffect } from 'react';
import { useBoardStore } from '@/state/boardStore';
import styles from './ShortcutSheet.module.css';

const GROUPS: Array<{ title: string; rows: Array<[string, string]> }> = [
  {
    title: 'Tools',
    rows: [
      ['V', 'Move and select'],
      ['H · Space', 'Pan the board'],
      ['R · O', 'Rectangle · Ellipse'],
      ['L · A', 'Line · Arrow'],
      ['P', 'Pen'],
      ['E', 'Eraser'],
      ['T · N', 'Text · Sticky note'],
      ['F', 'Frame'],
      ['K', 'Laser pointer'],
    ],
  },
  {
    title: 'Editing',
    rows: [
      ['⌘Z · ⇧⌘Z', 'Undo · Redo (Phase 4)'],
      ['⌘D · Alt-drag', 'Duplicate'],
      ['⌘G · ⇧⌘G', 'Group · Ungroup'],
      ['⇧⌘L · ⇧⌘H', 'Lock · Hide'],
      ['[ · ]', 'Send backward · forward'],
      ['⌘[ · ⌘]', 'Send to back · front'],
      ['⌘A · Esc', 'Select all · Deselect'],
      ['Delete', 'Delete selection'],
      ['Arrows', 'Nudge 1px (10px with Shift)'],
    ],
  },
  {
    title: 'View',
    rows: [
      ['Scroll', 'Pan'],
      ['⌘Scroll', 'Zoom'],
      ['⇧1 · ⇧2 · ⇧0', 'Fit · Selection · 100%'],
      ['+ · −', 'Zoom in · out'],
      ['?', 'This sheet'],
    ],
  },
  {
    title: 'While dragging',
    rows: [
      ['Shift', 'Square, circle or 15° line'],
      ['Shift (pen)', 'Straighten the stroke'],
      ['Shift (resize)', 'Keep the aspect ratio'],
      ['Shift (image)', 'Free the aspect ratio'],
      ['Alt', 'Resize about the centre'],
      ['⌘', 'Ignore snapping'],
    ],
  },
];

export function ShortcutSheet() {
  const open = useBoardStore((state) => state.shortcutsOpen);
  const toggle = useBoardStore((state) => state.toggleShortcuts);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') toggle();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, toggle]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} data-hud onClick={toggle} data-testid="shortcut-sheet">
      <div
        className={styles.sheet}
        role="dialog"
        aria-label="Keyboard shortcuts"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Keyboard shortcuts</h2>
          <button type="button" className={styles.close} onClick={toggle} aria-label="Close">
            ✕
          </button>
        </header>

        <div className={styles.columns}>
          {GROUPS.map((group) => (
            <section key={group.title} className={styles.group}>
              <h3 className={styles.groupTitle}>{group.title}</h3>
              <dl className={styles.rows}>
                {group.rows.map(([keys, label]) => (
                  <div key={keys} className={styles.row}>
                    <dt className={styles.keys}>{keys}</dt>
                    <dd className={styles.label}>{label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
