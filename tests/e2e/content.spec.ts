import { expect, test, type Page } from '@playwright/test';

/** Ink coverage inside a page-space rectangle, as a fraction of its pixels. */
async function inkFraction(page: Page, rect: { x: number; y: number; w: number; h: number }) {
  return page.evaluate((area) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="board-canvas"]')!;
    const bounds = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d')!;
    const dpr = canvas.width / bounds.width;

    const background = getComputedStyle(document.documentElement)
      .getPropertyValue('--canvas-bg')
      .trim();
    const probe = document.createElement('canvas').getContext('2d')!;
    probe.fillStyle = background;
    probe.fillRect(0, 0, 1, 1);
    const [br, bg, bb] = probe.getImageData(0, 0, 1, 1).data;

    const data = ctx.getImageData(
      Math.round((area.x - bounds.left) * dpr),
      Math.round((area.y - bounds.top) * dpr),
      Math.round(area.w * dpr),
      Math.round(area.h * dpr),
    ).data;

    let different = 0;
    for (let index = 0; index < data.length; index += 4) {
      const distance =
        Math.abs(data[index]! - br!) +
        Math.abs(data[index + 1]! - bg!) +
        Math.abs(data[index + 2]! - bb!);
      // The dot grid is a faint difference; real content is far from the background.
      if (distance > 90) different += 1;
    }
    return different / (data.length / 4);
  }, rect);
}

async function drawStroke(page: Page, path: Array<[number, number]>, modifiers: string[] = []) {
  await page.keyboard.press('KeyP');
  const [first, ...rest] = path;
  await page.mouse.move(first![0], first![1]);
  await page.mouse.down();
  for (const key of modifiers) await page.keyboard.down(key);
  for (const [x, y] of rest) await page.mouse.move(x, y);
  for (const key of modifiers) await page.keyboard.up(key);
  await page.mouse.up();
}

const arc = (fromX: number, y: number, count = 24, amplitude = 70): Array<[number, number]> =>
  Array.from({ length: count }, (_, index) => [
    fromX + index * 10,
    y - Math.sin((index / (count - 1)) * Math.PI) * amplitude,
  ]);

const layerNames = (page: Page) => page.getByTestId('layers').locator('li').allInnerTexts();
const geo = async (page: Page) => ({
  x: Number(await page.getByTestId('geo-x').innerText()),
  y: Number(await page.getByTestId('geo-y').innerText()),
  w: Number(await page.getByTestId('geo-w').innerText()),
  h: Number(await page.getByTestId('geo-h').innerText()),
});

/** Pastes a generated PNG, the way a screenshot from the clipboard would arrive. */
async function pasteImage(page: Page, width: number, height: number) {
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
    [width, height],
  );
  await expect(page.getByTestId('layers').locator('li')).toHaveCount(1);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board-canvas')).toBeVisible();
});

test.describe('freehand ink', () => {
  // Checklist item 1.
  test('the pen leaves a stroke that follows the pointer', async ({ page }) => {
    await drawStroke(page, arc(300, 400));

    expect(await layerNames(page)).toEqual(['path']);
    const box = await geo(page);
    expect(box.w).toBeGreaterThan(200);
    expect(box.h).toBeGreaterThan(50);
    expect(await inkFraction(page, { x: 300, y: 320, w: 240, h: 100 })).toBeGreaterThan(0.01);
  });

  // Checklist item 2 — the gate.
  test('holding shift mid-stroke straightens it', async ({ page }) => {
    await drawStroke(page, arc(300, 400));
    const freehand = await geo(page);

    await page.keyboard.press('ControlOrMeta+KeyA');
    await page.keyboard.press('Delete');

    // Identical motion, but with Shift held from the first move onwards.
    await drawStroke(page, arc(300, 400), ['Shift']);
    const straightened = await geo(page);

    expect(straightened.w).toBeGreaterThan(180);
    // The arc rises 70px; a straight line between its ends barely rises at all.
    expect(straightened.h).toBeLessThan(freehand.h / 3);
  });

  test('the pen keeps drawing freehand after shift is released', async ({ page }) => {
    await page.keyboard.press('KeyP');
    await page.mouse.move(300, 400);
    await page.mouse.down();
    await page.mouse.move(340, 400);
    await page.keyboard.down('Shift');
    await page.mouse.move(460, 400);
    await page.keyboard.up('Shift');
    for (const [x, y] of arc(460, 400, 12, 60)) await page.mouse.move(x, y);
    await page.mouse.up();

    // The trailing arc is back to freehand, so the stroke is tall again.
    expect((await geo(page)).h).toBeGreaterThan(30);
  });
});

