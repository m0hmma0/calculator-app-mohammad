import { expect, test, type Page } from '@playwright/test';

/**
 * Writing and drawing on the board as a person does: text boxes, pasted text, lists,
 * smart shapes, words inside shapes, and the side panel's arranging and styling.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board-canvas')).toBeVisible();
});

const layerNames = async (page: Page) =>
  (await page.getByTestId('layers').locator('li').allInnerTexts()).map((name) => name.trim());
const geo = async (page: Page) => ({
  x: Number(await page.getByTestId('geo-x').innerText()),
  y: Number(await page.getByTestId('geo-y').innerText()),
  w: Number(await page.getByTestId('geo-w').innerText()),
  h: Number(await page.getByTestId('geo-h').innerText()),
});
const editor = (page: Page) => page.getByTestId('text-editor');
/** What the text box holds, line breaks and all. */
const typed = (page: Page) => editor(page).evaluate((node) => node.textContent ?? '');

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 6 });
  await page.mouse.up();
}

/** How much of an area of the canvas is close to a colour (a CSS colour or a token). */
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
        if (distance < 60) near += 1;
      }
      return near / (data.length / 4);
    },
    [colour, area] as const,
  );
}

test.describe('text boxes', () => {
  test('the caret stays where it is put: words go in at the start of a line', async ({ page }) => {
    await page.keyboard.press('KeyT');
    await page.mouse.click(200, 200);
    await page.keyboard.type('world');
    await page.keyboard.press('Home');
    await page.keyboard.type('hello ');
    await expect.poll(() => typed(page)).toBe('hello world');
  });

  test('a click places a large box with large type; a drag sets the size', async ({ page }) => {
    await page.keyboard.press('KeyT');
    await page.mouse.move(300, 300);
    await expect(page.getByTestId('stage')).toHaveAttribute('data-cursor', 'text');

    await page.mouse.click(120, 140);
    await page.keyboard.type('Hi');
    await page.keyboard.press('Escape');
    // 55 characters wide and 8 lines of 40px type tall.
    const clicked = await geo(page);
    expect(clicked.w).toBeGreaterThan(800);
    expect(clicked.h).toBeCloseTo(8 * 40 * 1.35 + 4, -1);
    await expect(page.getByTestId('size-40')).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('KeyT');
    await drag(page, [200, 520], [500, 620]);
    await page.keyboard.type('Sized');
    await page.keyboard.press('Escape');
    const dragged = await geo(page);
    expect(dragged.w).toBeCloseTo(300, -1);
    expect(dragged.h).toBeGreaterThanOrEqual(100);
  });

  test('a box grows to hold what is typed, so every line can be clicked', async ({ page }) => {
    await page.keyboard.press('KeyT');
    await drag(page, [200, 150], [700, 210]);
    for (let line = 0; line < 6; line += 1) {
      await page.keyboard.type(`line ${line}`);
      await page.keyboard.press('Shift+Enter');
    }
    await page.keyboard.press('Escape');
    expect((await geo(page)).h).toBeGreaterThan(6 * 54);
  });

  test('clicking away ends typing; one click selects, a double click edits', async ({ page }) => {
    await page.keyboard.press('KeyT');
    await drag(page, [200, 200], [600, 280]);
    await page.keyboard.type('Select me');
    await page.mouse.click(900, 600);
    await expect(editor(page)).toHaveCount(0);

    // One click inside the words: selected, not editing — and it can be dragged.
    await page.mouse.click(260, 230);
    await expect(editor(page)).toHaveCount(0);
    const before = await geo(page);
    await drag(page, [260, 230], [360, 300]);
    await expect(editor(page)).toHaveCount(0);
    const after = await geo(page);
    expect(after.x - before.x).toBeCloseTo(100, -1);

    await page.mouse.dblclick(360, 300);
    await expect.poll(() => typed(page)).toBe('Select me');
  });

  test('while typing, the canvas does not draw a second copy of the words', async ({ page }) => {
    await page.keyboard.press('KeyT');
    await drag(page, [200, 200], [700, 300]);
    await page.keyboard.type('MMMMMMMM');
    const area = { x: 205, y: 205, w: 400, h: 60 };
    expect(await colourFraction(page, '--text', area)).toBeLessThan(0.002);
    await page.keyboard.press('Escape');
    await expect.poll(() => colourFraction(page, '--text', area)).toBeGreaterThan(0.02);
  });

  test('pasted text becomes a text box', async ({ page }) => {
    await page.mouse.move(300, 250);
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.setData('text/plain', 'Pasted from elsewhere\nsecond line');
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true }));
    });
    await expect.poll(() => layerNames(page)).toEqual(['text']);
    const box = await geo(page);
    const stage = (await page.getByTestId('stage').boundingBox())!;
    await page.mouse.dblclick(stage.x + box.x + 30, stage.y + box.y + 20);
    await expect.poll(() => typed(page)).toBe('Pasted from elsewhere\nsecond line');
  });
});

