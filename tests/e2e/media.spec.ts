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

/** Double-clicks a media card in the middle, and waits for it to be playing. */
async function play(page: Page, kind: 'video' | 'audio') {
  const box = (await media(page, kind).boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const player = page.locator(`${kind}[data-testid="embed-player"]`);
  await expect(player).toBeVisible();
  await expect
    .poll(() => player.evaluate((node: HTMLMediaElement) => !node.paused && node.currentTime > 0))
    .toBe(true);
  return player;
}

// Checklist item 7, from files.
test('a video and a sound from files play on the board, and after a reload', async ({ page }) => {
  const video = await recordWebm(page);
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-import').click();
  await page.getByTestId('import-file').setInputFiles([
    { name: 'Clip.webm', mimeType: 'video/webm', buffer: video },
    { name: 'Tone.wav', mimeType: 'audio/wav', buffer: toneWav() },
  ]);
  await expect(layerItems(page)).toHaveCount(2);
  await expect(media(page, 'video')).toBeVisible();
  // The video shows its first picture, under a play button, until it is played.
  await expect(media(page, 'video').locator('video')).toHaveAttribute('src', /^blob:/);

  await play(page, 'video');
  await play(page, 'audio');
  // One plays at a time: the sound took over from the video.
  await expect(page.locator('video[data-testid="embed-player"]')).toHaveCount(0);

  await page.reload();
  await expect(layerItems(page)).toHaveCount(2);
  await play(page, 'video');
});

test('a played sound can still be selected by its strip and deleted', async ({ page }) => {
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-import').click();
  await page
    .getByTestId('import-file')
    .setInputFiles({ name: 'Tone.wav', mimeType: 'audio/wav', buffer: toneWav() });
  await expect(layerItems(page)).toHaveCount(1);
  await play(page, 'audio');
  await page.getByTestId('embed-grip').click();
  await page.keyboard.press('Delete');
  await expect(layerItems(page)).toHaveCount(0);
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
