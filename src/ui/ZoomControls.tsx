import { formatZoom } from '@/canvas/viewport';
import { useBoardStore } from '@/state/boardStore';
import styles from './ZoomControls.module.css';

export function ZoomControls() {
  // Selecting the number, not the viewport object: panning must not re-render this.
  const zoom = useBoardStore((state) => state.viewport.zoom);
  const zoomStep = useBoardStore((state) => state.zoomStep);
  const zoomTo100 = useBoardStore((state) => state.zoomTo100);
  const zoomToFit = useBoardStore((state) => state.zoomToFit);

  return (
    <div className={styles.controls} role="group" aria-label="Zoom">
      <button
        type="button"
        className={styles.button}
        onClick={() => zoomStep(-1)}
        title="Zoom out (−)"
        aria-label="Zoom out"
      >
        −
      </button>

      <button
        type="button"
        className={`${styles.button} ${styles.readout}`}
        onClick={zoomTo100}
        title="Reset to 100% (Shift 0)"
        data-testid="zoom-readout"
      >
        {formatZoom(zoom)}
      </button>

      <button
        type="button"
        className={styles.button}
        onClick={() => zoomStep(1)}
        title="Zoom in (+)"
        aria-label="Zoom in"
      >
        +
      </button>

      <span className={styles.separator} aria-hidden="true" />

      <button
        type="button"
        className={styles.button}
        onClick={zoomToFit}
        title="Zoom to fit (Shift 1)"
        aria-label="Zoom to fit"
        data-testid="zoom-fit"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
