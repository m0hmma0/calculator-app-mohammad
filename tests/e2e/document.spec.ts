import { expect, test, type Page } from '@playwright/test';

const layers = (page: Page) => page.getByTestId('layers').locator('li');
const layerCount = (page: Page) => layers(page).count();
const geo = async (page: Page) => ({
  x: Number(await page.getByTestId('geo-x').innerText()),
  y: Number(await page.getByTestId('geo-y').innerText()),
});

async function draw(page: Page, tool: string, from: [number, number], to: [number, number]) {
  await page.keyboard.press(tool);
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 5 });
  await page.mouse.up();
}

/** A fresh board for every test — the document outlives a reload by design. */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  await page.evaluate(async () => {
    for (const database of await indexedDB.databases()) {
      if (database.name) indexedDB.deleteDatabase(database.name);
    }
  });
  await page.reload();
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  await expect(page.getByTestId('status-loading')).toHaveCount(0);
});

test.describe('undo and redo', () => {
  // Checklist item 1.
  test('walks back one action at a time, then forward again', async ({ page }) => {
    await draw(page, 'KeyR', [250, 220], [380, 320]);
    await draw(page, 'KeyO', [450, 220], [570, 320]);
    await draw(page, 'KeyR', [650, 220], [760, 320]);
    expect(await layerCount(page)).toBe(3);

    for (const remaining of [2, 1, 0]) {
      await page.keyboard.press('ControlOrMeta+KeyZ');
      await expect.poll(() => layerCount(page)).toBe(remaining);
    }

    for (const remaining of [1, 2, 3]) {
      await page.keyboard.press('Shift+ControlOrMeta+KeyZ');
      await expect.poll(() => layerCount(page)).toBe(remaining);
    }
  });

  // Checklist item 2.
  test('restores an exact position after a move', async ({ page }) => {
    await draw(page, 'KeyR', [300, 250], [420, 350]);
    await page.keyboard.press('KeyV');
    await page.mouse.click(360, 300);
    const before = await geo(page);

    await page.mouse.move(360, 300);
    await page.mouse.down();
    await page.mouse.move(620, 460, { steps: 10 });
    await page.mouse.up();
    expect((await geo(page)).x).not.toBe(before.x);

    await page.keyboard.press('ControlOrMeta+KeyZ');
    await expect.poll(async () => (await geo(page)).x).toBe(before.x);
    expect((await geo(page)).y).toBe(before.y);
  });

  test('takes a whole drag back in one step, not frame by frame', async ({ page }) => {
    await draw(page, 'KeyR', [300, 250], [420, 350]);
    await page.keyboard.press('KeyV');
    await page.mouse.click(360, 300);

    await page.mouse.move(360, 300);
    await page.mouse.down();
    for (let step = 1; step <= 20; step += 1) await page.mouse.move(360 + step * 12, 300);
    await page.mouse.up();

    await page.keyboard.press('ControlOrMeta+KeyZ');
    // One undo returns it, and the shape itself still exists.
    await expect
      .poll(async () => (await geo(page)).x)
      .toBe(300 - Math.round((await page.getByTestId('stage').boundingBox())!.x));
    expect(await layerCount(page)).toBe(1);
  });

  test('a delete can be undone', async ({ page }) => {
    await draw(page, 'KeyR', [300, 250], [420, 350]);
    await page.keyboard.press('KeyV');
    await page.mouse.click(360, 300);
    await page.keyboard.press('Delete');
    expect(await layerCount(page)).toBe(0);

    await page.keyboard.press('ControlOrMeta+KeyZ');
    await expect.poll(() => layerCount(page)).toBe(1);
  });
});

