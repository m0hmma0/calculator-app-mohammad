import { useCallback, useEffect, useRef } from 'react';
import { useCanvas2D, type CanvasFrame } from '@/canvas/useCanvas2D';
import { getCanvasColors } from '@/canvas/theme';
import { centerOn, visibleBounds, type Size } from '@/canvas/viewport';
import { expandRect, type Point, type Rect } from '@/geometry';
import { sceneBounds, type DemoShape } from '@/scene/demoScene';
import { useBoardStore } from '@/state/boardStore';
import styles from './Minimap.module.css';

interface Projection {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const MAP_PADDING = 0.9;

function project(bounds: Rect, size: Size): Projection {
  const scale =
    Math.min(size.width / Math.max(bounds.w, 1), size.height / Math.max(bounds.h, 1)) * MAP_PADDING;
  return {
    scale,
    offsetX: size.width / 2 - (bounds.x + bounds.w / 2) * scale,
    offsetY: size.height / 2 - (bounds.y + bounds.h / 2) * scale,
  };
}

const toMap = (p: Projection, x: number, y: number): Point => ({
  x: x * p.scale + p.offsetX,
  y: y * p.scale + p.offsetY,
});

const toBoard = (p: Projection, x: number, y: number): Point => ({
  x: (x - p.offsetX) / p.scale,
  y: (y - p.offsetY) / p.scale,
});

/**
 * Content is painted once into an offscreen canvas and blitted afterwards: at 5,000
 * shapes, redrawing the map every frame of a pan would cost more than the board itself.
 */
function paintContentCache(
  shapes: readonly DemoShape[],
  bounds: Rect,
  size: Size,
  dpr: number,
  color: string,
): HTMLCanvasElement {
  const cache = document.createElement('canvas');
  cache.width = Math.max(1, Math.round(size.width * dpr));
  cache.height = Math.max(1, Math.round(size.height * dpr));

  const ctx = cache.getContext('2d');
  if (!ctx) return cache;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const projection = project(bounds, size);

  ctx.globalAlpha = 0.55;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (const shape of shapes) {
    const topLeft = toMap(projection, shape.x, shape.y);
    ctx.rect(
      topLeft.x,
      topLeft.y,
      Math.max(1, shape.w * projection.scale),
      Math.max(1, shape.h * projection.scale),
    );
  }
  ctx.fill();

  return cache;
}

export function Minimap() {
  const hasShapes = useBoardStore((state) => state.shapes.length > 0);
  const cacheRef = useRef<{ canvas: HTMLCanvasElement; key: string } | null>(null);

  const draw = useCallback((ctx: CanvasRenderingContext2D, frame: CanvasFrame) => {
    const host = ctx.canvas.parentElement;
    if (!host) return;

    const colors = getCanvasColors(host);
    const { shapes, sceneVersion, viewport, stageSize } = useBoardStore.getState();

    ctx.clearRect(0, 0, frame.width, frame.height);

    const bounds = sceneBounds(shapes);
    if (!bounds) return;

    const padded = expandRect(bounds, Math.max(bounds.w, bounds.h) * 0.04);
    const key = `${sceneVersion}:${Math.round(frame.width)}x${Math.round(frame.height)}:${frame.dpr}:${colors.minimapFill}`;

    if (cacheRef.current?.key !== key) {
      cacheRef.current = {
        key,
        canvas: paintContentCache(shapes, padded, frame, frame.dpr, colors.minimapFill),
      };
    }
    ctx.drawImage(cacheRef.current.canvas, 0, 0, frame.width, frame.height);

    // Where the board is looking right now.
    const projection = project(padded, frame);
    const view = visibleBounds(viewport, stageSize);
    const topLeft = toMap(projection, view.x, view.y);

    ctx.save();
    ctx.strokeStyle = colors.minimapViewport;
    ctx.fillStyle = colors.minimapViewport;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(topLeft.x, topLeft.y, view.w * projection.scale, view.h * projection.scale);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(topLeft.x, topLeft.y, view.w * projection.scale, view.h * projection.scale);
    ctx.restore();
  }, []);

  const { canvasRef, redraw } = useCanvas2D(draw);

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

  const jumpTo = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const host = event.currentTarget;
    const rect = host.getBoundingClientRect();
    const { shapes, viewport, stageSize, setViewport } = useBoardStore.getState();

    const bounds = sceneBounds(shapes);
    if (!bounds) return;

    const padded = expandRect(bounds, Math.max(bounds.w, bounds.h) * 0.04);
    const projection = project(padded, { width: rect.width, height: rect.height });
    const target = toBoard(projection, event.clientX - rect.left, event.clientY - rect.top);

    setViewport(centerOn(viewport, stageSize, target));
  }, []);

  if (!hasShapes) return null;

  return (
    <div
      className={styles.wrapper}
      data-testid="minimap"
      role="button"
      tabIndex={0}
      aria-label="Minimap — click to move the view"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        jumpTo(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) jumpTo(event);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
    >
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
}
