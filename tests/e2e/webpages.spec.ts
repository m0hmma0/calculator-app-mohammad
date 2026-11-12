import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Web pages on the signed-out board: an HTML file comes in as a working page, it is
 * used on the board, and what was done in it comes back after a reload. Code can be
 * pasted into a new web page and switched between its code and the page.
 */

const LESSON = readFileSync(new URL('./fixtures/lesson.html', import.meta.url));

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board-canvas')).toBeVisible();
});

async function importLesson(page: Page) {
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-import').click();
  await page
    .getByTestId('import-file')
    .setInputFiles({ name: 'lesson.html', mimeType: 'text/html', buffer: LESSON });
  await expect(page.getByTestId('web-page')).toHaveCount(1);
}

const lesson = (page: Page) => page.frameLocator('[data-testid="web-page"]');

/**
 * A real click on something in the page, at its place on screen. The page is scaled
 * with the board, which Playwright's own clicks inside a frame do not allow for.
 */
async function clickIn(page: Page, selector: string) {
  const frame = (await page.getByTestId('web-page').boundingBox())!;
  const inner = await lesson(page)
    .locator(selector)
    .evaluate((node) => {
      const box = node.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: innerWidth };
    });
  const scale = frame.width / inner.width;
  await page.mouse.click(frame.x + inner.x * scale, frame.y + inner.y * scale);
}

/**
 * Code or page, from the right-click menu: on the page, its edge (the board keeps it);
 * as code, the middle of the board, where a new code box goes.
 */
async function switchView(page: Page, to: 'code' | 'web') {
  const frame =
    (await page.getByTestId('web-page').count()) > 0
      ? await page.getByTestId('web-page').boundingBox()
      : null;
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const at = frame
    ? { x: Math.max(frame.x, stage.x) + 60, y: Math.max(frame.y, stage.y) + 3 }
    : { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(page.getByTestId('menu-web-view')).toHaveText(
    to === 'web' ? 'Show the web page' : 'Show the code',
  );
  await page.getByTestId('menu-web-view').click();
}

test('an HTML file is a working page, and what was done in it comes back after a reload', async ({
  page,
}) => {
  await importLesson(page);
  await expect(lesson(page).locator('h1')).toHaveText('Fractions');
  const order = await lesson(page).locator('#order').textContent();

  // In use as soon as the pointer is on it, with the select tool in hand.
  await expect(page.getByTestId('web-page')).toHaveAttribute('data-usable', 'true');
  await clickIn(page, '#choices button:text-is("3/4")');
  await expect(lesson(page).locator('#result')).toHaveText('Correct!');
  await clickIn(page, '#sure');
  await expect(lesson(page).locator('#sure')).toBeChecked();
  await clickIn(page, '#name');
  await page.keyboard.type('Maya');

  // Another tool in hand draws over it instead. (Typing in the page kept the keys
  // there; a click on the board takes them back.)
  const stage = (await page.getByTestId('stage').boundingBox())!;
  await page.mouse.click(stage.x + 5, stage.y + stage.height - 5);
  await page.keyboard.press('KeyP');
  await expect(page.getByTestId('web-page')).not.toHaveAttribute('data-usable', 'true');
  await page.keyboard.press('KeyV');
  await expect(page.getByTestId('web-page')).toHaveAttribute('data-usable', 'true');

  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByTestId('web-page')).toHaveCount(1);
  // The same shuffle, and everything done in it, replayed.
  await expect(lesson(page).locator('#order')).toHaveText(order!);
  await expect(lesson(page).locator('#result')).toHaveText('Correct!');
  await expect(lesson(page).locator('#sure')).toBeChecked();
  await expect(lesson(page).locator('#name')).toHaveValue('Maya');
  await expect(lesson(page).getByRole('button', { name: '3/4' })).toHaveClass(/chosen/);

  // Start over: a clean page, and it stays clean after a reload.
  await page.getByTestId('layers').locator('li').first().click();
  await page.getByTestId('web-page-restart').click();
  await expect(lesson(page).locator('#result')).toHaveText('');
  await expect(lesson(page).locator('#name')).toHaveValue('');
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByTestId('web-page')).toHaveCount(1);
  await expect(lesson(page).locator('h1')).toHaveText('Fractions');
  await page.waitForTimeout(500);
  await expect(lesson(page).locator('#result')).toHaveText('');
});

