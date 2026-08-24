import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The classic broken-theme bug is a colour that exists in only one of the theme
 * blocks: the page then renders one theme's text on the other theme's ground. This
 * caught exactly that — six shape colours and both guide colours were missing from
 * the explicit-dark block, so a viewer who picked dark got light shapes.
 */
// jsdom does not give import.meta a file: URL, and Vitest runs from the repo root.
const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

function tokensIn(selector: string): Set<string> {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`Selector not found: ${selector}`);

  const open = css.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }

  const body = css.slice(open + 1, end);
  return new Set([...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]!));
}

const LIGHT = ':root {';
const MEDIA_DARK = ":root:not([data-theme='light'])";
const STAMPED_DARK = ":root[data-theme='dark']";

describe('theme tokens', () => {
  it('defines a complete light palette on bare :root', () => {
    const light = tokensIn(LIGHT);
    expect(light.size).toBeGreaterThan(20);
    for (const required of ['--canvas-bg', '--surface', '--text', '--accent', '--guide']) {
      expect(light.has(required)).toBe(true);
    }
  });

  it('gives both dark blocks exactly the same tokens', () => {
    const media = [...tokensIn(MEDIA_DARK)].sort();
    const stamped = [...tokensIn(STAMPED_DARK)].sort();
    expect(stamped).toEqual(media);
  });

  it('overrides every colour the light palette defines', () => {
    const light = tokensIn(LIGHT);
    const dark = tokensIn(STAMPED_DARK);

    // Sizes and fonts are shared; every colour has to be redefined.
    const shared = new Set([
      '--radius-sm',
      '--radius-md',
      '--radius-lg',
      '--topbar-h',
      '--font-ui',
      '--font-mono',
    ]);
    const missing = [...light].filter((token) => !shared.has(token) && !dark.has(token));
    expect(missing).toEqual([]);
  });

  it('never leaves a dark value hiding only inside the media query', () => {
    const media = tokensIn(MEDIA_DARK);
    const stamped = tokensIn(STAMPED_DARK);
    expect([...media].filter((token) => !stamped.has(token))).toEqual([]);
  });
});
