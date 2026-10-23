import { expect, test, type Browser, type Page } from '@playwright/test';
import { colorFor, MAX_FRAME_BYTES } from '../../shared/collab';
import { API, createBoard, newAccount, signIn, tokenFor } from './accounts';

/**
 * Phase 7: two windows on one board, each a separate browser context — separate
 * storage, separate socket, exactly as two devices would be. Everything goes through
 * the real Worker and the board's real room.
 */

const layers = (page: Page) => page.getByTestId('layers').locator('li');

async function twoWindows(browser: Browser, label: string) {
  const account = newAccount(label);
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();

  await signIn(a, account);
  const boardId = await createBoard(a);
  await signIn(b, account);
  await b.goto(`/b/${boardId}`);

  for (const page of [a, b]) {
    await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');
  }
  // Each sees the other.
  await expect(a.getByTestId('peer-avatar').first()).toBeVisible();
  await expect(b.getByTestId('peer-avatar').first()).toBeVisible();

  return {
    account,
    boardId,
    a,
    b,
    contextA,
    contextB,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

async function drawRect(page: Page, from: [number, number], to: [number, number], tool = 'KeyR') {
  await page.keyboard.press(tool);
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 4 });
  await page.mouse.up();
}

async function geometry(page: Page, id: string) {
  await page.getByTestId(`layer-${id}`).click();
  return {
    x: Number(await page.getByTestId('geo-x').innerText()),
    y: Number(await page.getByTestId('geo-y').innerText()),
  };
}

async function layerIds(page: Page) {
  return page
    .getByTestId('layers')
    .locator('[data-testid^="layer-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')!.slice(6)).sort());
}

/** Fraction of the canvas close to a colour. */
async function colourFraction(
  page: Page,
  hex: string,
  area?: { x: number; y: number; w: number; h: number },
) {
  return page.evaluate(
    ([target, region]) => {
      const rgb = [1, 3, 5].map((index) => parseInt(target.slice(index, index + 2), 16));
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="board-canvas"]')!;
      const bounds = canvas.getBoundingClientRect();
      const dpr = canvas.width / bounds.width;
      const box = region ?? { x: bounds.left, y: bounds.top, w: bounds.width, h: bounds.height };
      const data = canvas
        .getContext('2d')!
        .getImageData(
          Math.round((box.x - bounds.left) * dpr),
          Math.round((box.y - bounds.top) * dpr),
          Math.round(box.w * dpr),
          Math.round(box.h * dpr),
        ).data;
      let near = 0;
      for (let index = 0; index < data.length; index += 4) {
        const distance =
          Math.abs(data[index]! - rgb[0]!) +
          Math.abs(data[index + 1]! - rgb[1]!) +
          Math.abs(data[index + 2]! - rgb[2]!);
        if (distance < 60) near += 1;
      }
      return near / (data.length / 4);
    },
    [hex, area ?? null] as const,
  );
}

/** Ink on the canvas inside a page-space rectangle: anything far from the background. */
async function inkIn(page: Page, area: { x: number; y: number; w: number; h: number }) {
  return page.evaluate((region) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="board-canvas"]')!;
    const bounds = canvas.getBoundingClientRect();
    const dpr = canvas.width / bounds.width;
    const probe = document.createElement('canvas').getContext('2d')!;
    probe.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue('--canvas-bg')
      .trim();
    probe.fillRect(0, 0, 1, 1);
    const [br, bg, bb] = probe.getImageData(0, 0, 1, 1).data;
    const data = canvas
      .getContext('2d')!
      .getImageData(
        Math.round((region.x - bounds.left) * dpr),
        Math.round((region.y - bounds.top) * dpr),
        Math.round(region.w * dpr),
        Math.round(region.h * dpr),
      ).data;
    let ink = 0;
    for (let index = 0; index < data.length; index += 4) {
      const distance =
        Math.abs(data[index]! - br!) +
        Math.abs(data[index + 1]! - bg!) +
        Math.abs(data[index + 2]! - bb!);
      if (distance > 90) ink += 1;
    }
    return ink / (data.length / 4);
  }, area);
}