test('the page cannot reach the whiteboard: no access to its storage or its window', async ({
  page,
}) => {
  await page.evaluate(() => localStorage.setItem('secret', 'whiteboard'));
  await importLesson(page);
  await expect(lesson(page).locator('h1')).toHaveText('Fractions');
  const frame = page.frames().find((each) => each !== page.mainFrame())!;
  const reach = await frame.evaluate(() => {
    let parentDocument = 'blocked';
    try {
      parentDocument = String(window.parent.document.title);
    } catch {
      // Walled off, as it should be.
    }
    return { parentDocument, secret: localStorage.getItem('secret'), origin: location.origin };
  });
  expect(reach).toEqual({ parentDocument: 'blocked', secret: null, origin: 'null' });
});

test('a new web page takes pasted code and switches between the code and the page', async ({
  page,
}) => {
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-web-page').click();
  // Open for the code at once.
  const editor = page.locator('textarea');
  await expect(editor).toBeFocused();
  await editor.fill('<h1 id="hello">Hello class</h1><script>document.title = "Hi"</script>');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('web-page')).toHaveCount(0);

  await switchView(page, 'web');
  await expect(page.getByTestId('web-page')).toHaveCount(1);
  await expect(lesson(page).locator('#hello')).toHaveText('Hello class');

  await switchView(page, 'code');
  await expect(page.getByTestId('web-page')).toHaveCount(0);
});

test('an HTML file dropped on the board is a page where it was dropped', async ({ page }) => {
  const transfer = await page.evaluateHandle((html) => {
    const data = new DataTransfer();
    data.items.add(new File([html], 'lesson.html', { type: 'text/html' }));
    return data;
  }, LESSON.toString());
  await page
    .getByTestId('stage')
    .dispatchEvent('drop', { dataTransfer: transfer, clientX: 300, clientY: 300 });
  await expect(page.getByTestId('web-page')).toHaveCount(1);
  await expect(lesson(page).locator('h1')).toHaveText('Fractions');
});

test('a page written at a fixed size fills its box, and grows with it', async ({ page }) => {
  const fixedApp = readFileSync(new URL('./fixtures/fixed-app.html', import.meta.url), 'utf8');
  // As it was done: a code box, the code pasted in, then switched to Web.
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-web-page').click();
  const editor = page.locator('textarea');
  await expect(editor).toBeFocused();
  await editor.fill(fixedApp);
  await page.keyboard.press('Escape');
  await switchView(page, 'web');
  // Fill the box: in the side panel, on from the start.
  await page.getByTestId('layers').locator('li').first().click();
  await expect(page.getByTestId('web-page-fill')).toBeChecked();

  const measure = () =>
    lesson(page)
      .locator('.app-container')
      .evaluate((app) => {
        const main = document.getElementById('main')!;
        return {
          app: { w: app.getBoundingClientRect().width, h: app.getBoundingClientRect().height },
          view: { w: innerWidth, h: innerHeight },
          scrolls: main.scrollHeight > main.clientHeight + 1,
        };
      });
  // The card is the whole box: no grey around it, nothing cut off.
  await expect.poll(async () => (await measure()).app).toEqual((await measure()).view);
  const before = await measure();
  expect(before.view).toEqual({ w: 960, h: 600 });
  // Five 130px rows need 650px: at 600 the panel scrolls.
  expect(before.scrolls).toBe(true);

  // Dragging the box taller, at the bottom and then the top, gives the page the room:
  // the panel stops scrolling. (The bottom-left corner: the right one is under the
  // side panel.)
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const drag = async (corner: { x: number; y: number }, by: number) => {
    await page.mouse.move(corner.x, corner.y);
    await page.mouse.down();
    await page.mouse.move(corner.x, corner.y + by, { steps: 6 });
    await page.mouse.up();
  };
  let box = (await page.getByTestId('web-page').boundingBox())!;
  await drag(
    { x: box.x, y: box.y + box.height },
    stage.y + stage.height - (box.y + box.height) - 4,
  );
  box = (await page.getByTestId('web-page').boundingBox())!;
  await drag({ x: box.x, y: box.y }, stage.y - box.y + 30);
  await expect.poll(async () => (await measure()).view.h).toBeGreaterThan(655);
  const after = await measure();
  expect(after.app).toEqual(after.view);
  expect(after.scrolls).toBe(false);

  // Fill box off: the page as written again — its card 800 high, the grey around it.
  await page.getByTestId('web-page-fill').click();
  await expect.poll(async () => (await measure()).app.h).toBe(800);
});

