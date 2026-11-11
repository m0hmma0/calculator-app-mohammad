import { useEffect, useRef, type PointerEvent } from 'react';
import { boardToScreen } from '@/canvas/viewport';
import { cameraRadius, cameraRect, setCameraLayout, useCamera } from '@/recording/camera';
import { useBoardStore } from '@/state/boardStore';
import { useFrameOnShow } from '@/workshop/onShow';
import { usePresentation } from '@/workshop/presentation';
import styles from './PresenterCamera.module.css';

/**
 * The camera on the presenter's slide, in presenter view: where it shows in the
 * audience window. Drag it to move it; drag its corner to size it. Its shape is chosen
 * in the recording row.
 */
export function PresenterCamera() {
  const audience = usePresentation((state) => state.audience);
  const stream = useCamera((state) => state.stream);
  const layout = useCamera((state) => state.layout);
  const viewport = useBoardStore((state) => state.viewport);
  const frame = useFrameOnShow();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const gesture = useRef<{
    mode: 'move' | 'size';
    startX: number;
    startY: number;
    from: typeof layout;
  } | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
  }, [stream]);

  if (!audience || !stream || !frame) return null;

  const corner = boardToScreen(viewport, { x: frame.x, y: frame.y });
  const slide = {
    x: corner.x,
    y: corner.y,
    w: frame.w * viewport.zoom,
    h: frame.h * viewport.zoom,
  };
  const box = cameraRect(layout, slide);
  const slideAspect = frame.h / frame.w;

  const begin = (mode: 'move' | 'size', event: PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { mode, startX: event.clientX, startY: event.clientY, from: layout };
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const now = gesture.current;
    if (!now) return;
    const dx = (event.clientX - now.startX) / slide.w;
    const dy = (event.clientY - now.startY) / slide.h;
    if (now.mode === 'move') {
      setCameraLayout({ x: now.from.x + dx, y: now.from.y + dy }, slideAspect);
    } else {
      setCameraLayout({ w: now.from.w + dx }, slideAspect);
    }
  };
  const end = () => {
    gesture.current = null;
  };

  return (
    <div
      className={styles.camera}
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        borderRadius: cameraRadius(layout.shape),
      }}
      data-hud
      title="Drag to move; drag the corner to size"
      data-testid="presenter-camera"
      onPointerDown={(event) => begin('move', event)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <video
        ref={videoRef}
        className={styles.video}
        style={{ borderRadius: cameraRadius(layout.shape) }}
        muted
        playsInline
        autoPlay
      />
      <span
        className={styles.handle}
        aria-label="Size the camera"
        data-testid="presenter-camera-size"
        onPointerDown={(event) => begin('size', event)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
    </div>
  );
}
