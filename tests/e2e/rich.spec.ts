import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 9 on the signed-out local board: pages, tables, code blocks, presentation
 * and SVG import — everything that needs no server. The shared parts (the timer,
 * voting, followers, link previews, the library, PDF import) are in workshop.spec.ts.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board-canvas')).toBeVisible();
});

const layerItems = (page: Page) => page.getByTestId('layers').locator('li');
const geo = async (page: Page) => ({
  x: Number(await page.getByTestId('geo-x').innerText()),
  y: Number(await page.getByTestId('geo-y').innerText()),
  w: Number(await page.getByTestId('geo-w').innerText()),
  h: Number(await page.getByTestId('geo-h').innerText()),
});

async function drag(page: Page, tool: string, from: [number, number], to: [number, number]) {
  await page.keyboard.press(tool);
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 5 });
  await page.mouse.up();
}

/**
 * The fraction of a page-space area painted close to a colour — a CSS colour or a
 * custom property of the page, resolved the way the canvas resolves it.
 */
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

// Checklist item 1 — the gate.
test.describe('presentation', () => {
  /** Three frames: two in a row, one below. Only the first holds a rectangle. */
  async function threeFrames(page: Page) {
    await drag(page, 'KeyR', [170, 200], [230, 240]);
    await drag(page, 'KeyF', [100, 150], [300, 290]);
    await drag(page, 'KeyF', [400, 150], [600, 290]);
    await drag(page, 'KeyF', [100, 400], [300, 540]);
    await page.keyboard.press('Escape');
  }

  test('arrow keys walk the frames, each filling the screen', async ({ page }) => {
    await threeFrames(page);
    await page.getByTestId('insert-menu').click();
    await page.getByTestId('present-start').click();

    await expect(page.getByTestId('presentation-counter')).toHaveText('1 / 3');
    // The chrome is gone; the stage is the whole window.
    const stage = (await page.getByTestId('stage').boundingBox())!;
    const window = page.viewportSize()!;
    expect(stage).toMatchObject({ x: 0, y: 0, width: window.width, height: window.height });
    // Where the top bar was, there is only the board.
    const atTopLeft = await page.evaluate(() =>
      document.elementFromPoint(20, 20)?.closest('[data-testid="stage"]'),
    );
    expect(atTopLeft).toBeTruthy();

    // Frame 1 is 200×140 with a 60×40 rectangle in its middle. Filling a 1280×720
    // window, the rectangle alone covers a large area at the centre of the screen.
    const centre = { x: window.width / 2 - 100, y: window.height / 2 - 60, w: 200, h: 120 };
    await expect.poll(() => colourFraction(page, '--shape-1', centre)).toBeGreaterThan(0.9);

    // Next frame: the empty one to the right.
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('presentation-counter')).toHaveText('2 / 3');
    await expect.poll(() => colourFraction(page, '--shape-1', centre)).toBeLessThan(0.01);
    // The frame itself fills the window edge to edge, less the margin.
    const surface = { x: 40, y: 40, w: window.width - 80, h: window.height - 80 };
    expect(await colourFraction(page, '--surface', surface)).toBeGreaterThan(0.5);

    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('presentation-counter')).toHaveText('3 / 3');
    // Past the end, it stays on the last frame.
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('presentation-counter')).toHaveText('3 / 3');

    // Back to the start.
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('presentation-counter')).toHaveText('1 / 3');
    await expect.poll(() => colourFraction(page, '--shape-1', centre)).toBeGreaterThan(0.9);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('presentation-bar')).toBeHidden();
    await expect(page.getByTestId('insert-menu')).toBeVisible();
  });

  test('says so when there is nothing to present', async ({ page }) => {
    await page.getByTestId('insert-menu').click();
    await page.getByTestId('present-start').click();
    await expect(page.getByText('Add a frame first')).toBeVisible();
    await expect(page.getByTestId('presentation-bar')).toBeHidden();
  });
});

