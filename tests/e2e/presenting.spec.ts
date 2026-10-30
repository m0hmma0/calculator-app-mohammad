import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 13 on the signed-out board: presenting shows the frame and nothing else,
 * frames are numbered in an order that can be chosen, a PDF's pages come in as
 * numbered frames, and celebrations vary and pile up.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board-canvas')).toBeVisible();
});

const layerItems = (page: Page) => page.getByTestId('layers').locator('li');

async function drag(page: Page, key: string, from: [number, number], to: [number, number]) {
  await page.keyboard.press(key);
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 5 });
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
          Math.max(1, Math.round(region.w * dpr)),
          Math.max(1, Math.round(region.h * dpr)),
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

/** Around the slide while presenting. */
const SURROUND = '#101217';

const stageBox = async (page: Page) => (await page.getByTestId('stage').boundingBox())!;

/** Three frames in a row; only the right-hand one has a rectangle filling most of it. */
async function threeFrames(page: Page) {
  await drag(page, 'KeyR', [700, 160], [860, 300]);
  await drag(page, 'KeyF', [80, 140], [320, 320]);
  await drag(page, 'KeyF', [380, 140], [620, 320]);
  await drag(page, 'KeyF', [680, 140], [920, 320]);
  await page.keyboard.press('Escape');
  await expect(layerItems(page)).toHaveCount(4);
}

/** Frames' ids, left to right on the board. */
async function frameIds(page: Page) {
  const badges = page.locator('[data-testid^="frame-number-"]');
  await expect(badges).toHaveCount(3);
  const found = await badges.evaluateAll((nodes) =>
    nodes
      .map((node) => ({
        id: node.getAttribute('data-testid')!.replace('frame-number-', ''),
        x: node.getBoundingClientRect().x,
      }))
      .sort((a, b) => a.x - b.x)
      .map((each) => each.id),
  );
  return found;
}

const numberOf = (page: Page, id: string) => page.getByTestId(`frame-order-${id}`);

async function present(page: Page) {
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('present-start').click();
  await expect(page.getByTestId('presentation-bar')).toBeVisible();
}

