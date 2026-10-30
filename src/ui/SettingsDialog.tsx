import { useEffect } from 'react';
import { isRecordingShortcut } from '@/input/shortcuts';
import { closeSettings, useSettingsDialog } from '@/settings/dialog';
import { SettingsPanel } from './SettingsPanel';
import styles from './Settings.module.css';

/** Settings over the board: change a shortcut, close, and it works at once. */
export function SettingsDialog() {
  const open = useSettingsDialog((state) => state.open);
  const section = useSettingsDialog((state) => state.section);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isRecordingShortcut()) closeSettings();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className={styles.backdrop} data-hud onClick={closeSettings}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-label="Settings"
        data-testid="settings-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.dialogHead}>
          <h1 className={styles.title}>Settings</h1>
          <button
            type="button"
            className={styles.close}
            aria-label="Close settings"
            data-testid="settings-close"
            onClick={closeSettings}
          >
            ✕
          </button>
        </header>
        <SettingsPanel section={section} />
      </div>
    </div>
  );
}