// Checklist item 5.
test('a table takes typing cell by cell and grows a row', async ({ page }) => {
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-table').click();
  await expect(page.getByTestId('table-size')).toHaveText('Table · 4 × 3');

  const box = await geo(page);
  const origin = (await page.getByTestId('stage').boundingBox())!;
  const cell = (row: number, col: number) => ({
    x: origin.x + box.x + (col + 0.5) * (box.w / 3),
    y: origin.y + box.y + (row + 0.5) * (box.h / 4),
  });

  // Double-click the first cell and type across the header row with Tab.
  const first = cell(0, 0);
  await page.mouse.dblclick(first.x, first.y);
  const editor = page.getByTestId('cell-editor');
  await expect(editor).toBeFocused();
  await page.keyboard.type('Idea');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Owner');
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();

  // What was typed is in the cells.
  const second = cell(0, 1);
  await page.mouse.dblclick(second.x, second.y);
  await expect(editor).toHaveValue('Owner');
  await page.keyboard.press('Escape');

  // A row from the inspector, then the table is one row taller.
  await page.mouse.click(first.x, first.y);
  await page.getByTestId('table-add-row').click();
  await expect(page.getByTestId('table-size')).toHaveText('Table · 5 × 3');
  expect((await geo(page)).h).toBeGreaterThan(box.h);

  // Tab past the last cell adds another.
  const grown = await geo(page);
  const last = {
    x: origin.x + grown.x + 2.5 * (grown.w / 3),
    y: origin.y + grown.y + 4.5 * (grown.h / 5),
  };
  await page.mouse.dblclick(last.x, last.y);
  await page.keyboard.type('end');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await page.mouse.click(first.x, first.y);
  await expect(page.getByTestId('table-size')).toHaveText('Table · 6 × 3');
});

test('shapes, notes and frames are picked from Insert and work as before', async ({ page }) => {
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-tool-ellipse').click();
  // The menu closes, and its button shows a tool from it is in hand.
  await expect(page.getByTestId('insert-panel')).toBeHidden();
  await expect(page.getByTestId('insert-menu')).toHaveAttribute('data-active', 'true');
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(420, 380, { steps: 5 });
  await page.mouse.up();
  await expect(layerItems(page)).toHaveText(['ellipse']);

  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-tool-sticky').click();
  await page.mouse.click(600, 350);
  await expect(page.getByTestId('text-editor')).toBeVisible();
  await page.keyboard.type('a note');
  await page.keyboard.press('Escape');
  await expect(layerItems(page)).toHaveText(['sticky', 'ellipse']);

  // The toolbar keeps only the everyday tools.
  for (const id of ['select', 'hand', 'pen', 'eraser', 'laser']) {
    await expect(page.getByTestId(`tool-${id}`)).toBeVisible();
  }
  for (const id of ['rect', 'ellipse', 'line', 'arrow', 'text', 'sticky', 'frame']) {
    await expect(page.getByTestId(`tool-${id}`)).toHaveCount(0);
  }
});

test('a stamp rides on the pointer and lands wherever it is clicked', async ({ page }) => {
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-stamp-⭐').click();
  const stage = page.getByTestId('stage');
  await page.mouse.move(400, 350);
  await expect(stage).toHaveAttribute('data-cursor', 'stamp');
  // The pointer is the star itself.
  const cursor = await stage.evaluate((node) => getComputedStyle(node).cursor);
  expect(cursor).toContain('data:image/svg+xml');
  expect(decodeURIComponent(cursor)).toContain('⭐');

  // Each click puts one down, centred where it was clicked; the stamp stays in hand.
  await page.mouse.click(400, 350);
  await page.mouse.click(560, 350);
  await expect(layerItems(page)).toHaveCount(2);
  await expect(page.getByTestId('insert-menu')).toHaveAttribute('data-active', 'true');

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('insert-menu')).not.toHaveAttribute('data-active', 'true');
  await layerItems(page).last().locator('button').click();
  const box = await geo(page);
  const origin = (await stage.boundingBox())!;
  expect(origin.x + box.x + box.w / 2).toBeCloseTo(400, -1);
  expect(origin.y + box.y + box.h / 2).toBeCloseTo(350, -1);
});

test('Import takes a picture from the computer as well', async ({ page }) => {
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-import').click();
  await page.getByTestId('import-file').setInputFiles({
    name: 'dot.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await expect(layerItems(page)).toHaveText(['image']);

  // Something it cannot read is refused, with a reason.
  await page.getByTestId('import-file').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  });
  await expect(page.getByTestId('import-status')).toContainText('notes.txt is not a picture');
});

