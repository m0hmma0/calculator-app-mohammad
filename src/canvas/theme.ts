export interface CanvasColors {
  background: string;
  dot: string;
  shapes: string[];
  minimapFill: string;
  minimapViewport: string;
  accent: string;
  guide: string;
  laser: string;
  handleFill: string;
  /** CSS custom-property name to its resolved value, for `var(--x)` in element styles. */
  byToken: Map<string, string>;
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

  const byToken = new Map<string, string>();
  for (const token of [
    ...SHAPE_TOKENS,
    '--text',
    '--text-muted',
    '--accent',
    '--surface',
    '--sticky',
    '--sticky-ink',
    '--laser',
    '--border-strong',
  ]) {
    byToken.set(token, read(token, '#888888'));
  }

  cache = {
    background: read('--canvas-bg', '#ffffff'),
    dot: read('--canvas-dot', '#d0d0d0'),
    shapes: SHAPE_TOKENS.map((token) => byToken.get(token) ?? '#888888'),
    minimapFill: read('--text-muted', '#888888'),
    minimapViewport: read('--accent', '#3b45d8'),
    accent: read('--accent', '#3b45d8'),
    laser: read('--laser', '#ff2d55'),
    guide: read('--guide', '#e0397a'),
    handleFill: read('--surface', '#ffffff'),
    byToken,
  };

  return cache;
}

export function invalidateCanvasColors(): void {
  cache = null;
}

const VAR_PATTERN = /^var\((--[a-z0-9-]+)\)$/i;

/** Element styles store `var(--shape-1)` so they follow the theme; canvas needs a colour. */
export function resolveColor(value: string | null, colors: CanvasColors): string | null {
  if (!value) return null;
  const token = VAR_PATTERN.exec(value)?.[1];
  if (!token) return value;
  return colors.byToken.get(token) ?? '#888888';
}
