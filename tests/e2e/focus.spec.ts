import { expect, test, type Page } from '@playwright/test';
import { createBoard, newAccount, signIn } from './accounts';

/**
 * Phase 17d off the board: Tab through the dashboard, Settings and the share dialog.
 * Every control the focus lands on shows a ring, and the focus is never trapped — it
 * comes round to where it started, and Escape leaves the dialog for the button that
 * opened it.
 */

interface Stop {
  key: string;
  ring: boolean;
}

/** Where the focus is, and whether it can be seen there. */
async function stop(page: Page): Promise<Stop | null> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return null;
    const style = getComputedStyle(element);
    const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 1;
    const shadow = style.boxShadow !== 'none' && style.boxShadow !== '';
    const label =
      element.getAttribute('data-testid') ??
      element.getAttribute('aria-label') ??
      element.textContent?.trim().slice(0, 30) ??
      element.tagName;
    // Where it is too: two links with the same words are two stops.
    const box = element.getBoundingClientRect();
    return {
      key: `${element.tagName}:${label}@${Math.round(box.x)},${Math.round(box.y)}`,
      ring: outline || shadow,
    };
  });
}

/**
 * Tabs until the focus comes back to the first stop (or `limit` presses), checking
 * each stop's ring. Returns the stops in order.
 */
async function tabRound(page: Page, limit = 150): Promise<Stop[]> {
  const stops: Stop[] = [];
  for (let presses = 0; presses < limit; presses += 1) {
    await page.keyboard.press('Tab');
    const here = await stop(page);
    if (!here) continue;
    if (stops.length > 0 && here.key === stops[0]!.key) return stops;
    stops.push(here);
  }
  throw new Error(`The focus did not come round within ${limit} presses: ${stops.at(-1)?.key}`);
}

test('the dashboard and Settings: every stop has a ring, and Tab comes round', async ({ page }) => {
  await signIn(page, newAccount('focus'));
  await page
    .getByTestId('new-folder')
    .click()
    .catch(() => {});
  await page.keyboard.press('Escape');

  const dashboard = await tabRound(page);
  expect(dashboard.length).toBeGreaterThan(5);
  expect(dashboard.filter((each) => !each.ring).map((each) => each.key)).toEqual([]);

  await page.getByTestId('nav-settings').click();
  await expect(page).toHaveURL(/settings/);
  const settings = await tabRound(page, 250);
  expect(settings.length).toBeGreaterThan(5);
  expect(settings.filter((each) => !each.ring).map((each) => each.key)).toEqual([]);
});

test('the share dialog: every stop has a ring, and Escape gives the focus back', async ({
  page,
}) => {
  await signIn(page, newAccount('focus-share'));
  await createBoard(page);
  await page.getByTestId('open-share').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('share-dialog')).toBeVisible();
  // Its controls come once the board's sharing has loaded; tab through them then.
  await expect(page.getByTestId('link-enabled')).toBeVisible();
  // The dialog has the focus to begin with.
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="share-dialog"]'))),
    )
    .toBe(true);
  const stops: Stop[] = [];
  for (let presses = 0; presses < 30; presses += 1) {
    const here = await stop(page);
    if (here) stops.push(here);
    const inside = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('[data-testid="share-dialog"]')),
    );
    if (!inside) break;
    await page.keyboard.press('Tab');
  }
  expect(stops.length).toBeGreaterThan(3);
  expect(stops.filter((each) => !each.ring).map((each) => each.key)).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('share-dialog')).toHaveCount(0);
  await expect(page.getByTestId('open-share')).toBeFocused();
});
