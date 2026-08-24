export interface CanvasColors {
  background: string;
  dot: string;
  shapes: string[];
  minimapFill: string;
  minimapViewport: string;
}

const SHAPE_TOKENS = ['--shape-1', '--shape-2', '--shape-3', '--shape-4', '--shape-5', '--shape-6'];

let cache: CanvasColors | null = null;

/**
 * getComputedStyle is far too slow to call inside a render loop, so colours are
 * read once and cached until the colour scheme changes.
 */
export function getCanvasColors(host: Element): CanvasColors {
  if (cache) return cache;

  const style = getComputedStyle(host);
  const read = (token: string, fallback: string) =>
    style.getPropertyValue(token).trim() || fallback;

  cache = {
    background: read('--canvas-bg', '#ffffff'),
    dot: read('--canvas-dot', '#d0d0d0'),
    shapes: SHAPE_TOKENS.map((token, index) => read(token, ['#888'][index] ?? '#888')),
    minimapFill: read('--text-muted', '#888888'),
    minimapViewport: read('--accent', '#3b45d8'),
  };

  return cache;
}

export function invalidateCanvasColors(): void {
  cache = null;
}