test.describe('a fresh browser', () => {
  // No stored preferences: what a first-time visitor sees.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('keeps the object list and the minimap hidden until asked for', async ({ page }) => {
    await drag(page, 'KeyR', [300, 300], [420, 380]);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('layers')).toHaveCount(0);
    await expect(page.getByTestId('minimap')).toHaveCount(0);
    // Nothing selected and no list: no side panel at all.
    await expect(page.getByTestId('inspector')).toHaveCount(0);
    // Nor the app's name, nor the renderer button, in the board's top bar.
    await expect(page.getByText('Sabboura', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Renderer' })).toHaveCount(0);

    await page.getByTestId('insert-menu').click();
    await page.getByTestId('toggle-minimap').click();
    await expect(page.getByTestId('minimap')).toBeVisible();
    await page.getByTestId('tools-menu').click();
    await page.getByTestId('toggle-layers').click();
    await expect(layerItems(page)).toHaveText(['rect']);

    // Both choices are remembered, and M hides the minimap again.
    await page.reload();
    await expect(page.getByTestId('minimap')).toBeVisible();
    await expect(layerItems(page)).toHaveText(['rect']);
    await page.keyboard.press('KeyM');
    await expect(page.getByTestId('minimap')).toHaveCount(0);
  });
});

// Checklist item 7.
test('each page keeps its own content and its own view', async ({ page }) => {
  await drag(page, 'KeyR', [300, 300], [400, 380]);
  await expect(layerItems(page)).toHaveCount(1);
  const firstZoom = await page.getByTestId('zoom-readout').innerText();

  await page.getByTestId('add-page').click();
  await expect(page.getByTestId('page-tab-1')).toHaveText('Page 2');
  // A new page is empty.
  await expect(layerItems(page)).toHaveCount(0);
  await drag(page, 'KeyO', [500, 300], [600, 380]);
  await drag(page, 'KeyO', [650, 300], [750, 380]);
  await expect(layerItems(page)).toHaveCount(2);
  // Zoom in on this page only.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Equal');
  await page.keyboard.press('Equal');
  const secondZoom = await page.getByTestId('zoom-readout').innerText();
  expect(secondZoom).not.toBe(firstZoom);

  await page.getByTestId('page-tab-0').click();
  await expect(layerItems(page)).toHaveCount(1);
  await expect(page.getByTestId('zoom-readout')).toHaveText(firstZoom);

  await page.getByTestId('page-tab-1').click();
  await expect(layerItems(page)).toHaveCount(2);
  await expect(page.getByTestId('zoom-readout')).toHaveText(secondZoom);

  // And both survive a reload.
  await page.reload();
  await expect(page.getByTestId('page-tab-1')).toBeVisible();
  await page.getByTestId('page-tab-1').click();
  await expect(layerItems(page)).toHaveCount(2);
  await page.getByTestId('page-tab-0').click();
  await expect(layerItems(page)).toHaveCount(1);
});

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200" onload="window.ranScript = true">
  <script>window.ranScript = true</script>
  <rect x="10" y="10" width="120" height="80" rx="8" fill="#e63946" stroke="#1d3557" stroke-width="4"/>
  <g transform="translate(150 0)">
    <circle cx="70" cy="50" r="40" fill="#2a9d8f"/>
  </g>
  <path d="M10 150 C 60 110, 110 190, 160 150" fill="none" stroke="#264653" stroke-width="6"/>
  <text x="180" y="170" font-size="24" fill="#000000">Hello</text>
</svg>`;

// Checklist item 9, first half.
test('an SVG comes in as shapes that can each be edited', async ({ page }) => {
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-import').click();
  await page.getByTestId('import-file').setInputFiles({
    name: 'drawing.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(SVG),
  });

  // One group holding a rectangle, an ellipse, the curve in ink, and the text.
  const layers = page.getByTestId('layers');
  const names = async () => (await layerItems(page).allInnerTexts()).map((name) => name.trim());
  await expect.poll(names).toEqual(['group']);
  // Taken apart, the pieces are ordinary shapes.
  await page.keyboard.press('ControlOrMeta+Shift+KeyG');
  await expect
    .poll(async () => (await names()).sort())
    .toEqual(['ellipse', 'path', 'rect', 'text']);

  // Its colours came with it.
  const stage = (await page.getByTestId('stage').boundingBox())!;
  const all = { x: stage.x, y: stage.y, w: stage.width - 250, h: stage.height };
  expect(await colourFraction(page, '#e63946', all)).toBeGreaterThan(0.005);
  expect(await colourFraction(page, '#2a9d8f', all)).toBeGreaterThan(0.005);

  // The rectangle is a real rectangle: select it alone and its size is the file's.
  await layers.getByText('rect', { exact: true }).click();
  expect(await geo(page)).toMatchObject({ w: 120, h: 80 });

  // Nothing in the file ran.
  expect(await page.evaluate(() => (window as { ranScript?: boolean }).ranScript)).toBeFalsy();
});
