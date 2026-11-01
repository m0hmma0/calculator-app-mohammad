import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 14.1 on the signed-out board: text boxes only as tall as their text, an
 * eraser that stays erased, a side panel above everything that shows only when there
 * is something to show, duplicates below, strikethrough and new shortcuts.
 * sharing.spec.ts covers boards shared for answering from the start.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board-canvas')).toBeVisible();
});

const layers = (page: Page) => page.getByTestId('layers').locator('li');
const editor = (page: Page) => page.getByTestId('text-editor');
const readout = async (page: Page, id: string) =>
  parseFloat(await page.getByTestId(id).innerText());

test.describe('text boxes', () => {
  // Checklist item 1.
  test('a clicked box keeps its width; its height follows the text, down as well as up', async ({
    page,
  }) => {
    await page.keyboard.press('KeyT');
    await page.mouse.click(200, 200);
    await expect(editor(page)).toBeVisible();
    const size = await readout(page, 'font-size');
    const width = await readout(page, 'geo-w');
    // One line to start, not the eight lines of empty space it used to open with.
    const oneLine = await readout(page, 'geo-h');
    expect(oneLine).toBeLessThan(size * 2);

    await page.keyboard.type(
      'A sentence long enough to wrap onto a second line, and a third, at this width.',
    );
    await expect.poll(() => readout(page, 'geo-h')).toBeGreaterThan(oneLine + size);
    expect(await readout(page, 'geo-w')).toBe(width);

    // Words taken away: the box comes back up to them, with nothing empty below.
    await page.keyboard.press('ControlOrMeta+KeyA');
    await page.keyboard.type('Short');
    await expect.poll(() => readout(page, 'geo-h')).toBe(oneLine);
    expect(await readout(page, 'geo-w')).toBe(width);
  });

  // Checklist item 2.
  test('a one-line box or placeholder stays one line once its words are deleted', async ({
    page,
  }) => {
    await page.keyboard.press('KeyT');
    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(700, 330, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.type('abc');
    const typed = await readout(page, 'geo-h');
    await page.keyboard.press('ControlOrMeta+KeyA');
    await page.keyboard.press('Backspace');
    await expect(editor(page)).toHaveText('');
    await page.waitForTimeout(200);
    expect(await readout(page, 'geo-h')).toBe(typed);
    await page.keyboard.press('Escape');

    await page.getByTestId('insert-menu').click();
    await page.getByTestId('insert-placeholder').click();
    await page.mouse.click(300, 450);
    await page.mouse.click(60, 60);
    await page.keyboard.press('KeyH');
    await page.mouse.click(380, 475);
    await expect(editor(page)).toBeVisible();
    await page.keyboard.type('Answer');
    await page.keyboard.press('ControlOrMeta+KeyA');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Escape');
    await layers(page).last().click();
    const size = await readout(page, 'font-size');
    expect(await readout(page, 'geo-h')).toBeLessThan(size * 2);
  });
});

// Checklist item 3.
test('erased ink stays erased when drawing carries on', async ({ page }) => {
  const stroke = async (y: number) => {
    await page.keyboard.press('KeyP');
    await page.mouse.move(200, y);
    await page.mouse.down();
    await page.mouse.move(600, y, { steps: 20 });
    await page.mouse.up();
  };
  const erase = async () => {
    await page.mouse.move(400, 250);
    await page.mouse.down();
    await page.mouse.move(400, 350, { steps: 10 });
    await page.mouse.up();
  };

  // The whole stroke rubbed out.
  await stroke(300);
  await expect(layers(page)).toHaveCount(1);
  await page.keyboard.press('KeyE');
  await erase();
  await expect(layers(page)).toHaveCount(0);
  await stroke(500);
  await expect(layers(page)).toHaveCount(1);

  // Part of one: two pieces, and still two once more is drawn.
  await stroke(300);
  await page.keyboard.press('KeyE');
  await page.getByTestId('eraser-stroke').click();
  await erase();
  await expect(layers(page)).toHaveCount(3);
  await stroke(600);
  await expect(layers(page)).toHaveCount(4);
});

test.describe('the side panel', () => {
  // Checklist item 4.
  test('nothing on the board covers it', async ({ page }) => {
    // A frame whose number sits where the panel opens.
    await page.keyboard.press('KeyF');
    await page.mouse.move(980, 120);
    await page.mouse.down();
    await page.mouse.move(1100, 260, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByTestId('inspector')).toBeVisible();
    const badge = (await page.locator('[data-testid^="frame-number-"]').first().boundingBox())!;
    const onTop = await page.evaluate(
      ([x, y]) => Boolean(document.elementFromPoint(x!, y!)?.closest('[data-testid="inspector"]')),
      [badge.x + badge.width / 2, badge.y + badge.height / 2],
    );
    expect(onTop).toBe(true);
  });

  // Checklist item 5.
  test('switched on, it shows for a selection or a pen, with no "Nothing selected"; off, never', async ({
    page,
  }) => {
    // The object list has its own switch; off, the panel has only the selection to show.
    await page.getByTestId('tools-menu').click();
    await page.getByTestId('toggle-layers').click();
    await page.keyboard.press('Escape');
    const panel = page.getByTestId('inspector');
    await expect(panel).toHaveCount(0);

    await page.keyboard.press('KeyR');
    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(400, 380, { steps: 4 });
    await page.mouse.up();
    await expect(panel).toBeVisible();
    await expect(page.getByText('Nothing selected')).toHaveCount(0);
    await page.mouse.click(700, 600);
    await expect(panel).toHaveCount(0);

    // The pen's colours and widths are in the panel, at its top.
    await page.keyboard.press('KeyP');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('tool-options')).toBeVisible();

    // Switched off: no panel, whatever is selected; the pen's options stand alone.
    await page.getByTestId('toggle-pane').click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId('tool-options')).toBeVisible();
    await page.keyboard.press('KeyV');
    await page.mouse.click(350, 340);
    await expect(page.getByTestId('toggle-pane')).toHaveAttribute('aria-pressed', 'false');
    await expect(panel).toHaveCount(0);
  });
});