test.describe('presenting', () => {
  // Checklist item 1 — the gate.
  test('shows only what is inside the frame: no border, no title, nothing around it', async ({
    page,
  }) => {
    await threeFrames(page);
    // A circle half in the third frame and half out of it.
    await drag(page, 'KeyO', [860, 260], [1000, 400]);
    await page.keyboard.press('Escape');
    await present(page);
    await page.keyboard.press('End');
    await expect(page.getByTestId('presentation-counter')).toHaveText('3 / 3');

    const stage = await stageBox(page);
    // Everything around the slide is the surround: the title above it, the circle's
    // outer half, the other frames — none of it is drawn.
    const strips = [
      { x: stage.x, y: stage.y, w: stage.width, h: 14 },
      { x: stage.x, y: stage.y + stage.height - 14, w: stage.width, h: 14 },
      { x: stage.x, y: stage.y, w: 14, h: stage.height },
      { x: stage.x + stage.width - 14, y: stage.y, w: 14, h: stage.height },
    ];
    for (const strip of strips) {
      await expect.poll(() => colourFraction(page, SURROUND, strip)).toBeGreaterThan(0.99);
    }
    // Inside: the slide's own white, its rectangle, and the half of the circle in it.
    // (The frame keeps its shape, so the slide is letterboxed: sample its middle.)
    const inside = {
      x: stage.x + stage.width / 2 - 300,
      y: stage.y + stage.height / 2 - 250,
      w: 600,
      h: 500,
    };
    expect(await colourFraction(page, '--shape-1', inside)).toBeGreaterThan(0.2);
    expect(await colourFraction(page, SURROUND, inside)).toBeLessThan(0.05);

    // Out of the presentation, the board is all there again.
    await page.getByTestId('present-stop').click();
    await expect(page.getByTestId('presentation-bar')).toHaveCount(0);
    await expect.poll(() => colourFraction(page, SURROUND, strips[0]!)).toBeLessThan(0.01);
  });

  // Checklist item 2.
  test('on a wide screen the slide controls are in the pane, with the tools and Insert', async ({
    page,
  }) => {
    await threeFrames(page);
    await present(page);
    const pane = (await page.getByTestId('controls').boundingBox())!;
    const bar = (await page.getByTestId('presentation-bar').boundingBox())!;
    expect(bar.x).toBeGreaterThanOrEqual(pane.x - 1);
    for (const id of ['tool-pen', 'tool-highlighter', 'tool-laser', 'insert-menu', 'undo']) {
      await expect(page.getByTestId(id), id).toBeVisible();
    }
    // What is about the board rather than the slide steps aside.
    for (const id of ['tools-menu', 'zoom-readout', 'page-tab-0', 'board-title']) {
      await expect(page.getByTestId(id), id).toHaveCount(0);
    }

    // The pen draws on the slide while presenting.
    await page.getByTestId('tool-pen').click();
    const stage = await stageBox(page);
    await page.mouse.move(stage.x + 200, stage.y + 200);
    await page.mouse.down();
    await page.mouse.move(stage.x + 400, stage.y + 260, { steps: 8 });
    await page.mouse.up();
    await page.getByTestId('slide-next').click();
    await expect(page.getByTestId('presentation-counter')).toHaveText('2 / 3');
    await page.getByTestId('present-stop').click();
    await expect(layerItems(page)).toHaveCount(5);
  });

  test.describe('on a tall screen', () => {
    test.use({ viewport: { width: 768, height: 1024 } });

    test('the slide controls are along the bottom; the tools stay at the top', async ({ page }) => {
      await drag(page, 'KeyF', [100, 200], [500, 500]);
      await page.keyboard.press('Escape');
      await present(page);
      const bar = (await page.getByTestId('presentation-bar').boundingBox())!;
      const controls = (await page.getByTestId('controls').boundingBox())!;
      expect(bar.y).toBeGreaterThan(900);
      expect(bar.y).toBeGreaterThan(controls.y + controls.height);
      await expect(page.getByTestId('tool-pen')).toBeVisible();
      await expect(page.getByTestId('insert-menu')).toBeVisible();
    });
  });
});

