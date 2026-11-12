import { useEffect, useState } from 'react';
import { loadRecordingFolder } from '@/recording/folder';
import { clockText, recoverRecording, useRecorder } from '@/recording/recorder';
import { discardRecordingFiles, unsavedRecordings, type Unsaved } from '@/recording/recovery';
import styles from './RecoveryNotice.module.css';

/**
 * A recording left on this computer without its files saved — the tab, the browser or
 * the computer stopped, or the files were never downloaded — offered back the next time
 * Sabboura opens, wherever it opens.
 */
export function RecoveryNotice() {
  const state = useRecorder((current) => current.state);
  const [left, setLeft] = useState<Unsaved[]>([]);
  const [again, setAgain] = useState(0);

  useEffect(() => {
    void loadRecordingFolder();
  }, []);

  useEffect(() => {
    if (state !== 'idle') return;
    let alive = true;
    void unsavedRecordings()
      .then((found) => {
        if (alive) setLeft(found);
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [state, again]);

  const first = left[0];
  if (state !== 'idle' || !first) return null;
  const when = new Date(first.startedAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <aside className={styles.notice} role="alert" data-testid="recording-recovery">
      <p className={styles.text}>
        A recording from <strong>{when}</strong>
        {first.length ? ` (${clockText(first.length * 1000)})` : ''} was not saved. It is still on
        this computer.
        {left.length > 1 ? ` ${left.length - 1} more after it.` : ''}
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.recover}
          data-testid="recording-recover"
          onClick={() => void recoverRecording(first)}
        >
          Recover
        </button>
        <button
          type="button"
          className={styles.delete}
          data-testid="recording-recovery-delete"
          onClick={() => {
            if (!window.confirm('Delete this recording? It cannot be brought back.')) return;
            void discardRecordingFiles(first.id).then(() => setAgain((count) => count + 1));
          }}
        >
          Delete
        </button>
      </div>
    </aside>
  );
}
