import { useEffect, useRef, type CSSProperties } from 'react';
import { DURATION, EFFECTS, useEffectsStore, type Effect } from '@/fun/effects';
import { seeded } from '@/fun/random';
import styles from './EffectsLayer.module.css';

/** Colour sets a play picks from; consecutive plays never pick the same variation. */
const PALETTES = [
  ['#ff4d6d', '#ffb703', '#06d6a0', '#118ab2', '#8338ec', '#fb5607', '#ffd6e0'],
  ['#f72585', '#b5179e', '#7209b7', '#4361ee', '#4cc9f0', '#ffd60a'],
  ['#ffbe0b', '#fb5607', '#ff006e', '#ffd6a5', '#fdffb6', '#e9ff70'],
  ['#2ec4b6', '#cbf3f0', '#ffbf69', '#ff9f1c', '#9bf6ff', '#caffbf'],
];

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** How much bigger a pile-up is: one play is 1. */
const boostOf = (level: number) => 1 + 0.5 * (level - 1);

type Shape = 'strip' | 'circle' | 'triangle' | 'star' | 'ribbon';
const SHAPES: Shape[] = ['strip', 'circle', 'triangle', 'star', 'ribbon'];

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
  shape: Shape;
  /** When a firework's spark appears, after the play starts, and how long it lasts. */
  bornAt: number;
  life: number;
}