test.describe('two windows on one board', () => {
  // Checklist items 1, 2 and 3.
  test('drawing, pointers and selections show up in the other window', async ({ browser }) => {
    const { a, b, account, close } = await twoWindows(browser, 'live');

    // 1. A shape drawn in one window appears in the other.
    await drawRect(a, [380, 300], [520, 400]);
    await expect(layers(b)).toHaveCount(1, { timeout: 3000 });

    // 2. A's pointer is in B's window, labelled, in A's colour.
    await a.mouse.move(600, 420);
    await a.mouse.move(640, 440, { steps: 3 });
    const cursor = b.getByTestId('peer-cursor');
    await expect(cursor).toBeVisible();
    await expect(cursor).toContainText(`Person live`);
    expect(
      await cursor
        .locator('span')
        .first()
        .evaluate((node) => getComputedStyle(node).backgroundColor),
    ).toBe(
      await b.evaluate((hex) => {
        const probe = document.createElement('span');
        probe.style.color = hex;
        document.body.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      }, colorFor(account.uid)),
    );

    // 3. What A selects is outlined in B's window, with A's name on it.
    const [id] = await layerIds(a);
    await a.getByTestId(`layer-${id}`).click();
    const halo = b.getByTestId('peer-selection');
    await expect(halo).toBeVisible();
    await expect(halo).toContainText('Person live');

    await close();
  });

  // Checklist item 4 — part of the gate.
  test('both dragging the same shape at once: one result, no duplicate, no freeze', async ({
    browser,
  }) => {
    const { a, b, close } = await twoWindows(browser, 'tug');
    await drawRect(a, [400, 300], [520, 400]);
    await expect(layers(b)).toHaveCount(1);
    const [id] = await layerIds(a);

    for (const page of [a, b]) {
      await page.keyboard.press('KeyV');
      await page.mouse.move(460, 350);
      await page.mouse.down();
    }
    for (let step = 1; step <= 12; step += 1) {
      await a.mouse.move(460 + step * 12, 350);
      await b.mouse.move(460, 350 + step * 10);
    }
    await a.mouse.up();
    await b.mouse.up();

    // Still one shape in each window, and both agree where it ended up.
    await expect(layers(a)).toHaveCount(1);
    await expect(layers(b)).toHaveCount(1);
    await expect
      .poll(async () => JSON.stringify(await geometry(a, id!)), { timeout: 5000 })
      .toBe(JSON.stringify(await geometry(b, id!)));
    await expect
      .poll(async () => JSON.stringify(await geometry(b, id!)))
      .toBe(JSON.stringify(await geometry(a, id!)));

    // And neither froze: both can keep working.
    await drawRect(b, [200, 500], [280, 560], 'KeyO');
    await expect(layers(a)).toHaveCount(2);

    await close();
  });

  // Checklist item 5.
  test('both typing in the same note: every character from both survives', async ({ browser }) => {
    const { a, b, close } = await twoWindows(browser, 'type');

    await a.keyboard.press('KeyN');
    await a.mouse.click(500, 380);
    await expect(a.getByTestId('text-editor')).toBeVisible();
    await a.keyboard.type('Start ');
    await a.keyboard.press('Escape');
    await expect(layers(b)).toHaveCount(1);

    // Both open the note…
    for (const page of [a, b]) {
      await page.keyboard.press('KeyV');
      await page.mouse.dblclick(500, 380);
      await expect(page.getByTestId('text-editor')).toBeVisible();
      await page.keyboard.press('End');
    }
    await expect(b.getByTestId('text-editor')).toHaveValue('Start ');

    // …and type at the same time.
    await Promise.all([
      a.keyboard.type('AAAAAA', { delay: 35 }),
      b.keyboard.type('bbbbbb', { delay: 35 }),
    ]);

    const settled = async (page: Page) => page.getByTestId('text-editor').inputValue();
    await expect.poll(async () => (await settled(a)).length, { timeout: 5000 }).toBe(18);
    await expect.poll(async () => settled(b)).toBe(await settled(a));
    const text = await settled(a);
    expect(text.startsWith('Start ')).toBe(true);
    expect([...text].filter((char) => char === 'A')).toHaveLength(6);
    expect([...text].filter((char) => char === 'b')).toHaveLength(6);

    await close();
  });

  // Checklist item 6 — part of the gate.
  test('undo takes back only your own change', async ({ browser }) => {
    const { a, b, close } = await twoWindows(browser, 'undo');

    await drawRect(a, [300, 300], [400, 380]);
    await expect(layers(b)).toHaveCount(1);
    const [mine] = await layerIds(a);

    await drawRect(b, [600, 300], [700, 380], 'KeyO');
    await expect(layers(a)).toHaveCount(2);
    const theirs = (await layerIds(b)).find((id) => id !== mine)!;

    await a.keyboard.press('Escape');
    await a.keyboard.press('ControlOrMeta+KeyZ');

    for (const page of [a, b]) {
      await expect(page.getByTestId(`layer-${mine}`)).toHaveCount(0);
      await expect(page.getByTestId(`layer-${theirs}`)).toHaveCount(1);
    }
    await close();
  });

  // Checklist item 7 — part of the gate.
  test('work done offline merges when the connection comes back', async ({ browser }) => {
    const { a, b, contextA, close } = await twoWindows(browser, 'offline');

    await contextA.setOffline(true);
    await expect(a.getByTestId('connection-status')).toHaveAttribute('data-status', 'offline');
    await expect(a.getByTestId('status-offline')).toBeVisible();

    // Both keep working, apart.
    await drawRect(a, [300, 300], [380, 360]);
    await drawRect(a, [300, 420], [380, 480], 'KeyO');
    await drawRect(b, [600, 300], [680, 360]);
    await expect(layers(a)).toHaveCount(2);
    await expect(layers(b)).toHaveCount(1);

    await contextA.setOffline(false);
    await expect(a.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');

    // Everything from both sides, in both windows.
    await expect(layers(a)).toHaveCount(3, { timeout: 5000 });
    await expect(layers(b)).toHaveCount(3);
    expect(await layerIds(a)).toEqual(await layerIds(b));

    await close();
  });

  /**
   * What actually happens when wifi drops: often no "offline" event at all, and both
   * sockets — two windows on one laptop — stay open in name only. Here every frame
   * in both directions is silently dropped, and the browser is never told.
   */
  test('a connection that dies silently is noticed, and both windows catch up without a reload', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const account = newAccount('silent');
    const line = { cut: false };
    const contexts = [await browser.newContext(), await browser.newContext()];
    for (const context of contexts) {
      await context.routeWebSocket(/\/room$/, (socket) => {
        const server = socket.connectToServer();
        socket.onMessage((message) => {
          if (!line.cut) server.send(message);
        });
        server.onMessage((message) => {
          if (!line.cut) socket.send(message);
        });
      });
    }
    const [a, b] = [await contexts[0]!.newPage(), await contexts[1]!.newPage()];
    await signIn(a, account);
    const boardId = await createBoard(a);
    await signIn(b, account);
    await b.goto(`/b/${boardId}`);
    for (const page of [a, b]) {
      await expect(page.getByTestId('connection-status')).toHaveAttribute(
        'data-status',
        'connected',
      );
    }

    // A healthy line stays Live: the room answers every ping.
    const watch = (page: Page) =>
      page.evaluate(() => {
        const seen: string[] = [];
        const node = document.querySelector('[data-testid="connection-status"]')!;
        new MutationObserver(() => seen.push(node.getAttribute('data-status')!)).observe(node, {
          attributes: true,
        });
        (window as unknown as { statuses: string[] }).statuses = seen;
      });
    const statuses = (page: Page) =>
      page.evaluate(() => (window as unknown as { statuses: string[] }).statuses);
    await watch(a);
    await a.waitForTimeout(22_000);
    expect(await statuses(a)).toEqual([]);

    // The line goes dead. Nothing tells either browser.
    line.cut = true;
    await drawRect(a, [300, 300], [400, 380]);
    expect(await a.evaluate(() => navigator.onLine)).toBe(true);

    // Both notice on their own, within a ping and its timeout.
    for (const page of [a, b]) {
      await expect(page.getByTestId('connection-status')).not.toHaveAttribute(
        'data-status',
        'connected',
        { timeout: 20_000 },
      );
      await expect(page.getByTestId('status-reconnecting')).toBeVisible();
    }

    // The line comes back: both reconnect, and B has A's shape — no reload.
    line.cut = false;
    for (const page of [a, b]) {
      await expect(page.getByTestId('connection-status')).toHaveAttribute(
        'data-status',
        'connected',
        { timeout: 30_000 },
      );
    }
    await expect(layers(b)).toHaveCount(1);
    expect(await layerIds(b)).toEqual(await layerIds(a));

    for (const context of contexts) await context.close();
  });

  // Checklist item 8.
  test("the laser shows on everyone's screen, in its owner's colour", async ({ browser }) => {
    const { a, b, account, close } = await twoWindows(browser, 'laser');
    const colour = colorFor(account.uid);

    await a.keyboard.press('KeyK');
    await a.mouse.move(300, 300);
    await a.mouse.down();
    const sweep = async () => {
      for (let step = 0; step < 20; step += 1) await a.mouse.move(300 + step * 20, 300 + step * 8);
    };
    await sweep();
    await expect.poll(() => colourFraction(b, colour), { timeout: 3000 }).toBeGreaterThan(0.0005);
    await a.mouse.up();

    // …and it fades there too.
    await expect.poll(() => colourFraction(b, colour), { timeout: 10_000 }).toBe(0);
    await close();
  });

  // Checklist item 9.
  test('following someone keeps your view on theirs, until you move it', async ({ browser }) => {
    const { a, b, close } = await twoWindows(browser, 'follow');

    await b.getByTestId('peer-avatar').first().click();
    await expect(b.getByTestId('following-banner')).toBeVisible();

    // A zooms in; B's view follows.
    await a.mouse.move(500, 400);
    for (let step = 0; step < 4; step += 1) await a.keyboard.press('Equal');
    const zoomA = await a.getByTestId('zoom-readout').innerText();
    expect(zoomA).not.toBe('100%');
    await expect(b.getByTestId('zoom-readout')).toHaveText(zoomA);

    // B takes the wheel: following stops.
    await b.mouse.move(500, 400);
    await b.mouse.wheel(0, 200);
    await expect(b.getByTestId('following-banner')).toHaveCount(0);

    // Presenting brings everyone along without them having to ask.
    await a.getByTestId('spotlight').click();
    await expect(b.getByTestId('following-banner')).toContainText('presenting');
    await close();
  });

  test('cursor chat: press /, type, and it appears by your pointer for everyone', async ({
    browser,
  }) => {
    const { a, b, close } = await twoWindows(browser, 'chat');
    await a.mouse.move(500, 400);
    await a.keyboard.press('Slash');
    await expect(a.getByTestId('chat-input')).toBeFocused();
    await a.keyboard.type('look here');
    await expect(b.getByTestId('peer-chat')).toHaveText('look here');
    await a.keyboard.press('Enter');
    // It lingers long enough to read, then goes.
    await expect(b.getByTestId('peer-chat')).toHaveText('look here');
    await expect(b.getByTestId('peer-chat')).toHaveCount(0, { timeout: 8000 });
    await close();
  });
});

