import { useEffect } from 'react';
import { ACTIONS, GROUPS, keyLabel, keysOf } from '@/input/shortcuts';
import { openSettings } from '@/settings/dialog';
import { useSettings } from '@/settings/settings';
import { useBoardStore } from '@/state/boardStore';
import styles from './ShortcutSheet.module.css';

/** Keys that are not on the list to change: they mean the same thing everywhere. */
const FIXED: Array<{ title: string; rows: Array<[string, string]> }> = [
  {
    title: 'Always',
    rows: [
      ['Space (hold)', 'Pan the board'],
      ['Scroll', 'Pan'],
      ['Ctrl/⌘ scroll', 'Zoom'],
      ['Arrows', 'Nudge 1px (10px with Shift)'],
      ['Esc', 'Put down the selection'],
      ['Ctrl/⌘ C · X · V', 'Copy · Cut · Paste'],
      ['Ctrl/⌘ click', 'Open a link in the words'],
    ],
  },
  {
    title: 'While dragging',
    rows: [
      ['Shift', 'Square, circle or 15° line'],
      ['Shift (pen)', 'Straight line; snaps level or upright when close'],
      ['Ctrl/⌘ (pen)', 'Turn an outline into a shape'],
      ['Shift (resize)', 'Keep the aspect ratio'],
      ['Shift (image)', 'Free the aspect ratio'],
      ['Alt', 'Resize about the centre'],
      ['Ctrl/⌘', 'Ignore snapping'],
    ],
  },
];

/**
 * Every shortcut, as this person has them: the list in `shortcuts.ts`, with whatever
 * they changed in Settings. Actions with no key are left out here; Settings has them.
 */
export function ShortcutSheet() {
  const open = useBoardStore((state) => state.shortcutsOpen);
  const shortcuts = useSettings((state) => state.settings.shortcuts);
  const close = () => useBoardStore.setState({ shortcutsOpen: false });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') useBoardStore.setState({ shortcutsOpen: false });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;

  const groups = [
    ...GROUPS.map((title) => ({
      title,
      rows: ACTIONS.filter((each) => each.group === title)
        .map((each): [string, string] => [
          keysOf(each.id, shortcuts).map(keyLabel).join(' · '),
          each.label,
        ])
        .filter(([keys]) => keys !== ''),
    })),
    ...FIXED,
  ].filter((group) => group.rows.length > 0);

  return (
    <div className={styles.backdrop} data-hud onClick={close} data-testid="shortcut-sheet">
      <div
        className={styles.sheet}
        role="dialog"
        aria-label="Keyboard shortcuts"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Keyboard shortcuts</h2>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.change}
              data-testid="sheet-change-shortcuts"
              onClick={() => {
                close();
                openSettings('shortcuts');
              }}
            >
              Change shortcuts
            </button>
            <button type="button" className={styles.close} onClick={close} aria-label="Close">
              ✕
            </button>
          </div>
        </header>

        <div className={styles.columns}>
          {groups.map((group) => (
            <section key={group.title} className={styles.group}>
              <h3 className={styles.groupTitle}>{group.title}</h3>
              <dl className={styles.rows}>
                {group.rows.map(([keys, label]) => (
                  <div key={label} className={styles.row}>
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
