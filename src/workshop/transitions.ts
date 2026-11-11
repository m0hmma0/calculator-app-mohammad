import { seeded } from '@/fun/random';

/**
 * How a presentation arrives at a frame: chosen per frame in the side panel and kept
 * on it (`element.transition`). Each is drawn on a canvas over the board from two
 * pictures — the slide being left, and the one arriving — so every screen showing the
 * presentation plays it: the presenter's, the audience window (and so a recording),
 * and everyone following along. Seeded by the frame, every screen plays the same one.
 */
export type TransitionKind =
  'none' | 'shatter' | 'portal' | 'glitch' | 'pixels' | 'warp' | 'blinds' | 'ink';

export const TRANSITIONS: ReadonlyArray<{
  kind: TransitionKind;
  label: string;
  description: string;
  /** Milliseconds. */
  duration: number;
}> = [
  { kind: 'none', label: 'None', description: 'Straight to the slide', duration: 0 },
  {
    kind: 'shatter',
    label: 'Shatter',
    description: 'The old slide cracks into shards that tumble away',
    duration: 1400,
  },
  {
    kind: 'portal',
    label: 'Portal',
    description: 'A glowing ring opens onto the new slide',
    duration: 1200,
  },
  {
    kind: 'glitch',
    label: 'Glitch',
    description: 'A burst of broken signal, colours torn apart',
    duration: 850,
  },
  {
    kind: 'pixels',
    label: 'Pixel storm',
    description: 'Breaks into blocks that flip, one by one, to the new slide',
    duration: 1100,
  },
  {
    kind: 'warp',
    label: 'Warp speed',
    description: 'Rushes forward through the old slide into the new',
    duration: 950,
  },
  {
    kind: 'blinds',
    label: 'Venetian',
    description: 'Strips turn over in a wave, like blinds',
    duration: 1200,
  },
  {
    kind: 'ink',
    label: 'Ink bloom',
    description: 'The new slide spreads in like ink in water',
    duration: 1400,
  },
];

export const isTransition = (value: unknown): value is TransitionKind =>
  TRANSITIONS.some((each) => each.kind === value);

export const durationOf = (kind: TransitionKind): number =>
  TRANSITIONS.find((each) => each.kind === kind)?.duration ?? 0;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

type Picture = HTMLCanvasElement | OffscreenCanvas;
type Context = CanvasRenderingContext2D;

/**
 * One playing transition. Made once with both pictures (the work that can be done
 * ahead is done here), then drawn at any point from 0 to 1.
 */
