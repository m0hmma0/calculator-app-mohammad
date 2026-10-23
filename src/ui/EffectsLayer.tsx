import { useEffect, useRef, type CSSProperties } from 'react';
import { DURATION, EFFECTS, useEffectsStore, type EffectKind } from '@/fun/effects';
import styles from './EffectsLayer.module.css';

const COLOURS = ['#ff4d6d', '#ffb703', '#06d6a0', '#118ab2', '#8338ec', '#fb5607', '#ffd6e0'];

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  spin: number;
  angle: number;
  colour: string;
  phase: number;
}

/**
 * Confetti or bubbles, drawn on a canvas of its own over the board: a few hundred
 * pieces moved by hand each frame, which is all either needs.
 */
function Particles({
  kind,
  delay = 0,
  length,
}: {
  kind: 'confetti' | 'bubbles';
  delay?: number;
  length: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.scale(ratio, ratio);

    const random = (low: number, high: number) => low + Math.random() * (high - low);
    const pieces: Particle[] = [];
    if (kind === 'confetti') {
      // Two cannons in the bottom corners, aimed up and inwards.
      for (let index = 0; index < 260; index += 1) {
        const left = index % 2 === 0;
        const angle = (left ? -1 : -1) * random(Math.PI * 0.28, Math.PI * 0.46);
        const speed = random(11, 21);
        pieces.push({
          x: left ? 0 : width,
          y: height,
          vx: Math.cos(angle) * speed * (left ? 1 : -1),
          vy: Math.sin(angle) * speed,
          size: random(6, 12),
          spin: random(-0.3, 0.3),
          angle: random(0, Math.PI),
          colour: COLOURS[index % COLOURS.length]!,
          phase: random(0, Math.PI * 2),
        });
      }
    } else {
      for (let index = 0; index < 46; index += 1) {
        pieces.push({
          x: random(0, width),
          y: height + random(20, height * 0.8),
          vx: 0,
          vy: -random(1.4, 3.4),
          size: random(10, 42),
          spin: random(0.02, 0.05),
          angle: 0,
          colour: COLOURS[index % COLOURS.length]!,
          phase: random(0, Math.PI * 2),
        });
      }
    }

    let frame = 0;
    let started: number | null = null;
    let last = 0;
    const step = (now: number) => {
      started ??= now + delay;
      const elapsed = now - started;
      const dt = Math.min(2, (now - (last || now)) / 16.7);
      last = now;
      ctx.clearRect(0, 0, width, height);
      if (elapsed >= 0) {
        const fade = Math.min(1, Math.max(0, (length - elapsed) / 600));
        ctx.globalAlpha = fade;
        for (const piece of pieces) {
          if (kind === 'confetti') {
            piece.vy += 0.32 * dt;
            piece.vx *= 0.99;
            piece.vy *= 0.99;
            piece.x += piece.vx * dt + Math.sin(piece.phase + elapsed / 180) * 0.6;
            piece.y += piece.vy * dt;
            piece.angle += piece.spin * dt;
            ctx.save();
            ctx.translate(piece.x, piece.y);
            ctx.rotate(piece.angle);
            ctx.scale(1, Math.abs(Math.cos(piece.phase + elapsed / 120)) + 0.2);
            ctx.fillStyle = piece.colour;
            ctx.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
            ctx.restore();
          } else {
            piece.y += piece.vy * dt;
            piece.phase += piece.spin * dt;
            const x = piece.x + Math.sin(piece.phase) * 14;
            const gradient = ctx.createRadialGradient(
              x - piece.size * 0.3,
              piece.y - piece.size * 0.3,
              piece.size * 0.1,
              x,
              piece.y,
              piece.size,
            );
            gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
            gradient.addColorStop(0.6, `${piece.colour}33`);
            gradient.addColorStop(1, `${piece.colour}66`);
            ctx.beginPath();
            ctx.arc(x, piece.y, piece.size, 0, Math.PI * 2);
            ctx.fillStyle = gradient;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = 'rgba(255,255,255,0.7)';
            ctx.stroke();
          }
        }
      }
      if (elapsed < length) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [kind, delay, length]);

  return <canvas ref={ref} className={styles.canvas} aria-hidden="true" />;
}

function Scene({ kind }: { kind: EffectKind }) {
  const length = DURATION[kind];
  switch (kind) {
    case 'confetti':
      return <Particles kind="confetti" length={length} />;
    case 'bubbles':
      return <Particles kind="bubbles" length={length} />;
    case 'drumroll':
      return (
        <>
          <div className={styles.spotlight} />
          <div className={styles.centre}>
            <span className={`${styles.big} ${styles.drum}`}>🥁</span>
            <span className={styles.caption}>Drum roll…</span>
            <span className={`${styles.caption} ${styles.reveal}`}>Ta-da!</span>
          </div>
          <Particles kind="confetti" delay={2400} length={length - 2400} />
        </>
      );
    case 'micdrop':
      return (
        <div className={`${styles.centre} ${styles.shake}`}>
          <span className={`${styles.big} ${styles.fall}`}>🎤</span>
          <span className={`${styles.caption} ${styles.late}`}>Mic drop.</span>
        </div>
      );
    case 'quiet':
      return (
        <>
          <div className={styles.dim} />
          <div className={styles.centre}>
            <span className={`${styles.big} ${styles.pop}`}>🤫</span>
            <span className={styles.caption}>Shh…</span>
          </div>
        </>
      );
    case 'curtain':
      return (
        <>
          <div className={`${styles.curtain} ${styles.curtainLeft}`} />
          <div className={`${styles.curtain} ${styles.curtainRight}`} />
          <div className={`${styles.centre} ${styles.bravo}`}>
            <span className={styles.caption}>👏 Bravo! 👏</span>
          </div>
        </>
      );
    case 'applause':
      return (
        <>
          {Array.from({ length: 26 }, (_, index) => (
            <span
              key={index}
              className={styles.floater}
              style={
                {
                  left: `${(index * 37) % 100}%`,
                  animationDelay: `${(index % 9) * 0.18}s`,
                  fontSize: `${28 + ((index * 13) % 30)}px`,
                } as CSSProperties
              }
            >
              👏
            </span>
          ))}
        </>
      );
  }
}

/**
 * The celebration playing now, over the board — for everyone on it at once. It lets
 * every click through and goes away by itself.
 */
export function EffectsLayer() {
  const playing = useEffectsStore((state) => state.playing);
  if (!playing) return null;
  const about = EFFECTS.find((effect) => effect.kind === playing.kind);
  return (
    <div
      key={playing.id}
      className={styles.layer}
      data-present-keep
      data-effect={playing.kind}
      data-testid="celebration"
      role="status"
      aria-label={about ? `${about.emoji} ${about.label}` : undefined}
    >
      {reducedMotion() ? (
        <div className={styles.centre}>
          <span className={styles.big}>{about?.emoji}</span>
          <span className={styles.caption}>{about?.label}</span>
        </div>
      ) : (
        <Scene kind={playing.kind} />
      )}
    </div>
  );
}
