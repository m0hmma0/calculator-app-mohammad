import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * `npm run build:preview` emits a fragment meant to be published as an artifact:
 * no <html>, <head> or <body> of its own, everything inlined, nothing fetched from
 * another host. This wraps it the way the artifact host does and checks it still
 * boots — so a broken preview is caught here rather than after publishing.
 *
 * Skipped when preview.html has not been built.
 */
const previewPath = resolve(process.cwd(), 'preview.html');

test.describe('artifact preview', () => {
  test.skip(!existsSync(previewPath), 'run `npm run build:preview` first');

  test('boots when wrapped by the artifact host', async ({ page }) => {
    const fragment = readFileSync(previewPath, 'utf8');

    expect(fragment, 'fragment must not carry its own document tags').not.toMatch(
      /<!doctype|<html|<\/head>|<body[\s>]/i,
    );

    const wrapped = join(tmpdir(), `sabboura-preview-${process.pid}.html`);
    writeFileSync(
      wrapped,
      `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`,
    );

    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(error.message));

    await page.goto(`file://${wrapped}`);

    const canvas = page.getByTestId('board-canvas');
    await expect(canvas).toBeVisible();

    const box = await canvas.boundingBox();
    expect(box!.height).toBeGreaterThan(200);
    expect(problems).toEqual([]);
  });
});
