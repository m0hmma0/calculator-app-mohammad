import { useEffect, useRef, useState } from 'react';
import { selectCanEdit, useBoardAccess } from '@/sharing/boardAccess';
import { importFile, useImport } from '@/importers/importFile';
import { insertCode, insertStamp, insertTable, STAMPS } from '@/input/insertions';
import styles from './InsertMenu.module.css';

export function InsertMenu() {
  const editable = useBoardAccess(selectCanEdit);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const importStatus = useImport((state) => state.status);
  const importError = useImport((state) => state.error);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  if (!editable) return null;
  const run = (action: () => void) => () => {
    action();
    setOpen(false);
  };

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="insert-menu"
        onClick={() => setOpen((current) => !current)}
      >
        Insert
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".svg,image/svg+xml,.pdf,application/pdf"
        hidden
        data-testid="import-file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void importFile(file);
        }}
      />
      {importStatus || importError ? (
        <span
          className={styles.status}
          data-error={importError ? true : undefined}
          role="status"
          data-testid="import-status"
        >
          {importStatus ?? importError}
          {importError ? (
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => useImport.setState({ error: null })}
            >
              ×
            </button>
          ) : null}
        </span>
      ) : null}
      {open ? (
        <div className={styles.menu} role="menu">
          <button
            type="button"
            role="menuitem"
            data-testid="insert-table"
            onClick={run(insertTable)}
          >
            Table
          </button>
          <button type="button" role="menuitem" data-testid="insert-code" onClick={run(insertCode)}>
            Code block
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="insert-import"
            onClick={() => {
              fileRef.current?.click();
              setOpen(false);
            }}
          >
            Import SVG or PDF…
          </button>
          <p className={styles.label}>Stamps</p>
          <div className={styles.stamps}>
            {STAMPS.map((stamp) => (
              <button
                key={stamp}
                type="button"
                role="menuitem"
                aria-label={`Stamp ${stamp}`}
                data-testid={`insert-stamp-${stamp}`}
                onClick={run(() => insertStamp(stamp))}
              >
                {stamp}
              </button>
            ))}
          </div>
          <p className={styles.hint}>Paste a link for a video or a preview card.</p>
        </div>
      ) : null}
    </div>
  );
}
