import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 12 on the signed-out board: Settings over the board, the default text box and
 * text size, shortcuts that can be changed, and celebrations on the number pad.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board-canvas')).toBeVisible();
});

const geo = async (page: Page) => ({
  w: Number(await page.getByTestId('geo-w').innerText()),
  h: Number(await page.getByTestId('geo-h').innerText()),
});

async function openSettings(page: Page) {
  await page.getByTestId('tools-menu').click();
  await page.getByTestId('tools-settings').click();
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
}

async function closeSettings(page: Page) {
  await page.getByTestId('settings-close').click();
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0);
}

/** Types a number into a settings field the way a person does: select, type, leave. */
async function setNumber(page: Page, id: string, value: number) {
  const field = page.getByTestId(id);
  await field.fill(String(value));
  await field.press('Enter');
  await expect(field).toHaveValue(String(value));
}

/** Clicks one of an action's keys in Settings and presses its replacement. */
async function rebind(page: Page, id: string, index: number, key: string) {
  await page.getByTestId(`shortcut-key-${id}-${index}`).click();
  await expect(page.getByTestId('shortcut-recording')).toBeVisible();
  await page.keyboard.press(key);
  await expect(page.getByTestId('shortcut-recording')).toHaveCount(0);
}

const keyLabels = (page: Page, id: string) =>
  page.getByTestId(`shortcut-row-${id}`).locator('[data-testid^="shortcut-key-"]').allInnerTexts();

test.describe('text', () => {
  // Checklist item 2.
  test('a click with the text tool makes the box and the type chosen in Settings', async ({
    page,
  }) => {
    await openSettings(page);
    await expect(page.getByTestId('settings-status')).toHaveText('Saved in this browser');
    await setNumber(page, 'setting-font-size', 24);
    await setNumber(page, 'setting-box-chars', 20);
    await setNumber(page, 'setting-box-lines', 3);
    // The preview says how big that is on the board.
    await expect(page.getByTestId('settings-text-size')).toContainText(
      `× ${Math.round(24 * 1.35 * 3 + 4)} px`,
    );
    await closeSettings(page);

    await page.keyboard.press('KeyT');
    await page.mouse.click(160, 160);
    await page.keyboard.type('Small');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('font-size')).toHaveText('24px');
    const box = await geo(page);
    expect(box.h).toBeCloseTo(3 * 24 * 1.35 + 4, -1);
    // Twenty characters of 24px type: far narrower than the 55 of 40px it was.
    expect(box.w).toBeGreaterThan(150);
    expect(box.w).toBeLessThan(400);

    // Pasted words start at the same size.
    await page.mouse.click(700, 500);
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData('text/plain', 'Pasted words');
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data }));
    });
    await expect(page.getByTestId('layers').locator('li')).toHaveCount(2);
    await expect(page.getByTestId('font-size')).toHaveText('24px');

    // Kept in this browser for next time.
    await page.reload();
    await openSettings(page);
    await expect(page.getByTestId('setting-font-size')).toHaveValue('24');
    await expect(page.getByTestId('setting-box-lines')).toHaveValue('3');
  });
});

