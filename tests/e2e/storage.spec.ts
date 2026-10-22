import { createHash } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { API, createBoard, newAccount, signIn, tokenFor } from './accounts';

/**
 * Phase 6: images live in R2, once each, named by their hash. Everything here runs
 * against the real Worker with local R2 and D1 — the same code that serves
 * production, so a stored object here is a stored object there.
 */

const FILE_REQUEST = /\/api\/files\/([0-9a-f]{64})(\/attach)?(\?|$)/;
const GREEN = [0x2f, 0x9e, 0x7e] as const;

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/**
 * Images are shared across every account, and the local database outlives a run, so
 * each test marks its pictures with its own nonce. Without it a picture from an
 * earlier run would still be "in use" — correctly — and cleanup could not be seen.
 */
let nonce = 0;
test.beforeEach(() => {
  nonce = Math.floor(Math.random() * 0xffffff);
});

/**
 * Pastes a generated picture the way a screenshot arrives from the clipboard, and
 * returns the SHA-256 of the pasted bytes — which is the stored file id for any
 * image small enough to be kept as it is. `seed` changes the colours, and so the hash;
 * within a test, the same seed and size always produce the same bytes.
 */
async function pasteImage(
  page: Page,
  { width, height, seed }: { width: number; height: number; seed: number },
) {
  return page.evaluate(
    async ([w, h, s, run]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w!;
      canvas.height = h!;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = `hsl(${(s! * 67) % 360} 55% 50%)`;
      ctx.fillRect(0, 0, w!, h!);
      ctx.fillStyle = '#2f9e7e';
      ctx.fillRect(0, 0, w! / 2, h! / 2);
      ctx.fillStyle = `#${run!.toString(16).padStart(6, '0')}`;
      ctx.fillRect(w! - 4, h! - 4, 4, 4);

      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((result) => resolve(result!), 'image/png'),
      );
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'pasted.png', { type: 'image/png' }));
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true }));

      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    },
    [width, height, seed, nonce] as const,
  );
}

/** Fraction of the board's pixels close to a colour — read from the canvas itself. */
async function colourFraction(page: Page, rgb: readonly number[]) {
  return page.evaluate((target) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="board-canvas"]')!;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let near = 0;
    for (let index = 0; index < data.length; index += 4) {
      const distance =
        Math.abs(data[index]! - target[0]!) +
        Math.abs(data[index + 1]! - target[1]!) +
        Math.abs(data[index + 2]! - target[2]!);
      if (distance < 40) near += 1;
    }
    return near / (data.length / 4);
  }, rgb);
}

async function waitForUploads(page: Page) {
  await expect(page.getByTestId('status-uploading')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId('status-upload-waiting')).toHaveCount(0);
}

const layers = (page: Page) => page.getByTestId('layers').locator('li');

async function fileStatus(request: APIRequestContext, fileId: string) {
  return (await request.get(`${API}/api/files/${fileId}`)).status();
}

