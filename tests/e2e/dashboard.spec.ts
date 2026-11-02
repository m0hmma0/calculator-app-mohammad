import { expect, test, type Browser, type Page } from '@playwright/test';
import { API, boardCards, createBoard, newAccount, signIn, tokenFor } from './accounts';

/**
 * Phase 16: organising the dashboard — tiles or a list, folders in the order they are
 * dragged into, pinned folders, the archive, and boards sorted by date added or name.
 * Each against the real Worker, and where it should, from a second device too.
 */

type Account = ReturnType<typeof newAccount>;

const folderCards = (page: Page) => page.locator('[data-testid^="folder-card-"]');
const folderCard = (page: Page, name: string) => folderCards(page).filter({ hasText: name });
const idOf = async (page: Page, name: string) =>
  (await folderCard(page, name).first().getAttribute('data-testid'))!.replace('folder-card-', '');
/** The names of the folder cards, in the order they show. */
const folderOrder = (page: Page) =>
  folderCards(page).evaluateAll((nodes) =>
    nodes.map((node) => node.querySelector('[class*="cardTitle"]')?.textContent?.trim()),
  );
/** The same, down the sidebar's tree. */
const treeOrder = (page: Page) =>
  page
    .locator('[data-testid^="tree-item-"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.querySelector('[class*="treeName"]')?.textContent?.trim()),
    );
const boardTitles = (page: Page) =>
  boardCards(page).evaluateAll((nodes) =>
    nodes.map((node) => node.querySelector('[class*="cardTitle"]')?.textContent?.trim()),
  );

async function newFolder(page: Page, name: string) {
  page.removeAllListeners('dialog');
  page.once('dialog', (dialog) => void dialog.accept(name));
  await page.getByTestId('new-folder').click();
  await expect(folderCard(page, name)).toBeVisible();
}

/** The same account, on another device: a separate browser context. */
async function anotherDevice(browser: Browser, account: Account) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, account);
  return { context, page };
}

