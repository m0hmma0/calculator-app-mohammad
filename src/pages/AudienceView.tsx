import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { renderElements } from '@/canvas/renderElements';
import { renderLaser } from '@/canvas/renderLaser';
import { getCanvasColors } from '@/canvas/theme';
import { useCanvas2D, type CanvasFrame } from '@/canvas/useCanvas2D';
import { boardToScreen, fitToRect, viewportsEqual } from '@/canvas/viewport';
import { usePresence } from '@/collab/presence';
import { REMOTE_ORIGIN, type BoardDoc } from '@/doc/board';
import type { LaserPoint } from '@/laser/laser';
import { isTrailAlive } from '@/laser/laser';
import { openAudienceDocument, useBoardStore } from '@/state/boardStore';
import { useEmbeds } from '@/state/embedStore';
import { EmbedLayer } from '@/ui/EmbedLayer';
import { EffectsLayer } from '@/ui/EffectsLayer';
import { SlideTransition } from '@/ui/SlideTransition';
import type { AudienceHooks, FromAudience, ToAudience } from '@/workshop/audience';
import { cameraRadius, cameraRect, type CameraLayout } from '@/recording/camera';
import { usePresentation } from '@/workshop/presentation';
import { usePages } from '@/webpage/pageStore';
import styles from './AudienceView.module.css';

/** Around the slide: dark, as on the presenter's screen. */
const SURROUND = '#101217';
/** The pointer hides after this long without moving. */
const CURSOR_IDLE_MS = 1500;
/** No answer from a presenter in this long, and the window says how to start one. */
const LONELY_MS = 2500;

interface Trail {
  points: LaserPoint[];
  lifetimeMs: number;
  color?: string;
}

/**
 * The audience window: the slide on show, filling the window, and nothing else — no
 * controls, nothing to press. It follows the presenter's window (`src/workshop/
 * audience.ts`) and cannot steer it. A double-click, or F, fills the screen.
 */
