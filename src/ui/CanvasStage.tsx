import { useCallback } from 'react';
import { useCanvas2D, type CanvasFrame } from '@/canvas/useCanvas2D';
import styles from './CanvasStage.module.css';

const DOT_SPACING = 24;

/**
 * Phase 0: a real canvas, correctly sized for the device pixel ratio, painting a
 * fixed dot grid. Phase 1 replaces this draw with a viewport that pans and zooms.
 */
function drawGrid(ctx: CanvasRenderingContext2D, frame: CanvasFrame, host: HTMLElement) {
  const style = getComputedStyle(host);
  const background = style.getPropertyValue('--canvas-bg').trim() || '#ffffff';
  const dot = style.getPropertyValue('--canvas-dot').trim() || '#d0d0d0';

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, frame.width, frame.height);

  // One path, one fill — thousands of separate fill calls would show up on a big screen.
  const size = frame.dpr >= 2 ? 1.5 : 1;
  ctx.beginPath();
  for (let y = DOT_SPACING / 2; y < frame.height; y += DOT_SPACING) {
    for (let x = DOT_SPACING / 2; x < frame.width; x += DOT_SPACING) {
      ctx.rect(x - size / 2, y - size / 2, size, size);
    }
  }
  ctx.fillStyle = dot;
  ctx.fill();
}

export function CanvasStage() {
  const draw = useCallback((ctx: CanvasRenderingContext2D, frame: CanvasFrame) => {
    const host = ctx.canvas.parentElement;
    if (host) drawGrid(ctx, frame, host);
  }, []);

  const { canvasRef } = useCanvas2D(draw);

  return (
    <div className={styles.stage}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        role="img"
        aria-label="Whiteboard canvas, currently empty"
        data-testid="board-canvas"
      />
      <div className={styles.placeholder}>
        <div className={styles.card}>
          <p className={styles.eyebrow}>Phase 0 · skeleton</p>
          <h2 className={styles.title}>The canvas is empty on purpose</h2>
          <p className={styles.body}>
            The app shell, build tooling and test harness are in place. This grid is drawn by the
            real renderer at your screen&rsquo;s pixel density — it just cannot move yet.
          </p>
          <p className={styles.next}>
            <b>Next:</b> Phase 1 adds the infinite viewport — pan, zoom, the minimap, and off-screen
            culling.
          </p>
        </div>
      </div>
    </div>
  );
}
