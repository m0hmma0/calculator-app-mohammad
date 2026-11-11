import { expect, test, type Page } from '@playwright/test';
import { toneWav } from './mediaFixtures';

/**
 * Presenter view on the signed-out board: a second window with only the slides, for
 * sharing or recording a screen, which follows this one and cannot steer it; and
 * here, the usual controls plus each slide's notes.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board-canvas')).toBeVisible();
});

const SURROUND = '#101217';

async function drag(page: Page, key: string, from: [number, number], to: [number, number]) {
  await page.keyboard.press(key);
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 5 });
  await page.mouse.up();
}

/** Three frames in a row; only the right-hand one has a rectangle filling most of it. */
async function threeFrames(page: Page) {
  await drag(page, 'KeyR', [700, 160], [860, 300]);
  await drag(page, 'KeyF', [80, 140], [320, 320]);
  await drag(page, 'KeyF', [380, 140], [620, 320]);
  await drag(page, 'KeyF', [680, 140], [920, 320]);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('layers').locator('li')).toHaveCount(4);
}

/** How much of a canvas's middle is close to a colour (a CSS colour or a token). */
async function middleFraction(page: Page, canvasId: string, colour: string, share = 0.5) {
  return page.evaluate(
    ([id, wanted, part]) => {
      const resolved = wanted.startsWith('--')
        ? getComputedStyle(document.documentElement).getPropertyValue(wanted).trim()
        : wanted;
      const probe = document.createElement('canvas').getContext('2d')!;
      probe.fillStyle = resolved;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
      const canvas = document.querySelector<HTMLCanvasElement>(`[data-testid="${id}"]`)!;
      const w = Math.round(canvas.width * part);
      const h = Math.round(canvas.height * part);
      const data = canvas
        .getContext('2d')!
        .getImageData(
          Math.round((canvas.width - w) / 2),
          Math.round((canvas.height - h) / 2),
          w,
          h,
        ).data;
      let near = 0;
      for (let index = 0; index < data.length; index += 4) {
        const distance =
          Math.abs(data[index]! - r!) +
          Math.abs(data[index + 1]! - g!) +
          Math.abs(data[index + 2]! - b!);
        if (distance < 40) near += 1;
      }
      return near / (data.length / 4);
    },
    [canvasId, colour, share] as const,
  );
}

/** Presents, then opens presenter view from the slide controls; returns its window. */
async function openPresenterView(page: Page) {
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('present-start').click();
  await expect(page.getByTestId('presentation-bar')).toBeVisible();
  const opened = page.context().waitForEvent('page');
  await page.getByTestId('presenter-view').click();
  const audience = await opened;
  await expect(audience.getByTestId('audience')).toBeVisible();
  await expect(page.getByTestId('presenter-notes')).toBeVisible();
  return audience;
}

