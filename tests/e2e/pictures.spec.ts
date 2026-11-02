import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 14.2 on the signed-out board: a picture pasted to fit what is selected,
 * cropping by double-click, and the board moving along when something is dragged to
 * its edge. The two kinds of lock are in shapes.spec.ts and classroom.spec.ts.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  await expect(page.getByTestId('zoom-readout')).toHaveText('100%');
});

const layers = (page: Page) => page.getByTestId('layers').locator('li');
const geo = async (page: Page) => ({
  x: Number(await page.getByTestId('geo-x').innerText()),
  y: Number(await page.getByTestId('geo-y').innerText()),
  w: Number(await page.getByTestId('geo-w').innerText()),
  h: Number(await page.getByTestId('geo-h').innerText()),
});

/** Pastes a picture from the clipboard: red, with its top-left quarter green. */
async function pastePicture(page: Page, width: number, height: number) {
  const count = await layers(page).count();
  await page.evaluate(
    async ([w, h]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w!;
      canvas.height = h!;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#c2456b';
      ctx.fillRect(0, 0, w!, h!);
      ctx.fillStyle = '#2f9e7e';
      ctx.fillRect(0, 0, w! / 2, h! / 2);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((result) => resolve(result!), 'image/png'),
      );
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'pasted.png', { type: 'image/png' }));
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true }));
    },
    [width, height] as const,
  );
  await expect(layers(page)).toHaveCount(count + 1);
}

/** How much of an area of the board (screen pixels) is the picture's green. */
async function greenIn(page: Page, area: { x: number; y: number; w: number; h: number }) {
  return page.evaluate((region) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="board-canvas"]')!;
    const bounds = canvas.getBoundingClientRect();
    const dpr = canvas.width / bounds.width;
    const data = canvas
      .getContext('2d')!
      .getImageData(
        (region.x - bounds.left) * dpr,
        (region.y - bounds.top) * dpr,
        region.w * dpr,
        region.h * dpr,
      ).data;
    let green = 0;
    for (let index = 0; index < data.length; index += 4) {
      const distance =
        Math.abs(data[index]! - 0x2f) +
        Math.abs(data[index + 1]! - 0x9e) +
        Math.abs(data[index + 2]! - 0x7e);
      if (distance < 40) green += 1;
    }
    return green / (data.length / 4);
  }, area);
}

// Checklist item 1.
test('pasted with something selected, a picture takes its width and lines up under it', async ({
  page,
}) => {
  await page.keyboard.press('KeyT');
  await page.mouse.move(300, 200);
  await page.mouse.down();
  await page.mouse.move(500, 240, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.type('Caption');
  await page.keyboard.press('Escape');
  await layers(page).first().click();
  const box = await geo(page);

  // Twice as wide as tall: under the box, at its width, half as tall.
  await pastePicture(page, 400, 200);
  const first = await geo(page);
  expect(first.x).toBe(box.x);
  expect(first.w).toBe(box.w);
  expect(first.h).toBeCloseTo(box.w / 2, 0);
  expect(first.y).toBe(box.y + box.h + 16);

  // The new picture is selected: the next one lines up under it, square as it is.
  await pastePicture(page, 300, 300);
  const second = await geo(page);
  expect(second.x).toBe(box.x);
  expect(second.w).toBe(box.w);
  expect(second.h).toBeCloseTo(box.w, 0);
  expect(second.y).toBe(first.y + first.h + 16);

  // Nothing selected: as before, sized by its shape where the pointer is.
  await page.mouse.click(900, 600);
  await expect(page.getByTestId('geo-w')).toHaveCount(0);
  await pastePicture(page, 400, 200);
  const alone = await geo(page);
  expect(alone.w).not.toBe(box.w);
  expect(alone.w / alone.h).toBeCloseTo(2, 1);
});

// Checklist item 2.
test('a double-click crops a picture by its edges; the whole picture is never lost', async ({
  page,
}) => {
  await page.mouse.move(500, 360);
  await pastePicture(page, 400, 200);
  const whole = await geo(page);
  const area = (box: typeof whole) => ({ x: box.x + 2, y: box.y + 2, w: box.w - 4, h: box.h - 4 });
  // A quarter of it is green.
  await expect.poll(() => greenIn(page, area(whole))).toBeGreaterThan(0.2);

  await page.mouse.dblclick(whole.x + whole.w / 2, whole.y + whole.h / 2);
  await expect(page.getByTestId('crop-hint')).toBeVisible();
  // The left edge's handle, dragged halfway in: the green half is cropped away.
  await page.mouse.move(whole.x, whole.y + whole.h / 2);
  await expect(page.getByTestId('stage')).toHaveAttribute('data-cursor', /resize/);
  await page.mouse.down();
  await page.mouse.move(whole.x + whole.w / 2, whole.y + whole.h / 2, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('crop-hint')).toHaveCount(0);
  const cropped = await geo(page);
  expect(cropped.x).toBeCloseTo(whole.x + whole.w / 2, -1);
  expect(cropped.w).toBeCloseTo(whole.w / 2, -1);
  expect(cropped.h).toBe(whole.h);
  await page.mouse.click(900, 650);
  await expect.poll(() => greenIn(page, area(cropped))).toBeLessThan(0.01);

  // Cropped again later: dragged out past the picture, the edge stops at its side, and
  // all of it is back.
  await page.mouse.dblclick(cropped.x + cropped.w / 2, cropped.y + cropped.h / 2);
  await expect(page.getByTestId('crop-hint')).toBeVisible();
  await page.mouse.move(cropped.x, cropped.y + cropped.h / 2);
  await page.mouse.down();
  await page.mouse.move(cropped.x - cropped.w * 3, cropped.y + cropped.h / 2, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  const again = await geo(page);
  expect(again.x).toBe(whole.x);
  expect(again.w).toBe(whole.w);
  await page.mouse.click(900, 650);
  await expect.poll(() => greenIn(page, area(again))).toBeGreaterThan(0.2);

  // Cropped once more and reloaded: the crop was kept.
  await page.mouse.dblclick(whole.x + whole.w / 2, whole.y + whole.h / 2);
  await page.mouse.move(whole.x, whole.y + whole.h / 2);
  await page.mouse.down();
  await page.mouse.move(whole.x + whole.w / 2, whole.y + whole.h / 2, { steps: 6 });
  await page.mouse.up();
  await page.mouse.click(900, 650);
  await expect(page.getByTestId('crop-hint')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  await layers(page).first().click();
  expect((await geo(page)).w).toBe(cropped.w);
  await page.mouse.click(1100, 690);
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const board = { x: stage.x, y: stage.y, w: stage.width, h: stage.height };
  await expect.poll(() => greenIn(page, board)).toBeLessThan(0.0005);
});

// Checklist item 6.
test('something dragged to the edge of the board takes the board along', async ({ page }) => {
  await page.keyboard.press('KeyR');
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(400, 380, { steps: 4 });
  await page.mouse.up();
  const start = await geo(page);

  // To the board's right edge, and held there a moment.
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const edge = stage.x + stage.width - 6;
  await page.mouse.move(350, 340);
  await page.mouse.down();
  await page.mouse.move(edge, 340, { steps: 12 });
  await page.waitForTimeout(800);
  await page.mouse.up();

  // It went further than the pointer did on screen: the board moved on under it.
  const moved = await geo(page);
  expect(moved.x - start.x).toBeGreaterThan(edge - 350 + 150);
  await expect(page.getByTestId('zoom-readout')).toHaveText('100%');
});
