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
  /**
   * How strongly highlights are painted: fully on a light theme, toned down on a dark
   * one, where light words sit on them. From the `--highlight-mix` token.
   */
  highlightMix: number;
  /** Whether the board is dark, which decides how highlighter ink blends. */
  dark: boolean;
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
    '--wash-yellow',
    '--wash-green',
    '--wash-blue',
    '--wash-pink',
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
    highlightMix: Math.min(
      1,
      Math.max(0.1, parseFloat(read('--highlight-mix', '100%')) / 100 || 1),
    ),
    dark: isDark(read('--canvas-bg', '#ffffff')),
    byToken,
  };

  return cache;
}

/** A colour's lightness, from a `#rrggbb` value; anything else counts as light. */
function isDark(colour: string): boolean {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour.trim());
  if (!match) return false;
  const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16) / 255) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.4;
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