test.describe('saving', () => {
  // Checklist item 3 — the gate.
  test('survives a reload, with the camera where it was left', async ({ page }) => {
    await draw(page, 'KeyR', [300, 250], [420, 350]);
    await draw(page, 'KeyO', [500, 250], [600, 350]);
    await page.keyboard.press('Equal');
    await page.keyboard.press('Equal');
    const zoom = await page.getByTestId('zoom-readout').innerText();

    await page.reload();
    await expect(page.getByTestId('board-canvas')).toBeVisible();

    await expect.poll(() => layerCount(page)).toBe(2);
    await expect(page.getByTestId('zoom-readout')).toHaveText(zoom);
  });

  // Checklist item 4.
  test('survives the tab being closed part-way through', async ({ page, context }) => {
    await draw(page, 'KeyR', [300, 250], [420, 350]);
    await expect.poll(() => layerCount(page)).toBe(1);

    // Start a stroke and kill the page without ever releasing the pointer.
    await page.keyboard.press('KeyP');
    await page.mouse.move(500, 400);
    await page.mouse.down();
    await page.mouse.move(600, 450, { steps: 4 });
    await page.close({ runBeforeUnload: false });

    const reopened = await context.newPage();
    await reopened.goto('/');
    await expect(reopened.getByTestId('board-canvas')).toBeVisible();
    // The committed rectangle is intact; the abandoned stroke was never committed.
    await expect.poll(() => reopened.getByTestId('layers').locator('li').count()).toBe(1);
    await reopened.close();
  });

  // Checklist item 6 — the gate.
  test('keeps working with the network down, and says so', async ({ page, context }) => {
    await draw(page, 'KeyR', [300, 250], [420, 350]);

    await context.setOffline(true);
    await expect(page.getByTestId('status-offline')).toBeVisible();

    // Drawing carries on regardless — the document is local.
    await draw(page, 'KeyO', [500, 250], [600, 350]);
    await draw(page, 'KeyR', [650, 250], [740, 350]);
    expect(await layerCount(page)).toBe(3);

    await context.setOffline(false);
    await expect(page.getByTestId('status-offline')).toHaveCount(0);

    // The work done while offline was saved, not just held in memory.
    await page.reload();
    await expect(page.getByTestId('board-canvas')).toBeVisible();
    await expect.poll(() => layerCount(page)).toBe(3);
  });
});

// Checklist item 5.
test.describe('clipboard', () => {
  test('copies in one tab and pastes in another', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await draw(page, 'KeyR', [300, 250], [420, 350]);
    await page.keyboard.press('KeyV');
    await page.mouse.click(360, 300);
    await page.getByLabel('Fill var(--shape-3)').click();
    await page.keyboard.press('ControlOrMeta+KeyC');

    const second = await context.newPage();
    await second.goto('/');
    await expect(second.getByTestId('board-canvas')).toBeVisible();
    await expect.poll(() => second.getByTestId('layers').locator('li').count()).toBe(1);

    await second.mouse.move(600, 400);
    await second.keyboard.press('ControlOrMeta+KeyV');

    await expect.poll(() => second.getByTestId('layers').locator('li').count()).toBe(2);
    // The copy carries its styling, not just its shape.
    await expect(second.getByLabel('Fill var(--shape-3)')).toHaveAttribute('aria-pressed', 'true');
    await second.close();
  });

  test('cut removes the original', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await draw(page, 'KeyR', [300, 250], [420, 350]);
    await page.keyboard.press('KeyV');
    await page.mouse.click(360, 300);

    await page.keyboard.press('ControlOrMeta+KeyX');
    await expect.poll(() => layerCount(page)).toBe(0);

    await page.mouse.move(600, 400);
    await page.keyboard.press('ControlOrMeta+KeyV');
    await expect.poll(() => layerCount(page)).toBe(1);
  });
});

