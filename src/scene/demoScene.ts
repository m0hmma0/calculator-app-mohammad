import { unionRects, type Rect } from '@/geometry';

/**
 * Scaffolding for Phase 1 only: enough shapes to prove the viewport, culling and
 * render loop hold up. Phase 2 replaces this with real, editable elements.
 */
export interface DemoShape extends Rect {
  id: string;
  kind: 'rect' | 'ellipse';
  color: number;
}

export const DEMO_SPREAD = { width: 14000, height: 9000 };

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

export function generateDemoShapes(count: number, seed = 1, paletteSize = 6): DemoShape[] {
  const random = mulberry32(seed);
  const shapes: DemoShape[] = new Array(count);

  for (let index = 0; index < count; index += 1) {
    const w = 24 + random() * 150;
    const h = 24 + random() * 110;
    shapes[index] = {
      id: `demo-${seed}-${index}`,
      kind: random() < 0.35 ? 'ellipse' : 'rect',
      x: (random() - 0.5) * DEMO_SPREAD.width,
      y: (random() - 0.5) * DEMO_SPREAD.height,
      w,
      h,
      color: Math.floor(random() * paletteSize) % paletteSize,
    };
  }

  return shapes;
}

export function sceneBounds(shapes: readonly DemoShape[]): Rect | null {
  return unionRects(shapes);
}
