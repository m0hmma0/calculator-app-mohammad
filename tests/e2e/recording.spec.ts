import { expect, test, type Page } from '@playwright/test';

/**
 * Recording presenter view on the signed-out board, with Chromium's stand-in camera
 * and microphone, and the tab ending "— slides" chosen for it when it asks what to
 * record (as a person would choose it).
 */

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
test.use({
  permissions: ['camera', 'microphone'],
  launchOptions: {
    ...(executablePath ? { executablePath } : {}),
    args: [
      '--use-fake-device-for-media-stream',
      '--auto-select-tab-capture-source-by-title=slides',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
});

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board-canvas')).toBeVisible();
});

async function drag(page: Page, key: string, from: [number, number], to: [number, number]) {
  await page.keyboard.press(key);
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 5 });
  await page.mouse.up();
}

async function presenterView(page: Page) {
  await drag(page, 'KeyR', [200, 200], [400, 300]);
  await drag(page, 'KeyF', [80, 140], [560, 420]);
  await drag(page, 'KeyF', [620, 140], [1100, 420]);
  await page.keyboard.press('Escape');
  await page.getByTestId('insert-menu').click();
  const opened = page.context().waitForEvent('page');
  await page.getByTestId('present-presenter-view').click();
  const audience = await opened;
  await expect(audience.getByTestId('audience')).toBeVisible();
  return audience;
}

/** A box's place within the audience window's slide, as fractions of it. */
async function cameraOnSlide(audience: Page) {
  return audience.getByTestId('audience-camera').evaluate((node) => {
    const box = node.getBoundingClientRect();
    return {
      left: box.left / innerWidth,
      top: box.top / innerHeight,
      aspect: box.height / box.width,
      playing: (node as HTMLVideoElement).videoWidth > 0,
    };
  });
}

test('the camera shows on the audience slide, and is moved, sized and shaped from here', async ({
  page,
}) => {
  const audience = await presenterView(page);
  await expect(audience.getByTestId('audience-camera')).toHaveCount(0);

  await page.getByTestId('record-camera').click();
  await expect(page.getByTestId('presenter-camera')).toBeVisible();
  await expect(audience.getByTestId('audience-camera')).toBeVisible();
  await expect.poll(async () => (await cameraOnSlide(audience)).playing).toBe(true);
  // It starts at the bottom right, round.
  const start = await cameraOnSlide(audience);
  expect(start.left).toBeGreaterThan(0.5);
  expect(start.aspect).toBeCloseTo(1, 1);

  // Dragged to the top left here, it goes there on the audience slide too.
  const box = (await page.getByTestId('presenter-camera').boundingBox())!;
  const slide = (await page.getByTestId('stage').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(slide.x + 10, slide.y + 10, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await cameraOnSlide(audience)).left).toBeLessThan(0.1);
  expect((await cameraOnSlide(audience)).top).toBeLessThan(0.1);

  // Sized from its corner: wider there too.
  const before = (await audience.getByTestId('audience-camera').boundingBox())!.width;
  const handle = (await page.getByTestId('presenter-camera-size').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 120, handle.y + 60, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => (await audience.getByTestId('audience-camera').boundingBox())!.width)
    .toBeGreaterThan(before * 1.3);

  // A wide rectangle instead of a circle.
  await page.getByTestId('camera-shape-wide').click();
  await expect.poll(async () => (await cameraOnSlide(audience)).aspect).toBeCloseTo(9 / 16, 1);

  // Kept for next time, and off with presenter view.
  await page.getByTestId('audience-close').click();
  await expect.poll(() => audience.isClosed()).toBe(true);
  const kept = await page.evaluate(() => localStorage.getItem('sabboura:camera-layout'));
  expect(JSON.parse(kept!)).toMatchObject({ shape: 'wide' });
});

test('a recording gives the video with sound, the video alone and the sound alone', async ({
  page,
}) => {
  test.slow();
  const audience = await presenterView(page);
  // A shape no other window here has, so the recording shows which one it is.
  await audience.setViewportSize({ width: 1000, height: 500 });
  await page.getByTestId('record-camera').click();
  await page.getByTestId('record-mic').click();
  await expect(page.getByTestId('record-mic')).toHaveAttribute('aria-checked', 'true');
  await expect(audience.getByTestId('audience-camera')).toBeVisible();

  await page.getByTestId('record-start').click();
  await expect(page.getByTestId('record-time')).toBeVisible();
  await expect(page.getByTestId('record-problem')).toHaveCount(0);
  await page.waitForTimeout(1500);
  await page.getByTestId('slide-next').click();
  await page.waitForTimeout(1000);
  await page.getByTestId('record-pause').click();
  await expect(page.getByTestId('record-time')).toHaveAttribute('data-state', 'paused');
  const paused = await page.getByTestId('record-time').textContent();
  await page.waitForTimeout(1200);
  await expect(page.getByTestId('record-time')).toHaveText(paused!);
  await page.getByTestId('record-resume').click();
  await page.waitForTimeout(1500);
  await page.getByTestId('record-stop').click();

  const result = page.getByTestId('recording-result');
  await expect(result).toBeVisible({ timeout: 20_000 });
  await expect(result.locator('a')).toHaveCount(3);

  // Each one is a file that plays: pictures in the videos, about four seconds long.
  const probe = (testId: string, kind: 'video' | 'audio') =>
    page.getByTestId(testId).evaluate(
      (node, tag) =>
        new Promise<{ width: number; height: number; duration: number; type: string }>(
          (resolve, reject) => {
            const media = document.createElement(tag);
            media.muted = true;
            media.preload = 'auto';
            media.onloadedmetadata = async () => {
              // A recording made in pieces may not know its length until played through.
              if (!Number.isFinite(media.duration)) {
                media.currentTime = 1e9;
                await new Promise((done) => (media.ontimeupdate = done));
              }
              resolve({
                width: (media as HTMLVideoElement).videoWidth ?? 0,
                height: (media as HTMLVideoElement).videoHeight ?? 0,
                duration: media.duration,
                type: (node as HTMLAnchorElement).download,
              });
            };
            media.onerror = () => reject(new Error(`${tag} would not load`));
            media.src = (node as HTMLAnchorElement).href;
          },
        ),
      kind,
    );

  const withSound = await probe('recording-video', 'video');
  const alone = await probe('recording-videoOnly', 'video');
  const sound = await probe('recording-sound', 'audio');
  for (const video of [withSound, alone]) {
    expect(video.type).toMatch(/\.mp4$/);
    expect(video.width).toBeGreaterThan(300);
    // The audience window's shape (2:1), not this window's (16:9).
    expect(video.width / video.height).toBeCloseTo(2, 1);
    expect(video.duration).toBeGreaterThan(2.5);
    expect(video.duration).toBeLessThan(8);
  }
  expect(alone.type).toMatch(/\(video only\)\.mp4$/);
  // M4A where the browser makes AAC; this Chromium does not, so WAV.
  expect(sound.type).toMatch(/\(sound only\)\.(m4a|wav)$/);
  expect(sound.duration).toBeGreaterThan(2.5);

  // A download is the file itself.
  const download = page.waitForEvent('download');
  await page.getByTestId('recording-sound').click();
  expect((await download).suggestedFilename()).toBe(sound.type);
  await expect(page.getByTestId('recording-sound')).toHaveAttribute('data-saved', 'true');

  // Closing before everything is downloaded asks first.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('recording-close').click();
  await expect(result).toHaveCount(0);
});
