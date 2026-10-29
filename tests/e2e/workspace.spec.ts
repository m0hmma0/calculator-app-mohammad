import { expect, test, type Page } from '@playwright/test';
import { boardCards, createBoard, newAccount, signIn, tokenFor } from './accounts';

/** Visible is not enough: a broken image is visible too. This one has to decode. */
async function expectThumbnailLoaded(page: Page, boardId: string) {
  const image = page.getByTestId(`board-${boardId}`).locator('img');
  await expect(image).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
}

async function drawRectangle(page: Page, from: [number, number], to: [number, number]) {
  await page.keyboard.press('KeyR');
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 5 });
  await page.mouse.up();
}

test.describe('signing in', () => {
  // Checklist item 1.
  test('lands on a dashboard showing who you are', async ({ page }) => {
    const account = newAccount('alice');
    await signIn(page, account);

    await expect(page.getByTestId('account-name')).toHaveText(account.name);
    await expect(page.getByTestId('empty-state')).toBeVisible();
  });

  test('offers Google sign-in when signed out', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('sabboura:test-token'));
    await page.goto('/');
    await expect(page.getByTestId('sign-in')).toBeVisible();
  });
});

test.describe('managing folders', () => {
  const folderCard = (page: Page, name: string) =>
    page.locator('[data-testid^="folder-card-"]').filter({ hasText: name });
  const idOf = async (page: Page, name: string) =>
    (await folderCard(page, name).getAttribute('data-testid'))!.replace('folder-card-', '');

  test('rename, move, delete and restore a folder with what is in it', async ({ page }) => {
    await signIn(page, newAccount('folders'));
    const answer = (text: string) => {
      page.removeAllListeners('dialog');
      page.on('dialog', (dialog) => void dialog.accept(text));
    };

    answer('Units');
    await page.getByTestId('new-folder').click();
    await expect(folderCard(page, 'Units')).toBeVisible();
    const units = await idOf(page, 'Units');

    // Renamed from its card.
    answer('Unit 1');
    await page.getByTestId(`folder-rename-${units}`).click();
    await expect(folderCard(page, 'Unit 1')).toBeVisible();

    answer('Archive');
    await page.getByTestId('new-folder').click();
    await expect(folderCard(page, 'Archive')).toBeVisible();
    const archive = await idOf(page, 'Archive');

    // Moved into Archive: gone from the top level, there inside Archive.
    await page.getByTestId(`folder-move-${units}`).click();
    await page.getByTestId(`folder-move-to-${units}`).selectOption({ label: 'Archive' });
    await expect(page.getByTestId(`folder-card-${units}`)).toHaveCount(0);
    await page.getByTestId(`folder-card-${archive}`).getByRole('link').first().click();
    await expect(page.getByTestId(`folder-card-${units}`)).toBeVisible();

    // A board inside it.
    await page.getByTestId(`folder-card-${units}`).getByRole('link').first().click();
    await createBoard(page);
    await page.getByTestId('back-to-boards').click();
    await expect(boardCards(page)).toHaveCount(1);

    // Deleted from the folder's own menu: back up to Archive, and it is gone.
    page.removeAllListeners('dialog');
    page.on('dialog', (dialog) => void dialog.accept());
    await page.getByTestId('folder-menu').click();
    await page.getByTestId('folder-menu-delete').click();
    await expect(page.getByTestId('breadcrumb')).not.toContainText('Unit 1');
    await expect(page.getByTestId('breadcrumb')).toContainText('Archive');
    await expect(page.getByTestId(`folder-card-${units}`)).toHaveCount(0);

    // In the trash as one folder, its board with it rather than loose.
    await page.getByTestId('nav-trash').click();
    await expect(page.getByTestId(`folder-card-${units}`)).toBeVisible();
    await expect(boardCards(page)).toHaveCount(0);

    // Restored: the folder, back in Archive, with its board.
    await page.getByTestId(`restore-folder-${units}`).click();
    await expect(page.getByTestId(`folder-card-${units}`)).toHaveCount(0);
    await page.getByTestId(`folder-${archive}`).click();
    await expect(folderCard(page, 'Unit 1')).toContainText('1 board');
  });
});