/** The box's runs of formatting, as the editor shows them. */
const runs = (page: Page) =>
  editor(page).evaluate((node) =>
    [...node.childNodes]
      .filter((child) => child.textContent)
      .map((child) => {
        const style = child instanceof HTMLElement ? child.style : null;
        return {
          text: child.textContent,
          bold: style?.fontWeight === '700',
          italic: style?.fontStyle === 'italic',
          underline: Boolean(style?.textDecoration.includes('underline')),
        };
      }),
  );

/** Selects characters [from, to) of the box's first line with the keyboard. */
async function selectChars(page: Page, from: number, to: number) {
  await page.keyboard.press('Home');
  for (let step = 0; step < from; step += 1) await page.keyboard.press('ArrowRight');
  for (let step = from; step < to; step += 1) await page.keyboard.press('Shift+ArrowRight');
}

test.describe('formatting part of a text', () => {
  async function box(page: Page, words: string) {
    await page.keyboard.press('KeyT');
    await drag(page, [150, 150], [900, 300]);
    await page.keyboard.type(words);
  }

  test('Ctrl+B, Ctrl+I and Ctrl+U format just the selected words', async ({ page }) => {
    await box(page, 'make this bold');
    await selectChars(page, 5, 9);
    await page.keyboard.press('ControlOrMeta+KeyB');
    await expect
      .poll(() => runs(page))
      .toEqual([
        { text: 'make ', bold: false, italic: false, underline: false },
        { text: 'this', bold: true, italic: false, underline: false },
        { text: ' bold', bold: false, italic: false, underline: false },
      ]);
    // The selection is kept, so more formatting can follow.
    await page.keyboard.press('ControlOrMeta+KeyU');
    await expect
      .poll(async () => (await runs(page))[1])
      .toMatchObject({ bold: true, underline: true });

    // And it is in the board, not just the box: closed and opened again, still there.
    await page.keyboard.press('Escape');
    await expect(editor(page)).toHaveCount(0);
    await page.mouse.dblclick(200, 180);
    await expect
      .poll(async () => (await runs(page))[1])
      .toMatchObject({
        text: 'this',
        bold: true,
        underline: true,
      });
  });

  test('with nothing selected, Ctrl+I formats what is typed next', async ({ page }) => {
    await box(page, 'plain ');
    await page.keyboard.press('ControlOrMeta+KeyI');
    await page.keyboard.type('slanted');
    await page.keyboard.press('ControlOrMeta+KeyI');
    await page.keyboard.type(' plain');
    await expect
      .poll(() => runs(page))
      .toEqual([
        { text: 'plain ', bold: false, italic: false, underline: false },
        { text: 'slanted', bold: false, italic: true, underline: false },
        { text: ' plain', bold: false, italic: false, underline: false },
      ]);
  });

  test('the side panel and the floating buttons format the selection too', async ({ page }) => {
    await box(page, 'one two three');
    await selectChars(page, 4, 7);
    // The side panel's B: the typing goes on, the word is bold.
    await page.getByTestId('text-bold').click();
    await expect(editor(page)).toBeFocused();
    await expect.poll(async () => (await runs(page))[1]).toMatchObject({ text: 'two', bold: true });
    await expect(page.getByTestId('text-bold')).toHaveAttribute('aria-pressed', 'true');

    // The floating U, just above the box.
    await selectChars(page, 8, 13);
    await page.getByTestId('format-underline').click();
    await expect(editor(page)).toBeFocused();
    await expect
      .poll(async () => (await runs(page)).at(-1))
      .toMatchObject({
        text: 'three',
        underline: true,
      });

    // Not typing, the panel's B is the whole box's.
    await page.keyboard.press('Escape');
    await page.getByTestId('text-bold').click();
    await expect(page.getByTestId('text-bold')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('lists', () => {
  test('Enter numbers, Shift+Enter does not, Backspace removes a number', async ({ page }) => {
    await page.keyboard.press('KeyT');
    await drag(page, [150, 150], [800, 400]);
    await page.keyboard.type('1. milk');
    await page.keyboard.press('Enter');
    await page.keyboard.type('eggs');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('free range');
    await page.keyboard.press('Enter');
    await page.keyboard.type('bread');
    await expect.poll(() => typed(page)).toBe('1. milk\n2. eggs\n   free range\n3. bread');

    // Backspace straight after "2. " takes the number away; "bread" becomes 2.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Home');
    for (let step = 0; step < 3; step += 1) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Backspace');
    await expect.poll(() => typed(page)).toBe('1. milk\neggs\n   free range\n2. bread');

    // Enter on an empty item ends the list.
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect.poll(() => typed(page)).toBe('1. milk\neggs\n   free range\n2. bread\n');
  });

  test('"- " starts bullets, and the panel button numbers a whole box', async ({ page }) => {
    await page.keyboard.press('KeyT');
    await drag(page, [150, 150], [800, 400]);
    await page.keyboard.type('- tea');
    await page.keyboard.press('Enter');
    await page.keyboard.type('coffee');
    await expect.poll(() => typed(page)).toBe('• tea\n• coffee');
    await page.keyboard.press('Escape');

    await page.getByTestId('text-number').click();
    await page.mouse.dblclick(300, 180);
    await expect.poll(() => typed(page)).toBe('1. tea\n2. coffee');
  });
});

test.describe('smart shapes', () => {
  /** Traces a loop with the pen, Ctrl held if asked. */
  async function trace(page: Page, points: Array<[number, number]>, ctrl: boolean) {
    await page.keyboard.press('KeyP');
    if (ctrl) await page.keyboard.down('Control');
    await page.mouse.move(points[0]![0], points[0]![1]);
    await page.mouse.down();
    for (const [x, y] of points.slice(1)) await page.mouse.move(x, y);
    await page.mouse.up();
    if (ctrl) await page.keyboard.up('Control');
  }

  const circle = (cx: number, cy: number, r: number) =>
    Array.from({ length: 49 }, (_, index): [number, number] => {
      const angle = (index / 48) * Math.PI * 2;
      // A hand's wobble.
      const wobble = 1 + 0.03 * Math.sin(index * 1.7);
      return [cx + Math.cos(angle) * r * wobble, cy + Math.sin(angle) * r * wobble];
    });

  const box = (x: number, y: number, w: number, h: number): Array<[number, number]> => {
    const corners: Array<[number, number]> = [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
      [x, y + 2],
    ];
    const out: Array<[number, number]> = [];
    corners.forEach(([ax, ay], index) => {
      const next = corners[index + 1];
      if (!next) return;
      for (let step = 0; step < 10; step += 1) {
        out.push([
          ax + ((next[0] - ax) * step) / 10,
          ay + ((next[1] - ay) * step) / 10 + (step % 2),
        ]);
      }
    });
    return out;
  };

  test('with Ctrl held, a drawn circle and rectangle become those shapes', async ({ page }) => {
    await trace(page, circle(300, 300, 80), true);
    await trace(page, box(500, 220, 220, 140), true);
    await expect.poll(() => layerNames(page)).toEqual(['rect', 'ellipse']);
  });

  test('without Ctrl, or when the stroke is not closed, ink stays ink', async ({ page }) => {
    await trace(page, circle(300, 300, 80), false);
    await trace(page, circle(600, 300, 80).slice(0, 30), true);
    await expect.poll(() => layerNames(page)).toEqual(['path', 'path']);
  });

  test('clouds and spikes are in Insert, too', async ({ page }) => {
    for (const [index, kind] of ['cloud', 'spike'].entries()) {
      await page.getByTestId('insert-menu').click();
      await page.getByTestId(`insert-tool-${kind}`).click();
      await drag(page, [200 + index * 300, 250], [440 + index * 300, 400]);
    }
    await expect.poll(() => layerNames(page)).toEqual(['spike', 'cloud']);
  });

  test('a click anywhere inside a shape selects it; a double click types in it', async ({
    page,
  }) => {
    await page.keyboard.press('KeyO');
    await drag(page, [300, 250], [500, 400]);
    await page.getByRole('button', { name: 'No fill' }).click();
    await page.mouse.click(900, 650);
    await expect(page.getByTestId('geo-x')).toHaveCount(0);

    await page.mouse.click(400, 325);
    await expect(page.getByTestId('geo-x')).toBeVisible();

    await page.mouse.dblclick(400, 325);
    await page.keyboard.type('Idea');
    await page.keyboard.press('Escape');
    await expect(editor(page)).toHaveCount(0);
    // The words are drawn inside the shape.
    await expect
      .poll(() => colourFraction(page, '--text', { x: 340, y: 300, w: 120, h: 50 }))
      .toBeGreaterThan(0.01);
    await page.mouse.dblclick(400, 325);
    await expect.poll(() => typed(page)).toBe('Idea');
  });
});

test.describe('the pen and the eraser', () => {
  test('a thinner pen, and no thickest one', async ({ page }) => {
    await page.keyboard.press('KeyP');
    await expect(page.getByTestId('ink-width-1.5')).toBeVisible();
    await expect(page.getByTestId('ink-width-24')).toHaveCount(0);
  });
});

test.describe('the side panel', () => {
  test('dashed on a shape with no outline gives it one', async ({ page }) => {
    await page.keyboard.press('KeyR');
    await drag(page, [300, 250], [460, 350]);
    await expect(page.getByRole('button', { name: 'No stroke' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByTestId('dash-dashed').click();
    await expect(page.getByRole('button', { name: 'No stroke' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('it scrolls when it is taller than the board', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 420 });
    await page.keyboard.press('KeyR');
    await drag(page, [300, 150], [460, 250]);
    const panel = page.getByTestId('inspector');
    const scrolls = await panel.evaluate((node) => ({
      style: getComputedStyle(node).overflowY,
      taller: node.scrollHeight > node.clientHeight,
    }));
    expect(scrolls).toEqual({ style: 'auto', taller: true });
  });

  test('several pictures pasted at once stand in a column', async ({ page }) => {
    await page.mouse.move(500, 300);
    await page.evaluate(async () => {
      const transfer = new DataTransfer();
      for (const colour of ['#c2456b', '#2f9e7e']) {
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 100;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = colour;
        ctx.fillRect(0, 0, 200, 100);
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!)));
        transfer.items.add(new File([blob], `${colour}.png`, { type: 'image/png' }));
      }
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true }));
    });
    await expect.poll(() => layerNames(page)).toEqual(['image', 'image']);
    const items = page.getByTestId('layers').locator('li button');
    await items.nth(1).click();
    const first = await geo(page);
    await items.nth(0).click();
    const second = await geo(page);
    expect(second.x).toBe(first.x);
    expect(second.y).toBeCloseTo(first.y + first.h + 40, 0);
  });
});
