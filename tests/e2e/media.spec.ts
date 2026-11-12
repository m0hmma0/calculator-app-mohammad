import { expect, test, type Page } from '@playwright/test';
import { recordWebm, toneWav } from './mediaFixtures';

/**
 * Phase 13 on the signed-out board: a video and a sound file put on the board play
 * there, and — kept in this browser, since there is no server — still play after a
 * reload. storage.spec.ts covers the same on an account board, and links.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board-canvas')).toBeVisible();
});

const layerItems = (page: Page) => page.getByTestId('layers').locator('li');
const media = (page: Page, kind: 'video' | 'audio') =>
  page.locator(`[data-testid="embed-media"][data-media="${kind}"]`);

/** Presses a media card's play button — once, nothing else — and waits for it to play. */
async function play(page: Page, kind: 'video' | 'audio') {
  await media(page, kind).getByTestId('media-play').click();
  const player = page.locator(`${kind}[data-testid="embed-player"]`);
  await expect
    .poll(() => player.evaluate((node: HTMLMediaElement) => !node.paused && node.currentTime > 0))
    .toBe(true);
  return player;
}

const paused = (page: Page, kind: 'video' | 'audio') =>
  page
    .locator(`${kind}[data-testid="embed-player"]`)
    .evaluate((node: HTMLMediaElement) => node.paused);

async function addFiles(
  page: Page,
  files: Array<{ name: string; mimeType: string; buffer: Buffer }>,
) {
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-import').click();
  await page.getByTestId('import-file').setInputFiles(files);
  await expect(layerItems(page)).toHaveCount(files.length);
}

// Checklist item 7, from files.
test('a video and a sound from files play at once, one at a time, and after a reload', async ({
  page,
}) => {
  const video = await recordWebm(page);
  await addFiles(page, [
    { name: 'Clip.webm', mimeType: 'video/webm', buffer: video },
    { name: 'Tone.wav', mimeType: 'audio/wav', buffer: toneWav() },
  ]);
  // Both are players from the start: the video shows its first picture under a play
  // button; nothing needs a double-click first.
  await expect(media(page, 'video').locator('video')).toHaveAttribute('src', /^blob:/);
  await expect(page.getByTestId('media-play')).toHaveCount(2);

  await play(page, 'video');
  await play(page, 'audio');
  // One plays at a time: the sound paused the video.
  expect(await paused(page, 'video')).toBe(true);
  // And nothing to close: the video's play button is back, ready.
  await expect(media(page, 'video').getByTestId('media-play')).toBeVisible();

  await page.reload();
  await expect(layerItems(page)).toHaveCount(2);
  await play(page, 'video');
});