/** Boards made straight through the API, a moment apart, so each has its own date. */
async function boardsByApi(account: Account, titles: string[]) {
  const token = await tokenFor(account);
  for (const title of titles) {
    const response = await fetch(`${API}/api/boards`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ title, folderId: null }),
    });
    expect(response.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

const settingsSaved = (page: Page) =>
  page.waitForResponse(
    (response) => response.url().endsWith('/api/settings') && response.request().method() === 'PUT',
  );

// Checklist item 1.
test('tiles or a list, and the choice is remembered — here and on another device', async ({
  page,
  browser,
}) => {
  const account = newAccount('tiles');
  await signIn(page, account);
  await newFolder(page, 'Unit 1');
  await createBoard(page);
  await page.getByTestId('back-to-boards').click();
  await expect(page.getByTestId('items')).toHaveAttribute('data-view', 'tiles');

  const saved = settingsSaved(page);
  await page.getByTestId('view-list').click();
  await expect(page.getByTestId('items')).toHaveAttribute('data-view', 'list');
  await expect(page.getByTestId('view-list')).toHaveAttribute('aria-pressed', 'true');
  // A row: no picture of the board, its actions folded away.
  await expect(boardCards(page).first().locator('img')).toHaveCount(0);
  await saved;

  await page.reload();
  await expect(page.getByTestId('items')).toHaveAttribute('data-view', 'list');
  const other = await anotherDevice(browser, account);
  await expect(other.page.getByTestId('items')).toHaveAttribute('data-view', 'list');
  await other.context.close();
});

// Checklist item 2.
test('a folder dragged to a new place stays there, after a reload and on another device', async ({
  page,
  browser,
}) => {
  const account = newAccount('dragorder');
  await signIn(page, account);
  for (const name of ['Alpha', 'Bravo', 'Charlie']) await newFolder(page, name);
  expect(await folderOrder(page)).toEqual(['Alpha', 'Bravo', 'Charlie']);

  // Charlie dropped on Alpha takes its place.
  await folderCard(page, 'Charlie').dragTo(folderCard(page, 'Alpha'));
  await expect.poll(() => folderOrder(page)).toEqual(['Charlie', 'Alpha', 'Bravo']);
  await expect.poll(() => treeOrder(page)).toEqual(['Charlie', 'Alpha', 'Bravo']);

  // And Alpha, dragged in the sidebar, after Bravo.
  const alpha = await idOf(page, 'Alpha');
  const bravo = await idOf(page, 'Bravo');
  await page.getByTestId(`tree-item-${alpha}`).dragTo(page.getByTestId(`tree-item-${bravo}`));
  await expect.poll(() => treeOrder(page)).toEqual(['Charlie', 'Bravo', 'Alpha']);

  await page.reload();
  await expect.poll(() => folderOrder(page)).toEqual(['Charlie', 'Bravo', 'Alpha']);
  const other = await anotherDevice(browser, account);
  await expect.poll(() => folderOrder(other.page)).toEqual(['Charlie', 'Bravo', 'Alpha']);
  await expect.poll(() => treeOrder(other.page)).toEqual(['Charlie', 'Bravo', 'Alpha']);
  await other.context.close();
});

// Checklist item 3.
test('a pinned folder stays at the top', async ({ page }) => {
  await signIn(page, newAccount('pin'));
  for (const name of ['Alpha', 'Bravo', 'Charlie']) await newFolder(page, name);
  const charlie = await idOf(page, 'Charlie');

  await page.getByTestId(`folder-pin-${charlie}`).click();
  await expect(page.getByTestId(`folder-pin-${charlie}`)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => folderOrder(page)).toEqual(['Charlie', 'Alpha', 'Bravo']);
  await expect.poll(() => treeOrder(page)).toEqual(['Charlie', 'Alpha', 'Bravo']);

  // Dragged below the others, it is still first: pinned comes before order.
  await folderCard(page, 'Charlie').dragTo(folderCard(page, 'Bravo'));
  await page.reload();
  await expect.poll(() => folderOrder(page)).toEqual(['Charlie', 'Alpha', 'Bravo']);

  // Unpinned, it goes back among the others.
  await page.getByTestId(`folder-pin-${charlie}`).click();
  await expect.poll(() => folderOrder(page)).not.toEqual(['Charlie', 'Alpha', 'Bravo']);
});

// Checklist item 4 — the gate.
test('archived folders and boards leave the main view, wait in Archive, and come back whole', async ({
  page,
}) => {
  await signIn(page, newAccount('archive'));
  await newFolder(page, 'Last term');
  const folder = await idOf(page, 'Last term');
  // A board inside the folder, and one loose at the top.
  await folderCard(page, 'Last term').getByRole('link').first().click();
  const inside = await createBoard(page);
  await page.getByTestId('back-to-boards').click();
  await page.getByTestId('nav-all').click();
  const loose = await createBoard(page);
  await page.getByTestId('back-to-boards').click();
  await expect(boardCards(page)).toHaveCount(1);

  await page.getByTestId(`archive-${loose}`).click();
  await page.getByTestId(`folder-archive-${folder}`).click();
  await expect(boardCards(page)).toHaveCount(0);
  await expect(folderCards(page)).toHaveCount(0);
  await expect(page.getByTestId(`folder-${folder}`)).toHaveCount(0);
  // Nor in a search across everything.
  await page.getByTestId('search').fill('Untitled');
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await page.getByTestId('search').fill('');

  // In the archive: the folder, and the loose board — the other is inside the folder.
  await page.getByTestId('nav-archive').click();
  await expect(page.getByTestId(`folder-card-${folder}`)).toBeVisible();
  await expect(page.getByTestId(`board-${loose}`)).toBeVisible();
  await expect(page.getByTestId(`board-${inside}`)).toHaveCount(0);
  await page.getByTestId(`folder-card-${folder}`).getByRole('link').first().click();
  await expect(page.getByTestId('archived-folder-notice')).toBeVisible();
  await expect(page.getByTestId(`board-${inside}`)).toBeVisible();

  // An archived board still opens.
  await page.getByTestId(`board-${inside}`).getByRole('link').first().click();
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  await page.getByTestId('back-to-boards').click();

  // Back, both, with what was in them.
  await page.getByTestId('nav-archive').click();
  await page.getByTestId(`unarchive-folder-${folder}`).click();
  await page.getByTestId(`unarchive-${loose}`).click();
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await page.getByTestId('nav-all').click();
  await expect(page.getByTestId(`board-${loose}`)).toBeVisible();
  await expect(folderCard(page, 'Last term')).toContainText('1 board');
  await page.getByTestId(`folder-${folder}`).click();
  await expect(page.getByTestId(`board-${inside}`)).toBeVisible();
  // Nothing went to the trash on the way.
  await page.getByTestId('nav-trash').click();
  await expect(page.getByTestId('empty-state')).toBeVisible();
});

// Checklist item 5.
test("a folder's boards sort by date added, either way, or by name — and the choice stays", async ({
  page,
}) => {
  const account = newAccount('sort');
  await boardsByApi(account, ['Lesson 2', 'Lesson 10', 'Apple']);
  await signIn(page, account);
  await expect(boardCards(page)).toHaveCount(3);

  const sort = page.getByTestId('board-sort');
  await sort.selectOption('newest');
  await expect.poll(() => boardTitles(page)).toEqual(['Apple', 'Lesson 10', 'Lesson 2']);
  await sort.selectOption('oldest');
  await expect.poll(() => boardTitles(page)).toEqual(['Lesson 2', 'Lesson 10', 'Apple']);
  const saved = settingsSaved(page);
  await sort.selectOption('name');
  await expect.poll(() => boardTitles(page)).toEqual(['Apple', 'Lesson 2', 'Lesson 10']);
  await saved;

  await page.reload();
  await expect(sort).toHaveValue('name');
  await expect.poll(() => boardTitles(page)).toEqual(['Apple', 'Lesson 2', 'Lesson 10']);
});

test('the API keeps one account from archiving or ordering another’s', async () => {
  const owner = newAccount('archowner');
  const stranger = newAccount('archstranger');
  await boardsByApi(owner, ['Mine']);
  const ownerToken = await tokenFor(owner);
  const workspace = (await (
    await fetch(`${API}/api/workspace`, { headers: { authorization: `Bearer ${ownerToken}` } })
  ).json()) as { boards: Array<{ id: string }> };
  const boardId = workspace.boards[0]!.id;

  const strangerToken = await tokenFor(stranger);
  const attempt = await fetch(`${API}/api/boards/${boardId}/archive`, {
    method: 'POST',
    headers: { authorization: `Bearer ${strangerToken}` },
  });
  expect(attempt.status).toBe(404);
});