export interface Player {
  draw(ctx: Context, t: number): void;
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** A picture with only some of its colour: red alone, or green and blue. */
function channel(picture: Picture, colour: string): HTMLCanvasElement {
  const out = canvasOf(picture.width, picture.height);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(picture, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(picture, 0, 0);
  return out;
}

export function makePlayer(
  kind: TransitionKind,
  from: Picture,
  to: Picture,
  seed: string,
  reduced = false,
): Player {
  const w = to.width;
  const h = to.height;
  const random = seeded(`${kind}:${seed}`);

  // Someone who asked the computer for less motion gets a quiet cross-fade.
  if (reduced || kind === 'none') {
    return {
      draw(ctx, t) {
        ctx.drawImage(from, 0, 0);
        ctx.globalAlpha = clamp01(t);
        ctx.drawImage(to, 0, 0);
        ctx.globalAlpha = 1;
      },
    };
  }

  switch (kind) {
    case 'shatter': {
      // Shards: a grid of quads, each cut into two triangles, jittered so the cracks
      // run crooked. They fall from where the blow landed, outward and spinning.
      const cols = 9;
      const rows = 6;
      const jitter = (value: number, span: number, edge: boolean) =>
        edge ? value : value + (random() - 0.5) * span * 0.7;
      const points: Array<Array<{ x: number; y: number }>> = [];
      for (let r = 0; r <= rows; r += 1) {
        const row: Array<{ x: number; y: number }> = [];
        for (let c = 0; c <= cols; c += 1) {
          row.push({
            x: jitter((c / cols) * w, w / cols, c === 0 || c === cols),
            y: jitter((r / rows) * h, h / rows, r === 0 || r === rows),
          });
        }
        points.push(row);
      }
      const impact = { x: w * (0.35 + random() * 0.3), y: h * (0.35 + random() * 0.3) };
      const reach = Math.hypot(w, h);
      const shards: Array<{
        triangle: Array<{ x: number; y: number }>;
        cx: number;
        cy: number;
        vx: number;
        vy: number;
        spin: number;
        delay: number;
      }> = [];
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const a = points[r]![c]!;
          const b = points[r]![c + 1]!;
          const d = points[r + 1]![c]!;
          const e = points[r + 1]![c + 1]!;
          for (const triangle of random() < 0.5
            ? [
                [a, b, e],
                [a, e, d],
              ]
            : [
                [a, b, d],
                [b, e, d],
              ]) {
            const cx = (triangle[0]!.x + triangle[1]!.x + triangle[2]!.x) / 3;
            const cy = (triangle[0]!.y + triangle[1]!.y + triangle[2]!.y) / 3;
            const away = Math.atan2(cy - impact.y, cx - impact.x);
            const distance = Math.hypot(cx - impact.x, cy - impact.y) / reach;
            const speed = (0.25 + random() * 0.35) * reach;
            shards.push({
              triangle,
              cx,
              cy,
              vx: Math.cos(away) * speed,
              vy: Math.sin(away) * speed - random() * reach * 0.15,
              spin: (random() - 0.5) * 6,
              delay: distance * 0.35,
            });
          }
        }
      }
      return {
        draw(ctx, t) {
          ctx.drawImage(to, 0, 0);
          // The new slide is a little dark at first, as if behind glass.
          ctx.fillStyle = `rgba(0,0,0,${0.45 * (1 - easeOut(t))})`;
          ctx.fillRect(0, 0, w, h);
          for (const shard of shards) {
            const local = clamp01((t - shard.delay) / (1 - shard.delay));
            const fall = local * local;
            if (local >= 1) continue;
            ctx.save();
            ctx.globalAlpha = 1 - clamp01((local - 0.6) / 0.4);
            ctx.translate(
              shard.cx + shard.vx * fall,
              shard.cy + shard.vy * local + h * 1.2 * fall * fall,
            );
            ctx.rotate(shard.spin * fall);
            ctx.scale(1 - 0.3 * fall, 1 - 0.3 * fall);
            ctx.translate(-shard.cx, -shard.cy);
            ctx.beginPath();
            ctx.moveTo(shard.triangle[0]!.x, shard.triangle[0]!.y);
            ctx.lineTo(shard.triangle[1]!.x, shard.triangle[1]!.y);
            ctx.lineTo(shard.triangle[2]!.x, shard.triangle[2]!.y);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(from, 0, 0);
            // A glint along each crack.
            ctx.strokeStyle = `rgba(255,255,255,${0.55 * (1 - local)})`;
            ctx.lineWidth = Math.max(1, w / 900);
            ctx.stroke();
            ctx.restore();
          }
          // The blow: a flash where it landed.
          if (t < 0.15) {
            const glow = ctx.createRadialGradient(
              impact.x,
              impact.y,
              0,
              impact.x,
              impact.y,
              reach * 0.3,
            );
            glow.addColorStop(0, `rgba(255,255,255,${0.7 * (1 - t / 0.15)})`);
            glow.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = glow;
            ctx.fillRect(0, 0, w, h);
          }
        },
      };
    }

    case 'portal': {
      const reach = Math.hypot(w, h) / 2;
      const turn = (random() < 0.5 ? -1 : 1) * 0.25;
      return {
        draw(ctx, t) {
          const open = easeInOut(t);
          const radius = open * reach * 1.05;
          ctx.drawImage(from, 0, 0);
          // The old slide sinks back as the ring opens.
          ctx.fillStyle = `rgba(6,8,20,${0.55 * open})`;
          ctx.fillRect(0, 0, w, h);
          ctx.save();
          ctx.beginPath();
          ctx.arc(w / 2, h / 2, Math.max(0.1, radius), 0, Math.PI * 2);
          ctx.clip();
          ctx.translate(w / 2, h / 2);
          ctx.rotate(turn * (1 - open));
          const grow = 1.25 - 0.25 * open;
          ctx.scale(grow, grow);
          ctx.drawImage(to, -w / 2, -h / 2);
          ctx.restore();
          // The ring: bright at its edge, fading out as it passes the corners.
          if (radius > 1 && t < 1) {
            const fade = 1 - clamp01((open - 0.75) / 0.25);
            const width = Math.max(4, reach * 0.06) * (1 - open * 0.5);
            const ring = ctx.createRadialGradient(
              w / 2,
              h / 2,
              Math.max(0, radius - width),
              w / 2,
              h / 2,
              radius + width,
            );
            ring.addColorStop(0, 'rgba(120,200,255,0)');
            ring.addColorStop(0.45, `rgba(140,220,255,${0.85 * fade})`);
            ring.addColorStop(0.55, `rgba(255,255,255,${0.95 * fade})`);
            ring.addColorStop(0.7, `rgba(200,120,255,${0.7 * fade})`);
            ring.addColorStop(1, 'rgba(200,120,255,0)');
            ctx.fillStyle = ring;
            ctx.beginPath();
            ctx.arc(w / 2, h / 2, radius + width, 0, Math.PI * 2);
            ctx.arc(w / 2, h / 2, Math.max(0, radius - width), 0, Math.PI * 2, true);
            ctx.fill();
          }
        },
      };
    }

    case 'glitch': {
      const reds = [channel(from, '#ff0000'), channel(to, '#ff0000')];
      const cyans = [channel(from, '#00ffff'), channel(to, '#00ffff')];
      return {
        draw(ctx, t) {
          const second = t >= 0.5 ? 1 : 0;
          const picture = second ? to : from;
          // Strongest in the middle, where one becomes the other.
          const strength = Math.sin(Math.PI * clamp01(t));
          const tick = Math.floor(t * 24);
          const shake = seeded(`glitch-${seed}-${tick}`);
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, w, h);
          const split = strength * w * 0.025;
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(reds[second]!, split, 0);
          ctx.drawImage(cyans[second]!, -split, 0);
          ctx.globalCompositeOperation = 'source-over';
          // Torn bands, slid sideways.
          const bands = Math.round(4 + strength * 14);
          for (let index = 0; index < bands; index += 1) {
            if (shake() > strength) continue;
            const y = shake() * h;
            const band = (0.01 + shake() * 0.06) * h;
            const dx = (shake() - 0.5) * w * 0.18 * strength;
            ctx.drawImage(picture, 0, y, w, band, dx, y, w, band);
          }
          // Scan lines and a flicker.
          ctx.fillStyle = `rgba(0,0,0,${0.18 * strength})`;
          for (let y = 0; y < h; y += Math.max(2, Math.round(h / 240))) {
            ctx.fillRect(0, y, w, 1);
          }
          if (shake() < strength * 0.25) {
            ctx.fillStyle = `rgba(255,255,255,${0.15 * strength})`;
            ctx.fillRect(0, 0, w, h);
          }
        },
      };
    }