test('drawing, stamps and notes over a page show on top of it, and the note takes a click', async ({
  page,
}) => {
  await importLesson(page);
  await expect(lesson(page).locator('h1')).toHaveText('Fractions');
  const frame = (await page.getByTestId('web-page').boundingBox())!;
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const left = Math.max(frame.x, stage.x) + 80;
  const top = Math.max(frame.y, stage.y) + 80;

  // How much of an area of the canvas over the pages has something drawn on it.
  const inked = (area: { x: number; y: number; w: number; h: number }) =>
    page.evaluate((region) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="board-over"]')!;
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
      let drawn = 0;
      for (let index = 3; index < data.length; index += 4) if (data[index]! > 0) drawn += 1;
      return drawn / (data.length / 4);
    }, area);

  // A pen stroke across the page.
  await page.keyboard.press('KeyP');
  await page.mouse.move(left, top);
  await page.mouse.down();
  await page.mouse.move(left + 200, top + 40, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => inked({ x: left, y: top - 10, w: 200, h: 60 })).toBeGreaterThan(0.02);

  // A sticky note on it: drawn over the page, and a click on it selects it.
  await page.keyboard.press('KeyN');
  await page.mouse.click(left + 60, top + 160);
  await page.keyboard.press('Escape');
  await page.keyboard.press('KeyV');
  await expect.poll(() => inked({ x: left + 60, y: top + 160, w: 40, h: 40 })).toBeGreaterThan(0.9);
  await page.mouse.click(stage.x + 5, stage.y + stage.height - 5);
  await page.mouse.click(left + 80, top + 180);
  await expect(page.getByTestId('inspector')).toContainText('sticky');
});

test('over a page the wheel scrolls what can scroll, then moves the board', async ({ page }) => {
  const fixedApp = readFileSync(new URL('./fixtures/fixed-app.html', import.meta.url), 'utf8');
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-web-page').click();
  await page.locator('textarea').fill(fixedApp);
  await page.keyboard.press('Escape');
  await switchView(page, 'web');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('web-page')).toHaveAttribute('data-usable', 'true');

  const frame = page.getByTestId('web-page');
  const at = async () => (await frame.boundingBox())!;
  const scrolled = () =>
    lesson(page)
      .locator('#main')
      .evaluate((node) => node.scrollTop);
  const start = await at();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);

  // The page's panel scrolls first; the board stays put.
  await page.mouse.wheel(0, 40);
  await expect.poll(scrolled).toBeGreaterThan(0);
  expect((await at()).y).toBe(start.y);

  // At its end, the wheel moves the board.
  for (let turn = 0; turn < 12; turn += 1) await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await at()).y).toBeLessThan(start.y - 20);
});

test('the board’s shortcuts work while a page has the keyboard, but not while typing in it', async ({
  page,
}) => {
  await importLesson(page);
  await expect(lesson(page).locator('h1')).toHaveText('Fractions');
  // A click in the page gives it the keyboard.
  await clickIn(page, '#choices button:text-is("3/4")');
  await expect(lesson(page).locator('#result')).toHaveText('Correct!');
  await page.keyboard.press('KeyP');
  await expect(page.getByTestId('tool-pen')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('KeyV');
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');

  // Typing in one of its fields is the page's alone.
  await clickIn(page, '#name');
  await page.keyboard.type('pp');
  await expect(lesson(page).locator('#name')).toHaveValue('pp');
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
  // Escape leaves the field; the next key is the board's.
  await page.keyboard.press('Escape');
  await page.keyboard.press('KeyP');
  await expect(page.getByTestId('tool-pen')).toHaveAttribute('aria-pressed', 'true');
});
