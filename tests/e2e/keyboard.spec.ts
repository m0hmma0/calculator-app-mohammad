import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 17d on the signed-out board: the board without a mouse. Tab reaches the
 * board, a tool's key and Enter put a shape, a note or a text box in the middle of
 * the view, Tab walks through what is there, Enter types into it — and Tab moves on
 * past the last item, so the focus is never trapped.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board-canvas')).toBeVisible();
});

const layerItems = (page: Page) => page.getByTestId('layers').locator('li');
const focusedTestId = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);

/** Tabs from wherever the focus is until the board has it. */
async function tabToBoard(page: Page) {
  for (let presses = 0; presses < 120; presses += 1) {
    if ((await focusedTestId(page)) === 'stage') return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Tab never reached the board');
}

test('a shape, a note and text made, reached and typed into from the keyboard alone', async ({
  page,
}) => {
  await tabToBoard(page);
  // The board shows that it has the focus.
  const ring = await page
    .getByTestId('stage')
    .evaluate((node) => getComputedStyle(node).outlineStyle);
  expect(ring).not.toBe('none');

  // A rectangle: its key, then Enter.
  await page.keyboard.press('KeyR');
  await page.keyboard.press('Enter');
  await expect(layerItems(page)).toHaveCount(1);
  await expect(page.getByTestId('board-announce')).toHaveText('Rectangle, 1 of 1');

  // Enter again types into it; Escape ends the typing and the board keeps the focus.
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.type('Start');
  await page.keyboard.press('Escape');
  await expect.poll(() => focusedTestId(page)).toBe('stage');
  await expect(page.getByTestId('board-announce')).toHaveText('Rectangle: Start, 1 of 1');

  // A note goes straight to typing.
  await page.keyboard.press('KeyN');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.type('Second');
  await page.keyboard.press('Escape');
  await expect(layerItems(page)).toHaveCount(2);
  await expect.poll(() => focusedTestId(page)).toBe('stage');

  // Escape lets go of the selection.
  await page.keyboard.press('Escape');
  // Nothing selected: Tab starts at the first in reading order.
  await page.keyboard.press('Tab');
  const first = await page.getByTestId('board-announce').innerText();
  await page.keyboard.press('Tab');
  const second = await page.getByTestId('board-announce').innerText();
  expect(new Set([first, second]).size).toBe(2);
  expect(first + second).toContain('Note: Second');
  expect(first + second).toContain('Rectangle: Start');
  // Shift+Tab goes back.
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('board-announce')).toHaveText(first);

  // Past the last item, Tab leaves the board for the next control.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect.poll(() => focusedTestId(page)).not.toBe('stage');
  await expect(page.getByTestId('board-announce')).toHaveText('');
});

test('text from the keyboard: T, Enter, type', async ({ page }) => {
  await tabToBoard(page);
  await page.keyboard.press('KeyT');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.type('Typed here');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('board-announce')).toHaveText('Text: Typed here, 1 of 1');
  // Delete removes what is selected, as it always has.
  await page.keyboard.press('Delete');
  await expect(layerItems(page)).toHaveCount(0);
});

test('Enter on a button is the button’s, not the board’s', async ({ page }) => {
  await page.keyboard.press('KeyR');
  await page.getByTestId('insert-menu').focus();
  await page.keyboard.press('Enter');
  await expect(layerItems(page)).toHaveCount(0);
});
