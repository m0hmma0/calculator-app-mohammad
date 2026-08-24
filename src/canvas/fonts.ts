import type { ElementStyle } from '@/model/element';

export type FontKey = 'sans' | 'serif' | 'mono';

/**
 * Only families a browser already has. The app has to work offline from Phase 4, so
 * nothing here may depend on a webfont arriving. Arabic coverage is explicit rather
 * than left to chance — without it the canvas falls back to a font that cannot shape
 * Arabic and the text comes out as disconnected letters.
 */
export const FONT_STACKS: Record<FontKey, string> = {
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'Noto Sans Arabic', 'Geeza Pro', 'Segoe UI Arabic', sans-serif",
  serif: "Georgia, 'Times New Roman', 'Noto Serif', 'Noto Naskh Arabic', 'Times New Roman', serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Noto Sans Mono', monospace",
};

export const FONT_LABELS: Record<FontKey, string> = {
  sans: 'Sans',
  serif: 'Serif',
  mono: 'Mono',
};

export function fontStack(key: string): string {
  return FONT_STACKS[key as FontKey] ?? FONT_STACKS.sans;
}

/** A CSS font shorthand for canvas and for the editing overlay, so both agree. */
export function fontString(style: ElementStyle, size = style.fontSize): string {
  const italic = style.italic ? 'italic ' : '';
  return `${italic}${style.fontWeight} ${size}px ${fontStack(style.fontFamily)}`;
}