    case 'pixels': {
      const block = Math.max(8, Math.round(Math.min(w, h) / 22));
      const cols = Math.ceil(w / block);
      const rows = Math.ceil(h / block);
      // Each slide shrunk to one pixel a block: the blocks' colours.
      const small = (picture: Picture) => {
        const canvas = canvasOf(cols, rows);
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(picture, 0, 0, cols, rows);
        return ctx.getImageData(0, 0, cols, rows);
      };
      const before = small(from);
      const after = small(to);
      const mixed = canvasOf(cols, rows);
      const mixedContext = mixed.getContext('2d')!;
      const image = mixedContext.createImageData(cols, rows);
      // Each block turns at its own moment, sweeping loosely from one side.
      const sweep = random() < 0.5;
      const when = Array.from({ length: cols * rows }, (_, index) => {
        const c = index % cols;
        const along = sweep ? c / cols : Math.floor(index / cols) / rows;
        return 0.15 + 0.55 * (0.55 * along + 0.45 * random());
      });
      return {
        draw(ctx, t) {
          // Sharp at either end, in blocks in between.
          const blocky = clamp01(Math.min(t, 1 - t) / 0.15);
          for (let index = 0; index < cols * rows; index += 1) {
            const turned = clamp01((t - when[index]!) / 0.08);
            const pop = 1 + 0.6 * Math.sin(Math.PI * turned);
            for (let k = 0; k < 3; k += 1) {
              const value =
                before.data[index * 4 + k]! * (1 - turned) + after.data[index * 4 + k]! * turned;
              image.data[index * 4 + k] = Math.min(255, value * pop);
            }
            image.data[index * 4 + 3] = 255;
          }
          mixedContext.putImageData(image, 0, 0);
          ctx.drawImage(t < 0.5 ? from : to, 0, 0);
          ctx.globalAlpha = blocky;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(mixed, 0, 0, cols * block, rows * block);
          ctx.imageSmoothingEnabled = true;
          ctx.globalAlpha = 1;
        },
      };
    }

