import { useEffect, useRef, useState } from 'react';
import {
  closeHistory,
  nameCheckpoint,
  restorePreview,
  scrubTo,
  useHistory,
} from '@/collab/history';
import styles from './HistoryPanel.module.css';

const SCRUB_MS = 80;

function when(at: number | null): string {
  if (!at) return '';
  return new Date(at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Version history. The slider runs over every change the room has recorded; moving
 * it shows the board as it was then. Restoring makes that the board again — as a new
 * change, so nothing after it is lost and the restore itself can be undone.
 */
export function HistoryPanel() {
  const history = useHistory();
  const [name, setName] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  if (!history.open) return null;

  // Dragging asks for a past state at most this often; the last position always lands.
  const scrub = (seq: number) => {
    pending.current = seq;
    useHistory.setState({ seq });
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (pending.current !== null) scrubTo(pending.current);
    }, SCRUB_MS);
  };

  const position = history.seq ?? history.last;
  const atLatest = position === history.last && !history.preview;

  return (
    <aside className={styles.panel} aria-label="Version history" data-testid="history-panel">
      <header className={styles.head}>
        <h2>Version history</h2>
        <button
          type="button"
          onClick={closeHistory}
          aria-label="Close history"
          data-testid="close-history"
        >
          ×
        </button>
      </header>

      {history.loading && history.last === 0 && !history.preview ? (
        <p className={styles.muted}>Loading…</p>
      ) : (
        <>
          <label className={styles.scrubber}>
            <span className={styles.muted}>
              {history.preview ? `As it was ${when(history.at)}` : 'Now'}
            </span>
            <input
              type="range"
              min={history.first}
              max={Math.max(history.first, history.last)}
              step={1}
              value={position}
              data-testid="history-scrubber"
              aria-label="Point in the board's history"
              onChange={(event) => scrub(Number(event.target.value))}
            />
            <span className={styles.range}>
              <span>{when(history.firstAt)}</span>
              <span>{when(history.lastAt)}</span>
            </span>
          </label>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              disabled={!history.preview || history.loading || atLatest}
              data-testid="restore-version"
              onClick={restorePreview}
            >
              Restore this version
            </button>
            <button type="button" disabled={atLatest} onClick={closeHistory}>
              Back to now
            </button>
          </div>

          <form
            className={styles.name}
            onSubmit={(event) => {
              event.preventDefault();
              nameCheckpoint(name);
              setName('');
            }}
          >
            <input
              value={name}
              maxLength={80}
              placeholder="Name the board as it is now"
              aria-label="Checkpoint name"
              data-testid="checkpoint-name"
              onChange={(event) => setName(event.target.value)}
            />
            <button type="submit" disabled={!name.trim()} data-testid="save-checkpoint">
              Save
            </button>
          </form>

          {history.checkpoints.length > 0 ? (
            <ul className={styles.checkpoints} data-testid="checkpoints">
              {[...history.checkpoints].reverse().map((checkpoint) => (
                <li key={`${checkpoint.seq}:${checkpoint.at}`}>
                  <button
                    type="button"
                    aria-current={
                      history.preview && history.seq === checkpoint.seq ? 'true' : undefined
                    }
                    onClick={() => {
                      useHistory.setState({ seq: checkpoint.seq });
                      scrubTo(checkpoint.seq);
                    }}
                  >
                    <strong>{checkpoint.name}</strong>
                    <span>{when(checkpoint.at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>
              Named versions appear here. Everything else is on the slider.
            </p>
          )}
        </>
      )}
    </aside>
  );
}
