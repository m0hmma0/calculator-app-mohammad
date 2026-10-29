import { formatZoom } from '@/canvas/viewport';
import { useBoardStore } from '@/state/boardStore';
import styles from './ZoomControls.module.css';

/**
 * Out, the zoom (which resets to 100%), and in. Zooming to fit everything has no
 * button of its own — Shift 1 does it, and every board opens that way.
 * `embedded`: part of the board's controls, without a frame of its own.
 */
export function ZoomControls({ embedded = false }: { embedded?: boolean }) {
  // Selecting the number, not the viewport object: panning must not re-render this.
  const zoom = useBoardStore((state) => state.viewport.zoom);
  const zoomStep = useBoardStore((state) => state.zoomStep);
  const zoomTo100 = useBoardStore((state) => state.zoomTo100);

  return (
    <div
      className={embedded ? `${styles.controls} ${styles.embedded}` : styles.controls}
      role="group"
      aria-label="Zoom"
    >
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
    </div>
  );
}