test.describe('a large board', () => {
  test('5,000 shapes travel through the room in pieces and arrive whole', async ({
    browser,
    request,
  }) => {
    const { a, b, account, boardId, close } = await twoWindows(browser, 'large');
    const total = (page: Page) =>
      page.getByTestId('stat-visible').evaluate((node) => node.textContent!.split('/')[1]!.trim());

    for (const page of [a, b]) {
      await page.keyboard.press('ControlOrMeta+KeyK');
      await page.getByTestId('command-dev-panel').click();
    }
    await a.getByTestId('load-5000').click();
    await expect.poll(() => total(b), { timeout: 20_000 }).toBe('5,000');

    // The board really is bigger than one message can carry, so it was split.
    const auth = { authorization: `Bearer ${await tokenFor(account)}` };
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(`${API}/api/boards/${boardId}/snapshot`, { headers: auth })
            ).body()
          ).length,
        { timeout: 15_000 },
      )
      .toBeGreaterThan(MAX_FRAME_BYTES);

    // A third window, starting from nothing, gets all of it from the room.
    const third = await browser.newContext();
    const c = await third.newPage();
    await signIn(c, account);
    await c.goto(`/b/${boardId}`);
    // The palette's keys belong to the board, so the board has to be there first.
    await expect(c.getByTestId('board-canvas')).toBeVisible();
    await c.keyboard.press('ControlOrMeta+KeyK');
    await c.getByTestId('command-dev-panel').click();
    await expect.poll(() => total(c), { timeout: 20_000 }).toBe('5,000');
    await third.close();
    await close();
  });
});

