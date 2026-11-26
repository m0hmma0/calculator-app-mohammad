import { memo, useEffect, useRef, useState } from 'react';
import { boardToScreen, fitToRect } from '@/canvas/viewport';
import { renderElements } from '@/canvas/renderElements';
import { getCanvasColors } from '@/canvas/theme';
import type { BoardElement } from '@/model/element';

/**
 * A slide as it will look, at any size: the frame alone, drawn by the board's own
 * renderer on the dark surround. Presenter view's next slide, and the remote
 * control's slides.
 */
export const SlidePicture = memo(function SlidePicture({
  frame,
  elements,
  className,
  label,
  testId,
}: {
  frame: BoardElement;
  elements: readonly BoardElement[];
  className?: string;
  label: string;
  testId?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [, redraw] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Drawn again when its box changes size (a divider dragged, a phone turned).
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      const box = canvas.getBoundingClientRect();
      setSize({ width: box.width, height: box.height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, box.width);
    const height = Math.max(1, box.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#101217';
    ctx.fillRect(0, 0, width, height);
    const area = { width, height };
    const viewport = fitToRect(frame, area, 0);
    const colors = getCanvasColors(canvas);
    const corner = boardToScreen(viewport, { x: frame.x, y: frame.y });
    ctx.save();
    ctx.beginPath();
    ctx.rect(corner.x, corner.y, frame.w * viewport.zoom, frame.h * viewport.zoom);
    ctx.clip();
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, width, height);
    // Pictures still loading draw again when they arrive.
    renderElements(ctx, viewport, area, elements, colors, () => redraw((n) => n + 1), frame.id);
    ctx.restore();
  });

  return (
    <canvas
      ref={ref}
      className={className}
      aria-label={label}
      data-testid={testId}
      data-frame={frame.id}
      data-width={Math.round(size.width)}
    />
  );
});