test.describe('shortcuts', () => {
  // Checklist item 4.
  test('a changed shortcut works at once; a clash is marked; reset brings the defaults back', async ({
    page,
  }) => {
    await openSettings(page);
    await rebind(page, 'tool.pen', 0, 'KeyB');
    expect(await keyLabels(page, 'tool.pen')).toEqual(['B']);
    await closeSettings(page);

    await page.keyboard.press('KeyB');
    await expect(page.getByTestId('tool-pen')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('KeyV');
    await page.keyboard.press('KeyP');
    await expect(page.getByTestId('tool-pen')).toHaveAttribute('aria-pressed', 'false');
    // The tooltip and the list of shortcuts say B now.
    await expect(page.getByTestId('tool-pen')).toHaveAttribute('title', 'Pen — B');
    await page.keyboard.press('Shift+Slash');
    await expect(
      page.getByTestId('shortcut-sheet').getByText('Pen', { exact: true }).locator('..'),
    ).toContainText('B');
    await page.getByTestId('sheet-change-shortcuts').click();
    await expect(page.getByTestId('settings-dialog')).toBeVisible();

    // R is the rectangle's; giving it to confetti marks both, and confetti wins.
    await page.getByTestId('shortcut-add-celebrate.confetti').click();
    await page.keyboard.press('KeyR');
    await expect(page.getByTestId('shortcut-clash-celebrate.confetti')).toContainText(
      'R is also Rectangle. Pressing it does Confetti.',
    );
    await expect(page.getByTestId('shortcut-clash-tool.rect')).toContainText(
      'R is also Confetti. Pressing it does Confetti.',
    );
    await closeSettings(page);
    await page.keyboard.press('KeyR');
    await expect(page.getByTestId('celebration')).toHaveAttribute('data-effect', 'confetti');
    await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');

    // Some keys are not for giving away.
    await openSettings(page);
    await page.getByTestId('shortcut-add-tool.hand').click();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('shortcut-refused-tool.hand')).toContainText('Space');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('shortcut-recording')).toHaveCount(0);
    await expect(page.getByTestId('settings-dialog')).toBeVisible();

    await page.getByTestId('shortcuts-reset-all').click();
    expect(await keyLabels(page, 'tool.pen')).toEqual(['P']);
    expect(await keyLabels(page, 'celebrate.confetti')).toEqual(['Num 1']);
    await expect(page.getByTestId('shortcut-clash-tool.rect')).toHaveCount(0);
    await closeSettings(page);
    await page.keyboard.press('KeyP');
    await expect(page.getByTestId('tool-pen')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a key can be removed, and an action with none can be given one', async ({ page }) => {
    await openSettings(page);
    await page.getByTestId('shortcut-remove-tool.pen-0').click();
    await expect(page.getByTestId('shortcut-add-tool.pen')).toHaveText('Add a key');
    // The triangle has no key to begin with.
    await page.getByTestId('shortcut-add-tool.triangle').click();
    await page.keyboard.press('Shift+KeyT');
    expect(await keyLabels(page, 'tool.triangle')).toEqual(['Shift+T']);
    await closeSettings(page);

    await page.keyboard.press('KeyP');
    await expect(page.getByTestId('tool-pen')).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Shift+KeyT');
    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(420, 400, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByTestId('layers').locator('li')).toHaveText(['triangle']);

    // And the change outlives a reload.
    await page.reload();
    await openSettings(page);
    expect(await keyLabels(page, 'tool.triangle')).toEqual(['Shift+T']);
    await expect(page.getByTestId('shortcut-row-tool.pen')).toHaveAttribute('data-changed', 'true');
    await page.getByTestId('shortcut-reset-tool.pen').click();
    expect(await keyLabels(page, 'tool.pen')).toEqual(['P']);
  });

  test('a shortcut while typing can be changed too', async ({ page }) => {
    await openSettings(page);
    await page.getByTestId('shortcut-filter').fill('bold');
    await rebind(page, 'text.bold', 0, 'Control+KeyE');
    // Without Ctrl, ⌘ or Alt it would type instead, so it is refused.
    await page.getByTestId('shortcut-add-text.bold').click();
    await page.keyboard.press('KeyQ');
    await expect(page.getByTestId('shortcut-refused-text.bold')).toBeVisible();
    await page.keyboard.press('Escape');
    await closeSettings(page);

    await page.keyboard.press('KeyT');
    await page.mouse.click(200, 200);
    await page.keyboard.press('Control+KeyE');
    await page.keyboard.type('Strong');
    await expect(page.getByTestId('text-bold')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('text-editor').locator('span[style*="font-weight"]')).toHaveText(
      'Strong',
    );
  });
});

test.describe('celebrations', () => {
  // Checklist item 5.
  test('the number pad starts one at any time, presenting or not', async ({ page }) => {
    await page.keyboard.press('Numpad3');
    await expect(page.getByTestId('celebration')).toHaveAttribute('data-effect', 'bubbles');
    await page.keyboard.press('Numpad7');
    await expect(page.getByTestId('celebration')).toHaveAttribute('data-effect', 'applause');

    await page.keyboard.press('KeyF');
    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.move(500, 400, { steps: 4 });
    await page.mouse.up();
    await page.getByTestId('insert-menu').click();
    await page.getByTestId('present-start').click();
    await expect(page.getByTestId('presentation-bar')).toBeVisible();
    await page.keyboard.press('Numpad1');
    await expect(page.getByTestId('celebration')).toHaveAttribute('data-effect', 'confetti');
    // The letters that once did this while presenting are not celebrations any more.
    await expect(page.getByTestId('celebration')).toHaveCount(0, { timeout: 8000 });
    await page.keyboard.press('KeyD');
    await page.waitForTimeout(300);
    await expect(page.getByTestId('celebration')).toHaveCount(0);
  });
});
