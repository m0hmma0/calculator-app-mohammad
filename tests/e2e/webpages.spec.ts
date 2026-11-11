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

/** Clicks into the page, as someone who edits does: a double-click on it. */
async function usePage(page: Page) {
  // Somewhere on the page that is on screen (it is bigger than the view).
  const box = (await page.getByTestId('web-page').boundingBox())!;
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const right = Math.min(box.x + box.width, stage.x + stage.width);
  const bottom = Math.min(box.y + box.height, stage.y + stage.height);
  const left = Math.max(box.x, stage.x);
  const top = Math.max(box.y, stage.y);
  await page.mouse.dblclick((left + right) / 2, (top + bottom) / 2 + 40);
  await expect(page.getByTestId('web-page')).toHaveAttribute('data-usable', 'true');
}

test('an HTML file is a working page, and what was done in it comes back after a reload', async ({
  page,
}) => {
  await importLesson(page);
  await expect(lesson(page).locator('h1')).toHaveText('Fractions');
  const order = await lesson(page).locator('#order').textContent();

  // Someone who edits clicks into it first; until then a click is the board's.
  await expect(page.getByTestId('web-page')).not.toHaveAttribute('data-usable', 'true');
  await usePage(page);
  await clickIn(page, '#choices button:text-is("3/4")');
  await expect(lesson(page).locator('#result')).toHaveText('Correct!');
  await clickIn(page, '#sure');
  await expect(lesson(page).locator('#sure')).toBeChecked();
  await clickIn(page, '#name');
  await page.keyboard.type('Maya');

  // Escape puts it down again.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('web-page')).not.toHaveAttribute('data-usable', 'true');

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
  await page.getByTestId('layers').locator('li').first().click();
  await expect(page.getByTestId('web-page-code')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('web-page')).toHaveCount(0);

  await page.getByTestId('web-page-web').click();
  await expect(page.getByTestId('web-page')).toHaveCount(1);
  await expect(lesson(page).locator('#hello')).toHaveText('Hello class');

  await page.getByTestId('web-page-code').click();
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
