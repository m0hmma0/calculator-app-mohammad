import { expect, test } from '@playwright/test';

test.describe('app shell', () => {
  test('renders the header and a sized canvas', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByText('Sabboura')).toBeVisible();

    const canvas = page.getByTestId('board-canvas');
    await expect(canvas).toBeVisible();

    // The canvas must actually fill its area — a zero-sized canvas still "renders".
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(200);
    expect(box!.height).toBeGreaterThan(200);
  });

  test('sizes the backing store to the device pixel ratio', async ({ page }) => {
    await page.goto('/');

    const { cssWidth, backingWidth, dpr } = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="board-canvas"]')!;
      return {
        cssWidth: canvas.getBoundingClientRect().width,
        backingWidth: canvas.width,
        dpr: Math.min(window.devicePixelRatio || 1, 2),
      };
    });

    expect(backingWidth).toBeCloseTo(cssWidth * dpr, 0);
  });

  test('redraws when the window is resized', async ({ page }) => {
    await page.goto('/');
    await page.setViewportSize({ width: 700, height: 600 });

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="board-canvas"]')!;
          return Math.round(canvas.getBoundingClientRect().width);
        }),
      )
      .toBe(700);
  });

  test('loads with a clean console', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        problems.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

    await page.goto('/');
    await expect(page.getByTestId('board-canvas')).toBeVisible();

    expect(problems).toEqual([]);
  });
});