export function AudienceView({ channelName }: { channelName: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const trails = useRef<Trail[]>([]);
  const [heard, setHeard] = useState(false);
  const [lonely, setLonely] = useState(false);
  const [idle, setIdle] = useState(false);
  const [camera, setCamera] = useState<CameraLayout | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const frameId = usePresentation((state) => state.frame);
  const onShow = useBoardStore((state) =>
    frameId ? state.elements.some((element) => element.id === frameId) : false,
  );
  const redrawRef = useRef<() => void>(() => {});

  const draw = useCallback((ctx: CanvasRenderingContext2D, frame: CanvasFrame) => {
    const host = ctx.canvas.parentElement;
    if (!host) return;
    const store = useBoardStore.getState();
    store.setStageSize({ width: frame.width, height: frame.height });
    ctx.fillStyle = SURROUND;
    ctx.fillRect(0, 0, frame.width, frame.height);

    const id = usePresentation.getState().frame;
    const shown = id ? store.elements.find((element) => element.id === id) : undefined;
    if (!shown) return;
    // The camera is set from the size below; until it is, nothing is drawn askew.
    const viewport = fitToRect(shown, frame, 0);
    if (!viewportsEqual(viewport, store.viewport)) {
      store.setViewport(viewport);
      return;
    }
    const colors = getCanvasColors(host);
    const corner = boardToScreen(viewport, { x: shown.x, y: shown.y });
    ctx.save();
    ctx.beginPath();
    ctx.rect(corner.x, corner.y, shown.w * viewport.zoom, shown.h * viewport.zoom);
    ctx.clip();
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, frame.width, frame.height);
    renderElements(ctx, viewport, frame, store.elements, colors, redrawRef.current, shown.id);
    const now = performance.now();
    for (const trail of trails.current) {
      renderLaser(ctx, viewport, trail.points, trail.lifetimeMs, now, colors, trail.color);
    }
    ctx.restore();
  }, []);

  const { canvasRef, redraw } = useCanvas2D(draw);
  useEffect(() => {
    redrawRef.current = redraw;
  }, [redraw]);

  // The board, the slide and the rest, from the presenter's window.
  useEffect(() => {
    const board: BoardDoc = openAudienceDocument();
    // Never the presenter: nothing here may be presented from or followed.
    usePresentation.setState({ presenting: true, frame: null });
    const channel = new BroadcastChannel(channelName);
    const say = (message: FromAudience) => channel.postMessage(message);
    let laserFrame = 0;
    const pumpLaser = () => {
      laserFrame = 0;
      redraw();
      const now = performance.now();
      const alive = trails.current.some((trail) =>
        isTrailAlive(trail.points, { now, lifetimeMs: trail.lifetimeMs }),
      );
      if (alive) laserFrame = requestAnimationFrame(pumpLaser);
    };

    const onMessage = (event: MessageEvent<ToAudience>) => {
      const message = event.data;
      setHeard(true);
      switch (message.t) {
        case 'state': {
          document.title = `${message.title} — slides`;
          usePresence.setState({ clockOffset: message.clockOffset });
          // The board's web pages show what the presenter does in them.
          usePages.setState({ forcedViewer: message.person });
          useEmbeds.setState({ started: message.started });
          if (useBoardStore.getState().page !== message.page) {
            useBoardStore.getState().setPage(message.page);
          }
          usePresentation.setState({ frame: message.frame });
          setCamera(message.camera);
          redraw();
          break;
        }
        case 'doc':
          Y.applyUpdate(board.doc, message.update, REMOTE_ORIGIN);
          break;
        case 'laser': {
          const now = performance.now();
          trails.current = message.trails.map((trail) => ({
            lifetimeMs: trail.lifetimeMs,
            color: trail.color,
            points: trail.points.map((point) => ({ x: point.x, y: point.y, at: now - point.age })),
          }));
          if (laserFrame === 0) laserFrame = requestAnimationFrame(pumpLaser);
          break;
        }
        case 'media':
          followMedia(message, (id) => say({ t: 'media-blocked', id }));
          break;
        case 'close':
          window.close();
          break;
      }
    };
    channel.addEventListener('message', onMessage);
    // The presenter's window hands over its camera's picture through this.
    (window as Window & { sabbouraAudience?: AudienceHooks }).sabbouraAudience = {
      setCamera: setCameraStream,
    };
    // A recording made from the presenter's window can tell this tab from any other.
    try {
      (
        navigator.mediaDevices as MediaDevices & {
          setCaptureHandleConfig?: (config: {
            handle: string;
            exposeOrigin: boolean;
            permittedOrigins: string[];
          }) => void;
        }
      ).setCaptureHandleConfig?.({
        handle: channelName,
        exposeOrigin: true,
        permittedOrigins: [location.origin],
      });
    } catch {
      // Not offered by this browser: the recording takes the tab chosen on trust.
    }
    say({ t: 'hello' });
    const lonely = setTimeout(() => setLonely(true), LONELY_MS);
    const onLeave = () => say({ t: 'gone' });
    window.addEventListener('pagehide', onLeave);
    return () => {
      clearTimeout(lonely);
      if (laserFrame !== 0) cancelAnimationFrame(laserFrame);
      window.removeEventListener('pagehide', onLeave);
      channel.removeEventListener('message', onMessage);
      channel.close();
    };
  }, [channelName, redraw]);

  // Content and camera changes redraw, as on the board.
  useEffect(
    () =>
      useBoardStore.subscribe((state, previous) => {
        if (
          state.renderVersion !== previous.renderVersion ||
          state.viewport !== previous.viewport
        ) {
          redraw();
        }
      }),
    [redraw],
  );

  // Full screen on a double-click or F; nothing else here answers.
  useEffect(() => {
    const toggle = () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      else void document.documentElement.requestFullscreen().catch(() => {});
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'KeyF' && !event.ctrlKey && !event.metaKey && !event.altKey) toggle();
    };
    window.addEventListener('dblclick', toggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('dblclick', toggle);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // The pointer goes once it stops moving, so it is never in a recording by accident.
  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), CURSOR_IDLE_MS);
    const onMove = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), CURSOR_IDLE_MS);
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={styles.audience}
      data-idle={idle || undefined}
      data-testid="audience"
      data-frame={frameId ?? ''}
    >
      <canvas ref={canvasRef} className={styles.canvas} data-testid="audience-canvas" />
      {/* Only over a slide: between slides there is nothing to clip them to. */}
      {onShow ? <EmbedLayer /> : null}
      <SlideTransition source={canvasRef} />
      {onShow && camera && cameraStream ? (
        <AudienceCamera layout={camera} stream={cameraStream} />
      ) : null}
      <EffectsLayer />
      {!heard && lonely ? (
        <p className={styles.lonely} data-testid="audience-lonely">
          This window shows the slides from presenter view. Start presenter view on the board to use
          it.
        </p>
      ) : null}
    </div>
  );
}

/** Plays, pauses and moves a video or sound as the presenter's copy did. */
function followMedia(
  message: Extract<ToAudience, { t: 'media' }>,
  blocked: (id: string) => void,
): void {
  const media = document.querySelector<HTMLMediaElement>(
    `video[data-element-id="${CSS.escape(message.id)}"], audio[data-element-id="${CSS.escape(message.id)}"]`,
  );
  if (!media) return;
  if (media.playbackRate !== message.rate) media.playbackRate = message.rate;
  // Close enough is left alone: nudging a playing video makes it stutter.
  const drift = Math.abs(media.currentTime - message.time);
  if (drift > (message.playing ? 0.4 : 0.05)) media.currentTime = message.time;
  if (message.playing && media.paused) {
    media.play().catch(() => {
      // Not allowed to play with sound unasked: play silently here, heard there.
      media.muted = true;
      void media.play().catch(() => {});
      blocked(message.id);
    });
  } else if (!message.playing && !media.paused) {
    media.pause();
  }
}

/** The presenter's camera, where they put it on the slide. */
function AudienceCamera({ layout, stream }: { layout: CameraLayout; stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const viewport = useBoardStore((state) => state.viewport);
  const frameId = usePresentation((state) => state.frame);
  const frame = useBoardStore((state) => state.elements.find((element) => element.id === frameId));

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
  }, [stream]);

  if (!frame) return null;
  const corner = boardToScreen(viewport, { x: frame.x, y: frame.y });
  const box = cameraRect(layout, {
    x: corner.x,
    y: corner.y,
    w: frame.w * viewport.zoom,
    h: frame.h * viewport.zoom,
  });
  return (
    <video
      ref={ref}
      className={styles.camera}
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        borderRadius: cameraRadius(layout.shape),
      }}
      muted
      playsInline
      autoPlay
      data-testid="audience-camera"
    />
  );
}