test.describe('opening a board', () => {
  test('it opens showing everything on it, wherever the view was left', async ({ page }) => {
    await signIn(page, newAccount('fitopen'));
    await createBoard(page);
    for (const [x, y] of [
      [150, 150],
      [900, 600],
    ] as const) {
      await page.keyboard.press('KeyR');
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 80, y + 60, { steps: 4 });
      await page.mouse.up();
    }
    await expect(page.getByTestId('layers').locator('li')).toHaveCount(2);
    // Zoomed right in on one corner.
    for (let step = 0; step < 4; step += 1) await page.keyboard.press('Equal');
    const zoomedIn = await page.getByTestId('zoom-readout').innerText();

    await page.getByTestId('back-to-boards').click();
    await boardCards(page).first().getByRole('link').first().click();
    await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');
    await expect(page.getByTestId('layers').locator('li')).toHaveCount(2);

    // Fitted to both shapes — exactly the view Shift+1 gives — not where it was left.
    await expect(page.getByTestId('zoom-readout')).not.toHaveText(zoomedIn);
    const opened = await page.getByTestId('zoom-readout').innerText();
    await page.keyboard.press('Shift+Digit1');
    await expect(page.getByTestId('zoom-readout')).toHaveText(opened);
  });
});

test.describe('folders and boards', () => {
  // Checklist item 2.
  test('nests folders and shows the path', async ({ page }) => {
    await signIn(page, newAccount('nest'));

    page.on('dialog', (dialog) => void dialog.accept('Projects'));
    await page.getByTestId('new-folder').click();
    await expect(page.getByRole('complementary').getByText('Projects')).toBeVisible();

    await page.getByText('Projects').first().click();
    await expect(page.getByTestId('breadcrumb')).toContainText('Projects');

    page.removeAllListeners('dialog');
    page.on('dialog', (dialog) => void dialog.accept('Q4'));
    await page.getByTestId('new-folder').click();
    await expect(page.getByRole('complementary').getByText('Q4')).toBeVisible();

    await page.getByText('Q4').first().click();
    const breadcrumb = page.getByTestId('breadcrumb');
    await expect(breadcrumb).toContainText('Projects');
    await expect(breadcrumb).toContainText('Q4');

    // A board made here belongs to the folder that is open, and "back" returns to it.
    await createBoard(page);
    await page.getByTestId('back-to-boards').click();
    await expect(page.getByTestId('breadcrumb')).toContainText('Q4');
    await expect(boardCards(page)).toHaveCount(1);

    // The top level does not show it, because it lives two folders down.
    await page.getByTestId('nav-all').click();
    await expect(boardCards(page)).toHaveCount(0);
  });

  // Checklist item 5.
  test('renames, moves and duplicates a board', async ({ page }) => {
    await signIn(page, newAccount('edit'));
    const id = await createBoard(page);
    await page.getByTestId('back-to-boards').click();

    page.on('dialog', (dialog) => void dialog.accept('Roadmap'));
    await page.getByTestId(`rename-${id}`).click();
    await expect(page.getByText('Roadmap', { exact: true })).toBeVisible();

    await page.getByTestId(`duplicate-${id}`).click();
    await expect(boardCards(page)).toHaveCount(2);
    await expect(page.getByText('Roadmap copy')).toBeVisible();

    page.removeAllListeners('dialog');
    page.on('dialog', (dialog) => void dialog.accept('Archive'));
    await page.getByTestId('new-folder').click();
    await expect(page.getByRole('complementary').getByText('Archive')).toBeVisible();

    await page.getByTestId(`move-${id}`).click();
    await page.getByTestId(`move-to-${id}`).selectOption({ label: 'Archive' });
    await expect(page.getByTestId(`board-${id}`)).toHaveCount(0);
    await expect(boardCards(page)).toHaveCount(1);

    // All of it survives a reload, because it lives on the server.
    await page.reload();
    await expect(boardCards(page)).toHaveCount(1);
    await expect(page.getByText('Roadmap copy')).toBeVisible();

    await page.getByText('Archive').first().click();
    await expect(page.getByTestId(`board-${id}`)).toBeVisible();
    await expect(page.getByText('Roadmap', { exact: true })).toBeVisible();
  });

  // Checklist item 6.
  test('searches by title and filters by star', async ({ page }) => {
    await signIn(page, newAccount('find'));

    const first = await createBoard(page);
    await page.getByTestId('back-to-boards').click();
    page.on('dialog', (dialog) => void dialog.accept('Marketing plan'));
    await page.getByTestId(`rename-${first}`).click();
    await expect(page.getByText('Marketing plan')).toBeVisible();

    await page.getByTestId('new-board').click();
    await expect(page.getByTestId('board-canvas')).toBeVisible();
    await page.getByTestId('back-to-boards').click();
    await expect(boardCards(page)).toHaveCount(2);

    await page.getByTestId('search').fill('marketing');
    await expect(boardCards(page)).toHaveCount(1);
    await page.getByTestId('search').fill('');

    await page.getByTestId(`star-${first}`).click();
    await expect(page.getByTestId(`star-${first}`)).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('nav-starred').click();
    await expect(boardCards(page)).toHaveCount(1);
  });

  // Checklist item 7.
  test('deletes to the trash and restores', async ({ page }) => {
    await signIn(page, newAccount('trash'));
    const id = await createBoard(page);
    await page.getByTestId('back-to-boards').click();

    await page.getByTestId(`trash-${id}`).click();
    await expect(boardCards(page)).toHaveCount(0);

    await page.getByTestId('nav-trash').click();
    await expect(page.getByTestId(`board-${id}`)).toBeVisible();

    await page.getByTestId(`restore-${id}`).click();
    await page.getByTestId('nav-all').click();
    await expect(page.getByTestId(`board-${id}`)).toBeVisible();
  });
});

