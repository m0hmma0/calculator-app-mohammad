import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 11: where the controls are. A pane down the right on a wide screen, a bar
 * along the top on a tall one, two rows at most on a phone — and nothing at the
 * bottom of the board.
 */

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('board-canvas')).toBeVisible();
}

const box = async (page: Page, id: string) => (await page.getByTestId(id).boundingBox())!;

/** True when the whole of `inner` lies inside `outer`. */
const within = (
  inner: { x: number; y: number; width: number; height: number },
  outer: { x: number; y: number; width: number; height: number },
) =>
  inner.x >= outer.x - 1 &&
  inner.y >= outer.y - 1 &&
  inner.x + inner.width <= outer.x + outer.width + 1 &&
  inner.y + inner.height <= outer.y + outer.height + 1;

test.describe('a wide screen', () => {
  test('every control is in one pane down the right, and nothing is at the bottom', async ({
    page,
  }) => {
    await open(page);
    const viewport = page.viewportSize()!;
    const pane = await box(page, 'controls');
    expect(pane.x + pane.width).toBeCloseTo(viewport.width, 0);
    expect(pane.y).toBeCloseTo(0, 0);
    expect(pane.height).toBeCloseTo(viewport.height, 0);
    expect(pane.width).toBeLessThan(140);

    for (const id of [
      'undo',
      'tool-select',
      'tool-pen',
      'tool-highlighter',
      'insert-menu',
      'tools-menu',
      'page-tab-0',
      'toggle-pane',
      'view-minimap',
      'zoom-readout',
    ]) {
      expect(within(await box(page, id), pane), id).toBe(true);
    }

    // The board takes the rest of the screen, from the top to the very bottom.
    const stage = await box(page, 'stage');
    expect(stage.y).toBeCloseTo(0, 0);
    expect(stage.y + stage.height).toBeCloseTo(viewport.height, 0);
    expect(stage.x + stage.width).toBeCloseTo(pane.x, 0);
    await expect(page.getByTestId('bottom-bar')).toHaveCount(0);
    await expect(page.getByTestId('zoom-fit')).toHaveCount(0);
  });

  test("a menu opens to the pane's left, all of it on screen", async ({ page }) => {
    await open(page);
    await page.getByTestId('insert-menu').click();
    const menu = await page.getByRole('menu').boundingBox();
    const pane = await box(page, 'controls');
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(pane.x);
    expect(menu!.y).toBeGreaterThanOrEqual(0);
    expect(menu!.y + menu!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  });

  test('the pen’s options stand beside the pane, and left of the side panel when open', async ({
    page,
  }) => {
    await open(page);
    await page.keyboard.press('KeyP');
    const stage = await box(page, 'stage');
    const panel = await box(page, 'inspector');
    const options = await box(page, 'tool-options');
    // Right-hand side of the board, upright, clear of the open side panel.
    expect(options.x).toBeGreaterThan(stage.x + stage.width / 2);
    expect(options.height).toBeGreaterThan(options.width);
    expect(options.x + options.width).toBeLessThanOrEqual(panel.x);

    await page.getByTestId('close-pane').click();
    const alone = await box(page, 'tool-options');
    expect(stage.x + stage.width - (alone.x + alone.width)).toBeLessThan(30);
  });

  test('the full-screen button fills the screen with the board, and back', async ({ page }) => {
    await open(page);
    await page.getByTestId('fullscreen').click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await expect(page.getByTestId('fullscreen')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('fullscreen').click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  });
});

test.describe('a tall screen', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('the controls are a bar along the top; the pen’s options sit top centre', async ({
    page,
  }) => {
    await open(page);
    const bar = await box(page, 'controls');
    expect(bar.y).toBeCloseTo(0, 0);
    expect(bar.width).toBeCloseTo(768, 0);
    expect(bar.height).toBeLessThan(120);
    for (const id of ['tool-pen', 'insert-menu', 'zoom-readout', 'toggle-pane']) {
      expect(within(await box(page, id), bar), id).toBe(true);
    }
    const stage = await box(page, 'stage');
    expect(stage.y).toBeCloseTo(bar.y + bar.height, 0);
    expect(stage.y + stage.height).toBeCloseTo(1024, 0);

    await page.keyboard.press('KeyP');
    const options = await box(page, 'tool-options');
    const centre = options.x + options.width / 2;
    expect(Math.abs(centre - (stage.x + stage.width / 2))).toBeLessThan(20);
    expect(options.y - stage.y).toBeLessThan(40);
  });
});

test.describe('a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('two rows at most, with every control on them', async ({ page }) => {
    await open(page);
    const bar = await box(page, 'controls');
    const tool = await box(page, 'tool-pen');
    // Two rows of buttons, and room around them — not three.
    expect(bar.height).toBeLessThan(tool.height * 3 + 16);
    for (const id of [
      'undo',
      'tool-select',
      'tool-laser',
      'insert-menu',
      'tools-menu',
      'page-tab-0',
      'zoom-readout',
    ]) {
      const each = await box(page, id);
      expect(within(each, bar), id).toBe(true);
      expect(each.x + each.width).toBeLessThanOrEqual(390);
    }
  });
});