    case 'warp': {
      return {
        draw(ctx, t) {
          ctx.fillStyle = '#05060c';
          ctx.fillRect(0, 0, w, h);
          const zoom = (picture: Picture, scale: number, alpha: number) => {
            if (alpha <= 0) return;
            ctx.globalAlpha = Math.min(1, alpha);
            ctx.drawImage(picture, (w - w * scale) / 2, (h - h * scale) / 2, w * scale, h * scale);
          };
          const out = easeInOut(clamp01(t / 0.55));
          const into = easeOut(clamp01((t - 0.45) / 0.55));
          // The old slide rushes past: itself, solid, then bright trails behind it.
          zoom(from, 1 + out * 3, Math.sqrt(1 - out));
          ctx.globalCompositeOperation = 'lighter';
          for (let echo = 1; echo <= 5; echo += 1) {
            zoom(from, 1 + out * (3 - echo * 0.45), (1 - out) * out * 0.22);
          }
          ctx.globalCompositeOperation = 'source-over';
          // The new one arrives from far off, trailing light as it comes.
          zoom(to, 0.2 + 0.8 * into, into);
          ctx.globalCompositeOperation = 'lighter';
          for (let echo = 1; echo <= 4; echo += 1) {
            zoom(to, 0.2 + 0.8 * into + echo * 0.12 * (1 - into), into * (1 - into) * 0.3);
          }
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          // A flash at the jump.
          const flash = 1 - Math.abs(t - 0.5) / 0.12;
          if (flash > 0) {
            ctx.fillStyle = `rgba(230,240,255,${0.6 * flash})`;
            ctx.fillRect(0, 0, w, h);
          }
        },
      };
    }

    case 'blinds': {
      const strips = 12;
      const strip = w / strips;
      return {
        draw(ctx, t) {
          ctx.fillStyle = '#0b0d14';
          ctx.fillRect(0, 0, w, h);
          for (let index = 0; index < strips; index += 1) {
            const start = (index / strips) * 0.45;
            const local = easeInOut(clamp01((t - start) / 0.55));
            const angle = local * Math.PI;
            const squash = Math.abs(Math.cos(angle));
            const picture = angle < Math.PI / 2 ? from : to;
            const x = index * strip;
            ctx.save();
            ctx.translate(x + strip / 2, h / 2);
            ctx.scale(Math.max(0.001, squash), 1 + 0.04 * Math.sin(angle));
            ctx.drawImage(picture, x, 0, strip + 1, h, -strip / 2, -h / 2, strip + 1, h);
            // Turned away from the light, darker.
            ctx.fillStyle = `rgba(0,0,0,${0.55 * (1 - squash)})`;
            ctx.fillRect(-strip / 2, -h / 2, strip + 1, h);
            ctx.restore();
          }
        },
      };
    }

