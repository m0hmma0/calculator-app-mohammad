import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 15 on the signed-out board: undo that survives closing the board. The same on
 * an account's board, closed and opened from the dashboard, is in workspace.spec.ts.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board-canvas')).toBeVisible();
});

const layers = (page: Page) => page.getByTestId('layers').locator('li');
const geoX = async (page: Page) => Number(await page.getByTestId('geo-x').innerText());

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 5 });
  await page.mouse.up();
}

// Checklist item 1.
test('steps from before a reload are undone, newest first, and redone', async ({ page }) => {
  // Three steps: a rectangle, the rectangle moved, an ellipse.
  await page.keyboard.press('KeyR');
  await drag(page, [300, 300], [400, 380]);
  const drawnAt = await geoX(page);
  await drag(page, [350, 340], [550, 340]);
  const movedTo = await geoX(page);
  expect(movedTo).toBeGreaterThan(drawnAt + 150);
  await page.keyboard.press('KeyO');
  await drag(page, [300, 500], [380, 580]);
  await expect(layers(page)).toHaveCount(2);

  // Closed and opened again, straight away.
  await page.reload();
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  await expect(layers(page)).toHaveCount(2);
  await expect(page.getByTestId('undo')).toBeEnabled();

  await page.keyboard.press('ControlOrMeta+KeyZ');
  await expect(layers(page)).toHaveCount(1);
  await layers(page).first().click();
  await page.keyboard.press('ControlOrMeta+KeyZ');
  await expect.poll(() => geoX(page)).toBe(drawnAt);
  await page.getByTestId('undo').click();
  await expect(layers(page)).toHaveCount(0);
  await expect(page.getByTestId('undo')).toBeDisabled();

  // And forward again.
  await expect(page.getByTestId('redo')).toBeEnabled();
  await page.getByTestId('redo').click();
  await page.getByTestId('redo').click();
  await page.getByTestId('redo').click();
  await expect(layers(page)).toHaveCount(2);
  await expect(page.getByTestId('redo')).toBeDisabled();
});

test("this visit's steps are undone first, then those from before", async ({ page }) => {
  await page.keyboard.press('KeyR');
  await drag(page, [300, 300], [400, 380]);
  await page.reload();
  await expect(layers(page)).toHaveCount(1);

  await page.keyboard.press('KeyO');
  await drag(page, [300, 500], [380, 580]);
  await expect(layers(page)).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+KeyZ');
  await expect(layers(page)).toHaveCount(1);
  // The one left is the rectangle from before the reload, and it goes next.
  await expect(layers(page).first()).toContainText(/rect/i);
  await page.keyboard.press('ControlOrMeta+KeyZ');
  await expect(layers(page)).toHaveCount(0);

  // Undone and then closed: nothing comes back that was not asked for.
  await page.reload();
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  await expect(layers(page)).toHaveCount(0);
});