test.describe('version history', () => {
  // Checklist items 10 and 11.
  test('scrubbing rewinds the board; restoring brings both windows back; nothing is lost', async ({
    browser,
  }) => {
    const { a, b, close } = await twoWindows(browser, 'history');
    const first = { x: 300, y: 300, w: 100, h: 80 };
    const second = { x: 600, y: 300, w: 100, h: 80 };

    await drawRect(a, [first.x, first.y], [first.x + first.w, first.y + first.h]);
    await expect(layers(b)).toHaveCount(1);

    // Name this moment.
    await a.getByTestId('tools-menu').click();
    await a.getByTestId('open-history').click();
    await a.getByTestId('checkpoint-name').fill('One box');
    await a.getByTestId('save-checkpoint').click();
    await expect(a.getByTestId('checkpoints')).toContainText('One box');
    await a.getByTestId('close-history').click();

    await drawRect(a, [second.x, second.y], [second.x + second.w, second.y + second.h], 'KeyO');
    await expect(layers(b)).toHaveCount(2);
    const inset = (box: typeof first) => ({
      x: box.x + 10,
      y: box.y + 10,
      w: box.w - 20,
      h: box.h - 20,
    });
    const shapeInk = (page: Page, box: typeof first) => inkIn(page, inset(box));
    expect(await shapeInk(a, second)).toBeGreaterThan(0.2);

    // 10. Drag the scrubber to the very start: the board rewinds to empty.
    await a.getByTestId('tools-menu').click();
    await a.getByTestId('open-history').click();
    const scrubber = a.getByTestId('history-scrubber');
    await expect(scrubber).toHaveAttribute('max', /[1-9]/);
    await scrubber.fill('0');
    await expect.poll(() => shapeInk(a, first)).toBeLessThan(0.02);
    expect(await shapeInk(a, second)).toBeLessThan(0.02);
    // The other window is untouched by someone else looking at the past.
    await expect(layers(b)).toHaveCount(2);

    // 11. The named checkpoint: one box, not two.
    await a
      .getByTestId('checkpoints')
      .getByRole('button', { name: /One box/ })
      .click();
    await expect.poll(() => shapeInk(a, first)).toBeGreaterThan(0.2);
    expect(await shapeInk(a, second)).toBeLessThan(0.02);

    // Restoring it is a change like any other: both windows go back to one box.
    await a.getByTestId('restore-version').click();
    await expect(a.getByTestId('history-panel')).toHaveCount(0);
    await expect(layers(a)).toHaveCount(1);
    await expect(layers(b)).toHaveCount(1);

    // And what came after is still in history.
    await a.getByTestId('tools-menu').click();
    await a.getByTestId('open-history').click();
    const max = Number(await a.getByTestId('history-scrubber').getAttribute('max'));
    await a.getByTestId('history-scrubber').fill(String(max - 1));
    await expect.poll(() => shapeInk(a, second)).toBeGreaterThan(0.2);
    await a.getByTestId('close-history').click();

    // The restore was A's own edit, so A can undo it.
    await a.keyboard.press('ControlOrMeta+KeyZ');
    await expect(layers(b)).toHaveCount(2);

    await close();
  });
});