test.describe('export', () => {
  async function save(page: Page, command: string) {
    const download = page.waitForEvent('download');
    await page.keyboard.press('ControlOrMeta+KeyK');
    await page.getByTestId('command-input').fill(command);
    await page.keyboard.press('Enter');
    return download;
  }

  // Checklist item 7.
  test('writes a PNG of the board', async ({ page }) => {
    await draw(page, 'KeyR', [300, 250], [420, 350]);

    const download = await save(page, 'Export board as PNG');
    expect(download.suggestedFilename()).toBe('sabboura-board.png');

    const path = await download.path();
    const { readFileSync } = await import('node:fs');
    const bytes = readFileSync(path);
    // PNG magic number, and something bigger than an empty image.
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  // Checklist item 8.
  test('writes an SVG of real vectors, not a bitmap', async ({ page }) => {
    await draw(page, 'KeyR', [300, 250], [420, 350]);
    await draw(page, 'KeyO', [500, 250], [600, 350]);

    const download = await save(page, 'Export board as SVG');
    expect(download.suggestedFilename()).toBe('sabboura-board.svg');

    const { readFileSync } = await import('node:fs');
    const svg = readFileSync(await download.path(), 'utf8');

    expect(svg).toContain('<svg');
    expect(svg).toContain('<rect');
    expect(svg).toContain('<ellipse');
    expect(svg).not.toContain('data:image/png');
  });

  test('writes a PDF a reader will open', async ({ page }) => {
    await draw(page, 'KeyR', [300, 250], [420, 350]);

    const download = await save(page, 'Export board as PDF');
    const { readFileSync } = await import('node:fs');
    const bytes = readFileSync(await download.path());
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.toString('latin1')).toContain('%%EOF');
  });

  test('exports only the selection when asked', async ({ page }) => {
    await draw(page, 'KeyR', [260, 240], [340, 320]);
    await draw(page, 'KeyR', [900, 240], [980, 320]);
    await page.keyboard.press('KeyV');
    await page.mouse.click(300, 280);

    const whole = await save(page, 'Export board as PNG');
    const { readFileSync } = await import('node:fs');
    const wholeSize = readFileSync(await whole.path()).length;

    await page.mouse.click(300, 280);
    const part = await save(page, 'Export selection as PNG');
    const partSize = readFileSync(await part.path()).length;

    // One small shape makes a smaller image than two shapes far apart.
    expect(partSize).toBeLessThan(wholeSize);
  });
});

// Checklist item 9.
test.describe('command palette', () => {
  test('finds a command and runs it', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+KeyK');
    await expect(page.getByTestId('command-palette')).toBeVisible();

    await page.getByTestId('command-input').fill('rect');
    await expect(page.getByTestId('command-tool-rect')).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(page.getByTestId('command-palette')).toHaveCount(0);
    await expect(page.getByTestId('tool-rect')).toHaveAttribute('aria-pressed', 'true');
  });

  test('matches loosely and closes on Escape', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+KeyK');
    await page.getByTestId('command-input').fill('zmft');
    await expect(page.getByTestId('command-fit')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('command-palette')).toHaveCount(0);
  });

  test('says so when nothing matches', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+KeyK');
    await page.getByTestId('command-input').fill('qqqqzzzz');
    await expect(page.getByText('No matching command')).toBeVisible();
    await page.keyboard.press('Escape');
  });
});

// Checklist item 10.
test.describe('context menu', () => {
  test('right-clicking a shape offers actions that work', async ({ page }) => {
    await draw(page, 'KeyR', [300, 250], [420, 350]);
    await page.keyboard.press('KeyV');

    await page.mouse.click(360, 300, { button: 'right' });
    await expect(page.getByTestId('context-menu')).toBeVisible();
    await expect(page.getByTestId('menu-duplicate')).toBeVisible();

    await page.getByTestId('menu-duplicate').click();
    await expect(page.getByTestId('context-menu')).toHaveCount(0);
    await expect.poll(() => layerCount(page)).toBe(2);
  });

  test('right-clicking selects what was clicked', async ({ page }) => {
    await draw(page, 'KeyR', [260, 240], [340, 320]);
    await draw(page, 'KeyR', [500, 240], [580, 320]);
    await page.keyboard.press('KeyV');

    await page.mouse.click(300, 280);
    await page.mouse.click(540, 280, { button: 'right' });
    await page.getByTestId('menu-delete').click();

    // The one that was right-clicked went, not the one that had been selected.
    await expect.poll(() => layerCount(page)).toBe(1);
  });

  test('offers lock, and it takes effect', async ({ page }) => {
    await draw(page, 'KeyR', [300, 250], [420, 350]);
    await page.keyboard.press('KeyV');
    await page.mouse.click(360, 300, { button: 'right' });
    await page.getByTestId('menu-lock').click();

    await expect(page.getByTestId('layer-locked')).toBeVisible();
  });

  test('Escape dismisses it', async ({ page }) => {
    await draw(page, 'KeyR', [300, 250], [420, 350]);
    await page.keyboard.press('KeyV');
    await page.mouse.click(360, 300, { button: 'right' });
    await expect(page.getByTestId('context-menu')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('context-menu')).toHaveCount(0);
  });
});
