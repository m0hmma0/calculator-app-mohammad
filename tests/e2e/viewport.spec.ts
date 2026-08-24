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
  /** Well below the 145ms pathology, well above normal runner noise. */
  const SLOW_FRAME_MS = 45;

  /** Pans by dispatching one wheel event per animation frame and times the frames. */
  async function panForFrames(page: Page, frames = 90) {
    return page.evaluate(async (count) => {
      const stage = document.querySelector('[data-testid="stage"]')!;
      const stamps: number[] = [];
      await new Promise<void>((resolve) => {
        let drawn = 0;
        const tick = (time: number) => {
          stamps.push(time);
          stage.dispatchEvent(
            new WheelEvent('wheel', { deltaY: 1, deltaX: 1, bubbles: true, cancelable: true }),
          );
          drawn += 1;
          if (drawn < count) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      const deltas = stamps
        .slice(1)
        .map((t, i) => t - stamps[i]!)
        .sort((a, b) => a - b);
      return {
        median: deltas[Math.floor(deltas.length / 2)] ?? 0,
        p95: deltas[Math.floor(deltas.length * 0.95)] ?? 0,
      };
    }, frames);
  }

  const drawMs = async (page: Page) =>
    Number.parseFloat(
      (await page.evaluate(
        () => document.querySelectorAll('[data-testid="dev-panel"] dd')[1]?.textContent ?? '',
      )) || '0',
    );

  test('draws 5,000 elements within the frame budget', async ({ page }) => {
    await loadShapes(page, 5000);
    await page.keyboard.press('Shift+Digit1');

    const timing = await panForFrames(page);
    await expect.poll(() => drawMs(page)).toBeGreaterThan(0);
    const cost = await drawMs(page);

    // The earlier version of this test panned right off the board and measured an
    // empty screen, so it has to prove there was actually something to draw.
    const { visible } = await drawnCounts(page);
    expect(visible).toBeGreaterThan(4000);

    console.log(
      `5,000 elements — draw ${cost.toFixed(1)}ms, frame median ${timing.median.toFixed(1)}ms, p95 ${timing.p95.toFixed(1)}ms, drawn ${visible}`,
    );
    // A shared CI runner cannot measure 11ms repeatably — the same build swings
    // between 6 and 14ms. The threshold is set to catch an order-of-magnitude
    // regression, not a small one; the logged number is the thing worth watching.
    expect(cost).toBeLessThan(SLOW_FRAME_MS);
  });

  test('does not choke when every element shares one style', async ({ page }) => {
    // Regression guard: merging same-styled shapes into one unbounded path cost 145ms
    // per frame. Real boards are full of identically styled elements, so this matters.
    await loadShapes(page, 5000);
    await page.keyboard.press('Shift+Digit1');
    await page.keyboard.press('ControlOrMeta+KeyA');
    await page.getByLabel('Fill var(--shape-1)').click();
    await page.keyboard.press('Escape');

    await panForFrames(page, 60);
    await expect.poll(() => drawMs(page)).toBeGreaterThan(0);
    const cost = await drawMs(page);

    console.log(`5,000 elements, one style — draw ${cost.toFixed(1)}ms`);
    expect(cost).toBeLessThan(SLOW_FRAME_MS);
  });
});