    case 'ink': {
      // Drops of the new slide land and spread; a soft mask, drawn small and scaled up.
      const scale = 8;
      const mask = canvasOf(w / scale, h / scale);
      const maskContext = mask.getContext('2d')!;
      const layer = canvasOf(w, h);
      const layerContext = layer.getContext('2d')!;
      const drops = Array.from({ length: 22 }, () => ({
        x: random() * mask.width,
        y: random() * mask.height,
        at: random() * 0.6,
        size: 0.35 + random() * 0.65,
        lobes: Array.from({ length: 5 }, () => ({
          angle: random() * Math.PI * 2,
          reach: 0.3 + random() * 0.5,
          size: 0.4 + random() * 0.5,
        })),
      }));
      const full = Math.hypot(mask.width, mask.height) * 0.24;
      // The stain at the edge of the spreading ink, so it shows over white too.
      const halo = canvasOf(mask.width, mask.height);
      const haloContext = halo.getContext('2d')!;
      return {
        draw(ctx, t) {
          maskContext.clearRect(0, 0, mask.width, mask.height);
          maskContext.fillStyle = '#fff';
          maskContext.filter = `blur(${Math.max(1, mask.width / 90)}px)`;
          for (const drop of drops) {
            const grown = easeInOut(clamp01((t - drop.at) / (1 - drop.at)));
            if (grown <= 0) continue;
            const radius = grown * full * drop.size;
            maskContext.beginPath();
            maskContext.arc(drop.x, drop.y, radius, 0, Math.PI * 2);
            for (const lobe of drop.lobes) {
              maskContext.moveTo(
                drop.x + Math.cos(lobe.angle) * radius * lobe.reach + radius * lobe.size,
                drop.y + Math.sin(lobe.angle) * radius * lobe.reach,
              );
              maskContext.arc(
                drop.x + Math.cos(lobe.angle) * radius * lobe.reach,
                drop.y + Math.sin(lobe.angle) * radius * lobe.reach,
                radius * lobe.size,
                0,
                Math.PI * 2,
              );
            }
            maskContext.fill();
          }
          maskContext.filter = 'none';
          // Past the end, all of it, whatever the drops missed.
          if (t > 0.85) {
            maskContext.globalAlpha = (t - 0.85) / 0.15;
            maskContext.fillRect(0, 0, mask.width, mask.height);
            maskContext.globalAlpha = 1;
          }
          layerContext.globalCompositeOperation = 'copy';
          layerContext.drawImage(to, 0, 0);
          layerContext.globalCompositeOperation = 'destination-in';
          layerContext.drawImage(mask, 0, 0, w, h);
          ctx.drawImage(from, 0, 0);
          haloContext.globalCompositeOperation = 'copy';
          haloContext.filter = `blur(${Math.max(2, mask.width / 40)}px)`;
          haloContext.drawImage(mask, 0, 0);
          haloContext.filter = 'none';
          haloContext.globalCompositeOperation = 'source-in';
          haloContext.fillStyle = '#3b2fc9';
          haloContext.fillRect(0, 0, halo.width, halo.height);
          ctx.globalAlpha = 0.55 * (1 - clamp01((t - 0.8) / 0.2));
          ctx.drawImage(halo, 0, 0, w, h);
          ctx.globalAlpha = 1;
          ctx.drawImage(layer, 0, 0);
        },
      };
    }
  }
}
