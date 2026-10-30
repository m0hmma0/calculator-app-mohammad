import { expect, test, type Browser, type Page } from '@playwright/test';
import { API, createBoard, KEYS, newAccount, signIn, tokenFor } from './accounts';

/**
 * Phase 9, the shared half: a presenter and a follower, a timer and a vote seen from
 * two windows, link previews fetched by the real Worker, the library carried from one
 * board to another, and a PDF's pages stored like any other picture.
 */

const layerItems = (page: Page) => page.getByTestId('layers').locator('li');
const geo = async (page: Page) => ({
  x: Number(await page.getByTestId('geo-x').innerText()),
  y: Number(await page.getByTestId('geo-y').innerText()),
  w: Number(await page.getByTestId('geo-w').innerText()),
  h: Number(await page.getByTestId('geo-h').innerText()),
});

/**
 * One board open in two windows: by the same person, or — `twoPeople` — by its owner
 * and someone they shared it with as an editor.
 */
async function twoWindows(browser: Browser, label: string, twoPeople = false) {
  const account = newAccount(label);
  const other = twoPeople ? newAccount(`${label}-b`) : account;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  await signIn(a, account);
  const boardId = await createBoard(a);
  if (twoPeople) {
    const shared = await fetch(`${API}/api/shares/board/${boardId}/people`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await tokenFor(account)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: `${other.uid}@example.test`, role: 'editor' }),
    });
    expect(shared.ok).toBe(true);
  }
  await signIn(b, other);
  await b.goto(`/b/${boardId}`);
  for (const page of [a, b]) {
    await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');
  }
  await expect(b.getByTestId('peer-avatar').first()).toBeVisible();
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

async function drag(page: Page, tool: string, from: [number, number], to: [number, number]) {
  await page.keyboard.press(tool);
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 5 });
  await page.mouse.up();
}

/** As in rich.spec.ts: how much of an area is painted close to a colour. */
async function colourFraction(
  page: Page,
  colour: string,
  area: { x: number; y: number; w: number; h: number },
) {
  return page.evaluate(
    ([wanted, region]) => {
      const resolved = wanted.startsWith('--')
        ? getComputedStyle(document.documentElement).getPropertyValue(wanted).trim()
        : wanted;
      const probe = document.createElement('canvas').getContext('2d')!;
      probe.fillStyle = resolved;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="board-canvas"]')!;
      const bounds = canvas.getBoundingClientRect();
      const dpr = canvas.width / bounds.width;
      const data = canvas
        .getContext('2d')!
        .getImageData(
          Math.round((region.x - bounds.left) * dpr),
          Math.round((region.y - bounds.top) * dpr),
          Math.round(region.w * dpr),
          Math.round(region.h * dpr),
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
    [colour, area] as const,
  );
}

/** Pastes text the way a person would: a paste event carrying it. */
async function pasteText(page: Page, text: string) {
  await page.evaluate((value) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', value);
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true }));
  }, text);
}

/** The middle of the stage, as a page-space area. */
async function stageCentre(page: Page, w = 160, h = 100) {
  const stage = (await page.getByTestId('stage').boundingBox())!;
  return {
    x: stage.x + stage.width / 2 - w / 2,
    y: stage.y + stage.height / 2 - h / 2,
    w,
    h,
  };
}

// Checklist item 1 — the gate, from the follower's side.
test('followers see the frame the presenter is on', async ({ browser }) => {
  const { a, b, close } = await twoWindows(browser, 'present');
  try {
    // Two frames side by side; only the first has a rectangle in it.
    await drag(a, 'KeyR', [170, 230], [230, 270]);
    await drag(a, 'KeyF', [100, 180], [300, 320]);
    await drag(a, 'KeyF', [400, 180], [600, 320]);
    await a.keyboard.press('Escape');
    await expect(layerItems(b)).toHaveCount(3);

    await a.getByTestId('insert-menu').click();
    await a.getByTestId('present-start').click();
    await expect(a.getByTestId('presentation-counter')).toHaveText('1 / 2');

    // The follower's view fills with the first frame — its rectangle large in the middle.
    const centre = await stageCentre(b);
    await expect.poll(() => colourFraction(b, '--shape-1', centre)).toBeGreaterThan(0.9);

    // The presenter moves on; the follower goes with them.
    await a.keyboard.press('ArrowRight');
    await expect(a.getByTestId('presentation-counter')).toHaveText('2 / 2');
    await expect.poll(() => colourFraction(b, '--shape-1', centre)).toBeLessThan(0.01);
    await a.keyboard.press('ArrowLeft');
    await expect.poll(() => colourFraction(b, '--shape-1', centre)).toBeGreaterThan(0.9);

    await a.keyboard.press('Escape');
    await expect(b.getByTestId('peer-avatar').first()).not.toContainText('presenting');
  } finally {
    await close();
  }
});

