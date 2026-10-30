import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { shortcutLabel } from '@/input/shortcuts';
import { useSettings } from '@/settings/settings';
import { drawGrid } from '@/canvas/grid';
import { renderElements } from '@/canvas/renderElements';
import { renderLaser } from '@/canvas/renderLaser';
import { renderOverlay } from '@/canvas/renderOverlay';
import { getCanvasColors } from '@/canvas/theme';
import { useCanvas2D, type CanvasFrame } from '@/canvas/useCanvas2D';
import { useCanvasInteraction } from '@/input/useCanvasInteraction';
import { useClipboard } from '@/input/useClipboard';
import { useImageImport } from '@/input/useImageImport';
import { useLibraryDrop } from '@/library/library';
import { useUploads } from '@/media/uploads';
import { useHistory } from '@/collab/history';
import { usePresence } from '@/collab/presence';
import { boardToScreen } from '@/canvas/viewport';
import { frameOnShowId } from '@/workshop/onShow';
import { usePresentation } from '@/workshop/presentation';
import { isTrailAlive } from '@/laser/laser';
import { useShortcuts } from '@/input/useShortcuts';
import { stampCursor } from '@/input/insertions';
import { useUiPrefs } from '@/state/uiPrefs';
import { laserAlive, laserSnapshot, onLaserChange } from '@/laser/laserTrail';
import { selectionFrame } from '@/model/handles';
import { useBoardStore, type RenderStatsSnapshot } from '@/state/boardStore';
import { lockedForMe, selectIsOwner, useBoardAccess } from '@/sharing/boardAccess';
import { CommentPins } from './CommentPins';
import { DevPanel } from './DevPanel';
import { EmbedLayer } from './EmbedLayer';
import { FrameNumbers } from './FrameNumbers';
import { TableCellEditor } from './TableCellEditor';
import { PeersLayer } from './PeersLayer';
import { Inspector } from './Inspector';
import { Minimap } from './Minimap';
import { CommandPalette } from './CommandPalette';
import { ContextMenu } from './ContextMenu';
import { SettingsDialog } from './SettingsDialog';
import { ShortcutSheet } from './ShortcutSheet';
import { StatusBar } from './StatusBar';
import { TextEditor } from './TextEditor';
import { WorkshopLayer } from './WorkshopLayer';
import { EffectsLayer } from './EffectsLayer';
import { ToolOptions } from './ToolOptions';
import styles from './CanvasStage.module.css';

const STATS_INTERVAL_MS = 250;
/** Around the slide while presenting: dark, as a projector's screen is. */
const PRESENT_SURROUND = '#101217';

