import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 14 on the signed-out board: placeholders — a box with a hint that one click
 * types into, whatever the tool, which shows its hint again when emptied.
 * classroom.spec.ts covers the Answer role and locks, which need other people.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board-canvas')).toBeVisible();
});

const layerItems = (page: Page) => page.getByTestId('layers').locator('li');
const editor = (page: Page) => page.getByTestId('text-editor');

/** How much of an area of the canvas is close to a token's colour. */
async function colourFraction(
  page: Page,
  token: string,
  area: { x: number; y: number; w: number; h: number },
) {
  return page.evaluate(
    ([wanted, region]) => {
      const resolved = getComputedStyle(document.documentElement).getPropertyValue(wanted).trim();
      const probe = document.createElement('canvas').getContext('2d')!;
      probe.fillStyle = resolved;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="board-canvas"]')!;
      const bounds = canvas.getBoundingClientRect();
      const dpr = canvas.width / bounds.width;
      const data = canvas
        .getContext('2d')!
        .getImageData(
          Math.round((region.x - bounds.left) * dpr),
          Math.round((region.y - bounds.top) * dpr),
          Math.round(region.w * dpr),
          Math.round(region.h * dpr),
        ).data;
      let near = 0;
      for (let index = 0; index < data.length; index += 4) {
        const distance =
          Math.abs(data[index]! - r!) +
          Math.abs(data[index + 1]! - g!) +
          Math.abs(data[index + 2]! - b!);
        if (distance < 60) near += 1;
      }
      return near / (data.length / 4);
    },
    [token, area] as const,
  );
}

/** Inserts a placeholder with a hint; it lands in the middle of the board. */
async function insertPlaceholder(page: Page, hint: string) {
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-placeholder').click();
  const field = page.getByTestId('placeholder-hint');
  await expect(field).toBeFocused();
  await field.fill(hint);
  await expect(layerItems(page)).toHaveCount(1);
  // The middle of the board, where it is.
  const stage = (await page.getByTestId('stage').boundingBox())!;
  return { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };
}

// Checklist item 1.
test('one click types into a placeholder, whatever the tool; emptied, its hint is back', async ({
  page,
}) => {
  const middle = await insertPlaceholder(page, 'Your name');
  const area = { x: middle.x - 120, y: middle.y - 30, w: 240, h: 60 };
  // Its hint is drawn, faint, while it is empty.
  await page.mouse.click(60, 60);
  await expect.poll(() => colourFraction(page, '--text-muted', area)).toBeGreaterThan(0.004);

  // Holding the pen, one click is a click into it — not a stroke.
  await page.keyboard.press('KeyP');
  await page.mouse.click(middle.x, middle.y);
  await expect(editor(page)).toBeVisible();
  await expect(editor(page)).toHaveAttribute('data-placeholder', 'Your name');
  await page.keyboard.type('Ada');
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  await expect(layerItems(page)).toHaveCount(1);
  // The answer, in the text's own colour; no hint now.
  await expect.poll(() => colourFraction(page, '--text-muted', area)).toBeLessThan(0.002);

  // With the hand, the same: one click, and typing. Emptied, it stays, hint and all.
  await page.keyboard.press('KeyH');
  await page.mouse.click(middle.x, middle.y);
  await expect(editor(page)).toBeVisible();
  await page.keyboard.press('ControlOrMeta+KeyA');
  await page.keyboard.press('Backspace');
  await expect(editor(page)).toHaveAttribute('data-empty');
  await page.keyboard.press('Escape');
  await expect(layerItems(page)).toHaveCount(1);
  await expect.poll(() => colourFraction(page, '--text-muted', area)).toBeGreaterThan(0.004);
});

test('with the select tool, a drag moves a placeholder and a click types into it', async ({
  page,
}) => {
  const middle = await insertPlaceholder(page, 'Answer here');
  await page.keyboard.press('KeyV');
  await page.mouse.click(60, 60);

  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  await page.mouse.move(middle.x + 80, middle.y + 60, { steps: 6 });
  await page.mouse.up();
  await expect(editor(page)).toHaveCount(0);
  await expect(page.getByTestId('geo-x')).toBeVisible();

  await page.mouse.click(middle.x + 80, middle.y + 60);
  await expect(editor(page)).toBeVisible();
});

test('an ordinary text box becomes a placeholder from the side panel, and back', async ({
  page,
}) => {
  await page.keyboard.press('KeyT');
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(600, 360, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.type('Question one');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('placeholder-toggle')).not.toBeChecked();

  await page.getByTestId('placeholder-toggle').check();
  await expect(page.getByTestId('placeholder-hint')).toHaveValue('Click here to write');
  await page.getByTestId('placeholder-toggle').uncheck();
  await expect(page.getByTestId('placeholder-hint')).toHaveCount(0);
});
