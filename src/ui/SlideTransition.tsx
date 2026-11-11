import { useEffect, useRef, type RefObject } from 'react';
import { usePresence } from '@/collab/presence';
import { useBoardStore } from '@/state/boardStore';
import { frameOnShowId } from '@/workshop/onShow';
import { usePresentation } from '@/workshop/presentation';
import { durationOf, isTransition, makePlayer, type Player } from '@/workshop/transitions';
import styles from './SlideTransition.module.css';

/** Frames to wait for the board to draw the arriving slide before taking its picture. */
const SETTLE_FRAMES = 4;

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

function copyOf(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext('2d')!.drawImage(canvas, 0, 0);
  return copy;
}

/**
 * Plays the arriving frame's transition over a board canvas, whenever the frame on
 * show changes from one slide to another: presenting, following a presenter, or in
 * the audience window. The canvas still holds the slide being left at the moment the
 * frame changes (it redraws on the next animation frame), so that picture is taken
 * first; a few frames later, the arriving slide's. Between them, the layer plays.
 * Videos and players on the slide wait, hidden, until it is over.
 */
export function SlideTransition({ source }: { source: RefObject<HTMLCanvasElement | null> }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let shown = frameOnShowId();
    let frame = 0;
    let running = 0;

    const stop = () => {
      cancelAnimationFrame(frame);
      running += 1;
      const overlay = ref.current;
      if (overlay) overlay.hidden = true;
      if (usePresentation.getState().transitioning)
        usePresentation.setState({ transitioning: false });
    };

    const play = (arriving: string) => {
      const board = source.current;
      const overlay = ref.current;
      const element = useBoardStore.getState().elements.find((each) => each.id === arriving);
      const kind = element?.transition;
      if (!board || !overlay || !isTransition(kind) || kind === 'none') return;
      stop();
      const run = running;
      const from = copyOf(board);
      overlay.width = board.width;
      overlay.height = board.height;
      overlay.hidden = false;
      const ctx = overlay.getContext('2d')!;
      ctx.drawImage(from, 0, 0);
      usePresentation.setState({ transitioning: true });

      let waited = 0;
      const settle = () => {
        if (run !== running) return;
        if (waited++ < SETTLE_FRAMES) {
          frame = requestAnimationFrame(settle);
          return;
        }
        // The board was resized meanwhile: no transition rather than a torn one.
        if (board.width !== from.width || board.height !== from.height) return stop();
        let player: Player;
        try {
          player = makePlayer(kind, from, copyOf(board), arriving, reducedMotion());
        } catch {
          return stop();
        }
        const duration = reducedMotion() ? 300 : durationOf(kind);
        const started = performance.now();
        const step = (now: number) => {
          if (run !== running) return;
          const t = Math.min(1, (now - started) / duration);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          ctx.clearRect(0, 0, overlay.width, overlay.height);
          player.draw(ctx, t);
          if (t < 1) frame = requestAnimationFrame(step);
          else stop();
        };
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(settle);
    };

    const check = () => {
      const next = frameOnShowId();
      if (next === shown) return;
      const previous = shown;
      shown = next;
      // From one slide to another; not into a presentation, nor out of one.
      if (previous && next) play(next);
      else stop();
    };
    const stops = [usePresentation.subscribe(check), usePresence.subscribe(check)];
    return () => {
      stops.forEach((each) => each());
      stop();
    };
  }, [source]);

  return <canvas ref={ref} className={styles.layer} hidden data-testid="slide-transition" />;
}