/** Starts the board's timer from the Insert menu with a length typed in. */
async function startTimer(page: Page, minutes: number, seconds: number) {
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('timer-minutes').fill(String(minutes));
  await page.getByTestId('timer-seconds').fill(String(seconds));
  await page.getByTestId('timer-start').click();
}

// Checklist item 2.
test('a timer counts down on every screen and ends on all of them together', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { a, b, close } = await twoWindows(browser, 'timer');
  try {
    // A length in minutes and seconds, typed in.
    await startTimer(a, 0, 20);

    for (const page of [a, b]) {
      await expect(page.getByTestId('timer-display')).toHaveText(/^0:(20|1\d)$/);
    }
    // Both show the same time — they count to the same instant on the room's clock.
    const seconds = async (page: Page) => {
      const [minutes, secs] = (await page.getByTestId('timer-display').innerText()).split(':');
      return Number(minutes) * 60 + Number(secs);
    };
    const [left, right] = await Promise.all([seconds(a), seconds(b)]);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);

    // It runs out on both.
    for (const page of [a, b]) {
      await expect(page.getByTestId('timer-display')).toHaveText("Time's up", {
        timeout: 30_000,
      });
    }
    await expect(a.getByTestId('timer')).toHaveAttribute('data-state', 'done');
    await expect(b.getByTestId('timer')).toHaveAttribute('data-state', 'done');

    // Dismissed in one window, gone from the other.
    await b.getByTestId('timer-stop').click();
    await expect(a.getByTestId('timer')).toBeHidden();
  } finally {
    await close();
  }
});

test('the timer offers the lengths used last, newest first', async ({ browser }) => {
  const { a, b, close } = await twoWindows(browser, 'timer-recent');
  try {
    await startTimer(a, 5, 0);
    for (const page of [a, b]) {
      await expect(page.getByTestId('timer-display')).toHaveText(/^(5:00|4:5\d)$/);
    }
    await startTimer(a, 1, 30);
    await expect(b.getByTestId('timer-display')).toHaveText(/^(1:30|1:2\d)$/);

    // The two lengths used, the latest first; one click starts one again.
    await a.getByTestId('insert-menu').click();
    await expect(a.getByTestId('timer-recent-0')).toHaveText('1:30');
    await expect(a.getByTestId('timer-recent-1')).toHaveText('5:00');
    await expect(a.getByTestId('timer-recent-2')).toHaveCount(0);
    await a.getByTestId('timer-recent-1').click();
    await expect(b.getByTestId('timer-display')).toHaveText(/^(5:00|4:5\d)$/);

    // Still remembered after a reload, and the box starts at the latest length.
    await a.reload();
    await a.getByTestId('insert-menu').click();
    await expect(a.getByTestId('timer-recent-0')).toHaveText('5:00');
    await expect(a.getByTestId('timer-minutes')).toHaveValue('5');
    await expect(a.getByTestId('timer-seconds')).toHaveValue('0');
    await a.keyboard.press('Escape');

    await a.getByTestId('timer-stop').click();
    await expect(b.getByTestId('timer')).toBeHidden();
  } finally {
    await close();
  }
});

/** Two sticky notes, and their ids in the order they were placed. */
async function twoStickies(a: Page, b: Page) {
  for (const [x, y] of [
    [300, 300],
    [600, 300],
  ] as const) {
    await a.keyboard.press('KeyN');
    await a.mouse.click(x, y);
    await a.keyboard.type(`idea ${x}`);
    await a.keyboard.press('Escape');
  }
  await a.keyboard.press('Escape');
  await expect(layerItems(b)).toHaveCount(2);
  const ids = await a
    .getByTestId('layers')
    .locator('[data-testid^="layer-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')!.slice(6)));
  // The layer list is topmost first.
  return [ids[1]!, ids[0]!] as const;
}

async function startVote(page: Page) {
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('vote-start').click();
}