test.describe('numbered frames', () => {
  // Checklist item 3 — the gate.
  test('a frame’s number is chosen from its drop-down, and the presentation follows', async ({
    page,
  }) => {
    await threeFrames(page);
    const [left, middle, right] = await frameIds(page);
    await expect(numberOf(page, left!)).toHaveValue('1');
    await expect(numberOf(page, middle!)).toHaveValue('2');
    await expect(numberOf(page, right!)).toHaveValue('3');

    // Before: the first slide is the empty left-hand frame.
    const stage = await stageBox(page);
    const middleOfSlide = {
      x: stage.x + stage.width / 2 - 60,
      y: stage.y + stage.height / 2 - 40,
      w: 120,
      h: 80,
    };
    await present(page);
    await expect.poll(() => colourFraction(page, '--shape-1', middleOfSlide)).toBeLessThan(0.01);
    await page.getByTestId('present-stop').click();

    // The right-hand frame, with its rectangle, becomes number 1; the others close up.
    await numberOf(page, right!).selectOption('1');
    await expect(numberOf(page, right!)).toHaveValue('1');
    await expect(numberOf(page, left!)).toHaveValue('2');
    await expect(numberOf(page, middle!)).toHaveValue('3');

    await present(page);
    await expect(page.getByTestId('presentation-counter')).toHaveText('1 / 3');
    await expect.poll(() => colourFraction(page, '--shape-1', middleOfSlide)).toBeGreaterThan(0.9);
    await page.getByTestId('present-stop').click();

    // The order is part of the board: it is still so after a reload.
    await page.reload();
    await expect(numberOf(page, right!)).toHaveValue('1');
    await expect(numberOf(page, middle!)).toHaveValue('3');
  });

  // Checklist item 4.
  test('a PDF comes in as one numbered frame per page, after the frames already there', async ({
    page,
  }) => {
    await drag(page, 'KeyF', [80, 140], [320, 320]);
    await page.keyboard.press('Escape');
    const first = (await page
      .locator('[data-testid^="frame-order-"]')
      .getAttribute('data-testid'))!;
    await page.getByTestId('insert-menu').click();
    await page.getByTestId('insert-import').click();
    await page.getByTestId('import-file').setInputFiles({
      name: 'Canva deck.pdf',
      mimeType: 'application/pdf',
      buffer: makePdf([
        [0.9, 0.1, 0.1],
        [0.1, 0.6, 0.2],
      ]),
    });
    await expect(layerItems(page)).toHaveCount(5, { timeout: 20_000 });
    const names = await layerItems(page).allInnerTexts();
    expect(names.filter((name) => /frame/i.test(name))).toHaveLength(3);
    expect(names.filter((name) => /image/i.test(name))).toHaveLength(2);

    // The frame that was there stays 1; the pages are 2 and 3, top to bottom.
    await page.keyboard.press('Shift+Digit1');
    await expect(page.getByTestId(first)).toHaveValue('1');
    const pages = page.locator(`[data-testid^="frame-order-"]:not([data-testid="${first}"])`);
    await expect(pages).toHaveCount(2);
    const order = await pages.evaluateAll((nodes) =>
      nodes
        .map((node) => ({
          y: node.getBoundingClientRect().y,
          value: (node as HTMLSelectElement).value,
        }))
        .sort((a, b) => a.y - b.y)
        .map((each) => each.value),
    );
    expect(order).toEqual(['2', '3']);

    // Presenting reaches the first page as slide 2.
    await present(page);
    await page.getByTestId('slide-next').click();
    await expect(page.getByTestId('presentation-counter')).toHaveText('2 / 3');
    const stage = await stageBox(page);
    const all = { x: stage.x, y: stage.y, w: stage.width, h: stage.height };
    await expect.poll(() => colourFraction(page, '#e61a1a', all)).toBeGreaterThan(0.05);
  });
});

test.describe('celebrations', () => {
  // Checklist item 5.
  test('differ each time, and pile up when pressed again while one plays', async ({ page }) => {
    const celebration = page.getByTestId('celebration');
    const variants: string[] = [];
    for (let round = 0; round < 3; round += 1) {
      await page.keyboard.press('Numpad1');
      await expect(celebration).toHaveAttribute('data-effect', 'confetti');
      variants.push((await celebration.getAttribute('data-variant'))!);
      await expect(celebration).toHaveCount(0, { timeout: 8000 });
    }
    expect(variants[1]).not.toBe(variants[0]);
    expect(variants[2]).not.toBe(variants[1]);

    // Again and again while it plays: it builds, rather than starting over.
    await page.keyboard.press('Numpad1');
    await page.keyboard.press('Numpad1');
    await page.keyboard.press('Numpad1');
    await expect(celebration).toHaveAttribute('data-level', '3');
    await expect(page.getByTestId('celebration-play')).toHaveCount(3);
  });

  // Checklist item 6 (on this screen; workshop.spec covers everyone's).
  test('the new ones play from the menu and the number pad', async ({ page }) => {
    const celebration = page.getByTestId('celebration');
    for (const [key, kind] of [
      ['Numpad8', 'fireworks'],
      ['Numpad9', 'balloons'],
      ['Numpad0', 'hearts'],
      ['NumpadDivide', 'fanfare'],
      ['NumpadMultiply', 'womp'],
    ] as const) {
      await page.keyboard.press(key);
      await expect(celebration).toHaveAttribute('data-effect', kind);
    }
    await page.getByTestId('insert-menu').click();
    await page.getByTestId('celebrate-hearts').click();
    await expect(celebration).toHaveAttribute('data-effect', 'hearts');
  });
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
