import { useState } from 'react';
import { formatZoom } from '@/canvas/viewport';
import { useBoardStore } from '@/state/boardStore';
import styles from './DevPanel.module.css';

const COUNTS = [500, 5000, 20000];

/**
 * Not shipped-facing polish — this is the instrument panel that makes the Phase 1
 * performance claim checkable rather than asserted.
 */
/** Thrown while drawing, to show the crash screen and its report. */
function Crash(): never {
  throw new Error('Test crash from the Renderer panel');
}

export function DevPanel() {
  const [crash, setCrash] = useState(false);
  const stats = useBoardStore((state) => state.stats);
  const total = useBoardStore((state) => state.elements.length);
  const zoom = useBoardStore((state) => state.viewport.zoom);
  const loadDemoElements = useBoardStore((state) => state.loadDemoElements);
  const clearBoard = useBoardStore((state) => state.clearBoard);
  const toggleDevPanel = useBoardStore((state) => state.toggleDevPanel);

  return (
    <aside className={styles.panel} data-hud data-present-hide data-testid="dev-panel">
      <p className={styles.heading}>
        Renderer
        <button type="button" className={styles.close} onClick={toggleDevPanel} aria-label="Close">
          ✕
        </button>
      </p>

      <dl className={styles.metrics}>
        <dt>fps</dt>
        <dd data-testid="stat-fps">{stats.fps > 0 ? stats.fps : 'idle'}</dd>
        <dt>frame</dt>
        <dd>{stats.renderMs.toFixed(1)} ms</dd>
        <dt>drawn</dt>
        <dd data-testid="stat-visible">
          {stats.visible.toLocaleString()} / {total.toLocaleString()}
        </dd>
        <dt>zoom</dt>
        <dd>{formatZoom(zoom)}</dd>
      </dl>

      <div className={styles.actions}>
        {COUNTS.map((count) => (
          <button
            key={count}
            type="button"
            className={styles.action}
            onClick={() => loadDemoElements(count)}
            data-testid={`load-${count}`}
          >
            {count.toLocaleString()}
          </button>
        ))}
        <button type="button" className={styles.action} onClick={clearBoard}>
          Clear
        </button>
      </div>

      {/* Phase 18: proves error reports reach the dashboard. */}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.action}
          data-testid="test-error"
          onClick={() => {
            setTimeout(() => {
              throw new Error('Test error from the Renderer panel');
            });
          }}
        >
          Test error
        </button>
        <button
          type="button"
          className={styles.action}
          data-testid="test-crash"
          onClick={() => setCrash(true)}
        >
          Test crash
        </button>
      </div>
      {crash ? <Crash /> : null}
    </aside>
  );
}