// Checklist item 3.
test('dot votes from two people add up live on both screens', async ({ browser }) => {
  test.setTimeout(60_000);
  const { a, b, close } = await twoWindows(browser, 'vote', true);
  try {
    const [first, second] = await twoStickies(a, b);
    await startVote(a);
    await expect(a.getByTestId('votes-left')).toHaveText('3 dots left');
    await expect(b.getByTestId('votes-left')).toHaveText('3 dots left');

    // Both vote at once.
    await Promise.all([
      (async () => {
        await a.getByTestId(`vote-add-${first}`).click();
        await a.getByTestId(`vote-add-${first}`).click();
      })(),
      (async () => {
        await b.getByTestId(`vote-add-${first}`).click();
        await b.getByTestId(`vote-add-${second}`).click();
      })(),
    ]);
    for (const page of [a, b]) {
      await expect(page.getByTestId(`vote-count-${first}`)).toHaveText('3');
      await expect(page.getByTestId(`vote-count-${second}`)).toHaveText('1');
    }
    // Each has their own dots to spend.
    await expect(a.getByTestId('votes-left')).toHaveText('1 dot left');
    await expect(b.getByTestId('votes-left')).toHaveText('1 dot left');

    // Taking one back is seen everywhere too.
    await b.getByTestId(`vote-remove-${second}`).click();
    await expect(a.getByTestId(`vote-count-${second}`)).toHaveText('0');
    await expect(b.getByTestId('votes-left')).toHaveText('2 dots left');

    // Spending the last dot leaves the other person's untouched.
    await a.getByTestId(`vote-add-${second}`).click();
    await expect(a.getByTestId('votes-left')).toHaveText('0 dots left');
    await expect(a.getByTestId(`vote-add-${second}`)).toBeDisabled();
    await expect(b.getByTestId(`vote-add-${second}`)).toBeEnabled();

    // Closing the vote keeps the result and stops the voting.
    await a.getByTestId('insert-menu').click();
    await a.getByTestId('vote-end').click();
    await expect(b.getByTestId(`vote-add-${first}`)).toBeHidden();
    await expect(b.getByTestId(`vote-count-${first}`)).toHaveText('3');
    await expect(b.getByTestId('vote-status')).toHaveText('Voting closed');
  } finally {
    await close();
  }
});

test('one person voting from two windows keeps every dot, from one budget', async ({ browser }) => {
  test.setTimeout(60_000);
  const { a, b, close } = await twoWindows(browser, 'vote-same');
  try {
    const [first, second] = await twoStickies(a, b);
    await startVote(a);
    await Promise.all([
      (async () => {
        await a.getByTestId(`vote-add-${first}`).click();
        await a.getByTestId(`vote-add-${first}`).click();
      })(),
      b.getByTestId(`vote-add-${second}`).click(),
    ]);
    // Neither window's dots overwrote the other's.
    for (const page of [a, b]) {
      await expect(page.getByTestId(`vote-count-${first}`)).toHaveText('2');
      await expect(page.getByTestId(`vote-count-${second}`)).toHaveText('1');
      await expect(page.getByTestId('votes-left')).toHaveText('0 dots left');
    }
    // A dot given in one window can be taken back in the other.
    await b.getByTestId(`vote-remove-${first}`).click();
    await expect(a.getByTestId(`vote-count-${first}`)).toHaveText('1');
    await expect(a.getByTestId('votes-left')).toHaveText('1 dot left');
  } finally {
    await close();
  }
});