test.describe('storing images', () => {
  // Checklist items 1, 2, 3 and 6 — item 3, one stored copy, is the gate.
  test('an image shows at once, uploads once, and is there from another device', async ({
    page,
    browser,
    request,
  }) => {
    const account = newAccount('images');
    await signIn(page, account);
    const boardId = await createBoard(page);

    // Slow the upload down enough to see what happens while it is on its way.
    let uploads = 0;
    await page.route(FILE_REQUEST, async (route) => {
      if (route.request().method() === 'PUT') {
        uploads += 1;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      await route.continue();
    });

    await page.mouse.move(640, 420);
    const fileId = await pasteImage(page, { width: 1200, height: 800, seed: 1 });

    // Item 1: it is on the board straight away — blurred, with progress showing.
    await expect(page.getByTestId('status-uploading')).toBeVisible();
    await expect(layers(page)).toHaveCount(1);
    expect(await colourFraction(page, GREEN)).toBeGreaterThan(0.005);

    await waitForUploads(page);
    expect(uploads).toBe(1);

    // Item 3: the same picture again is recognised and not sent a second time.
    const again = await pasteImage(page, { width: 1200, height: 800, seed: 1 });
    expect(again).toBe(fileId);
    await expect(layers(page)).toHaveCount(2);
    await waitForUploads(page);
    expect(uploads).toBe(1);

    // Item 6: the board records what it stores — one copy, not two.
    const stored = await request.get(`${API}/api/files/${fileId}`);
    expect(stored.status()).toBe(200);
    const size = (await stored.body()).length;

    await page.getByTestId('back-to-boards').click();
    await expect(page.getByTestId(`storage-${boardId}`)).toBeVisible({ timeout: 15_000 });
    const workspace = await request.get(`${API}/api/workspace`, {
      headers: { authorization: `Bearer ${await tokenFor(account)}` },
    });
    const { boards } = (await workspace.json()) as {
      boards: Array<{ id: string; storageBytes: number }>;
    };
    expect(boards.find((board) => board.id === boardId)?.storageBytes).toBe(size);

    // Item 2: somewhere else entirely, the image arrives from storage.
    const elsewhere = await browser.newContext();
    const second = await elsewhere.newPage();
    await signIn(second, account);
    const fetched = second.waitForResponse(
      (response) => response.url().endsWith(`/api/files/${fileId}`) && response.status() === 200,
    );
    await second.goto(`/b/${boardId}`);
    await fetched;
    await expect(layers(second)).toHaveCount(2);
    await expect
      .poll(() => colourFraction(second, GREEN), { timeout: 10_000 })
      .toBeGreaterThan(0.01);
    await elsewhere.close();
  });

  // Checklist item 5.
  test('a huge picture is downsampled before it is uploaded', async ({ page }) => {
    await signIn(page, newAccount('huge'));
    await createBoard(page);

    const uploaded = page.waitForRequest(
      (request) => request.method() === 'PUT' && FILE_REQUEST.test(request.url()),
    );
    const original = await pasteImage(page, { width: 5000, height: 3000, seed: 4 });
    const fileId = FILE_REQUEST.exec((await uploaded).url())![1]!;
    await waitForUploads(page);

    // What was stored is not what was pasted…
    expect(fileId).not.toBe(original);

    const [width, height] = await page.evaluate(async (id) => {
      const blob = await (await fetch(`/api/files/${id}`)).blob();
      const bitmap = await createImageBitmap(blob);
      return [bitmap.width, bitmap.height];
    }, fileId);

    // …it is the same picture, at most 2048px on its longest side.
    expect(Math.max(width!, height!)).toBe(2048);
    expect(width! / height!).toBeCloseTo(5000 / 3000, 2);
  });

  // Checklist item 7.
  test('an image no board uses is removed when the trash is emptied — and not before', async ({
    page,
    request,
  }) => {
    const account = newAccount('cleanup');
    await signIn(page, account);
    const storageOf = async (boardId: string) => {
      const response = await request.get(`${API}/api/workspace`, {
        headers: { authorization: `Bearer ${await tokenFor(account)}` },
      });
      const { boards } = (await response.json()) as {
        boards: Array<{ id: string; storageBytes: number }>;
      };
      return boards.find((board) => board.id === boardId)?.storageBytes;
    };

    const first = await createBoard(page);
    const shared = await pasteImage(page, { width: 300, height: 200, seed: 7 });
    const only = await pasteImage(page, { width: 300, height: 200, seed: 8 });
    await expect(layers(page)).toHaveCount(2);
    await waitForUploads(page);

    // Another board uses one of the two pictures as well.
    await page.getByTestId('back-to-boards').click();
    const other = await createBoard(page);
    expect(await pasteImage(page, { width: 300, height: 200, seed: 7 })).toBe(shared);
    await waitForUploads(page);
    await page.getByTestId('back-to-boards').click();

    // Delete both images from the first board and let that save land.
    await page.getByTestId(`board-${first}`).getByRole('link').first().click();
    await expect(layers(page)).toHaveCount(2);
    await page.getByTestId('board-canvas').click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('ControlOrMeta+KeyA');
    await page.keyboard.press('Delete');
    await expect(layers(page)).toHaveCount(0);
    await page.getByTestId('back-to-boards').click();
    // The server agrees the board no longer uses them once the save has landed.
    await expect.poll(() => storageOf(first), { timeout: 10_000 }).toBe(0);

    // Undo could still bring them back, so nothing is removed yet.
    expect(await fileStatus(request, only)).toBe(200);

    page.on('dialog', (dialog) => void dialog.accept());
    await page.getByTestId('nav-trash').click();
    await page.getByTestId('empty-trash').click();

    await expect.poll(() => fileStatus(request, only)).toBe(404);
    // Still on the other board, so still stored.
    expect(await fileStatus(request, shared)).toBe(200);

    // Once that board is gone for good, so is the picture.
    await page.getByTestId('nav-all').click();
    await page.getByTestId(`trash-${other}`).click();
    await page.getByTestId('nav-trash').click();
    await page.getByTestId('empty-trash').click();
    await expect.poll(() => fileStatus(request, shared)).toBe(404);
  });

  test('a board from before Phase 6 has its inline images moved into storage', async ({
    page,
    request,
  }) => {
    const account = newAccount('legacy');
    const auth = { authorization: `Bearer ${await tokenFor(account)}` };
    await signIn(page, account);

    const created = await request.post(`${API}/api/boards`, {
      headers: auth,
      data: { title: 'Old board', folderId: null },
    });
    const { board } = (await created.json()) as { board: { id: string } };

    // What Phase 5 saved: an image element carrying its picture as a data URL.
    const dataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 120;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#2f9e7e';
      ctx.fillRect(0, 0, 160, 120);
      return canvas.toDataURL('image/png');
    });
    const doc = new Y.Doc();
    const element = new Y.Map<unknown>();
    doc.getMap('elements').set('old-image', element);
    for (const [key, value] of Object.entries({
      id: 'old-image',
      type: 'image',
      x: 100,
      y: 100,
      w: 160,
      h: 120,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      z: 'a0',
      parentId: null,
      image: { src: dataUrl, naturalWidth: 160, naturalHeight: 120 },
    })) {
      element.set(key, value);
    }
    element.set('style', new Y.Map());
    const legacy = await request.put(`${API}/api/boards/${board.id}/snapshot`, {
      headers: { ...auth, 'content-type': 'application/octet-stream', 'x-board-meta': '{}' },
      data: Buffer.from(Y.encodeStateAsUpdate(doc)),
    });
    expect(legacy.ok()).toBe(true);

    const expected = sha256(Buffer.from(dataUrl.split(',')[1]!, 'base64'));
    await page.goto(`/b/${board.id}`);
    await expect(layers(page)).toHaveCount(1);
    await waitForUploads(page);
    expect(await fileStatus(request, expected)).toBe(200);

    // The board's room writes the saved copy a moment after the change reaches it.
    const storedImage = async () => {
      const snapshot = await request.get(`${API}/api/boards/${board.id}/snapshot`, {
        headers: auth,
      });
      const after = new Y.Doc();
      Y.applyUpdate(after, new Uint8Array(await snapshot.body()));
      return (after.getMap('elements').get('old-image') as Y.Map<unknown>).get('image') as {
        src: string;
        fileId?: string;
      };
    };
    await expect.poll(async () => (await storedImage()).fileId, { timeout: 15_000 }).toBe(expected);
    const image = await storedImage();
    expect(image.src).toBe(`/api/files/${expected}`);
  });
});

