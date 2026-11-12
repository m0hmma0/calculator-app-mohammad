import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { recordWebm } from './mediaFixtures';

/**
 * Recording presenter view on the signed-out board, with Chromium's stand-in camera
 * and microphone, and the tab ending "— slides" chosen for it when it asks what to
 * record (as a person would choose it).
 */

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
test.use({
  // Playwright's headless shell has no camera, microphone or tab recording at all;
  // the full Chromium, headless, has all three (CI's run on the shell failed here).
  ...(executablePath ? {} : { channel: 'chromium' }),
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

/** What ffprobe says of a file: its streams, and the times of its key frames. */
function inspect(path: string) {
  const streams = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', path]).toString(),
  ).streams as Array<{ codec_type: string; codec_name: string; width?: number; height?: number }>;
  const keys = execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-skip_frame',
    'nokey',
    '-show_entries',
    'frame=pts_time',
    '-of',
    'csv=p=0',
    path,
  ])
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(Number);
  // Every frame decoded, as an editor would: any damage is an error here.
  const errors = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'null', '-'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();
  return { streams, keys, errors };
}

const hasFfmpeg = (() => {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** A frame of a recorded video, read in the page: how much of each area is the surround. */
async function frameAt(page: Page, testId: string, at: number) {
  return page.getByTestId(testId).evaluate(
    (node, time) =>
      new Promise<{
        width: number;
        height: number;
        right: number;
        bottom: number;
        middleDark: number;
      }>((resolve, reject) => {
        const video = document.createElement('video');
        video.muted = true;
        video.onloadeddata = () => (video.currentTime = time);
        video.onseeked = () => {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const context = canvas.getContext('2d')!;
          context.drawImage(video, 0, 0);
          const dark = (x: number, y: number, w: number, h: number) => {
            const data = context.getImageData(x, y, w, h).data;
            let near = 0;
            for (let index = 0; index < data.length; index += 4) {
              if (data[index]! < 40 && data[index + 1]! < 40 && data[index + 2]! < 50) near += 1;
            }
            return near / (data.length / 4);
          };
          const { videoWidth: w, videoHeight: h } = video;
          resolve({
            width: w,
            height: h,
            right: dark(w - 40, h * 0.3, 30, h * 0.4),
            bottom: dark(w * 0.3, h - 30, w * 0.4, 20),
            middleDark: dark(w * 0.35, h * 0.35, w * 0.3, h * 0.3),
          });
        };
        video.onerror = () => reject(new Error('the video would not load'));
        video.src = (node as HTMLAnchorElement).href;
      }),
    at,
  );
}

test('a recording gives videos at 1080p, sounds apart and together, and all of them at once', async ({
  page,
}) => {
  test.slow();
  const audience = await presenterView(page);
  // A shape no other window here has (2:1): fitted into 16:9 it leaves dark bands
  // above and below, where this window would have its notes and its pane.
  await audience.setViewportSize({ width: 1000, height: 500 });
  await page.getByTestId('record-camera').click();
  await page.getByTestId('record-mic').click();
  await expect(page.getByTestId('record-mic')).toHaveAttribute('aria-checked', 'true');
  await expect(audience.getByTestId('audience-camera')).toBeVisible();
  await expect(page.getByTestId('record-resolution')).toHaveValue('1080');

  await page.getByTestId('record-start').click();
  await expect(page.getByTestId('record-time')).toBeVisible();
  await expect(page.getByTestId('record-problem')).toHaveCount(0);
  // The window is smaller than 1080p: the presenter is told how to make it sharper.
  await expect(page.getByTestId('record-source')).toContainText('from a 1000×500 window');
  await expect(page.getByTestId('record-source')).toContainText('full screen');
  await page.waitForTimeout(2000);
  await page.getByTestId('slide-next').click();
  await page.waitForTimeout(1500);
  await page.getByTestId('record-pause').click();
  await expect(page.getByTestId('record-time')).toHaveAttribute('data-state', 'paused');
  const paused = await page.getByTestId('record-time').textContent();
  await page.waitForTimeout(1200);
  await expect(page.getByTestId('record-time')).toHaveText(paused!);
  await page.getByTestId('record-resume').click();
  await page.waitForTimeout(2000);
  await page.getByTestId('record-stop').click();

  const result = page.getByTestId('recording-result');
  await expect(result).toBeVisible({ timeout: 30_000 });
  for (const kind of ['video', 'videoOnly', 'mix', 'mic', 'slides']) {
    await expect(page.getByTestId(`recording-${kind}`), kind).toBeVisible();
  }

  // The picture holds from start to end: the audience window's slide and dark bands,
  // the same at the start, after the slide changed, and at the end.
  for (const at of [0.2, 2.5, 5]) {
    const frame = await frameAt(page, 'recording-video', at);
    expect(frame).toMatchObject({ width: 1920, height: 1080 });
    expect(frame.right, `right edge at ${at}s`).toBeGreaterThan(0.9);
    expect(frame.bottom, `bottom band at ${at}s`).toBeGreaterThan(0.9);
    expect(frame.middleDark, `slide at ${at}s`).toBeLessThan(0.1);
  }

  // Download all: every file, one after another, each its own whole file.
  const downloads: Array<{ name: string; path: string }> = [];
  page.on('download', async (download) => {
    downloads.push({ name: download.suggestedFilename(), path: (await download.path())! });
  });
  await page.getByTestId('recording-all').click();
  await expect.poll(() => downloads.length, { timeout: 20_000 }).toBe(5);
  await expect.poll(() => downloads.every((each) => each.path)).toBe(true);
  const names = downloads.map((each) => each.name).sort();
  expect(names.filter((name) => name.endsWith('.mp4'))).toHaveLength(2);
  expect(names.some((name) => /\(video only\)\.mp4$/.test(name))).toBe(true);
  // M4A where the browser makes AAC; this Chromium has none, so Opus in OGG.
  for (const label of ['sound only', 'microphone', 'slides sound']) {
    expect(
      names.some((name) => new RegExp(`\\(${label}\\)\\.(m4a|ogg)$`).test(name)),
      label,
    ).toBe(true);
  }

  if (hasFfmpeg) {
    const byName = (pattern: RegExp) => downloads.find((each) => pattern.test(each.name))!.path;
    const full = inspect(byName(/\d\.mp4$/));
    expect(full.errors).toBe('');
    expect(full.streams.map((stream) => stream.codec_type).sort()).toEqual(['audio', 'video']);
    const picture = full.streams.find((stream) => stream.codec_type === 'video')!;
    expect(picture).toMatchObject({ codec_name: 'h264', width: 1920, height: 1080 });
    // A key frame every two seconds, not just the first.
    expect(full.keys.length).toBeGreaterThanOrEqual(3);
    expect(
      Math.max(...full.keys.slice(1).map((time, index) => time - full.keys[index]!)),
    ).toBeLessThan(2.2);
    const alone = inspect(byName(/\(video only\)\.mp4$/));
    expect(alone.errors).toBe('');
    expect(alone.streams.map((stream) => stream.codec_type)).toEqual(['video']);
    const mic = inspect(byName(/\(microphone\)/));
    expect(mic.errors).toBe('');
    expect(mic.streams.map((stream) => stream.codec_type)).toEqual(['audio']);
  }

  // Closing after everything was downloaded does not ask.
  await page.getByTestId('recording-close').click();
  await expect(result).toHaveCount(0);
});

test('720p makes 1280×720 files', async ({ page }) => {
  await presenterView(page);
  await page.getByTestId('record-resolution').selectOption('720');
  await page.getByTestId('record-start').click();
  await expect(page.getByTestId('record-time')).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByTestId('record-stop').click();
  await expect(page.getByTestId('recording-result')).toBeVisible({ timeout: 30_000 });
  const frame = await frameAt(page, 'recording-videoOnly', 0.5);
  expect(frame).toMatchObject({ width: 1280, height: 720 });
  // Remembered for next time.
  expect(await page.evaluate(() => localStorage.getItem('sabboura:recording-resolution'))).toBe(
    '720',
  );
});

test('the camera sits over a video on the slide, not behind it', async ({ page }) => {
  // The camera in the middle of the slide, where the video will be.
  await page.evaluate(() =>
    localStorage.setItem(
      'sabboura:camera-layout',
      JSON.stringify({ x: 0.3, y: 0.3, w: 0.4, shape: 'square' }),
    ),
  );
  await page.reload();
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-import').click();
  await page
    .getByTestId('import-file')
    .setInputFiles({ name: 'Clip.webm', mimeType: 'video/webm', buffer: await recordWebm(page) });
  await expect(page.getByTestId('layers').locator('li')).toHaveCount(1);
  await page.mouse.click(1100, 690);
  await drag(page, 'KeyF', [10, 10], [1150, 700]);
  await page.keyboard.press('Escape');
  await page.getByTestId('insert-menu').click();
  const opened = page.context().waitForEvent('page');
  await page.getByTestId('present-presenter-view').click();
  const audience = await opened;
  await expect(audience.locator('video[data-testid="embed-player"]')).toHaveCount(1);
  await page.getByTestId('record-camera').click();
  const camera = audience.getByTestId('audience-camera');
  await expect(camera).toBeVisible();

  // Where the camera and the video overlap, the camera is what shows.
  const box = (await camera.boundingBox())!;
  const player = (await audience.locator('video[data-testid="embed-player"]').boundingBox())!;
  // The middle of where they overlap (the camera's corners are rounded).
  const left = Math.max(box.x, player.x);
  const right = Math.min(box.x + box.width, player.x + player.width);
  const upper = Math.max(box.y, player.y);
  const lower = Math.min(box.y + box.height, player.y + player.height);
  expect(right - left).toBeGreaterThan(20);
  expect(lower - upper).toBeGreaterThan(20);
  const x = (left + right) / 2;
  const y = (upper + lower) / 2;
  // Nothing there takes the pointer, which hides it from elementsFromPoint: for the
  // test only, everything does.
  await audience.addStyleTag({ content: '* { pointer-events: auto !important; }' });
  const top = await audience.evaluate(
    ([px, py]) => {
      const stack = document.elementsFromPoint(px!, py!);
      const camera = stack.findIndex(
        (node) => node.getAttribute('data-testid') === 'audience-camera',
      );
      const video = stack.findIndex((node) => node.getAttribute('data-testid') === 'embed-player');
      return { camera, video };
    },
    [x, y],
  );
  expect(top.camera).toBeGreaterThanOrEqual(0);
  expect(top.video === -1 || top.camera < top.video).toBe(true);
});

test.describe('nothing recorded is lost', () => {
  /** A finished video's length, read in the page from its download link. */
  const videoLength = (page: Page) =>
    page.getByTestId('recording-videoOnly').evaluate(
      (node) =>
        new Promise<number>((resolve, reject) => {
          const video = document.createElement('video');
          video.muted = true;
          video.onloadedmetadata = () => resolve(video.duration);
          video.onerror = () => reject(new Error('the video would not load'));
          video.src = (node as HTMLAnchorElement).href;
        }),
    );

  test('a recording cut off by a closed tab is offered back, and its files play', async ({
    page,
    context,
  }) => {
    test.slow();
    await presenterView(page);
    await expect(page.getByTestId('record-space')).toContainText('Room for recordings');
    await page.getByTestId('record-start').click();
    await expect(page.getByTestId('record-time')).toBeVisible();
    // Until a few seconds are safe on disk, as the row says.
    await expect
      .poll(
        async () => Number(await page.getByTestId('record-stored').getAttribute('data-seconds')),
        {
          timeout: 30_000,
        },
      )
      .toBeGreaterThanOrEqual(2);
    // As a crash would: the tab gone, no Stop, nothing downloaded.
    await page.close({ runBeforeUnload: false });

    const again = await context.newPage();
    await again.goto('/');
    await expect(again.getByTestId('recording-recovery')).toBeVisible({ timeout: 15_000 });
    await again.getByTestId('recording-recover').click();
    await expect(again.getByTestId('recording-result')).toBeVisible({ timeout: 30_000 });
    // What reached the disk before the tab went: a second or so short of it at most.
    expect(await videoLength(again)).toBeGreaterThan(1.5);

    // Closed without downloading, it is kept, and offered again.
    await again.getByTestId('recording-close').click();
    await expect(again.getByTestId('recording-recovery')).toBeVisible();
    // Deleted, it is gone for good.
    again.once('dialog', (dialog) => void dialog.accept());
    await again.getByTestId('recording-recovery-delete').click();
    await expect(again.getByTestId('recording-recovery')).toHaveCount(0);
    await again.reload();
    await expect(again.getByTestId('board-canvas')).toBeVisible();
    await again.waitForTimeout(1000);
    await expect(again.getByTestId('recording-recovery')).toHaveCount(0);
  });

  test('a chosen folder gets the finished files by themselves', async ({ page }) => {
    test.slow();
    // The computer's own folder picker cannot be driven from a test; a folder in the
    // browser's storage stands in for the one a person would pick.
    await page.addInitScript(() => {
      (window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker =
        async () =>
          (await navigator.storage.getDirectory()).getDirectoryHandle('picked', { create: true });
    });
    await page.reload();
    await expect(page.getByTestId('board-canvas')).toBeVisible();
    await presenterView(page);
    await page.getByTestId('record-folder-choose').click();
    await expect(page.getByTestId('record-folder')).toContainText('picked');

    await page.getByTestId('record-start').click();
    await expect(page.getByTestId('record-time')).toBeVisible();
    await page.waitForTimeout(2000);
    await page.getByTestId('record-stop').click();
    await expect(page.getByTestId('recording-saved-to')).toContainText('picked', {
      timeout: 30_000,
    });
    const saved = await page.evaluate(async () => {
      const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('picked');
      const files: Array<{ name: string; size: number }> = [];
      for await (const [name, handle] of (
        folder as unknown as { entries: () => AsyncIterable<[string, FileSystemFileHandle]> }
      ).entries()) {
        files.push({ name, size: (await handle.getFile()).size });
      }
      return files;
    });
    // Both videos: with sound, and alone.
    expect(saved.filter((file) => file.name.endsWith('.mp4'))).toHaveLength(2);
    expect(saved.find((file) => /\(video only\)\.mp4$/.test(file.name))?.size).toBeGreaterThan(
      1000,
    );
    // Saved there, closing needs no download, and nothing is left to recover.
    await page.getByTestId('recording-close').click();
    await expect(page.getByTestId('recording-result')).toHaveCount(0);
    await page.waitForTimeout(500);
    await expect(page.getByTestId('recording-recovery')).toHaveCount(0);
  });
});
