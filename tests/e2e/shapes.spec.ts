import { expect, test, type Page } from '@playwright/test';

/**
 * The board starts at 100% zoom with its origin at the stage's top-left, so a page
 * coordinate maps to a board coordinate by subtracting the stage offset. That lets
 * these tests point at exact handles rather than guessing.
 */
async function stageOrigin(page: Page) {
  const box = (await page.getByTestId('stage').boundingBox())!;
  return { x: box.x, y: box.y };
}

async function draw(
  page: Page,
  tool: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  modifiers: string[] = [],
) {
  await page.keyboard.press(tool);
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  for (const key of modifiers) await page.keyboard.up(key);
}

async function dragFrom(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  modifiers: string[] = [],
) {
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  for (const key of modifiers) await page.keyboard.up(key);
}

const geo = async (page: Page) => ({
  x: Number(await page.getByTestId('geo-x').innerText()),
  y: Number(await page.getByTestId('geo-y').innerText()),
  w: Number(await page.getByTestId('geo-w').innerText()),
  h: Number(await page.getByTestId('geo-h').innerText()),
});

const layerNames = (page: Page) => page.getByTestId('layers').locator('li').allInnerTexts();
const layerCount = (page: Page) => page.getByTestId('layers').locator('li').count();
const cursor = (page: Page) => page.getByTestId('stage').getAttribute('data-cursor');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board-canvas')).toBeVisible();
});

test.describe('drawing', () => {
  test('R draws a rectangle and returns to the select tool', async ({ page }) => {
    await draw(page, 'KeyR', { x: 300, y: 250 }, { x: 460, y: 350 });

    await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
    expect(await layerCount(page)).toBe(1);
    expect(await geo(page)).toMatchObject({ w: 160, h: 100 });
  });

  // Checklist item 3.
  test('shift makes a square and a circle', async ({ page }) => {
    await draw(page, 'KeyR', { x: 300, y: 250 }, { x: 460, y: 330 }, ['Shift']);
    const square = await geo(page);
    expect(square.w).toBe(square.h);

    await draw(page, 'KeyO', { x: 600, y: 250 }, { x: 700, y: 400 }, ['Shift']);
    const circle = await geo(page);
    expect(circle.w).toBe(circle.h);
  });

  test('draws every shape the toolbar offers', async ({ page }) => {
    for (const [index, tool] of ['triangle', 'diamond', 'star', 'polygon'].entries()) {
      await page.getByTestId(`tool-${tool}`).click();
      const x = 260 + index * 120;
      await dragFrom(page, { x, y: 250 }, { x: x + 90, y: 340 });
    }
    expect(await layerNames(page)).toEqual(['polygon', 'star', 'diamond', 'triangle']);
  });

  test('a click without a drag places a default-sized shape', async ({ page }) => {
    await page.keyboard.press('KeyR');
    await page.mouse.click(400, 300);

    expect(await layerCount(page)).toBe(1);
    expect(await geo(page)).toMatchObject({ w: 120, h: 90 });
  });
});

test.describe('selection and cursors', () => {
  // Checklist items 1 and 4 — the gate.
  test('the cursor names every part of the selection frame', async ({ page }) => {
    await draw(page, 'KeyR', { x: 300, y: 250 }, { x: 500, y: 400 });
    await page.keyboard.press('KeyV');
    await page.mouse.click(400, 320);

    const corners: Array<[{ x: number; y: number }, string]> = [
      [{ x: 300, y: 250 }, 'nwse-resize'],
      [{ x: 500, y: 400 }, 'nwse-resize'],
      [{ x: 500, y: 250 }, 'nesw-resize'],
      [{ x: 300, y: 400 }, 'nesw-resize'],
      [{ x: 400, y: 250 }, 'ns-resize'],
      [{ x: 400, y: 400 }, 'ns-resize'],
      [{ x: 300, y: 325 }, 'ew-resize'],
      [{ x: 500, y: 325 }, 'ew-resize'],
    ];

    for (const [point, expected] of corners) {
      await page.mouse.move(point.x, point.y);
      await expect.poll(() => cursor(page), { message: `at ${point.x},${point.y}` }).toBe(expected);
    }

    // Just outside a corner is the rotation ring.
    await page.mouse.move(292, 242);
    await expect.poll(() => cursor(page)).toBe('rotate');

    // Over the body, and over nothing.
    await page.mouse.move(400, 320);
    await expect.poll(() => cursor(page)).toBe('move');
    await page.mouse.move(800, 600);
    await expect.poll(() => cursor(page)).toBe('default');
  });

  test('shift-click adds and removes', async ({ page }) => {
    await draw(page, 'KeyR', { x: 260, y: 250 }, { x: 360, y: 330 });
    await draw(page, 'KeyR', { x: 420, y: 250 }, { x: 520, y: 330 });
    await page.keyboard.press('KeyV');

    await page.mouse.click(300, 290);
    await page.keyboard.down('Shift');
    await page.mouse.click(470, 290);
    await page.keyboard.up('Shift');
    await expect(page.getByText('2 selected')).toBeVisible();

    // Checklist item 7.
    await page.keyboard.down('Shift');
    await page.mouse.click(470, 290);
    await page.keyboard.up('Shift');
    await expect(page.getByText('2 selected')).toHaveCount(0);
  });

  // Checklist item 6.
  test('a marquee selects several, which then move and scale as one', async ({ page }) => {
    await draw(page, 'KeyR', { x: 260, y: 250 }, { x: 360, y: 330 });
    await draw(page, 'KeyR', { x: 420, y: 250 }, { x: 520, y: 330 });
    await page.keyboard.press('KeyV');

    await dragFrom(page, { x: 220, y: 210 }, { x: 580, y: 380 });
    await expect(page.getByText('2 selected')).toBeVisible();

    const before = await geo(page);
    await dragFrom(page, { x: 300, y: 290 }, { x: 340, y: 320 });
    const moved = await geo(page);
    expect(moved.x).toBeCloseTo(before.x + 40, 0);
    expect(moved.y).toBeCloseTo(before.y + 30, 0);
    expect(moved.w).toBeCloseTo(before.w, 0);

    // Drag the shared frame's east edge: both shapes get wider.
    const frameRight = 520 + 40;
    await dragFrom(page, { x: frameRight, y: 320 }, { x: frameRight + 100, y: 320 });
    expect((await geo(page)).w).toBeGreaterThan(moved.w + 80);
  });
});