// Checklist item 4.
test.describe('pasted links', () => {
  test('a YouTube link becomes a video that plays in place', async ({ page }) => {
    await signIn(page, newAccount('video'));
    await createBoard(page);
    await pasteText(page, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    const video = page.getByTestId('embed-video');
    await expect(video).toBeVisible();
    await expect(video.locator('img')).toHaveAttribute('src', /i\.ytimg\.com\/vi\/dQw4w9WgXcQ\//);

    const box = (await video.boundingBox())!;
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId('embed-player')).toHaveAttribute(
      'src',
      /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/,
    );
  });

  test('a video that was played can still be selected and deleted', async ({ page }) => {
    await signIn(page, newAccount('video-delete'));
    await createBoard(page);
    await pasteText(page, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    const video = page.getByTestId('embed-video');
    const box = (await video.boundingBox())!;
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);

    // Playing it hands the keyboard to the player.
    await page.getByTestId('embed-player').focus();
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME');

    // The strip along its top is the board's: a press there selects it and takes the
    // keyboard back, so Delete works without reloading.
    await page.getByTestId('embed-grip').click();
    await expect(page.getByTestId('embed-title')).toBeVisible();
    await page.keyboard.press('Delete');
    await expect(video).toHaveCount(0);
  });

  test('an article link becomes a card with its title and picture', async ({ page }) => {
    await signIn(page, newAccount('card'));
    await createBoard(page);
    await pasteText(page, `${KEYS}/article`);

    // The picture is the page's own og:image, resolved against the page.
    await expect(page.getByTestId('embed-card-image').locator('img')).toHaveAttribute(
      'src',
      `${KEYS}/article.png`,
    );
    // The title is drawn on the card; the inspector reads it out.
    await expect(page.getByTestId('embed-title')).toHaveText('Workshops that work');
  });
});

// Checklist item 8.
test('a styled group saved to the library drops onto another board intact', async ({ page }) => {
  await signIn(page, newAccount('library'));
  await createBoard(page);

  // Two rectangles, one restyled, grouped.
  await drag(page, 'KeyR', [300, 300], [400, 380]);
  await page.getByRole('button', { name: 'Fill var(--shape-4)' }).click();
  await drag(page, 'KeyR', [450, 300], [520, 360]);
  await page.keyboard.press('ControlOrMeta+KeyA');
  await page.keyboard.press('ControlOrMeta+KeyG');
  await expect(layerItems(page)).toHaveText(['group']);
  const saved = await geo(page);

  await page.getByTestId('tools-menu').click();

  await page.getByTestId('library-menu').click();
  await page.getByTestId('library-name').fill('Starter kit');
  await page.getByTestId('library-save').click();
  await expect(page.getByTestId('library-insert-0')).toContainText('Starter kit');
  await expect(page.getByTestId('library-insert-0')).toContainText('3 items');
  await page.keyboard.press('Escape');

  // A different board.
  await page.goto('/');
  await createBoard(page);
  await expect(layerItems(page)).toHaveCount(0);
  await page.getByTestId('tools-menu').click();
  await page.getByTestId('library-menu').click();
  await page.getByTestId('library-insert-0').click();

  // The same group, the same size, the same colours.
  await expect(layerItems(page)).toHaveText(['group']);
  const dropped = await geo(page);
  expect({ w: dropped.w, h: dropped.h }).toEqual({ w: saved.w, h: saved.h });
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const all = { x: stage.x, y: stage.y, w: stage.width - 250, h: stage.height };
  await expect.poll(() => colourFraction(page, '--shape-4', all)).toBeGreaterThan(0.005);
  expect(await colourFraction(page, '--shape-1', all)).toBeGreaterThan(0.002);

  await page.keyboard.press('ControlOrMeta+Shift+KeyG');
  await expect(layerItems(page)).toHaveText(['rect', 'rect']);

  // It is still there after a reload, and can be removed.
  await page.reload();
  await page.getByTestId('tools-menu').click();
  await page.getByTestId('library-menu').click();
  await expect(page.getByTestId('library-insert-0')).toContainText('Starter kit');
  await page.getByTestId('library-remove-0').click();
  await expect(page.getByTestId('library-insert-0')).toBeHidden();
});

/** A small PDF, written out by hand: each page one coloured square. */
function makePdf(colours: [number, number, number][]): Buffer {
  const objects: string[] = [];
  const pageIds = colours.map((_, index) => 3 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${colours.length} >>`;
  colours.forEach(([r, g, b], index) => {
    const pageId = pageIds[index]!;
    const stream = `${r} ${g} ${b} rg 50 50 200 200 re f`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

// Checklist item 9, second half.
test('a PDF comes in as one stored picture per page', async ({ page }) => {
  await signIn(page, newAccount('pdf'));
  await createBoard(page);
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-import').click();
  await page.getByTestId('import-file').setInputFiles({
    name: 'deck.pdf',
    mimeType: 'application/pdf',
    buffer: makePdf([
      [0.9, 0.1, 0.1],
      [0.1, 0.6, 0.2],
      [0.1, 0.2, 0.8],
    ]),
  });

  await expect(layerItems(page)).toHaveText(['image', 'image', 'image'], { timeout: 20_000 });
  await expect(page.getByTestId('import-status')).toBeHidden();
  // Each page's picture is the page: the first page's red square is on the board.
  await page.keyboard.press('Shift+Digit1');
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const all = { x: stage.x, y: stage.y, w: stage.width - 250, h: stage.height };
  await expect.poll(() => colourFraction(page, '#e61a1a', all)).toBeGreaterThan(0.002);
  await expect.poll(() => colourFraction(page, '#1a9933', all)).toBeGreaterThan(0.002);

  // And the pictures are stored, not just drawn: they survive a reload.
  await page.reload();
  await expect(layerItems(page)).toHaveCount(3);
  await page.keyboard.press('Shift+Digit1');
  await expect.poll(() => colourFraction(page, '#1a33cc', all)).toBeGreaterThan(0.002);
});

test('a celebration plays for everyone on the board, and ends by itself', async ({ browser }) => {
  const { a, b, close } = await twoWindows(browser, 'party');
  try {
    await a.getByTestId('insert-menu').click();
    await a.getByTestId('celebrate-confetti').click();
    for (const page of [a, b]) {
      await expect(page.getByTestId('celebration')).toHaveAttribute('data-effect', 'confetti');
    }
    await expect(b.getByTestId('celebration')).toHaveCount(0, { timeout: 8000 });

    // While presenting too, number pad 2 is a drum roll — for the audience as well.
    await drag(a, 'KeyF', [200, 200], [500, 400]);
    await a.getByTestId('insert-menu').click();
    await a.getByTestId('present-start').click();
    await a.keyboard.press('Numpad2');
    await expect(b.getByTestId('celebration')).toHaveAttribute('data-effect', 'drumroll');

    // Someone arriving afterwards does not get an old celebration replayed.
    await b.reload();
    await expect(b.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');
    await expect(b.getByTestId('celebration')).toHaveCount(0);
  } finally {
    await close();
  }
});
