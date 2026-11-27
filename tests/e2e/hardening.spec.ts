import { expect, test, type Page } from '@playwright/test';
import { API, createBoard, newAccount, signIn, tokenFor } from './accounts';

/**
 * Phase 18: a board the size a busy term produces, opened on a device that has never
 * seen it. 5,000 shapes from the renderer panel plus 50 photographs of different
 * content (so nothing is deduplicated), stored through the real upload path.
 */

const total = (page: Page) =>
  page.getByTestId('stat-visible').evaluate((node) => node.textContent!.split('/')[1]!.trim());

async function openRenderer(page: Page) {
  await page.keyboard.press('ControlOrMeta+KeyK');
  await page.getByTestId('command-dev-panel').click();
}

/** Pastes `count` different photographs (noisy JPEGs, about 100 kB each) at once. */
async function pastePhotos(page: Page, count: number) {
  await page.evaluate(async (n) => {
    const transfer = new DataTransfer();
    for (let i = 0; i < n; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 800;
      const ctx = canvas.getContext('2d')!;
      const gradient = ctx.createLinearGradient(0, 0, 1200, 800);
      gradient.addColorStop(0, `hsl(${(i * 37) % 360} 70% 50%)`);
      gradient.addColorStop(1, `hsl(${(i * 37 + 120) % 360} 60% 40%)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1200, 800);
      const noise = ctx.getImageData(0, 0, 1200, 800);
      let seed = i + 1;
      for (let p = 0; p < noise.data.length; p += 4) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        const shift = (seed >>> 24) - 128;
        noise.data[p] = noise.data[p]! + shift / 4;
        noise.data[p + 1] = noise.data[p + 1]! + shift / 4;
      }
      ctx.putImageData(noise, 0, 0);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((result) => resolve(result!), 'image/jpeg', 0.8),
      );
      transfer.items.add(new File([blob], `photo-${i}.jpg`, { type: 'image/jpeg' }));
    }
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true }));
  }, count);
}

test('a board of 5,000 items and 50 photographs opens in a few seconds on a new device', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const account = newAccount('load');
  const making = await browser.newContext();
  const a = await making.newPage();
  await signIn(a, account);
  const boardId = await createBoard(a);

  await openRenderer(a);
  await a.getByTestId('load-5000').click();
  await expect.poll(() => total(a)).toBe('5,000');
  await a.mouse.click(600, 360);
  await pastePhotos(a, 50);
  await expect.poll(() => total(a), { timeout: 120_000 }).toBe('5,050');
  // Every photograph uploaded, and the room has had time to write its log.
  await expect(a.getByTestId('status-uploading')).toHaveCount(0, { timeout: 120_000 });
  await a.waitForTimeout(3000);
  await making.close();

  // A new device: no IndexedDB copy, no cached pictures.
  const fresh = await browser.newContext();
  const b = await fresh.newPage();
  await signIn(b, account);
  let pictures = 0;
  let pictureBytes = 0;
  b.on('response', (response) => {
    if (/\/api\/files\/[0-9a-f]{64}$/.test(response.url()) && response.status() === 200) {
      pictures += 1;
      pictureBytes += Number(response.headers()['content-length'] ?? 0);
    }
  });
  // A mid-range phone on 4G: a quarter of this machine's speed (CI's runner is slower
  // already, so half there), 9 Mbit/s, 150 ms away. Chrome's emulation is harsher on
  // a WebSocket than a real network: the board's 0.27 MB takes it about two seconds.
  const cdp = await fresh.newCDPSession(b);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: process.env.CI ? 2 : 4 });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (9 * 1024 * 1024) / 8,
    uploadThroughput: (3 * 1024 * 1024) / 8,
  });
  const started = Date.now();
  await b.goto(`/b/${boardId}`);
  await expect(b.getByTestId('board-canvas')).toBeVisible();
  const drawn = Date.now() - started;
  await openRenderer(b);
  await expect.poll(() => total(b), { timeout: 30_000, intervals: [100] }).toBe('5,050');
  const everything = Date.now() - started;
  await expect.poll(() => pictures, { timeout: 30_000, intervals: [100] }).toBeGreaterThan(0);
  const firstPicture = Date.now() - started;
  test.info().annotations.push({
    type: 'timing',
    description: `canvas ${drawn} ms, all 5,050 items ${everything} ms, first picture ${firstPicture} ms, ${pictures} pictures (${Math.round(pictureBytes / 1024)} kB) fetched by then`,
  });
  console.log(test.info().annotations.at(-1)!.description);
  expect(everything).toBeLessThan(6000);
  await fresh.close();
});

const layerIds = (page: Page) =>
  page
    .getByTestId('layers')
    .locator('[data-testid^="layer-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')!.slice(6)));

/**
 * Draws a rectangle and returns its id, checking it is a new one. Before Phase 18 two
 * windows drawing in the same millisecond made the same id, and one shape replaced
 * the other on every screen.
 */
async function drawRect(page: Page, x: number, y: number): Promise<string> {
  const selected = page.locator('[data-testid^="layer-"][aria-selected="true"]');
  const before = (await selected.count()) === 1 ? await selected.getAttribute('data-testid') : null;
  await page.keyboard.press('KeyR');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 30, y + 24, { steps: 3 });
  await page.mouse.up();
  await expect(selected).toHaveCount(1);
  const now = await selected.getAttribute('data-testid');
  expect(now).not.toBe(before);
  return now!.slice(6);
}

test('five people editing one board at once: no lag spikes, and every window ends the same', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const owner = newAccount('five');
  const people = [owner, ...[1, 2, 3, 4].map((n) => newAccount(`five-${n}`))];
  const contexts = await Promise.all(people.map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));

  await signIn(pages[0]!, owner);
  const boardId = await createBoard(pages[0]!);
  for (const person of people.slice(1)) {
    const shared = await fetch(`${API}/api/shares/board/${boardId}/people`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await tokenFor(owner)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: `${person.uid}@example.test`, role: 'editor' }),
    });
    expect(shared.ok).toBe(true);
  }
  await Promise.all(
    pages.slice(1).map(async (page, index) => {
      await signIn(page, people[index + 1]!);
      await page.goto(`/b/${boardId}`);
    }),
  );
  for (const page of pages) {
    await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');
    await expect(page.getByTestId('peer-avatar')).toHaveCount(4);
  }

  // Everyone draws at the same time: twelve shapes each, in a column of their own.
  await Promise.all(
    pages.map(async (page, who) => {
      for (let n = 0; n < 12; n += 1) await drawRect(page, 60 + who * 170, 60 + n * 45);
    }),
  );

  for (const page of pages) {
    await expect.poll(async () => (await layerIds(page)).length, { timeout: 15_000 }).toBe(60);
  }

  // While four keep drawing, the fifth draws one shape at a time and times how long
  // each takes to show in every other window.
  const delays: number[] = [];
  const busy = Promise.all(
    pages.slice(1).map(async (page, who) => {
      for (let n = 0; n < 6; n += 1) await drawRect(page, 60 + n * 45 + who * 6, 610 + who * 8);
    }),
  );
  for (let probe = 0; probe < 5; probe += 1) {
    const before = new Set(await layerIds(pages[0]!));
    const id = await drawRect(pages[0]!, 860, 60 + probe * 100);
    expect(before.has(id)).toBe(false);
    const drawn = Date.now();
    await Promise.all(
      pages.slice(1).map(async (page) => {
        await expect(page.getByTestId(`layer-${id}`)).toHaveCount(1, { timeout: 10_000 });
        delays.push(Date.now() - drawn);
      }),
    );
  }
  await busy;

  // Same things, in the same order, in every window.
  const expected = 5 * 12 + 4 * 6 + 5;
  await expect
    .poll(async () => (await layerIds(pages[0]!)).length, { timeout: 15_000 })
    .toBe(expected);
  const reference = await layerIds(pages[0]!);
  for (const page of pages.slice(1)) {
    await expect.poll(() => layerIds(page), { timeout: 15_000 }).toEqual(reference);
  }

  delays.sort((x, y) => x - y);
  const report = `seen by the other four: median ${delays[Math.floor(delays.length / 2)]} ms, worst ${delays.at(-1)} ms (${delays.length} sightings)`;
  test.info().annotations.push({ type: 'timing', description: report });
  console.log(report);
  // The poll above checks every 100 ms or so, so this includes its own slack.
  expect(delays.at(-1)!).toBeLessThan(1500);
  await Promise.all(contexts.map((context) => context.close()));
});

test('an error in the browser is reported, and a crashed screen offers a reload', async ({
  page,
}) => {
  await signIn(page, newAccount('errors'));
  await createBoard(page);
  await openRenderer(page);

  const reported = () =>
    page.waitForRequest((request) => request.url().endsWith('/api/errors'), { timeout: 10_000 });

  let sending = reported();
  await page.getByTestId('test-error').click();
  let request = await sending;
  expect((await request.response())?.status()).toBe(200);
  const report = request.postDataJSON() as Record<string, string>;
  expect(report.message).toBe('Error: Test error from the Renderer panel');
  expect(report.where).toBe('window');
  expect(report.stack).toContain('Test error');
  expect(report.release).toMatch(/^[0-9a-f]{12}|unknown/);
  expect(report.path).toMatch(/^\/b\/brd_/);

  // A screen that throws while drawing: a way out instead of a blank page.
  sending = reported();
  await page.getByTestId('test-crash').click();
  request = await sending;
  expect(request.postDataJSON().where).toBe('render');
  await expect(page.getByTestId('crash-screen')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
});

test('hammering the API in a loop gets a clear "too many requests", and nobody else does', async () => {
  test.setTimeout(120_000);
  // The test backend counts only requests that name a key, as each caller's address is
  // counted in production.
  const hammer = `hammer-${Math.random().toString(36).slice(2)}`;
  const statuses: number[] = [];
  let refusal: Response | null = null;
  for (let round = 0; round < 14 && !refusal; round += 1) {
    const replies = await Promise.all(
      Array.from({ length: 100 }, () =>
        fetch(`${API}/api/workspace`, { headers: { 'x-rate-key': hammer } }),
      ),
    );
    for (const reply of replies) {
      statuses.push(reply.status);
      if (reply.status === 429) refusal ??= reply;
    }
  }
  expect(refusal, `statuses seen: ${[...new Set(statuses)].join(', ')}`).not.toBeNull();
  expect(await refusal!.json()).toEqual({
    error: 'Too many requests. Wait a minute, then try again.',
  });
  expect(refusal!.headers.get('retry-after')).toBe('60');
  // Never a crash: everything before the limit was answered as usual (401: no sign-in).
  expect(statuses.filter((status) => status !== 401 && status !== 429)).toEqual([]);

  // Someone else, at the same moment, is let through.
  const other = await fetch(`${API}/api/workspace`, {
    headers: { 'x-rate-key': `${hammer}-other` },
  });
  expect(other.status).toBe(401);

  // Link previews, which fetch another site each time, are limited much sooner.
  const unfurls = await Promise.all(
    Array.from({ length: 70 }, () =>
      fetch(`${API}/api/unfurl?url=x`, { headers: { 'x-rate-key': `${hammer}-unfurl` } }),
    ),
  );
  expect(unfurls.some((reply) => reply.status === 429)).toBe(true);
});

test('a page flooding its board with messages is cut off, and reconnects', async ({ page }) => {
  const account = newAccount('flood');
  await signIn(page, account);
  const boardId = await createBoard(page);
  const token = await tokenFor(account);
  const closed = await page.evaluate(
    async ([id, value]) => {
      const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/api/boards/${id}/room`);
      return new Promise<number>((resolve) => {
        ws.onclose = (event) => resolve(event.code);
        ws.onmessage = (event) => {
          if (typeof event.data !== 'string' || !event.data.includes('"ready"')) return;
          const presence = JSON.stringify({
            t: 'presence',
            state: {
              cursor: { x: 1, y: 1 },
              selection: [],
              view: { x: 0, y: 0, zoom: 1, width: 100, height: 100 },
              laser: null,
              chat: null,
              spotlight: false,
            },
          });
          for (let n = 0; n < 2000; n += 1) ws.send(presence);
        };
        ws.onopen = () =>
          ws.send(JSON.stringify({ t: 'auth', token: value, tab: 'flood-test-tab' }));
      });
    },
    [boardId, token] as const,
  );
  expect(closed).toBe(4429);
  // The board's own page was never part of it, and is still connected.
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');
});
