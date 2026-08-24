import { useCallback, useEffect, useRef } from 'react';
import { drawGrid } from '@/canvas/grid';
import { renderScene } from '@/canvas/renderScene';
import { getCanvasColors } from '@/canvas/theme';
import { useCanvas2D, type CanvasFrame } from '@/canvas/useCanvas2D';
import { usePanZoom } from '@/input/usePanZoom';
import { effectiveTool, useBoardStore, type RenderStatsSnapshot } from '@/state/boardStore';
import { DevPanel } from './DevPanel';
import { Minimap } from './Minimap';
import { ZoomControls } from './ZoomControls';
import styles from './CanvasStage.module.css';

const STATS_INTERVAL_MS = 250;

export function CanvasStage() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const frameTimes = useRef<number[]>([]);
  const lastReport = useRef(0);
  const pendingStats = useRef<RenderStatsSnapshot | null>(null);
  const trailingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tool = useBoardStore((state) => effectiveTool(state));
  const panning = useBoardStore((state) => state.panning);
  const devPanelOpen = useBoardStore((state) => state.devPanelOpen);
  const isEmpty = useBoardStore((state) => state.shapes.length === 0);

  const draw = useCallback((ctx: CanvasRenderingContext2D, frame: CanvasFrame) => {
    const host = ctx.canvas.parentElement;
    if (!host) return;

    const startedAt = performance.now();
    const colors = getCanvasColors(host);
    const store = useBoardStore.getState();

    // The stage measures itself here, so "zoom to fit" and the minimap know the size.
    store.setStageSize({ width: frame.width, height: frame.height });
    const { viewport, shapes } = store;

    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, frame.width, frame.height);

    drawGrid(ctx, viewport, frame, colors.dot, frame.dpr);
    const { visible } = renderScene(ctx, viewport, frame, shapes, colors.shapes);

    // Frames drawn in the last second — genuine fps while interacting, zero when idle,
    // because there is nothing to redraw when nothing is moving.
    const finishedAt = performance.now();
    const times = frameTimes.current;
    times.push(finishedAt);
    while (times.length > 0 && finishedAt - times[0]! > 1000) times.shift();

    pendingStats.current = {
      fps: times.length,
      renderMs: finishedAt - startedAt,
      visible,
    };

    const flush = () => {
      trailingTimer.current = null;
      lastReport.current = performance.now();
      if (pendingStats.current) store.reportStats(pendingStats.current);
    };

    const elapsed = finishedAt - lastReport.current;
    if (elapsed > STATS_INTERVAL_MS) {
      flush();
    } else if (trailingTimer.current === null) {
      // Without a trailing flush the *last* frame of an interaction never reports,
      // leaving the panel showing numbers from mid-gesture.
      trailingTimer.current = setTimeout(flush, STATS_INTERVAL_MS - elapsed);
    }
  }, []);

  useEffect(
    () => () => {
      if (trailingTimer.current !== null) clearTimeout(trailingTimer.current);
    },
    [],
  );

  const { canvasRef, redraw } = useCanvas2D(draw);
  usePanZoom(hostRef);

  // Redraw on camera or scene changes only. Subscribing to everything would loop,
  // because reporting stats is itself a state change.
  useEffect(() => {
    let previousViewport = useBoardStore.getState().viewport;
    let previousVersion = useBoardStore.getState().sceneVersion;

    return useBoardStore.subscribe((state) => {
      if (state.viewport === previousViewport && state.sceneVersion === previousVersion) return;
      previousViewport = state.viewport;
      previousVersion = state.sceneVersion;
      redraw();
    });
  }, [redraw]);

  const cursor = tool === 'hand' ? (panning ? 'grabbing' : 'grab') : 'default';

  return (
    <div ref={hostRef} className={styles.stage} data-cursor={cursor} data-testid="stage">
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        role="img"
        aria-label="Whiteboard canvas"
        data-testid="board-canvas"
      />

      {isEmpty ? (
        <div className={styles.empty}>
          <div className={styles.card}>
            <p className={styles.eyebrow}>Phase 1 · infinite canvas</p>
            <h2 className={styles.title}>Pan and zoom anywhere</h2>
            <p className={styles.body}>
              Scroll to pan, <span className={styles.key}>⌘</span>-scroll to zoom, hold{' '}
              <span className={styles.key}>Space</span> to drag the board. Open the renderer panel
              from the top bar to drop a few thousand shapes in and watch it hold 60fps.
            </p>
          </div>
        </div>
      ) : null}

      <div className={styles.hud} data-hud>
        <Minimap />
        <ZoomControls />
      </div>

      {devPanelOpen ? <DevPanel /> : null}
    </div>
  );
}