// Checklist item 3.
test.describe('eraser', () => {
  test('object mode removes the whole stroke', async ({ page }) => {
    await drawStroke(page, arc(300, 400));
    expect(await layerNames(page)).toHaveLength(1);

    await page.keyboard.press('KeyE');
    await page.mouse.move(300, 400);
    await page.mouse.down();
    await page.mouse.move(420, 340, { steps: 6 });
    await page.mouse.up();

    expect(await layerNames(page)).toHaveLength(0);
  });

  test('stroke mode cuts a line into two pieces', async ({ page }) => {
    await drawStroke(page, [
      [260, 400],
      [400, 400],
      [560, 400],
      [700, 400],
    ]);
    expect(await layerNames(page)).toEqual(['path']);

    await page.keyboard.press('KeyE');
    await page.getByTestId('eraser-stroke').click();
    await page.mouse.move(480, 360);
    await page.mouse.down();
    await page.mouse.move(480, 440, { steps: 6 });
    await page.mouse.up();

    expect(await layerNames(page)).toEqual(['path', 'path']);
  });
});

// Checklist item 4 — the gate.
test.describe('laser pointer', () => {
  test('leaves a trail that fades and is never saved', async ({ page }) => {
    await page.keyboard.press('KeyK');

    await page.mouse.move(400, 400);
    await page.mouse.down();
    for (let step = 0; step < 20; step += 1) await page.mouse.move(400 + step * 12, 400);
    await page.mouse.up();

    // Something is on screen right after drawing…
    await expect
      .poll(() => inkFraction(page, { x: 400, y: 380, w: 240, h: 40 }), { timeout: 2000 })
      .toBeGreaterThan(0.005);

    // …it creates no element…
    expect(await layerNames(page)).toHaveLength(0);

    // …and it is gone on its own within the ink lifetime.
    await expect
      .poll(() => inkFraction(page, { x: 400, y: 380, w: 240, h: 40 }), { timeout: 9000 })
      .toBeLessThan(0.002);
  });

  test('survives a reload with no trace, because it was never stored', async ({ page }) => {
    await page.keyboard.press('KeyK');
    await page.mouse.move(400, 400);
    await page.mouse.down();
    await page.mouse.move(600, 400, { steps: 10 });
    await page.mouse.up();

    await page.reload();
    await expect(page.getByTestId('board-canvas')).toBeVisible();
    expect(await layerNames(page)).toHaveLength(0);
  });
});