// Checklist item 6.
test('a duplicate lands directly below the original, lined up', async ({ page }) => {
  await page.keyboard.press('KeyR');
  await page.mouse.move(300, 200);
  await page.mouse.down();
  await page.mouse.move(420, 280, { steps: 4 });
  await page.mouse.up();
  const x = await readout(page, 'geo-x');
  const y = await readout(page, 'geo-y');
  const h = await readout(page, 'geo-h');
  await page.keyboard.press('ControlOrMeta+KeyD');
  await expect(layers(page)).toHaveCount(2);
  await expect.poll(() => readout(page, 'geo-y')).toBe(y + h + 16);
  expect(await readout(page, 'geo-x')).toBe(x);
});

// Checklist item 7.
test('strikethrough, on chosen words while typing and on a whole box', async ({ page }) => {
  await page.keyboard.press('KeyT');
  await page.mouse.click(200, 200);
  await page.keyboard.type('keep cross');
  for (let index = 0; index < 5; index += 1) await page.keyboard.press('Shift+ArrowLeft');
  await page.getByTestId('text-strike').click();
  await expect(editor(page).locator('span')).toHaveCSS('text-decoration-line', 'line-through');
  await expect(editor(page).locator('span')).toHaveText('cross');
  // The shortcut takes it off again.
  await page.keyboard.press('ControlOrMeta+Shift+KeyX');
  await expect(editor(page).locator('span')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+KeyX');
  await page.keyboard.press('Escape');

  // It stays on the words after typing ends, and the box can be struck through whole.
  await layers(page).first().click();
  await expect(page.getByTestId('text-strike')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('text-strike').click();
  await expect(page.getByTestId('text-strike')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.dblclick(260, 225);
  await expect(editor(page).locator('span')).toHaveText('cross');
});

// Checklist item 8.
test('shortcuts for the placeholder tool, stamps and presenting, in the cheat sheet', async ({
  page,
}) => {
  await page.keyboard.press('KeyQ');
  await page.getByTestId('insert-menu').click();
  await expect(page.getByTestId('insert-placeholder')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');

  // S picks up the stamp; S again moves on to the next one.
  await page.mouse.move(600, 400);
  await page.keyboard.press('KeyS');
  await expect(page.getByTestId('stage')).toHaveAttribute('data-cursor', 'stamp');
  await page.mouse.click(600, 400);
  await page.keyboard.press('KeyS');
  await page.keyboard.press('KeyS');
  await page.mouse.click(700, 400);
  await expect(layers(page)).toHaveCount(2);
  const stamps = await page.evaluate(
    () => [...document.querySelectorAll('[data-testid="layers"] li')].length,
  );
  expect(stamps).toBe(2);

  await page.keyboard.press('Shift+Slash');
  const sheet = page.getByTestId('shortcut-sheet');
  await expect(sheet).toContainText('Placeholder');
  await expect(sheet).toContainText('Start presenting');
  await expect(sheet).toContainText('Stamp');
  await expect(sheet).toContainText('Strikethrough');
  await page.keyboard.press('Escape');

  // Presenting, from the keyboard.
  await page.keyboard.press('KeyF');
  await page.mouse.move(200, 450);
  await page.mouse.down();
  await page.mouse.move(400, 600, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('presentation-bar')).toBeVisible();
});
