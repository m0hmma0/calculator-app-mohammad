import { useEffect, useRef, useState } from 'react';
import type { BoardElement } from '@/model/element';
import { useBoardStore } from '@/state/boardStore';
import {
  durationOf,
  isTransition,
  makePlayer,
  TRANSITIONS,
  type TransitionKind,
} from '@/workshop/transitions';
import styles from './TransitionPicker.module.css';

const W = 112;
const H = 63;

/** Two little slides to show each transition on. */
function sample(which: 0 | 1, dpr: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  if (which === 0) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#5b6ee8';
    ctx.beginPath();
    ctx.roundRect(12, 14, 46, 30, 4);
    ctx.fill();
    ctx.fillStyle = '#f59f00';
    ctx.beginPath();
    ctx.arc(82, 32, 15, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const sky = ctx.createLinearGradient(0, 0, W, H);
    sky.addColorStop(0, '#0f172a');
    sky.addColorStop(1, '#7c3aed');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 18px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Next ✦', W / 2, H / 2);
  }
  return canvas;
}

/** A tile's picture: the transition playing on two little slides while pointed at. */
function Preview({ kind, playing }: { kind: TransitionKind; playing: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d')!;
    const from = sample(0, dpr);
    const to = sample(1, dpr);
    if (!playing || kind === 'none') {
      ctx.drawImage(kind === 'none' ? to : from, 0, 0);
      return;
    }
    const player = makePlayer(kind, from, to, kind);
    const duration = durationOf(kind);
    let frame = 0;
    let started = performance.now();
    const step = (now: number) => {
      // Play, hold the new slide a moment, and again.
      let t = (now - started) / duration;
      if (t > 1.6) {
        started = now;
        t = 0;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      player.draw(ctx, Math.min(1, t));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [kind, playing]);

  return <canvas ref={ref} className={styles.preview} aria-hidden="true" />;
}

/**
 * How a presentation arrives at the selected frames: a tile per transition, each
 * showing itself while pointed at. Kept on the frame, so it plays on every screen.
 */
export function TransitionPicker({ frames }: { frames: BoardElement[] }) {
  const applyDiscrete = useBoardStore((state) => state.applyDiscrete);
  const [hovered, setHovered] = useState<TransitionKind | null>(null);
  const current = new Set(
    frames.map((frame) => (isTransition(frame.transition) ? frame.transition : 'none')),
  );
  const chosen = current.size === 1 ? [...current][0]! : null;

  const choose = (kind: TransitionKind) =>
    applyDiscrete(
      new Map(frames.map((frame) => [frame.id, { transition: kind === 'none' ? '' : kind }])),
    );

  return (
    <div className={styles.section} data-testid="transition-picker">
      <p className={styles.label}>
        Transition into {frames.length > 1 ? 'these frames' : 'this frame'}
      </p>
      <div className={styles.grid} role="radiogroup" aria-label="Transition">
        {TRANSITIONS.map((each) => (
          <button
            key={each.kind}
            type="button"
            role="radio"
            aria-checked={chosen === each.kind}
            className={styles.tile}
            title={each.description}
            data-testid={`transition-${each.kind}`}
            onMouseDown={(event) => event.preventDefault()}
            onPointerEnter={() => setHovered(each.kind)}
            onPointerLeave={() => setHovered(null)}
            onFocus={() => setHovered(each.kind)}
            onBlur={() => setHovered(null)}
            onClick={() => choose(each.kind)}
          >
            <Preview kind={each.kind} playing={hovered === each.kind} />
            <span className={styles.name}>{each.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
