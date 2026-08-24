import { createElement, type BoardElement } from '@/model/element';
import { keysBetween } from '@/model/zorder';

const KINDS = ['rect', 'ellipse', 'triangle', 'diamond', 'star', 'polygon'] as const;

/** Deterministic PRNG, so a given seed always produces the same board. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_SPREAD = { width: 14000, height: 9000 };

/**
 * Stress content for the renderer panel. Real elements, not a parallel type, so what
 * the performance numbers measure is what the app actually draws.
 */
export function generateDemoElements(count: number, seed = 1): BoardElement[] {
  const random = mulberry32(seed);
  const keys = keysBetween(null, null, count);

  return Array.from({ length: count }, (_, index) => {
    const kind = KINDS[Math.floor(random() * KINDS.length)]!;
    const element = createElement({
      type: kind,
      box: {
        x: (random() - 0.5) * DEMO_SPREAD.width,
        y: (random() - 0.5) * DEMO_SPREAD.height,
        w: 30 + random() * 150,
        h: 30 + random() * 110,
      },
      z: keys[index]!,
      style: { fill: `var(--shape-${1 + Math.floor(random() * 6)})` },
    });
    if (random() < 0.15) element.rotation = random() * Math.PI * 2;
    return element;
  });
}