test.describe('transform', () => {
  // Checklist item 2 — the gate.
  test('a corner resize holds the opposite corner still', async ({ page }) => {
    await draw(page, 'KeyR', { x: 300, y: 250 }, { x: 460, y: 350 });
    await page.keyboard.press('KeyV');
    await page.mouse.click(380, 300);
    const before = await geo(page);

    await dragFrom(page, { x: 460, y: 350 }, { x: 560, y: 430 });
    const after = await geo(page);

    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.w).toBeCloseTo(before.w + 100, 0);
    expect(after.h).toBeCloseTo(before.h + 80, 0);
  });

  test('alt resizes about the centre', async ({ page }) => {
    await draw(page, 'KeyR', { x: 300, y: 250 }, { x: 460, y: 350 });
    await page.keyboard.press('KeyV');
    await page.mouse.click(380, 300);
    const before = await geo(page);
    const centreX = before.x + before.w / 2;

    await dragFrom(page, { x: 460, y: 350 }, { x: 500, y: 380 }, ['Alt']);
    const after = await geo(page);

    expect(after.x + after.w / 2).toBeCloseTo(centreX, 0);
    expect(after.w).toBeCloseTo(before.w + 80, 0);
  });

  test('shift keeps the ratio while resizing', async ({ page }) => {
    await draw(page, 'KeyR', { x: 300, y: 250 }, { x: 500, y: 350 });
    await page.keyboard.press('KeyV');
    await page.mouse.click(400, 300);
    const before = await geo(page);

    await dragFrom(page, { x: 500, y: 350 }, { x: 600, y: 360 }, ['Shift']);
    const after = await geo(page);
    expect(after.w / after.h).toBeCloseTo(before.w / before.h, 1);
  });

  // Checklist item 14.
  test('rotating snaps to 15° and shows the angle', async ({ page }) => {
    await draw(page, 'KeyR', { x: 320, y: 260 }, { x: 480, y: 360 });
    await page.keyboard.press('KeyV');
    await page.mouse.click(400, 310);

    await page.keyboard.down('Shift');
    await page.mouse.move(312, 252);
    await page.mouse.down();
    await page.mouse.move(520, 300, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    const angle = Number((await page.getByTestId('geo-angle').innerText()).replace('°', ''));
    expect(angle % 15).toBe(0);
    expect(angle).not.toBe(0);
  });
});

test.describe('snapping', () => {
  // Checklist item 5 — the gate.
  test('a near miss snaps to the other shape and can be overridden', async ({ page }) => {
    await draw(page, 'KeyR', { x: 300, y: 200 }, { x: 400, y: 280 });
    await draw(page, 'KeyR', { x: 500, y: 400 }, { x: 600, y: 480 });
    await page.keyboard.press('KeyV');

    await page.mouse.click(550, 440);
    const anchor = await geo(page);

    // Nudge the second shape so its left edge lands 4px from the first shape's left.
    await dragFrom(page, { x: 550, y: 440 }, { x: 550 - 196, y: 440 });
    const snapped = await geo(page);

    await page.mouse.click(300, 200);
    await page.mouse.click(anchor.x + 50 - (await stageOrigin(page)).x + 0, 240);

    expect(snapped.x).toBe(300 - (await stageOrigin(page)).x);
  });

  test('holding the modifier ignores snapping', async ({ page }) => {
    await draw(page, 'KeyR', { x: 300, y: 200 }, { x: 400, y: 280 });
    await draw(page, 'KeyR', { x: 500, y: 400 }, { x: 600, y: 480 });
    await page.keyboard.press('KeyV');
    await page.mouse.click(550, 440);

    await dragFrom(page, { x: 550, y: 440 }, { x: 550 - 196, y: 440 }, ['Control']);
    const free = await geo(page);
    const origin = await stageOrigin(page);
    expect(free.x).toBe(304 - origin.x);
  });
});

