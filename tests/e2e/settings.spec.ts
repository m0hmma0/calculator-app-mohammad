import { expect, test, type Browser, type Page } from '@playwright/test';
import { API, createBoard, newAccount, signIn, tokenFor } from './accounts';

/**
 * Phase 12 with accounts: settings saved to the account, so they follow a person to
 * another device; and the size others' text starts at on an owner's boards.
 */

type Account = ReturnType<typeof newAccount>;

async function device(browser: Browser, account: Account) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, account);
  return { context, page };
}

async function setNumber(page: Page, id: string, value: number) {
  const field = page.getByTestId(id);
  await field.fill(String(value));
  await field.press('Enter');
  await expect(field).toHaveValue(String(value));
}

/** Settings from the dashboard, on their own page. */
async function settingsPage(page: Page) {
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-page')).toBeVisible();
  await expect(page.getByTestId('settings-status')).toHaveText('Saved to your account');
}

/** A click with the text tool, some words, and the size they came out at. */
async function typeSomething(page: Page, at: [number, number]) {
  await page.keyboard.press('KeyT');
  await page.mouse.click(at[0], at[1]);
  await page.keyboard.type('Hello');
  await page.keyboard.press('Escape');
  return page.getByTestId('font-size').innerText();
}

test.describe('settings on the account', () => {
  // Checklist item 1.
  test('follow you to another device', async ({ browser }) => {
    const account = newAccount('settings');
    const laptop = await device(browser, account);
    await settingsPage(laptop.page);
    await setNumber(laptop.page, 'setting-font-size', 28);
    await laptop.page.getByTestId('shortcut-key-tool.pen-0').click();
    await laptop.page.keyboard.press('KeyB');
    await expect(laptop.page.getByTestId('settings-status')).toHaveText('Saved to your account');

    // The server has them, as sent.
    const saved = await fetch(`${API}/api/settings`, {
      headers: { authorization: `Bearer ${await tokenFor(account)}` },
    }).then((response) => response.json() as Promise<{ settings: unknown }>);
    expect(saved.settings).toMatchObject({
      text: { fontSize: 28 },
      shortcuts: { 'tool.pen': ['KeyB'] },
    });

    // A second device, never used before, finds them.
    const phone = await device(browser, account);
    await settingsPage(phone.page);
    await expect(phone.page.getByTestId('setting-font-size')).toHaveValue('28');
    await expect(phone.page.getByTestId('shortcut-key-tool.pen-0')).toHaveText('B');

    // And they work there on a board.
    await phone.page.getByTestId('settings-back').click();
    await createBoard(phone.page);
    await phone.page.keyboard.press('KeyB');
    await expect(phone.page.getByTestId('tool-pen')).toHaveAttribute('aria-pressed', 'true');
    expect(await typeSomething(phone.page, [300, 260])).toBe('28px');

    await laptop.context.close();
    await phone.context.close();
  });
});

test.describe('text on someone else’s board', () => {
  // Checklist item 3.
  test('starts at the owner’s size — or the size the owner chose for others', async ({
    browser,
  }) => {
    const ownerAccount = newAccount('textowner');
    const editorAccount = newAccount('texteditor');
    const owner = await device(browser, ownerAccount);
    const editor = await device(browser, editorAccount);

    await settingsPage(owner.page);
    await setNumber(owner.page, 'setting-font-size', 24);
    await expect(owner.page.getByTestId('settings-status')).toHaveText('Saved to your account');
    // The editor likes big type on their own boards.
    await settingsPage(editor.page);
    await setNumber(editor.page, 'setting-font-size', 64);
    await expect(editor.page.getByTestId('settings-status')).toHaveText('Saved to your account');

    await owner.page.getByTestId('settings-back').click();
    const boardId = await createBoard(owner.page);
    await owner.page.getByTestId('open-share').click();
    await owner.page.getByTestId('person-email').fill(`${editorAccount.uid}@example.test`);
    await owner.page.getByTestId('person-role').selectOption('editor');
    await owner.page.getByTestId('add-person').click();
    await expect(owner.page.getByTestId('person-row')).toHaveCount(1);
    await owner.page.getByTestId('close-share').click();
    expect(await typeSomething(owner.page, [200, 160])).toBe('24px');

    await editor.page.goto(`/b/${boardId}`);
    await expect(editor.page.getByTestId('connection-status')).toHaveAttribute(
      'data-status',
      'connected',
    );
    expect(await typeSomething(editor.page, [200, 420])).toBe('24px');

    // The owner picks a size just for others; their own text stays as it was.
    await owner.page.goto('/settings');
    await expect(owner.page.getByTestId('settings-status')).toHaveText('Saved to your account');
    await owner.page.getByTestId('setting-others-own').check();
    await setNumber(owner.page, 'setting-others-size', 32);
    await expect(owner.page.getByTestId('settings-status')).toHaveText('Saved to your account');
    await owner.page.goto(`/b/${boardId}`);
    await expect(owner.page.getByTestId('board-canvas')).toBeVisible();
    expect(await typeSomething(owner.page, [700, 160])).toBe('24px');

    await editor.page.reload();
    await expect(editor.page.getByTestId('connection-status')).toHaveAttribute(
      'data-status',
      'connected',
    );
    expect(await typeSomething(editor.page, [700, 420])).toBe('32px');

    // On their own board, the editor's own size.
    await editor.page.goto('/');
    await createBoard(editor.page);
    expect(await typeSomething(editor.page, [300, 260])).toBe('64px');

    await owner.context.close();
    await editor.context.close();
  });
});