test.describe('board content', () => {
  // Checklist item 3.
  test('saves what you drew and shows it as a thumbnail', async ({ page }) => {
    await signIn(page, newAccount('draw'));
    const id = await createBoard(page);

    await drawRectangle(page, [360, 300], [520, 420]);
    await drawRectangle(page, [560, 300], [700, 420]);

    await page.getByTestId('back-to-boards').click();
    await expect(boardCards(page)).toHaveCount(1);

    // The thumbnail is written with the snapshot, so it appears after the save lands.
    await expectThumbnailLoaded(page, id);

    // And it survives a reload, which is when it has to come from the server alone.
    await page.reload();
    await expectThumbnailLoaded(page, id);

    // A duplicate shows the same picture straight away, not an empty card.
    await page.getByTestId(`duplicate-${id}`).click();
    await expect(boardCards(page)).toHaveCount(2);
    const copy = (
      await boardCards(page).evaluateAll((cards) => cards.map((card) => card.dataset.testid))
    )
      .map((testId) => testId!.replace('board-', ''))
      .find((cardId) => cardId !== id)!;
    await expectThumbnailLoaded(page, copy);
  });

  // Checklist item 4 — the gate. A second browser is a second device.
  test('the same account finds its boards from somewhere else', async ({ page, browser }) => {
    const account = newAccount('device');
    await signIn(page, account);
    const id = await createBoard(page);
    await drawRectangle(page, [360, 300], [540, 430]);

    // Leaving the board flushes whatever has not been sent.
    await page.getByTestId('back-to-boards').click();
    await expectThumbnailLoaded(page, id);

    const elsewhere = await browser.newContext();
    const second = await elsewhere.newPage();
    await signIn(second, account);

    await expect(second.getByTestId(`board-${id}`)).toBeVisible();
    await second.goto(`/b/${id}`);
    await expect(second.getByTestId('board-canvas')).toBeVisible();

    // The drawing came with it.
    await expect
      .poll(() => second.getByTestId('layers').locator('li').count(), { timeout: 15_000 })
      .toBe(1);

    await elsewhere.close();
  });
});

// Checklist item 8 — the gate.
test.describe('access', () => {
  test('a stranger is asked to sign in, not shown the board', async ({ page, browser }) => {
    const owner = newAccount('owner');
    await signIn(page, owner);
    const id = await createBoard(page);
    await drawRectangle(page, [360, 300], [520, 420]);
    await page.getByTestId('back-to-boards').click();

    // Nobody at all.
    const anonymous = await browser.newContext();
    const guest = await anonymous.newPage();
    await guest.goto(`/b/${id}`);
    await expect(guest.getByTestId('sign-in')).toBeVisible();
    await expect(guest.getByTestId('board-canvas')).toHaveCount(0);
    await anonymous.close();

    // And a different signed-in account cannot reach it either.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await signIn(otherPage, newAccount('intruder'));
    await otherPage.goto(`/b/${id}`);
    await expect(otherPage.getByTestId('board-missing')).toBeVisible();
    await other.close();
  });

  test('the API refuses a request with no token at all', async ({ request }) => {
    const response = await request.get('http://localhost:8788/api/workspace');
    expect(response.status()).toBe(401);
  });

  test('the API refuses a token it did not sign', async ({ request }) => {
    // Correctly shaped, correct claims, signed by someone else entirely.
    const response = await request.get('http://localhost:8788/api/workspace', {
      headers: { authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJldmlsIn0.not-a-signature' },
    });
    expect(response.status()).toBe(401);
  });

  test('one account cannot read another account board over the API', async ({ request }) => {
    const owner = newAccount('api-owner');
    const ownerToken = await tokenFor(owner);

    const created = await request.post('http://localhost:8788/api/boards', {
      headers: { authorization: `Bearer ${ownerToken}` },
      data: { title: 'Private', folderId: null },
    });
    const { board } = (await created.json()) as { board: { id: string } };

    const intruderToken = await tokenFor(newAccount('api-intruder'));
    const stolen = await request.get(`http://localhost:8788/api/boards/${board.id}/snapshot`, {
      headers: { authorization: `Bearer ${intruderToken}` },
    });
    expect(stolen.status()).toBe(404);
  });
});