test.describe('presenter view', () => {
  test('opens a window with only the slide, which follows the presenter', async ({ page }) => {
    await threeFrames(page);
    const audience = await openPresenterView(page);
    await expect(audience).toHaveTitle(/slides/);

    // Nothing to press there: no buttons, no controls, no notes.
    await expect(audience.locator('button:visible')).toHaveCount(0);
    await expect(audience.getByTestId('presenter-notes')).toHaveCount(0);
    await expect(page.getByTestId('presenter-slide')).toHaveText('Slide 1 of 3');

    // Slide 1 is empty: the slide's own white, edge to edge in the middle.
    await expect
      .poll(() => middleFraction(audience, 'audience-canvas', SURROUND))
      .toBeLessThan(0.05);
    expect(await middleFraction(audience, 'audience-canvas', '--shape-1')).toBeLessThan(0.05);

    // The last slide holds the rectangle; the audience window moves with the presenter.
    await page.keyboard.press('End');
    await expect(page.getByTestId('presentation-counter')).toHaveText('3 / 3');
    await expect(page.getByTestId('presenter-next')).toHaveText('Last slide');
    await expect
      .poll(() => middleFraction(audience, 'audience-canvas', '--shape-1'))
      .toBeGreaterThan(0.3);

    // The audience window cannot steer: its keys and clicks do nothing.
    await audience.bringToFront();
    await audience.keyboard.press('Home');
    await audience.keyboard.press('ArrowLeft');
    await audience.mouse.click(200, 200);
    await page.bringToFront();
    await expect(page.getByTestId('presentation-counter')).toHaveText('3 / 3');

    // Ending the presentation closes it.
    await page.getByTestId('present-stop').click();
    await expect.poll(() => audience.isClosed()).toBe(true);
    await expect(page.getByTestId('presenter-notes')).toHaveCount(0);
  });

  test('what is drawn on the slide shows in the audience window at once', async ({ page }) => {
    await threeFrames(page);
    const audience = await openPresenterView(page);
    const before = await middleFraction(audience, 'audience-canvas', '--shape-1');
    expect(before).toBeLessThan(0.05);

    // A rectangle drawn across the middle of the first slide, while presenting.
    const stage = (await page.getByTestId('stage').boundingBox())!;
    const notes = (await page.getByTestId('presenter-notes').boundingBox())!;
    const middle = { x: stage.x + stage.width / 2, y: (stage.y + notes.y) / 2 };
    await drag(page, 'KeyR', [middle.x - 150, middle.y - 60], [middle.x + 150, middle.y + 60]);
    await expect
      .poll(() => middleFraction(audience, 'audience-canvas', '--shape-1', 0.2))
      .toBeGreaterThan(0.3);
  });

  test('closing the audience window keeps presenting here', async ({ page }) => {
    await threeFrames(page);
    const audience = await openPresenterView(page);
    await audience.close();
    await expect(page.getByTestId('presenter-notes')).toHaveCount(0);
    await expect(page.getByTestId('presentation-bar')).toBeVisible();
    await expect(page.getByTestId('presenter-view')).toHaveText('Presenter view');
  });

  test('each slide keeps its own notes, and the arrows type in them', async ({ page }) => {
    await threeFrames(page);
    const audience = await openPresenterView(page);
    const field = page.getByTestId('presenter-notes-field');

    await field.click();
    await page.keyboard.type('Welcome everyone');
    // Arrows and Space are the note's while typing, not the next slide.
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('presentation-counter')).toHaveText('1 / 3');
    await expect(field).toHaveValue('Welcome everyone ');

    await page.getByTestId('slide-next').click();
    await expect(page.getByTestId('presenter-slide')).toHaveText('Slide 2 of 3');
    await expect(field).toHaveValue('');
    await field.fill('The second point');
    await page.getByTestId('slide-previous').click();
    await expect(field).toHaveValue('Welcome everyone ');
    // Not in the audience window.
    await expect(audience.getByText('Welcome everyone')).toHaveCount(0);

    // Kept on the frame: there after presenter view and the presentation end, and
    // after a reload.
    await page.getByTestId('present-stop').click();
    await expect.poll(() => audience.isClosed()).toBe(true);
    await page.waitForTimeout(600);
    await page.reload();
    await expect(page.getByTestId('board-canvas')).toBeVisible();
    await openPresenterView(page);
    await expect(field).toHaveValue('Welcome everyone ');
    await page.getByTestId('slide-next').click();
    await expect(field).toHaveValue('The second point');
  });

  test('a sound played here is heard in the audience window, not twice', async ({ page }) => {
    await page.getByTestId('insert-menu').click();
    await page.getByTestId('insert-import').click();
    await page
      .getByTestId('import-file')
      .setInputFiles({ name: 'Tone.wav', mimeType: 'audio/wav', buffer: toneWav(4) });
    await expect(page.getByTestId('layers').locator('li')).toHaveCount(1);
    // A frame around everything in view: one slide, with the sound on it.
    await page.mouse.click(1100, 690);
    await drag(page, 'KeyF', [10, 10], [1150, 700]);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('layers').locator('li')).toHaveCount(2);

    const audience = await openPresenterView(page);
    const there = audience.locator('audio[data-testid="embed-player"]');
    const here = page.locator('audio[data-testid="embed-player"]');
    await expect(there).toHaveCount(1);
    // Its play button is the presenter's; the audience window shows the card only.
    await expect(audience.getByTestId('media-play')).toBeHidden();

    await page.getByTestId('media-play').click();
    await expect
      .poll(() => there.evaluate((node: HTMLMediaElement) => !node.paused && node.currentTime > 0))
      .toBe(true);
    expect(await there.evaluate((node: HTMLMediaElement) => node.muted)).toBe(false);
    expect(await here.evaluate((node: HTMLMediaElement) => node.muted)).toBe(true);

    await page.getByTestId('media-play').click();
    await expect.poll(() => there.evaluate((node: HTMLMediaElement) => node.paused)).toBe(true);

    // Presenter view over, it is heard here again.
    await page.getByTestId('audience-close').click();
    await expect.poll(() => audience.isClosed()).toBe(true);
    expect(await here.evaluate((node: HTMLMediaElement) => node.muted)).toBe(false);
  });
});