test.describe('text', () => {
  // Checklist item 5.
  test('types, formats and keeps the formatting', async ({ page }) => {
    await page.keyboard.press('KeyT');
    await page.mouse.click(320, 360);
    await expect(page.getByTestId('text-editor')).toBeFocused();
    await page.keyboard.type('Hello board');
    await page.keyboard.press('Escape');

    expect(await layerNames(page)).toEqual(['text']);
    await expect(page.getByTestId('text-controls')).toBeVisible();

    await page.getByTestId('size-40').click();
    await expect(page.getByTestId('size-40')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('text-bold').click();
    await expect(page.getByTestId('text-bold')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('font-serif').click();
    await expect(page.getByTestId('font-serif')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('text-align-center').click();
    await expect(page.getByTestId('text-align-center')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('text-bullet').click();
    await expect(page.getByTestId('text-bullet')).toHaveAttribute('aria-pressed', 'true');
  });

  // Checklist item 6 — the gate.
  test('lays Arabic out right to left', async ({ page }) => {
    await page.keyboard.press('KeyT');
    await page.mouse.click(320, 360);
    await page.keyboard.type('مرحبا بالسبورة');

    const editor = page.getByTestId('text-editor');
    await expect(editor).toHaveAttribute('dir', 'rtl');
    await expect(editor).toHaveValue('مرحبا بالسبورة');

    await page.keyboard.press('Escape');
    // And it actually renders on the canvas rather than silently dropping out.
    expect(await inkFraction(page, { x: 300, y: 340, w: 260, h: 50 })).toBeGreaterThan(0.005);
  });

  test('switches back to left-to-right for Latin text', async ({ page }) => {
    await page.keyboard.press('KeyT');
    await page.mouse.click(320, 360);
    await page.keyboard.type('hello');
    await expect(page.getByTestId('text-editor')).toHaveAttribute('dir', 'ltr');
  });

  test('discards an empty text box rather than leaving litter', async ({ page }) => {
    await page.keyboard.press('KeyT');
    await page.mouse.click(320, 360);
    await page.keyboard.press('Escape');
    expect(await layerNames(page)).toHaveLength(0);
  });

  test('double-clicking reopens the editor', async ({ page }) => {
    await page.keyboard.press('KeyT');
    await page.mouse.click(320, 360);
    await page.keyboard.type('edit me');
    await page.keyboard.press('Escape');

    await page.keyboard.press('KeyV');
    await page.mouse.dblclick(340, 372);
    await expect(page.getByTestId('text-editor')).toHaveValue('edit me');
  });
});

// Checklist item 7.
test.describe('sticky notes', () => {
  test('shrinks its text instead of overflowing', async ({ page }) => {
    await page.keyboard.press('KeyN');
    await page.mouse.click(500, 400);
    await page.keyboard.type('short');
    await page.keyboard.press('Escape');

    const size = await geo(page);
    expect(size.w).toBe(size.h);

    await page.mouse.dblclick(500, 400);
    await page.keyboard.press('ControlOrMeta+KeyA');
    await page.keyboard.type(
      'a much longer note that would spill straight out of the square if the text did not shrink to fit inside it',
    );
    await page.keyboard.press('Escape');

    // The note is the same size…
    expect(await geo(page)).toMatchObject({ w: size.w, h: size.h });

    // …and nothing is drawn in the margin just outside it.
    const outside = await inkFraction(page, { x: 500 + size.w / 2 + 12, y: 380, w: 60, h: 40 });
    expect(outside).toBeLessThan(0.01);
  });
});

test.describe('images', () => {
  // Checklist item 8.
  test('paste drops an image onto the board', async ({ page }) => {
    await pasteImage(page, 400, 300);

    expect(await layerNames(page)).toEqual(['image']);
    const box = await geo(page);
    expect(box.w / box.h).toBeCloseTo(4 / 3, 1);
  });

  // Checklist item 10 — the gate.
  test('resizing holds the ratio, and shift frees it', async ({ page }) => {
    await pasteImage(page, 400, 300);
    await page.keyboard.press('KeyV');

    const start = await geo(page);
    const ratio = start.w / start.h;
    const origin = (await page.getByTestId('stage').boundingBox())!;
    const corner = { x: origin.x + start.x + start.w, y: origin.y + start.y + start.h };

    // No modifier: the ratio holds even though the drag is mostly horizontal.
    await page.mouse.move(corner.x, corner.y);
    await page.mouse.down();
    await page.mouse.move(corner.x + 160, corner.y + 10, { steps: 8 });
    await page.mouse.up();

    const locked = await geo(page);
    expect(locked.w).toBeGreaterThan(start.w);
    expect(locked.w / locked.h).toBeCloseTo(ratio, 1);

    // With Shift the ratio is released — the reverse of how shapes behave.
    const nextCorner = { x: origin.x + locked.x + locked.w, y: origin.y + locked.y + locked.h };
    await page.keyboard.down('Shift');
    await page.mouse.move(nextCorner.x, nextCorner.y);
    await page.mouse.down();
    await page.mouse.move(nextCorner.x + 200, nextCorner.y + 4, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    const freed = await geo(page);
    expect(freed.w / freed.h).toBeGreaterThan(ratio * 1.2);
  });
});

// Checklist item 11.
test.describe('connectors', () => {
  test('an arrow binds to two shapes and follows them', async ({ page }) => {
    await page.keyboard.press('KeyR');
    await page.mouse.move(300, 250);
    await page.mouse.down();
    await page.mouse.move(420, 330, { steps: 5 });
    await page.mouse.up();

    await page.keyboard.press('KeyR');
    await page.mouse.move(300, 500);
    await page.mouse.down();
    await page.mouse.move(420, 580, { steps: 5 });
    await page.mouse.up();

    await page.keyboard.press('KeyA');
    await page.mouse.move(360, 290);
    await page.mouse.down();
    await page.mouse.move(360, 540, { steps: 8 });
    await page.mouse.up();

    expect(await layerNames(page)).toContain('arrow');
    const before = await geo(page);

    // Move the lower shape sideways; the arrow has to follow it.
    await page.keyboard.press('KeyV');
    await page.mouse.move(360, 540);
    await page.mouse.down();
    await page.mouse.move(700, 540, { steps: 10 });
    await page.mouse.up();

    await page.getByTestId('layers').locator('li button').first().click();
    const after = await geo(page);
    expect(after.w).toBeGreaterThan(before.w + 100);
  });
});

// Checklist item 12.
test.describe('frames', () => {
  test('moving a frame carries what is inside it', async ({ page }) => {
    await page.keyboard.press('KeyR');
    await page.mouse.move(400, 350);
    await page.mouse.down();
    await page.mouse.move(480, 420, { steps: 5 });
    await page.mouse.up();

    await page.keyboard.press('KeyF');
    await page.mouse.move(340, 300);
    await page.mouse.down();
    await page.mouse.move(560, 500, { steps: 8 });
    await page.mouse.up();

    expect(await layerNames(page)).toContain('frame');

    await page.keyboard.press('KeyV');
    // Click a part of the frame with nothing on top of it, then drag from there.
    await page.mouse.click(360, 480);
    await page.mouse.move(360, 480);
    await page.mouse.down();
    await page.mouse.move(560, 480, { steps: 10 });
    await page.mouse.up();

    // The rectangle went with the frame, so it is no longer where it was drawn.
    expect(await inkFraction(page, { x: 400, y: 350, w: 70, h: 60 })).toBeLessThan(0.05);
    expect(await inkFraction(page, { x: 600, y: 350, w: 70, h: 60 })).toBeGreaterThan(0.2);
  });
});

// Checklist item 13.
test.describe('shortcut sheet', () => {
  test('opens with ? and closes with Escape', async ({ page }) => {
    await page.keyboard.press('Shift+Slash');
    await expect(page.getByTestId('shortcut-sheet')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await expect(page.getByText('Straighten the stroke')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('shortcut-sheet')).toHaveCount(0);
  });
});