test.describe('the file API', () => {
  async function boardFor(request: APIRequestContext, label: string) {
    const token = await tokenFor(newAccount(label));
    const response = await request.post(`${API}/api/boards`, {
      headers: { authorization: `Bearer ${token}` },
      data: { title: 'Files', folderId: null },
    });
    const { board } = (await response.json()) as { board: { id: string } };
    return { token, boardId: board.id };
  }

  const put = (
    request: APIRequestContext,
    hash: string,
    bytes: Buffer,
    options: { token?: string; boardId: string; type?: string },
  ) =>
    request.put(`${API}/api/files/${hash}?board=${options.boardId}`, {
      headers: {
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        'content-type': options.type ?? 'image/png',
      },
      data: bytes,
    });

  // Checklist item 4.
  test('serves a stored image to anyone, cached for good', async ({ request }) => {
    const { token, boardId } = await boardFor(request, 'cache');
    const bytes = Buffer.from(`cache-test-${Math.random()}`);
    const hash = sha256(bytes);
    expect((await put(request, hash, bytes, { token, boardId })).status()).toBe(201);

    // No sign-in at all: the hash is the capability.
    const response = await request.get(`${API}/api/files/${hash}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('immutable');
    expect(response.headers()['etag']).toBe(`"${hash}"`);
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(await response.body())).toEqual(bytes);

    const revalidated = await request.get(`${API}/api/files/${hash}`, {
      headers: { 'if-none-match': `"${hash}"` },
    });
    expect(revalidated.status()).toBe(304);
  });

  test('refuses bytes that do not match their name', async ({ request }) => {
    const { token, boardId } = await boardFor(request, 'forge');
    const real = Buffer.from(`real-${Math.random()}`);
    const response = await put(request, sha256(real), Buffer.from('something else'), {
      token,
      boardId,
    });
    expect(response.status()).toBe(400);
    expect(await fileStatus(request, sha256(real))).toBe(404);
  });

  test('refuses uploads from anyone who cannot edit the board, and non-images', async ({
    request,
  }) => {
    const owner = await boardFor(request, 'files-owner');
    const intruder = await boardFor(request, 'files-intruder');
    const bytes = Buffer.from(`guarded-${Math.random()}`);
    const hash = sha256(bytes);

    // No sign-in and no share link: nothing says this person may edit the board.
    expect((await put(request, hash, bytes, { boardId: owner.boardId })).status()).toBe(404);
    expect(
      (await put(request, hash, bytes, { token: intruder.token, boardId: owner.boardId })).status(),
    ).toBe(404);
    expect(
      (
        await put(request, hash, bytes, {
          token: owner.token,
          boardId: owner.boardId,
          type: 'text/html',
        })
      ).status(),
    ).toBe(415);

    // Attaching a stored image to someone else's board is refused the same way.
    expect((await put(request, hash, bytes, owner)).status()).toBe(201);
    const attach = await request.post(`${API}/api/files/${hash}/attach?board=${owner.boardId}`, {
      headers: { authorization: `Bearer ${intruder.token}` },
    });
    expect(attach.status()).toBe(404);
  });

  test('serves an SVG as a picture, never as a page that can run script', async ({ request }) => {
    const { token, boardId } = await boardFor(request, 'svg');
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><!--${Math.random()}--></svg>`,
    );
    const hash = sha256(svg);
    expect((await put(request, hash, svg, { token, boardId, type: 'image/svg+xml' })).ok()).toBe(
      true,
    );

    const response = await request.get(`${API}/api/files/${hash}`);
    expect(response.headers()['content-type']).toBe('image/svg+xml');
    expect(response.headers()['content-security-policy']).toContain('sandbox');
    expect(response.headers()['content-security-policy']).toContain("default-src 'none'");
  });
});