test("a sound's waveform shows where a click plays from, and plays from there", async ({
  page,
}) => {
  await addFiles(page, [{ name: 'Six seconds.wav', mimeType: 'audio/wav', buffer: toneWav(6) }]);
  const wave = media(page, 'audio').getByTestId('media-wave');
  // Its shape is the file's own, not the made-up one used when a file cannot be read.
  await expect(wave).toHaveAttribute('data-real', 'true');
  await expect(media(page, 'audio')).toContainText('Six seconds');

  const box = (await wave.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await expect(page.getByTestId('media-hover-time')).toHaveText('0:03');
  // Clicked four fifths of the way along: it plays from 0:04.8 — at once, well before
  // playing from the start could have got there.
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
  const audio = page.locator('audio[data-testid="embed-player"]');
  await expect
    .poll(() => audio.evaluate((node: HTMLMediaElement) => !node.paused && node.currentTime), {
      timeout: 1500,
    })
    .toBeGreaterThanOrEqual(4.5);
  // The button pauses it, and the time shows where it stopped.
  await media(page, 'audio').getByTestId('media-play').click();
  expect(await paused(page, 'audio')).toBe(true);
  await expect(media(page, 'audio').getByTestId('media-time')).toHaveText(/^0:0[4-6]$/);
});

test('a sound is selected and moved by its card, not its controls', async ({ page }) => {
  await addFiles(page, [{ name: 'Tone.wav', mimeType: 'audio/wav', buffer: toneWav() }]);
  await page.mouse.click(1000, 650);
  // A press on its title is a press on the card: the board's, to select. (The title
  // lets the pointer through, so the press is made where it is, as a person would.)
  const title = (await media(page, 'audio').getByText('Tone').boundingBox())!;
  await page.mouse.click(title.x + title.width / 2, title.y + title.height / 2);
  await expect(page.getByTestId('inspector')).toContainText(/embed/i);
  expect(await paused(page, 'audio')).toBe(true);
  // Dragged by its title, it moves; it did not start playing.
  const x = Number(await page.getByTestId('geo-x').innerText());
  await page.mouse.move(title.x + title.width / 2, title.y + title.height / 2);
  await page.mouse.down();
  await page.mouse.move(title.x + title.width / 2 + 120, title.y + title.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Number(await page.getByTestId('geo-x').innerText())).toBe(x + 120);
  expect(await paused(page, 'audio')).toBe(true);
  await page.keyboard.press('Delete');
  await expect(layerItems(page)).toHaveCount(0);
});

test('locked, a sound and a video still play', async ({ page }) => {
  const video = await recordWebm(page);
  await addFiles(page, [
    { name: 'Clip.webm', mimeType: 'video/webm', buffer: video },
    { name: 'Tone.wav', mimeType: 'audio/wav', buffer: toneWav() },
  ]);
  // Locked for everyone, this person (the owner here) included.
  await page.keyboard.press('ControlOrMeta+KeyA');
  await page.keyboard.press('ControlOrMeta+Shift+KeyL');
  await expect(page.getByTestId('layer-locked')).toHaveCount(2);
  await page.mouse.click(1000, 650);
  await play(page, 'video');
  await play(page, 'audio');
});

test('a file too big for the board is refused, with a reason', async ({ page }) => {
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-import').click();
  await page.getByTestId('import-file').setInputFiles({
    name: 'Long.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.alloc(21 * 1024 * 1024),
  });
  await expect(page.getByTestId('import-status')).toContainText('up to 20 MB');
  await expect(layerItems(page)).toHaveCount(0);
});

test('a playing video pauses on a click on its picture, and ink drawn on it stays on top', async ({
  page,
}) => {
  const video = await recordWebm(page);
  await addFiles(page, [{ name: 'Clip.webm', mimeType: 'video/webm', buffer: video }]);
  await play(page, 'video');

  // A click in the middle of the playing picture pauses it.
  await page.getByTestId('media-tap').click();
  await expect.poll(() => paused(page, 'video')).toBe(true);

  // With the pen, a stroke across it — on top of the video once drawn, not under it.
  const box = (await media(page, 'video').boundingBox())!;
  await page.keyboard.press('KeyP');
  await expect(page.getByTestId('media-tap')).toHaveCount(0);
  const from = { x: box.x + box.width * 0.2, y: box.y + box.height * 0.4 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + box.width * 0.5, from.y + 20, { steps: 10 });
  await page.mouse.up();
  await expect(layerItems(page)).toHaveCount(2);
  const inkOver = await page.evaluate(
    (area) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="board-over"]')!;
      const bounds = canvas.getBoundingClientRect();
      const dpr = canvas.width / bounds.width;
      const data = canvas
        .getContext('2d')!
        .getImageData(
          Math.round((area.x - bounds.left) * dpr),
          Math.round((area.y - bounds.top) * dpr),
          Math.round(area.w * dpr),
          Math.round(area.h * dpr),
        ).data;
      let drawn = 0;
      for (let index = 3; index < data.length; index += 4) if (data[index]! > 0) drawn += 1;
      return drawn / (data.length / 4);
    },
    { x: from.x, y: from.y - 10, w: box.width * 0.5, h: 40 },
  );
  expect(inkOver).toBeGreaterThan(0.02);
});
