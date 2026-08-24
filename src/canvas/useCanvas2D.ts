import { useCallback, useEffect, useRef } from 'react';
import { invalidateCanvasColors } from './theme';

export interface CanvasFrame {
  /** CSS pixels, not device pixels — the context is already scaled for you. */
  width: number;
  height: number;
  dpr: number;
}

export type DrawFn = (ctx: CanvasRenderingContext2D, frame: CanvasFrame) => void;

/**
 * Owns the unglamorous half of canvas work: sizing the backing store to the device
 * pixel ratio so nothing looks blurry on a retina screen, redrawing when the element
 * resizes or the colour scheme flips, and coalescing all of that into one animation
 * frame. Returns a ref for the <canvas> and a `redraw` you can call yourself.
 */
export function useCanvas2D(draw: DrawFn) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef(draw);
  const frameRef = useRef(0);

  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  const render = useCallback(() => {
    frameRef.current = 0;

    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Cap at 2: a 3x phone screen triples the fill cost for no visible gain.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = host.getBoundingClientRect();
    const backingWidth = Math.max(1, Math.round(width * dpr));
    const backingHeight = Math.max(1, Math.round(height * dpr));

    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawRef.current(ctx, { width, height, dpr });
  }, []);

  const redraw = useCallback(() => {
    if (frameRef.current === 0) {
      frameRef.current = requestAnimationFrame(render);
    }
  }, [render]);

  useEffect(() => {
    const host = canvasRef.current?.parentElement;
    if (!host) return;

    const observer = new ResizeObserver(redraw);
    observer.observe(host);

    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const onSchemeChange = () => {
      invalidateCanvasColors();
      redraw();
    };
    scheme.addEventListener('change', onSchemeChange);

    redraw();

    return () => {
      observer.disconnect();
      scheme.removeEventListener('change', onSchemeChange);
      if (frameRef.current !== 0) cancelAnimationFrame(frameRef.current);
    };
  }, [redraw]);

  return { canvasRef, redraw };
}