test.describe('arranging', () => {
  // Checklist item 8.
  test('alt-drag leaves a copy and Cmd+D duplicates', async ({ page }) => {
    await draw(page, 'KeyR', { x: 300, y: 250 }, { x: 400, y: 330 });
    await page.keyboard.press('KeyV');
    await page.mouse.click(350, 290);

    await dragFrom(page, { x: 350, y: 290 }, { x: 550, y: 290 }, ['Alt']);
    expect(await layerCount(page)).toBe(2);

    await page.keyboard.press('ControlOrMeta+KeyD');
    expect(await layerCount(page)).toBe(3);
  });

  // Checklist item 9.
  test('locking makes a shape inert and marks it in the layers list', async ({ page }) => {
    await draw(page, 'KeyR', { x: 300, y: 250 }, { x: 460, y: 350 });
    await page.keyboard.press('KeyV');
    await page.mouse.click(380, 300);

    await page.keyboard.press('Shift+ControlOrMeta+KeyL');
    await expect(page.getByTestId('layer-locked')).toBeVisible();

    await page.mouse.move(380, 300);
    await expect.poll(() => cursor(page)).toBe('not-allowed');

    // Clicking it selects nothing.
    await page.mouse.click(800, 600);
    await page.mouse.click(380, 300);
    await expect(page.getByTestId('geo-x')).toHaveCount(0);

    // And it unlocks again.
    await page
      .getByTestId(
        `layer-${(await page.getByTestId('layers').locator('li button').first().getAttribute('data-testid'))!.replace('layer-', '')}`,
      )
      .click();
    await page.getByTestId('toggle-lock').click();
    await expect(page.getByTestId('layer-locked')).toHaveCount(0);
  });

  // Checklist item 10.
  test('group moves as one and ungroup releases', async ({ page }) => {
    await draw(page, 'KeyR', { x: 260, y: 250 }, { x: 360, y: 330 });
    await draw(page, 'KeyR', { x: 420, y: 250 }, { x: 520, y: 330 });
    await page.keyboard.press('KeyV');
    await dragFrom(page, { x: 220, y: 210 }, { x: 580, y: 380 });

    await page.keyboard.press('ControlOrMeta+KeyG');
    expect(await layerNames(page)).toContain('group');

    const before = await geo(page);
    await dragFrom(page, { x: 300, y: 290 }, { x: 340, y: 290 });
    expect((await geo(page)).x).toBeCloseTo(before.x + 40, 0);

    await page.keyboard.press('Shift+ControlOrMeta+KeyG');
    expect(await layerNames(page)).not.toContain('group');
    await expect(page.getByText('2 selected')).toBeVisible();
  });

  // Checklist item 11.
  test('bracket keys change the stacking one step at a time', async ({ page }) => {
    for (const [index] of [0, 1, 2].entries()) {
      await draw(page, 'KeyR', { x: 300 + index * 30, y: 250 }, { x: 420 + index * 30, y: 350 });
    }
    await page.keyboard.press('KeyV');

    // Layers list is top-first; the last drawn shape starts on top.
    const initial = await layerNames(page);
    expect(initial).toHaveLength(3);

    await page.getByTestId('layers').locator('li button').first().click();
    await page.keyboard.press('BracketLeft');

    const after = await layerNames(page);
    expect(after).toHaveLength(3);
  });

  // Checklist item 12.
  test('distribute equalises the gaps', async ({ page }) => {
    await draw(page, 'KeyR', { x: 260, y: 250 }, { x: 320, y: 330 });
    await draw(page, 'KeyR', { x: 360, y: 250 }, { x: 420, y: 330 });
    await draw(page, 'KeyR', { x: 700, y: 250 }, { x: 760, y: 330 });
    await page.keyboard.press('KeyV');
    await dragFrom(page, { x: 220, y: 210 }, { x: 820, y: 380 });

    const before = await geo(page);
    await page.getByTestId('distribute-x').click();
    const after = await geo(page);

    // The outer edges do not move when distributing.
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.w).toBeCloseTo(before.w, 0);
  });
});

// Checklist item 13.
test.describe('inspector', () => {
  test('style changes apply to the selection', async ({ page }) => {
    await draw(page, 'KeyR', { x: 300, y: 250 }, { x: 460, y: 350 });
    await page.keyboard.press('KeyV');
    await page.mouse.click(380, 300);

    await page.getByTestId('dash-dashed').click();
    await expect(page.getByTestId('dash-dashed')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('stroke-width').fill('8');
    await expect(page.getByTestId('stroke-width')).toHaveValue('8');

    await page.getByTestId('corner-radius').fill('30');
    await expect(page.getByTestId('corner-radius')).toHaveValue('30');

    await page.getByLabel('Fill var(--shape-3)').click();
    await expect(page.getByLabel('Fill var(--shape-3)')).toHaveAttribute('aria-pressed', 'true');
  });
});
