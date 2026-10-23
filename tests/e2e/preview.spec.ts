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

  // PDF.js arrives as a dynamically imported chunk; the single-file build has to
  // carry it inline, or the preview's PDF import would quietly fail.
  test('imports a PDF without fetching anything', async ({ page }) => {
    const fragment = readFileSync(previewPath, 'utf8');
    const wrapped = join(tmpdir(), `sabboura-preview-pdf-${process.pid}.html`);
    writeFileSync(
      wrapped,
      `<!doctype html><html><head><meta charset="utf-8"></head><body>${fragment}</body></html>`,
    );
    await page.goto(`file://${wrapped}`);
    await expect(page.getByTestId('board-canvas')).toBeVisible();
    // A file:// page has no stored preferences, so the object list starts off.
    await page.getByTestId('tools-menu').click();
    await page.getByTestId('toggle-layers').click();

    await page.getByTestId('insert-menu').click();
    await page.getByTestId('insert-import').click();
    await page.getByTestId('import-file').setInputFiles({
      name: 'one-page.pdf',
      mimeType: 'application/pdf',
      buffer: onePagePdf(),
    });
    await expect(page.getByTestId('layers').locator('li')).toHaveText(['image'], {
      timeout: 20_000,
    });
  });
});

/** The smallest PDF worth the name: one page, one red square. */
function onePagePdf(): Buffer {
  const stream = '0.9 0.1 0.1 rg 50 50 200 200 re f';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const at = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return at;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) body += `${String(at).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
