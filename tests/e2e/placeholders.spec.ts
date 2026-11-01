import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 14 on the signed-out board: placeholders — a box with a hint that one click
 * types into, whatever the tool, which shows its hint again when emptied.
 * classroom.spec.ts covers the Answer role and locks, which need other people.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board-canvas')).toBeVisible();
});

const layerItems = (page: Page) => page.getByTestId('layers').locator('li');
const editor = (page: Page) => page.getByTestId('text-editor');

/** How much of an area of the canvas is close to a token's colour. */
async function colourFraction(
  page: Page,
  token: string,
  area: { x: number; y: number; w: number; h: number },
) {
  return page.evaluate(
    ([wanted, region]) => {
      const resolved = getComputedStyle(document.documentElement).getPropertyValue(wanted).trim();
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
        if (distance < 60) near += 1;
      }
      return near / (data.length / 4);
    },
    [token, area] as const,
  );
}

/**
 * Takes the placeholder tool from Insert and clicks on the board, which places a
 * one-line placeholder with its top left where the click was; then writes its hint.
 * Returns a point inside it. Positions are worked out on screen, at 100%.
 */
async function insertPlaceholder(page: Page, hint: string, at: [number, number] = [300, 300]) {
  await expect(page.getByTestId('zoom-readout')).toHaveText('100%');
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-placeholder').click();
  await page.mouse.click(at[0], at[1]);
  const field = page.getByTestId('placeholder-hint');
  await expect(field).toBeFocused();
  await field.fill(hint);
  await expect(layerItems(page)).toHaveCount(1);
  return { x: at[0] + 80, y: at[1] + 30 };
}

const readout = async (page: Page, id: string) =>
  parseFloat(await page.getByTestId(id).innerText());

// Checklist item 1.
test('one click types into a placeholder, whatever the tool; emptied, its hint is back', async ({
  page,
}) => {
  const middle = await insertPlaceholder(page, 'Your name');
  // Where the end of the hint is drawn, past where the answer below will reach, and
  // clear of the box's dashed edge.
  const area = { x: middle.x + 20, y: middle.y - 20, w: 120, h: 38 };
  // Its hint is drawn, faint, while it is empty.
  await page.mouse.click(60, 60);
  await expect.poll(() => colourFraction(page, '--text-muted', area)).toBeGreaterThan(0.004);

  // Holding the pen, one click is a click into it — not a stroke.
  await page.keyboard.press('KeyP');
  await page.mouse.click(middle.x, middle.y);
  await expect(editor(page)).toBeVisible();
  await expect(editor(page)).toHaveAttribute('data-placeholder', 'Your name');
  await page.keyboard.type('Ada');
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  await expect(layerItems(page)).toHaveCount(1);
  // The answer, in the text's own colour; no hint now.
  await expect.poll(() => colourFraction(page, '--text-muted', area)).toBeLessThan(0.002);

  // With the hand, the same: one click, and typing. Emptied, it stays, hint and all.
  await page.keyboard.press('KeyH');
  await page.mouse.click(middle.x, middle.y);
  await expect(editor(page)).toBeVisible();
  await page.keyboard.press('ControlOrMeta+KeyA');
  await page.keyboard.press('Backspace');
  await expect(editor(page)).toHaveAttribute('data-empty');
  await page.keyboard.press('Escape');
  await expect(layerItems(page)).toHaveCount(1);
  await expect.poll(() => colourFraction(page, '--text-muted', area)).toBeGreaterThan(0.004);
});

test('a click places one line where it is clicked; a drag, the size dragged', async ({ page }) => {
  await insertPlaceholder(page, 'Name', [300, 260]);
  // One line, not two: the hint needs no more.
  const size = await readout(page, 'font-size');
  expect(await readout(page, 'geo-h')).toBeLessThan(size * 2);
  // Where it was clicked: its hint starts there.
  await page.mouse.click(60, 60);
  await expect
    .poll(() => colourFraction(page, '--text-muted', { x: 308, y: 268, w: 110, h: 40 }))
    .toBeGreaterThan(0.004);

  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-placeholder').click();
  await page.mouse.move(300, 420);
  await page.mouse.down();
  await page.mouse.move(700, 620, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('placeholder-hint')).toBeFocused();
  await expect(layerItems(page)).toHaveCount(2);
  expect(Math.abs((await readout(page, 'geo-w')) - 400)).toBeLessThan(4);
  expect(Math.abs((await readout(page, 'geo-h')) - 200)).toBeLessThan(4);
});

test('with the select tool, inside types, the edge takes hold, and the corner resizes', async ({
  page,
}) => {
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-placeholder').click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(700, 420, { steps: 6 });
  await page.mouse.up();
  await page.getByTestId('placeholder-hint').fill('Answer here');
  await page.mouse.click(60, 60);
  await page.keyboard.press('KeyV');
  const cursor = page.getByTestId('stage');

  // The pointer says which is which.
  await page.mouse.move(500, 360);
  await expect(cursor).toHaveAttribute('data-cursor', 'text');
  await page.mouse.move(303, 360);
  await expect(cursor).toHaveAttribute('data-cursor', 'move');

  // A click on the edge selects it, without typing.
  await page.mouse.click(303, 360);
  await expect(editor(page)).toHaveCount(0);
  await expect(page.getByTestId('geo-w')).toHaveText('400');

  // Its corner shows the resize arrows, and resizes.
  await page.mouse.move(700, 420);
  await expect(cursor).toHaveAttribute('data-cursor', 'nwse-resize');
  await page.mouse.down();
  await page.mouse.move(800, 470, { steps: 6 });
  await page.mouse.up();
  expect(Math.abs((await readout(page, 'geo-w')) - 500)).toBeLessThan(4);

  // Dragged by its edge, it moves.
  const x = await readout(page, 'geo-x');
  await page.mouse.move(303, 360);
  await page.mouse.down();
  await page.mouse.move(363, 400, { steps: 6 });
  await page.mouse.up();
  await expect(editor(page)).toHaveCount(0);
  expect(Math.abs((await readout(page, 'geo-x')) - (x + 60))).toBeLessThan(4);

  // Inside, a click types.
  await page.mouse.click(600, 420);
  await expect(editor(page)).toBeVisible();
});

test('an ordinary text box becomes a placeholder from the side panel, and back', async ({
  page,
}) => {
  await page.keyboard.press('KeyT');
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(600, 360, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.type('Question one');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('placeholder-toggle')).not.toBeChecked();

  await page.getByTestId('placeholder-toggle').check();
  await expect(page.getByTestId('placeholder-hint')).toHaveValue('Click here to write');
  await page.getByTestId('placeholder-toggle').uncheck();
  await expect(page.getByTestId('placeholder-hint')).toHaveCount(0);
});
