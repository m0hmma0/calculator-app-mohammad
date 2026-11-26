import { expect, test, type Page } from '@playwright/test';
import { createBoard, newAccount, signIn } from './accounts';
import { toneWav } from './mediaFixtures';

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
  // It is told to wait (the room cannot tell it from a link made a moment ago), and
  // is shown nothing of the board.
  await stranger.goto(`/#remote=${'x'.repeat(24)}&b=${boardId}`);
  await expect(stranger.getByTestId('remote-status')).toHaveText(/Waiting/);
  await stranger.waitForTimeout(1500);
  await expect(stranger.getByTestId('remote-current')).toHaveCount(0);
  // The real one, at the same moment, works.
  await stranger.goto(real);
  await expect(stranger.getByTestId('remote-slide')).toHaveText(/Slide 1 of 1/);
  await context.close();
  await strangerContext.close();
});

// Asked for on 26 November: the audience window shared as a link — the slides alone,
// on any device, following the presenter, unable to move them.
test('a slides link shows the slides on another device, and cannot move them', async ({
  browser,
}) => {
  const owner = newAccount('watch-link');
  const presenterContext = await browser.newContext();
  const page = await presenterContext.newPage();
  await signIn(page, owner);
  const boardId = await createBoard(page);
  await drag(page, 'KeyF', [80, 140], [320, 320]);
  await drag(page, 'KeyF', [380, 140], [620, 320]);
  await page.keyboard.press('Escape');
  await page.getByTestId('present-start').click();
  await expect(page.getByTestId('presentation-counter')).toHaveText('1 / 2');

  await page.getByTestId('watch-link-open').click();
  await expect(page.getByTestId('watch-link-qr')).toBeVisible();
  // A board with a room: no "only in this browser" note.
  await expect(page.getByTestId('watch-link-local')).toHaveCount(0);
  const link = await page.getByTestId('watch-link-link').inputValue();
  expect(link).toContain('#watch=');
  await page.getByTestId('watch-link-done').click();

  const screenContext = await browser.newContext();
  const screen = await screenContext.newPage();
  await screen.goto(link);
  const audience = screen.getByTestId('audience');
  await expect(audience).toBeVisible();
  await expect(audience).not.toHaveAttribute('data-frame', '');
  const first = (await audience.getAttribute('data-frame'))!;
  // The slide is drawn: its white fills the middle of the dark screen.
  const middle = () =>
    screen.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="audience-canvas"]')!;
      const [r, g, b] = canvas
        .getContext('2d')!
        .getImageData(Math.round(canvas.width / 2), Math.round(canvas.height / 2), 1, 1).data;
      return r! + g! + b!;
    });
  await expect.poll(middle).toBeGreaterThan(600);
  // The presenter moves on; the screen follows.
  await page.keyboard.press('ArrowRight');
  await expect(audience).not.toHaveAttribute('data-frame', first);
  await expect(audience).not.toHaveAttribute('data-frame', '');

  // Sent by hand with the slides link's key, a "next" is ignored: it only looks.
  const watchKey = new URL(link).hash.match(/watch=([\w-]+)/)![1]!;
  await screen.evaluate(
    ([board, key]) =>
      new Promise<void>((resolve) => {
        const ws = new WebSocket(
          `${location.origin.replace('http', 'ws')}/api/boards/${board}/room`,
        );
        ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', token: '', remote: key }));
        ws.onmessage = (event) => {
          if (typeof event.data === 'string' && event.data.includes('"ready"')) {
            ws.send(JSON.stringify({ t: 'remote', action: 'previous' }));
            setTimeout(() => {
              ws.close();
              resolve();
            }, 800);
          }
        };
      }),
    [boardId, watchKey] as const,
  );
  await expect(page.getByTestId('presentation-counter')).toHaveText('2 / 2');

  // The presentation ends: so does the link.
  await page.getByTestId('present-stop').click();
  await expect(screen.getByTestId('audience-link-status')).toHaveText(/has ended/);

  await presenterContext.close();
  await screenContext.close();
});

// Asked for on 26 November: a slides link plays the presenter's sound along, paused and
// played by them, and shows their laser.
test('a slides link plays and pauses with the presenter, and shows the laser', async ({
  browser,
}) => {
  const owner = newAccount('watch-media');
  const presenterContext = await browser.newContext();
  const page = await presenterContext.newPage();
  await signIn(page, owner);
  await createBoard(page);
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-import').click();
  await page
    .getByTestId('import-file')
    .setInputFiles({ name: 'Tone.wav', mimeType: 'audio/wav', buffer: toneWav(6) });
  await expect(page.getByTestId('layers').locator('li')).toHaveCount(1);
  await page.mouse.click(1100, 690);
  await drag(page, 'KeyF', [10, 10], [1150, 700]);
  await page.keyboard.press('Escape');
  await page.getByTestId('present-start').click();
  await page.getByTestId('watch-link-open').click();
  const link = await page.getByTestId('watch-link-link').inputValue();
  await page.getByTestId('watch-link-done').click();

  const screenContext = await browser.newContext();
  const screen = await screenContext.newPage();
  await screen.goto(link);
  await expect(screen.getByTestId('audience')).not.toHaveAttribute('data-frame', '');
  const there = screen.locator('audio[data-element-id]');
  await expect(there).toHaveCount(1);
  const playing = () => there.evaluate((node: HTMLMediaElement) => !node.paused);

  // Space plays the slide's sound here; it plays there too, and pauses with it.
  await page.keyboard.press('Space');
  await expect.poll(playing).toBe(true);
  await page.keyboard.press('Space');
  await expect.poll(playing).toBe(false);

  // The laser drawn here shows there.
  await page.getByTestId('tool-laser').click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(700, 320, { steps: 10 });
  const laserThere = () =>
    screen.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-board-over]')!;
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0;
      for (let index = 3; index < data.length; index += 4) if (data[index]! > 40) painted += 1;
      return painted;
    });
  await expect.poll(laserThere).toBeGreaterThan(100);
  await page.mouse.up();

  await presenterContext.close();
  await screenContext.close();
});
