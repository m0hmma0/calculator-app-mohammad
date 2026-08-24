import { expect, test, type Page } from '@playwright/test';

/** A cheap fingerprint of what is actually painted, to prove the view moved. */
async function canvasSignature(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="board-canvas"]')!;
    const data = canvas.getContext('2d')!.getImageData(0, 0, 240, 240).data;
    let hash = 0;
    for (let index = 0; index < data.length; index += 7) hash = (hash * 31 + data[index]!) | 0;
    return hash;
  });
}

const zoomText = (page: Page) => page.getByTestId('zoom-readout').innerText();
const zoomPercent = async (page: Page) => Number.parseInt(await zoomText(page), 10);

/**
 * The renderer reports its stats on a throttle, so every assertion about them has
 * to poll — reading once races the trailing update rather than testing the app.
 */
async function drawnCounts(page: Page): Promise<{ visible: number; total: number }> {
  const text = await page.getByTestId('stat-visible').innerText();
  const [visible, total] = text
    .split('/')
    .map((part) => Number.parseInt(part.replace(/\D/g, ''), 10));
  return { visible: visible ?? 0, total: total ?? 0 };
}

async function loadShapes(page: Page, count: 500 | 5000 | 20000) {
  await page.getByTestId('toggle-dev-panel').click();
  await page.getByTestId(`load-${count}`).click();
  // Loading fits the board, so every shape ends up on screen.
  await expect.poll(() => drawnCounts(page)).toEqual({ visible: count, total: count });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board-canvas')).toBeVisible();
});

test.describe('panning', () => {
  test('wheel pans without changing zoom', async ({ page }) => {
    const before = await canvasSignature(page);
    await page.mouse.move(500, 350);
    await page.mouse.wheel(0, 400);

    await expect.poll(() => canvasSignature(page)).not.toBe(before);
    expect(await zoomText(page)).toBe('100%');
  });

  test('space and drag moves the board and shows a grabbing cursor', async ({ page }) => {
    const before = await canvasSignature(page);
    const stage = page.getByTestId('stage');

    await page.keyboard.down('Space');
    await expect(stage).toHaveAttribute('data-cursor', 'grab');

    await page.mouse.move(600, 400);
    await page.mouse.down();
    await page.mouse.move(400, 250, { steps: 8 });
    await expect(stage).toHaveAttribute('data-cursor', 'grabbing');
    await page.mouse.up();
    await page.keyboard.up('Space');

    await expect(stage).toHaveAttribute('data-cursor', 'default');
    await expect.poll(() => canvasSignature(page)).not.toBe(before);
  });

  test('releasing space outside the window does not strand the hand tool', async ({ page }) => {
    await page.keyboard.down('Space');
    await expect(page.getByTestId('stage')).toHaveAttribute('data-cursor', 'grab');

    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.getByTestId('stage')).toHaveAttribute('data-cursor', 'default');
  });
});

test.describe('zooming', () => {
  test('ctrl and wheel zooms rather than pans', async ({ page }) => {
    await page.mouse.move(500, 350);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');

    await expect.poll(() => zoomPercent(page)).toBeGreaterThan(100);
  });

  test('the zoom buttons step in and out', async ({ page }) => {
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(() => zoomPercent(page)).toBeGreaterThan(100);

    await page.getByRole('button', { name: 'Zoom out' }).click();
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect.poll(() => zoomPercent(page)).toBeLessThan(100);
  });

  test('shift+0 returns to 100% and shift+1 fits the content', async ({ page }) => {
    await loadShapes(page, 500);

    await page.keyboard.press('Shift+Digit0');
    await expect(page.getByTestId('zoom-readout')).toHaveText('100%');

    await page.keyboard.press('Shift+Digit1');
    // The demo board is far larger than the stage, so fitting must zoom out.
    await expect.poll(() => zoomPercent(page)).toBeLessThan(100);

    // And fitting means everything is drawn.
    await expect.poll(() => drawnCounts(page)).toEqual({ visible: 500, total: 500 });
  });

  test('the readout resets to 100% when clicked', async ({ page }) => {
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByTestId('zoom-readout').click();
    await expect(page.getByTestId('zoom-readout')).toHaveText('100%');
  });
});

test.describe('tools', () => {
  test('h and v switch between the hand and select tools', async ({ page }) => {
    const stage = page.getByTestId('stage');

    await page.keyboard.press('KeyH');
    await expect(stage).toHaveAttribute('data-cursor', 'grab');
    await expect(page.getByTestId('tool-hand')).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('KeyV');
    await expect(stage).toHaveAttribute('data-cursor', 'default');
    await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the hand tool drags the board with one pointer', async ({ page }) => {
    await page.keyboard.press('KeyH');
    const before = await canvasSignature(page);

    await page.mouse.move(600, 400);
    await page.mouse.down();
    await page.mouse.move(350, 250, { steps: 8 });
    await page.mouse.up();

    await expect.poll(() => canvasSignature(page)).not.toBe(before);
  });
});

test.describe('culling and the minimap', () => {
  test('only the shapes on screen are drawn', async ({ page }) => {
    await loadShapes(page, 5000);
    await page.keyboard.press('Shift+Digit1');

    await expect.poll(() => drawnCounts(page)).toEqual({ visible: 5000, total: 5000 });

    // Zoom in hard: the vast majority must fall outside the viewport and be skipped.
    for (let step = 0; step < 8; step += 1) {
      await page.getByRole('button', { name: 'Zoom in' }).click();
    }

    await expect.poll(async () => (await drawnCounts(page)).visible).toBeLessThan(500);
  });

  test('the minimap appears with content and moves the view when clicked', async ({ page }) => {
    await expect(page.getByTestId('minimap')).toHaveCount(0);

    await loadShapes(page, 500);
    const minimap = page.getByTestId('minimap');
    await expect(minimap).toBeVisible();

    const before = await canvasSignature(page);
    const box = (await minimap.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.22, box.y + box.height * 0.25);

    await expect.poll(() => canvasSignature(page)).not.toBe(before);
  });
});

test.describe('performance', () => {
  test('holds up while panning 5,000 shapes', async ({ page }) => {
    await loadShapes(page, 5000);
    await page.keyboard.press('Shift+Digit1');

    await page.mouse.move(600, 400);
    for (let step = 0; step < 40; step += 1) {
      await page.mouse.wheel(0, 40);
    }

    const fps = await page.getByTestId('stat-fps').innerText();
    const frame = await page.evaluate(() => {
      const rows = document.querySelectorAll('[data-testid="dev-panel"] dd');
      return rows[1]?.textContent ?? '';
    });
    const renderMs = Number.parseFloat(frame);

    console.log(`5,000 shapes — fps: ${fps}, frame: ${renderMs.toFixed(2)} ms`);

    // A frame budget of 16.7ms is 60fps; drawing must leave room for everything else.
    expect(renderMs).toBeLessThan(12);
  });
});