export function CanvasStage() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const redrawRef = useRef<() => void>(() => {});
  const frameTimes = useRef<number[]>([]);
  const lastReport = useRef(0);
  const pendingStats = useRef<RenderStatsSnapshot | null>(null);
  const trailingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const devPanelOpen = useBoardStore((state) => state.devPanelOpen);
  const viewport = useBoardStore((state) => state.viewport);
  const isEmpty = useBoardStore((state) => state.elements.length === 0);
  const stamp = useBoardStore((state) => state.stamp);
  const minimap = useUiPrefs((state) => state.minimap);
  // The minimap is the owner's: on someone else's board it stays away.
  const owner = useBoardAccess(selectIsOwner);

  const draw = useCallback((ctx: CanvasRenderingContext2D, frame: CanvasFrame) => {
    const host = ctx.canvas.parentElement;
    if (!host) return;

    const startedAt = performance.now();
    const colors = getCanvasColors(host);
    const store = useBoardStore.getState();

    // The stage measures itself here, so "zoom to fit" and the minimap know the size.
    store.setStageSize({ width: frame.width, height: frame.height });
    const { viewport, draft } = store;
    // Scrubbing through history shows the board as it was, and nothing can be edited.
    const preview = useHistory.getState().preview;
    // The text being typed is shown by the editor over it; drawn here as well, the
    // two copies never quite line up and read as a shadow.
    const editing = preview ? null : store.editingId;
    const elements =
      preview ??
      (editing
        ? store.elements.map((element) =>
            element.id === editing ? { ...element, text: '', placeholder: undefined } : element,
          )
        : store.elements);
    const selection = preview ? [] : store.selection;

    // Presenting, or following a presenter: the frame on show, and nothing around it.
    const showId = preview ? null : frameOnShowId();
    const shown = showId ? elements.find((element) => element.id === showId) : undefined;
    if (shown) {
      const corner = boardToScreen(viewport, { x: shown.x, y: shown.y });
      ctx.fillStyle = PRESENT_SURROUND;
      ctx.fillRect(0, 0, frame.width, frame.height);
      ctx.save();
      ctx.beginPath();
      ctx.rect(corner.x, corner.y, shown.w * viewport.zoom, shown.h * viewport.zoom);
      ctx.clip();
      ctx.fillStyle = colors.background;
      ctx.fillRect(0, 0, frame.width, frame.height);
    } else {
      ctx.fillStyle = colors.background;
      ctx.fillRect(0, 0, frame.width, frame.height);
      drawGrid(ctx, viewport, frame, colors.dot, frame.dpr);
    }

    const { visible } = renderElements(
      ctx,
      viewport,
      frame,
      elements,
      colors,
      redrawRef.current,
      shown?.id ?? null,
    );
    if (draft) renderElements(ctx, viewport, frame, [draft], colors, redrawRef.current);
    if (shown) ctx.restore();

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
        // Locked for this person: no handles. Locked for others only (the owner's
        // view): handles, and a padlock to say so.
        lockedSelection: selected.some(lockedForMe),
        lockedForOthers: selected.some((element) => element.locked && !lockedForMe(element)),
      },
      colors,
    );

    // The laser sits above everything, including the selection chrome, because it is
    // a pointer rather than content.
    const trail = laserSnapshot(startedAt);
    if (trail.points.length > 1) {
      renderLaser(ctx, viewport, trail.points, trail.lifetimeMs, startedAt, colors);
    }
    for (const peer of Object.values(usePresence.getState().peers)) {
      if (peer.laser && peer.laser.points.length > 1) {
        renderLaser(
          ctx,
          viewport,
          peer.laser.points,
          peer.laser.lifetimeMs,
          startedAt,
          colors,
          peer.user.color,
        );
      }
    }

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
  useImageImport(hostRef);
  useLibraryDrop(hostRef);
  useClipboard(hostRef);
  // Shortcuts belong to the canvas, not the app shell: wherever a board is on screen
  // — a signed-in board or the local one — the keys work.
  useShortcuts();

  // The draw callback needs to ask for another frame — when an image finishes
  // decoding, and while a laser trail is still fading.
  useEffect(() => {
    redrawRef.current = redraw;
  }, [redraw]);

  // A fading trail has to keep redrawing even though nothing in the store changed.
  useEffect(() => {
    let frame = 0;
    const pump = () => {
      frame = 0;
      redraw();
      if (laserAlive()) frame = requestAnimationFrame(pump);
    };
    const stop = onLaserChange(() => {
      if (frame === 0) frame = requestAnimationFrame(pump);
    });
    return () => {
      stop();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [redraw]);

  // Upload progress lives outside the document, so it needs its own redraws.
  useEffect(() => useUploads.subscribe(() => redraw()), [redraw]);
  useEffect(() => useHistory.subscribe(() => redraw()), [redraw]);
  // Presenting starts and stops without the camera necessarily moving.
  useEffect(() => usePresentation.subscribe(() => redraw()), [redraw]);

  // Someone else's laser fades on this screen too, frame by frame, until it is gone.
  useEffect(() => {
    let frame = 0;
    const peersAlive = () =>
      Object.values(usePresence.getState().peers).some(
        (peer) =>
          peer.laser !== null &&
          isTrailAlive(peer.laser.points, {
            now: performance.now(),
            lifetimeMs: peer.laser.lifetimeMs,
          }),
      );
    const pump = () => {
      frame = 0;
      redraw();
      if (peersAlive()) frame = requestAnimationFrame(pump);
    };
    const stop = usePresence.subscribe((state, previous) => {
      if (state.peers !== previous.peers && frame === 0) frame = requestAnimationFrame(pump);
    });
    return () => {
      stop();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [redraw]);

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
    <div
      ref={hostRef}
      className={styles.stage}
      data-cursor="default"
      data-testid="stage"
      style={{ '--stamp-cursor': stampCursor(stamp) } as CSSProperties}
    >
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        role="img"
        aria-label="Whiteboard canvas"
        data-testid="board-canvas"
      />

      {isEmpty ? (
        <div className={styles.empty} data-present-hide>
          <div className={styles.card}>
            <h2 className={styles.title}>Draw something</h2>
            <EmptyHint />
          </div>
        </div>
      ) : null}

      {minimap && owner ? (
        <div className={styles.hud} data-hud data-present-hide>
          <Minimap />
        </div>
      ) : null}

      <FrameNumbers />
      <EmbedLayer />
      <PeersLayer hostRef={hostRef} />
      <CommentPins />
      <WorkshopLayer />
      <EffectsLayer />
      <ToolOptions />
      <TextEditor viewport={viewport} />
      <TableCellEditor viewport={viewport} />
      <Inspector />
      <ShortcutSheet />
      <SettingsDialog />
      <CommandPalette />
      <ContextMenu />
      <StatusBar />
      {devPanelOpen ? <DevPanel /> : null}
    </div>
  );
}

/** The first keys to know, as this person has them set. */
function EmptyHint() {
  const shortcuts = useSettings((state) => state.settings.shortcuts);
  const key = (id: string) => {
    const label = shortcutLabel(id, shortcuts);
    return label ? (
      <span key={id} className={styles.key}>
        {label}
      </span>
    ) : null;
  };
  const making = ['tool.rect', 'tool.ellipse', 'tool.sticky', 'tool.text']
    .map(key)
    .filter(Boolean)
    .flatMap((node, index) => (index === 0 ? [node] : [' ', node]));
  return (
    <p className={styles.body}>
      Shapes, notes, text and frames are in <strong>Insert</strong>
      {making.length > 0 ? <> — or press {making}</> : null}.{' '}
      {key('tool.pen') ? <>{key('tool.pen')} draws, </> : null}
      {key('tool.select') ? <>{key('tool.select')} selects, </> : null}
      <span className={styles.key}>Space</span> pans.
    </p>
  );
}
