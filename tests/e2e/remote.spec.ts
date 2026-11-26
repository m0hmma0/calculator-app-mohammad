import { expect, test, type Page } from '@playwright/test';
import { createBoard, newAccount, signIn } from './accounts';

/**
 * Phase 17c on a board with a room: the presenter's remote control link opens
 * presenter view on another device — no sign-in — and moves the slides there; it
 * stops working when the presentation ends.
 */

async function drag(page: Page, key: string, from: [number, number], to: [number, number]) {
  await page.keyboard.press(key);
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 5 });
  await page.mouse.up();
}

test('a remote control link moves the slides from another device, and ends with them', async ({
  browser,
}) => {
  const owner = newAccount('remote');
  const presenterContext = await browser.newContext();
  const page = await presenterContext.newPage();
  await signIn(page, owner);
  await createBoard(page);
  await drag(page, 'KeyF', [80, 140], [320, 320]);
  await drag(page, 'KeyF', [380, 140], [620, 320]);
  await drag(page, 'KeyF', [680, 140], [920, 320]);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('layers').locator('li')).toHaveCount(3);

  await page.getByTestId('present-start').click();
  await expect(page.getByTestId('presentation-counter')).toHaveText('1 / 3');
  await page.getByTestId('remote-open').click();
  await expect(page.getByTestId('remote-qr')).toBeVisible();
  const link = await page.getByTestId('remote-link').inputValue();
  expect(link).toContain('#remote=');
  await page.getByTestId('remote-done').click();

  // Somebody else's phone: no account, nothing but the link.
  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phone = await phoneContext.newPage();
  await phone.goto(link);
  await expect(phone.getByTestId('remote-slide')).toHaveText(/Slide 1 of 3/);
  await expect(phone.getByTestId('remote-current')).toBeVisible();
  await expect(phone.getByTestId('remote-next')).toBeVisible();
  // It is nobody on the board: the presenter's people do not count it.
  await expect(page.getByTestId('peer-avatar')).toHaveCount(0);

  // The phone moves the slides…
  await phone.getByTestId('remote-next-button').tap();
  await expect(page.getByTestId('presentation-counter')).toHaveText('2 / 3');
  await expect(phone.getByTestId('remote-slide')).toHaveText(/Slide 2 of 3/);
  // …and follows the presenter's own moves.
  await page.keyboard.press('ArrowRight');
  await expect(phone.getByTestId('remote-slide')).toHaveText(/Slide 3 of 3/);
  await expect(phone.getByTestId('remote-next-button')).toBeDisabled();
  await phone.getByTestId('remote-previous').tap();
  await expect(page.getByTestId('presentation-counter')).toHaveText('2 / 3');

  // The presentation ends: so does the link, for this phone and any other.
  await page.getByTestId('present-stop').click();
  await expect(phone.getByTestId('remote-status')).toHaveText(/has ended/);
  const late = await phoneContext.newPage();
  await late.goto(link);
  await expect(late.getByTestId('remote-status')).toHaveText(/has ended/);

  await presenterContext.close();
  await phoneContext.close();
});

test('a made-up remote key is refused while a real one works, and gets nothing', async ({
  browser,
}) => {
  const owner = newAccount('remote-forged');
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, owner);
  const boardId = await createBoard(page);
  await drag(page, 'KeyF', [80, 140], [320, 320]);
  await page.keyboard.press('Escape');
  await page.getByTestId('present-start').click();
  await page.getByTestId('remote-open').click();
  const real = await page.getByTestId('remote-link').inputValue();
  const strangerContext = await browser.newContext();
  const stranger = await strangerContext.newPage();
  // The same board, a key of the right shape that is not the presenter's.
  await stranger.goto(`/#remote=${'x'.repeat(24)}&b=${boardId}`);
  await expect(stranger.getByTestId('remote-status')).toHaveText(/has ended/);
  await expect(stranger.getByTestId('remote-current')).toHaveCount(0);
  // The real one, at the same moment, works.
  await stranger.goto(real);
  await expect(stranger.getByTestId('remote-slide')).toHaveText(/Slide 1 of 1/);
  await context.close();
  await strangerContext.close();
});
