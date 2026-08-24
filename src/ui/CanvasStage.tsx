import { useCallback, useEffect, useRef } from 'react';
import { drawGrid } from '@/canvas/grid';
import { renderElements } from '@/canvas/renderElements';
import { renderOverlay } from '@/canvas/renderOverlay';
import { getCanvasColors } from '@/canvas/theme';
import { useCanvas2D, type CanvasFrame } from '@/canvas/useCanvas2D';
import { useCanvasInteraction } from '@/input/useCanvasInteraction';
import { selectionFrame } from '@/model/handles';
import { useBoardStore, type RenderStatsSnapshot } from '@/state/boardStore';
import { DevPanel } from './DevPanel';
import { Inspector } from './Inspector';
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

  const devPanelOpen = useBoardStore((state) => state.devPanelOpen);
  const isEmpty = useBoardStore((state) => state.elements.length === 0);

  const draw = useCallback((ctx: CanvasRenderingContext2D, frame: CanvasFrame) => {
    const host = ctx.canvas.parentElement;
    if (!host) return;

    const startedAt = performance.now();
    const colors = getCanvasColors(host);
    const store = useBoardStore.getState();

    // The stage measures itself here, so "zoom to fit" and the minimap know the size.
    store.setStageSize({ width: frame.width, height: frame.height });
    const { viewport, elements, draft, selection } = store;

    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, frame.width, frame.height);
    drawGrid(ctx, viewport, frame, colors.dot, frame.dpr);

    const { visible } = renderElements(ctx, viewport, frame, elements, colors);
    if (draft) renderElements(ctx, viewport, frame, [draft], colors);

    const selectedIds = new Set(selection);
    const selected = elements.filter((element) => selectedIds.has(element.id));
    renderOverlay(
      ctx,
      viewport,
      frame,
      {
        selected,
        frame: selectionFrame(selected),
        marquee: store.marquee,
        guides: store.guides,
        spacing: store.spacing,
        rotationReadout: store.rotationReadout,
        lockedSelection: selected.length > 0 && selected.some((element) => element.locked),
      },
      colors,
    );

    // Frames drawn in the last second — genuine fps while interacting, zero when idle,
    // because there is nothing to redraw when nothing is moving.
    const finishedAt = performance.now();
    const times = frameTimes.current;
    times.push(finishedAt);
    while (times.length > 0 && finishedAt - times[0]! > 1000) times.shift();

    pendingStats.current = { fps: times.length, renderMs: finishedAt - startedAt, visible };

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

  const { canvasRef, redraw } = useCanvas2D(draw);
  useCanvasInteraction(hostRef);

  useEffect(
    () => () => {
      if (trailingTimer.current !== null) clearTimeout(trailingTimer.current);
    },
    [],
  );

  // Redraw on camera or content changes only. Subscribing to everything would loop,
  // because reporting stats is itself a state change.
  useEffect(() => {
    let previousViewport = useBoardStore.getState().viewport;
    let previousVersion = useBoardStore.getState().renderVersion;

    return useBoardStore.subscribe((state) => {
      if (state.viewport === previousViewport && state.renderVersion === previousVersion) return;
      previousViewport = state.viewport;
      previousVersion = state.renderVersion;
      redraw();
    });
  }, [redraw]);

  return (
    <div ref={hostRef} className={styles.stage} data-cursor="default" data-testid="stage">
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
            <p className={styles.eyebrow}>Phase 2 · shapes and selection</p>
            <h2 className={styles.title}>Draw something</h2>
            <p className={styles.body}>
              Press <span className={styles.key}>R</span> for a rectangle,{' '}
              <span className={styles.key}>O</span> for an ellipse,{' '}
              <span className={styles.key}>L</span> or <span className={styles.key}>A</span> for a
              line or arrow. <span className={styles.key}>V</span> selects,{' '}
              <span className={styles.key}>Space</span> pans.
            </p>
          </div>
        </div>
      ) : null}

      <div className={styles.hud} data-hud>
        <Minimap />
        <ZoomControls />
      </div>

      <Inspector />
      {devPanelOpen ? <DevPanel /> : null}
    </div>
  );
}