test.describe('the room', () => {
  const roomUrl = (boardId: string) => `${API.replace('http', 'ws')}/api/boards/${boardId}/room`;

  function closeCode(url: string, firstMessage: string | null) {
    return new Promise<number>((resolve) => {
      const socket = new WebSocket(url);
      socket.onopen = () => {
        if (firstMessage !== null) socket.send(firstMessage);
      };
      socket.onclose = (event) => resolve(event.code);
    });
  }

  test('lets in only the board owner, after a verified handshake', async ({ request }) => {
    const owner = await tokenFor(newAccount('room-owner'));
    const created = await request.post(`${API}/api/boards`, {
      headers: { authorization: `Bearer ${owner}` },
      data: { title: 'Room', folderId: null },
    });
    const { board } = (await created.json()) as { board: { id: string } };

    // Anything before signing in is refused.
    expect(await closeCode(roomUrl(board.id), JSON.stringify({ t: 'presence', state: {} }))).toBe(
      4401,
    );
    // A token nobody issued.
    expect(
      await closeCode(roomUrl(board.id), JSON.stringify({ t: 'auth', token: 'not.a.token' })),
    ).toBe(4401);
    // A real account that is not the owner.
    const intruder = await tokenFor(newAccount('room-intruder'));
    expect(await closeCode(roomUrl(board.id), JSON.stringify({ t: 'auth', token: intruder }))).toBe(
      4404,
    );
  });
});