function drawPiece(ctx: CanvasRenderingContext2D, piece: Particle, flip: number) {
  ctx.scale(1, flip);
  ctx.fillStyle = piece.colour;
  const size = piece.size;
  switch (piece.shape) {
    case 'circle':
      ctx.beginPath();
      ctx.arc(0, 0, size / 2.6, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'triangle':
      ctx.beginPath();
      ctx.moveTo(0, -size / 2);
      ctx.lineTo(size / 2, size / 2);
      ctx.lineTo(-size / 2, size / 2);
      ctx.fill();
      return;
    case 'star': {
      ctx.beginPath();
      for (let point = 0; point < 10; point += 1) {
        const radius = point % 2 === 0 ? size / 2 : size / 5;
        const angle = (point * Math.PI) / 5 - Math.PI / 2;
        ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
      ctx.fill();
      return;
    }
    case 'ribbon':
      ctx.fillRect(-size, -size / 8, size * 2, size / 4);
      return;
    default:
      ctx.fillRect(-size / 2, -size / 4, size, size / 2);
  }
}

/**
 * Confetti, bubbles or fireworks, drawn on a canvas of its own over the board: a few
 * hundred pieces moved by hand each frame, which is all any of them needs. The seed
 * makes a play the same on every screen; the variant picks its colours, its shapes
 * and where it comes from; the level makes a pile-up bigger.
 */
function Particles({
  kind,
  seed,
  variant,
  level,
  delay = 0,
  length,
  from,
}: {
  kind: 'confetti' | 'bubbles' | 'fireworks';
  seed: string;
  variant: number;
  level: number;
  delay?: number;
  length: number;
  from?: 'corners' | 'top' | 'centre';
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

    const random = seeded(`${seed}:${kind}`);
    const between = (low: number, high: number) => low + random() * (high - low);
    const palette = PALETTES[variant % PALETTES.length]!;
    const colour = () => palette[Math.floor(random() * palette.length)]!;
    const boost = boostOf(level);
    const pieces: Particle[] = [];
    const base = {
      spin: 0,
      angle: 0,
      phase: 0,
      bornAt: 0,
      life: Infinity,
      shape: 'strip' as Shape,
    };

    if (kind === 'confetti') {
      // Two or three shapes this time, and one way in: cannons, a shower, a burst.
      const shapes = SHAPES.filter(() => random() < 0.5);
      if (shapes.length === 0) shapes.push(SHAPES[variant % SHAPES.length]!);
      const launch = from ?? (['corners', 'top', 'centre'] as const)[Math.floor(variant / 4) % 3]!;
      const count = Math.round(240 * boost);
      for (let index = 0; index < count; index += 1) {
        const piece: Particle = {
          ...base,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          size: between(6, 12) * (1 + 0.15 * (level - 1)),
          spin: between(-0.3, 0.3),
          angle: between(0, Math.PI),
          colour: colour(),
          phase: between(0, Math.PI * 2),
          shape: shapes[index % shapes.length]!,
        };
        if (launch === 'corners') {
          const left = index % 2 === 0;
          const angle = -between(Math.PI * 0.28, Math.PI * 0.46);
          const speed = between(11, 21);
          piece.x = left ? 0 : width;
          piece.y = height;
          piece.vx = Math.cos(angle) * speed * (left ? 1 : -1);
          piece.vy = Math.sin(angle) * speed;
        } else if (launch === 'top') {
          piece.x = between(0, width);
          piece.y = between(-height * 0.6, -10);
          piece.vx = between(-1.5, 1.5);
          piece.vy = between(1, 4);
        } else {
          const angle = between(0, Math.PI * 2);
          const speed = between(6, 18);
          piece.x = width / 2;
          piece.y = height * 0.45;
          piece.vx = Math.cos(angle) * speed;
          piece.vy = Math.sin(angle) * speed - 6;
        }
        pieces.push(piece);
      }
    } else if (kind === 'bubbles') {
      for (let index = 0; index < Math.round(46 * boost); index += 1) {
        pieces.push({
          ...base,
          x: between(0, width),
          y: height + between(20, height * 0.8),
          vx: 0,
          vy: -between(1.4, 3.4),
          size: between(10, 42),
          spin: between(0.02, 0.05),
          colour: colour(),
          phase: between(0, Math.PI * 2),
        });
      }
    } else {
      // Rockets burst at different heights, one after another; each burst a ring of
      // sparks in one colour that fall and fade.
      const rockets = 3 + (variant % 2) + level * 2;
      for (let rocket = 0; rocket < rockets; rocket += 1) {
        const x = between(width * 0.12, width * 0.88);
        const y = between(height * 0.12, height * 0.5);
        const at = rocket * (length / (rockets + 2)) + between(0, 200);
        const tint = colour();
        const sparks = 60 + Math.round(between(0, 30));
        for (let spark = 0; spark < sparks; spark += 1) {
          const angle = (spark / sparks) * Math.PI * 2 + between(-0.05, 0.05);
          const speed = between(2.2, 5.5);
          pieces.push({
            ...base,
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: between(1.6, 3),
            colour: tint,
            bornAt: at,
            life: between(900, 1500),
          });
        }
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
        for (const piece of pieces) {
          if (kind === 'confetti') {
            ctx.globalAlpha = fade;
            piece.vy += 0.32 * dt;
            piece.vx *= 0.99;
            piece.vy *= 0.99;
            piece.x += piece.vx * dt + Math.sin(piece.phase + elapsed / 180) * 0.6;
            piece.y += piece.vy * dt;
            piece.angle += piece.spin * dt;
            ctx.save();
            ctx.translate(piece.x, piece.y);
            ctx.rotate(piece.angle);
            drawPiece(ctx, piece, Math.abs(Math.cos(piece.phase + elapsed / 120)) + 0.2);
            ctx.restore();
          } else if (kind === 'bubbles') {
            ctx.globalAlpha = fade;
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
          } else {
            const age = elapsed - piece.bornAt;
            if (age < 0 || age > piece.life) continue;
            piece.vy += 0.05 * dt;
            piece.vx *= 0.985;
            piece.vy *= 0.985;
            piece.x += piece.vx * dt;
            piece.y += piece.vy * dt;
            ctx.globalAlpha = Math.max(0, 1 - age / piece.life) * fade;
            ctx.fillStyle = piece.colour;
            ctx.beginPath();
            ctx.arc(piece.x, piece.y, piece.size, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      }
      if (elapsed < length) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [kind, seed, variant, level, delay, length, from]);

  return <canvas ref={ref} className={styles.canvas} aria-hidden="true" />;
}

/** Emoji rising from the bottom, spread across the width: applause, balloons, hearts. */
function Floaters({
  seed,
  emoji,
  count,
  level,
  hue,
  rise = 'floater',
}: {
  seed: string;
  emoji: readonly string[];
  count: number;
  level: number;
  hue?: boolean;
  rise?: 'floater' | 'drift';
}) {
  const random = seeded(`${seed}:floaters`);
  const total = Math.round(count * boostOf(level));
  return (
    <>
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={styles[rise]}
          style={
            {
              left: `${random() * 96}%`,
              animationDelay: `${random() * 1.6}s`,
              fontSize: `${(28 + random() * 30) * (1 + 0.12 * (level - 1))}px`,
              filter: hue ? `hue-rotate(${Math.round(random() * 360)}deg)` : undefined,
            } as CSSProperties
          }
        >
          {emoji[index % emoji.length]}
        </span>
      ))}
    </>
  );
}

/** One line, picked by the variation: the same play says the same thing everywhere. */
const pick = <T,>(choices: readonly T[], variant: number): T => choices[variant % choices.length]!;

function Scene({ effect }: { effect: Effect }) {
  const { kind, id: seed, level, variant } = effect;
  const length = DURATION[kind];
  const common = { seed, variant, level };
  const scale = { '--boost': String(1 + 0.15 * (level - 1)) } as CSSProperties;

  switch (kind) {
    case 'confetti':
      return <Particles kind="confetti" length={length} {...common} />;
    case 'bubbles':
      return <Particles kind="bubbles" length={length} {...common} />;
    case 'fireworks':
      return (
        <>
          <div className={styles.night} />
          <Particles kind="fireworks" length={length} {...common} />
        </>
      );
    case 'drumroll':
      return (
        <>
          <div className={styles.spotlight} />
          <div className={styles.centre} style={scale}>
            <span className={`${styles.big} ${styles.drum}`}>🥁</span>
            <span className={styles.caption}>Drum roll…</span>
            <span className={`${styles.caption} ${styles.reveal}`}>
              {pick(['Ta-da!', 'And the winner is…', 'Here it comes!'], variant)}
            </span>
          </div>
          <Particles kind="confetti" delay={2400} length={length - 2400} {...common} />
        </>
      );
    case 'micdrop':
      return (
        <div className={`${styles.centre} ${styles.shake}`} style={scale}>
          <span className={`${styles.big} ${styles.fall}`}>🎤</span>
          <span className={`${styles.caption} ${styles.late}`}>
            {pick(['Mic drop.', 'Boom.', 'And that is that.'], variant)}
          </span>
        </div>
      );
    case 'quiet':
      return (
        <>
          <div className={styles.dim} />
          <div className={styles.centre} style={scale}>
            <span className={`${styles.big} ${styles.pop}`}>
              {pick(['🤫', '🙊', '🔇'], variant)}
            </span>
            <span className={styles.caption}>
              {pick(['Shh…', 'Quiet, please', 'Listen…'], variant)}
            </span>
          </div>
        </>
      );
    case 'curtain': {
      const curtain = { '--curtain': pick(['#a4161a', '#1d3557', '#5a189a'], variant) };
      return (
        <>
          <div
            className={`${styles.curtain} ${styles.curtainLeft}`}
            style={curtain as CSSProperties}
          />
          <div
            className={`${styles.curtain} ${styles.curtainRight}`}
            style={curtain as CSSProperties}
          />
          <div className={`${styles.centre} ${styles.bravo}`} style={scale}>
            <span className={styles.caption}>
              👏 {pick(['Bravo!', 'Encore!', 'Well done!'], variant)} 👏
            </span>
          </div>
        </>
      );
    }
    case 'applause':
      return (
        <Floaters
          seed={seed}
          level={level}
          count={26}
          emoji={pick([['👏'], ['🙌'], ['👏🏽', '👏🏻', '👏🏿'], ['👏', '🎉', '🙌']], variant)}
        />
      );
    case 'balloons':
      return (
        <Floaters
          seed={seed}
          level={level}
          count={18}
          emoji={['🎈']}
          hue={variant !== 0}
          rise="drift"
        />
      );
    case 'hearts':
      return (
        <Floaters
          seed={seed}
          level={level}
          count={24}
          emoji={pick(
            [
              ['💖', '❤️', '💕'],
              ['💛', '🧡', '❤️'],
              ['💜', '💙', '🩵'],
              ['🥰', '😍', '💗'],
            ],
            variant,
          )}
        />
      );
    case 'fanfare':
      return (
        <>
          <div className={styles.centre} style={scale}>
            <span className={`${styles.big} ${styles.pop}`}>🎺</span>
            <span className={styles.caption}>
              {pick(['Ta-ra!', 'Hooray!', 'Winner!'], variant)}
            </span>
          </div>
          <Particles kind="confetti" from="top" length={length} {...common} />
        </>
      );
    case 'womp':
      return (
        <>
          <div className={styles.grey} />
          <div className={`${styles.centre} ${styles.droop}`} style={scale}>
            <span className={styles.big}>{pick(['😢', '😬', '🫠'], variant)}</span>
            <span className={styles.caption}>
              {pick(['Womp womp…', 'Oh no…', 'So close!'], variant)}
            </span>
          </div>
        </>
      );
  }
}

/**
 * The celebrations playing now, over the board — for everyone on it at once. One
 * started again while it plays piles on top rather than starting over. It lets every
 * click through and goes away by itself.
 */
export function EffectsLayer() {
  const playing = useEffectsStore((state) => state.playing);
  if (playing.length === 0) return null;
  const latest = playing.at(-1)!;
  const level = Math.max(
    ...playing.filter((each) => each.kind === latest.kind).map((each) => each.level),
  );
  const about = (kind: string) => EFFECTS.find((effect) => effect.kind === kind);
  const still = reducedMotion();
  return (
    <div
      className={styles.layer}
      data-effect={latest.kind}
      data-level={level}
      data-variant={latest.variant}
      data-testid="celebration"
      role="status"
      aria-label={`${about(latest.kind)?.emoji ?? ''} ${about(latest.kind)?.label ?? ''}`}
    >
      {playing.map((effect) => (
        <div key={effect.id} className={styles.play} data-testid="celebration-play">
          {still ? (
            <div className={styles.centre}>
              <span className={styles.big}>{about(effect.kind)?.emoji}</span>
              <span className={styles.caption}>{about(effect.kind)?.label}</span>
            </div>
          ) : (
            <Scene effect={effect} />
          )}
        </div>
      ))}
    </div>
  );
}
