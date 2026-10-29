import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 10's fixes on the board itself: the text box with nothing laid over it and
 * its controls in the side panel, the wheel over it, tools putting the selection
 * down, and the right-click menu.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board-canvas')).toBeVisible();
});

const editor = (page: Page) => page.getByTestId('text-editor');
const layers = (page: Page) => page.getByTestId('layers').locator('li');

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 6 });
  await page.mouse.up();
}

async function rect(page: Page, from: [number, number], to: [number, number]) {
  await page.keyboard.press('KeyR');
  await drag(page, from, to);
}

test.describe('typing in a text box', () => {
  test('nothing is laid over the board, and no bar floats above the box', async ({ page }) => {
    await rect(page, [200, 200], [500, 400]);
    await page.keyboard.press('KeyT');
    await drag(page, [150, 150], [700, 300]);
    await page.keyboard.type('over the square');

    await expect(editor(page)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(page.getByTestId('format-bar')).toHaveCount(0);
    // Its controls are in the side panel, and work from there.
    await expect(page.getByTestId('text-bold')).toBeVisible();
    await expect(page.getByTestId('text-colour-red')).toBeVisible();
  });

  test('Ctrl+K opens the shut side panel at the address field', async ({ page }) => {
    await page.getByTestId('close-pane').click();
    await expect(page.getByTestId('inspector')).toHaveCount(0);

    await page.keyboard.press('KeyT');
    await drag(page, [150, 150], [700, 300]);
    await page.keyboard.type('page');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press('ControlOrMeta+KeyK');
    await expect(page.getByTestId('inspector')).toBeVisible();
    await expect(page.getByTestId('link-input')).toBeFocused();
    await page.keyboard.type('example.com');
    await page.keyboard.press('Enter');
    await expect(editor(page)).toBeFocused();
    await expect(editor(page).locator('[data-link]')).toHaveText('page');
  });

  test('the wheel over the box moves the board, as it does anywhere else', async ({ page }) => {
    await page.keyboard.press('KeyT');
    await drag(page, [300, 300], [800, 400]);
    await page.keyboard.type('scroll over me');
    const before = (await editor(page).boundingBox())!;

    await page.mouse.move(before.x + 40, before.y + 20);
    await page.mouse.wheel(0, 150);
    await expect
      .poll(async () => (await editor(page).boundingBox())!.y)
      .toBeLessThan(before.y - 100);
    // Still typing, in the same box.
    await expect(editor(page)).toBeFocused();
  });
});

test.describe('changing tools', () => {
  test('picking up another tool by its key puts the selection down', async ({ page }) => {
    await rect(page, [300, 300], [420, 380]);
    await expect(page.getByTestId('geometry')).toBeVisible();

    await page.keyboard.press('KeyP');
    await expect(page.getByTestId('geometry')).toHaveCount(0);

    // Back to selecting, nothing is selected until something is clicked.
    await page.keyboard.press('KeyV');
    await expect(page.getByTestId('geometry')).toHaveCount(0);
    await page.mouse.click(360, 340);
    await expect(page.getByTestId('geometry')).toBeVisible();
  });
});

test.describe('the right-click menu', () => {
  test('pastes what was copied, where it was opened', async ({ page, context }) => {
    // As if the browser's "allow reading the clipboard?" had been answered yes.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await rect(page, [200, 200], [300, 280]);
    await page.keyboard.press('ControlOrMeta+KeyC');

    await page.mouse.click(700, 450, { button: 'right' });
    await page.getByTestId('menu-paste').click();
    await expect(layers(page)).toHaveCount(2);
    // The copy is where the menu was opened, not on top of the original.
    await layers(page).first().locator('button').click();
    const x = Number(await page.getByTestId('geo-x').innerText());
    expect(x).toBeGreaterThan(400);
  });

  test('stays on the board when opened in a corner', async ({ page }) => {
    await page.getByTestId('close-pane').click();
    const stage = (await page.getByTestId('stage').boundingBox())!;
    // Near the bottom right, above the bar there: a menu opened down and right of
    // here would run off both edges.
    const corner = { x: stage.x + stage.width - 8, y: stage.y + stage.height - 70 };
    await page.mouse.click(corner.x, corner.y, { button: 'right' });
    const menu = (await page.getByTestId('context-menu').boundingBox())!;
    expect(menu.x).toBeGreaterThanOrEqual(stage.x);
    expect(menu.y).toBeGreaterThanOrEqual(stage.y);
    expect(menu.x + menu.width).toBeLessThanOrEqual(stage.x + stage.width);
    expect(menu.y + menu.height).toBeLessThanOrEqual(stage.y + stage.height);
  });

  test('has unlock, ungroup and the side panel; not select all or ordering', async ({ page }) => {
    await rect(page, [200, 200], [300, 280]);
    await rect(page, [400, 200], [500, 280]);
    await page.keyboard.press('KeyV');
    await drag(page, [150, 150], [560, 330]);

    await page.mouse.click(250, 240, { button: 'right' });
    for (const gone of ['select-all', 'front', 'forward', 'backward', 'back']) {
      await expect(page.getByTestId(`menu-${gone}`)).toHaveCount(0);
    }
    await page.getByTestId('menu-group').click();
    await expect(layers(page)).toHaveText(['group']);

    await page.mouse.click(250, 240, { button: 'right' });
    await page.getByTestId('menu-ungroup').click();
    await expect(layers(page)).toHaveText(['rect', 'rect']);

    // Lock one, then unlock it from the same menu.
    await page.keyboard.press('Escape');
    await page.mouse.click(250, 240);
    await page.mouse.click(250, 240, { button: 'right' });
    await page.getByTestId('menu-lock').click();
    await expect(page.getByTestId('layer-locked')).toHaveCount(1);
    await page.mouse.click(250, 240, { button: 'right' });
    await expect(page.getByTestId('menu-lock')).toBeDisabled();
    await page.getByTestId('menu-unlock').click();
    await expect(page.getByTestId('layer-locked')).toHaveCount(0);

    // And the side panel, shut and opened again.
    await page.mouse.click(700, 500, { button: 'right' });
    await page.getByTestId('menu-pane').click();
    await expect(page.getByTestId('inspector')).toHaveCount(0);
    await page.mouse.click(700, 500, { button: 'right' });
    await page.getByTestId('menu-pane').click();
    await expect(page.getByTestId('inspector')).toBeVisible();
  });
});
