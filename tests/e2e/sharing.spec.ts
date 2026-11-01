import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { API, createBoard, newAccount, signIn, tokenFor } from './accounts';

/**
 * Phase 8: sharing. Every test runs the real Worker and the board's real room, with
 * separate browser contexts standing in for separate people and devices.
 */

type Account = ReturnType<typeof newAccount>;
const emailOf = (account: Account) => `${account.uid}@example.test`;
const layers = (page: Page) => page.getByTestId('layers').locator('li');

async function person(browser: Browser, label: string) {
  const account = newAccount(label);
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, account);
  return { account, context, page };
}

async function guest(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

async function drawRect(page: Page, from: [number, number], to: [number, number]) {
  await page.keyboard.press('KeyR');
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 4 });
  await page.mouse.up();
}

async function openShare(page: Page) {
  await page.getByTestId('open-share').click();
  await expect(page.getByTestId('share-dialog')).toBeVisible();
}

async function closeShare(page: Page) {
  await page.getByTestId('close-share').click();
  await expect(page.getByTestId('share-dialog')).toHaveCount(0);
}

/**
 * Sets the board's link from the share dialog — on, for anyone, to view unless a role
 * is given — and returns it. A new board's link is already on (for answering).
 */
async function enableLink(page: Page, role = 'viewer') {
  const toggle = page.getByTestId('link-enabled');
  await expect(toggle).toBeVisible();
  if (!(await toggle.isChecked())) await toggle.click();
  await page.getByTestId('link-role').selectOption(role);
  await expect(page.getByTestId('link-role')).toHaveValue(role);
  const field = page.getByTestId('link-url');
  await expect(field).toHaveValue(/\/s\/[\w-]+$/);
  return field.inputValue();
}

/** Follows a share link as a guest, giving a name when asked. */
async function followAsGuest(page: Page, url: string, name: string) {
  await page.goto(url);
  await page.getByTestId('guest-name').fill(name);
  await page.getByTestId('guest-continue').click();
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');
}

/** Ink on the canvas inside a page rectangle — what a viewer sees, with no inspector. */
async function inkIn(page: Page, area: { x: number; y: number; w: number; h: number }) {
  return page.evaluate((region) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="board-canvas"]')!;
    const bounds = canvas.getBoundingClientRect();
    const dpr = canvas.width / bounds.width;
    const probe = document.createElement('canvas').getContext('2d')!;
    probe.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue('--canvas-bg')
      .trim();
    probe.fillRect(0, 0, 1, 1);
    const [br, bg, bb] = probe.getImageData(0, 0, 1, 1).data;
    const data = canvas
      .getContext('2d')!
      .getImageData(
        Math.round((region.x - bounds.left) * dpr),
        Math.round((region.y - bounds.top) * dpr),
        Math.round(region.w * dpr),
        Math.round(region.h * dpr),
      ).data;
    let ink = 0;
    for (let index = 0; index < data.length; index += 4) {
      const distance =
        Math.abs(data[index]! - br!) +
        Math.abs(data[index + 1]! - bg!) +
        Math.abs(data[index + 2]! - bb!);
      if (distance > 90) ink += 1;
    }
    return ink / (data.length / 4);
  }, area);
}

/** The board as the room last saved it, read back through the owner's API. */
async function savedElementIds(account: Account, boardId: string) {
  const response = await fetch(`${API}/api/boards/${boardId}/snapshot`, {
    headers: { authorization: `Bearer ${await tokenFor(account)}` },
  });
  if (response.status === 204) return [];
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(await response.arrayBuffer()));
  return [...doc.getMap('elements').keys()].sort();
}

async function ownerWithBoard(browser: Browser, label: string) {
  const owner = await person(browser, label);
  const boardId = await createBoard(owner.page);
  await drawRect(owner.page, [380, 300], [520, 400]);
  await expect(layers(owner.page)).toHaveCount(1);
  return { ...owner, boardId };
}

const close = async (...contexts: BrowserContext[]) => {
  for (const context of contexts) await context.close();
};

test.describe('a new board', () => {
  // Phase 14.1, checklist item 9.
  test('is shared for answering from the start, and its link still turns off', async ({
    browser,
  }) => {
    const owner = await ownerWithBoard(browser, 'answerdefault');
    await openShare(owner.page);
    const toggle = owner.page.getByTestId('link-enabled');
    await expect(toggle).toBeChecked();
    await expect(owner.page.getByTestId('link-audience')).toHaveValue('anyone');
    await expect(owner.page.getByTestId('link-role')).toHaveValue('answer');
    await expect(owner.page.getByTestId('audit-log')).toContainText(
      'link on: anyone with the link can answer',
    );
    const url = await owner.page.getByTestId('link-url').inputValue();
    await closeShare(owner.page);

    // Whoever has it may answer, and nothing more.
    const visitor = await guest(browser);
    await followAsGuest(visitor.page, url, 'Ada');
    await expect(visitor.page.getByText('Can answer')).toBeVisible();

    // Off, as before: the link stops working.
    await openShare(owner.page);
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(visitor.page.getByTestId('board-missing')).toBeVisible({ timeout: 5000 });
    await close(owner.context, visitor.context);
  });
});

test.describe('a link anyone can view', () => {
  // Checklist items 1 and 2 — item 2 is the gate.
  test('a guest sees the board, cannot change it, and the room refuses an edit sent by hand', async ({
    browser,
  }) => {
    const owner = await ownerWithBoard(browser, 'linkowner');
    await openShare(owner.page);
    const url = await enableLink(owner.page);
    await closeShare(owner.page);

    // 1. A private window — no account — is asked for a name and then sees the board.
    const visitor = await guest(browser);
    await followAsGuest(visitor.page, url, 'Gina');
    await expect(visitor.page.getByTestId('board-title')).toHaveText('Untitled board');
    await expect
      .poll(() => inkIn(visitor.page, { x: 400, y: 320, w: 100, h: 60 }))
      .toBeGreaterThan(0.5);
    // The owner sees who that is.
    await expect(owner.page.getByTestId('peer-avatar')).toHaveAttribute('title', /Gina \(guest\)/);

    // 2. The tools to change anything are not offered — a viewer has the hand and
    // the laser, and nothing to select…
    await expect(visitor.page.locator('[role="toolbar"] button')).toHaveCount(2);
    await expect(visitor.page.getByTestId('tool-hand')).toHaveAttribute('aria-pressed', 'true');
    await expect(visitor.page.getByTestId('inspector')).toHaveCount(0);
    // …and the keys do nothing either.
    await drawRect(visitor.page, [600, 450], [700, 520]);
    await visitor.page.keyboard.press('ControlOrMeta+KeyA');
    await visitor.page.keyboard.press('Delete');
    await expect(layers(owner.page)).toHaveCount(1);

    // The real test: an edit sent straight over the socket, the way DevTools could.
    const evil = new Y.Doc();
    const element = new Y.Map<unknown>();
    evil.getMap('elements').set('smuggled', element);
    element.set('id', 'smuggled');
    const update = [...Y.encodeStateAsUpdate(evil)];
    const token = url.split('/s/')[1]!;
    const boardId = owner.boardId;
    const answer = await visitor.page.evaluate(
      async ({ boardId: id, token: link, update: bytes }) =>
        new Promise<string>((resolve) => {
          const socket = new WebSocket(`ws://${location.host}/api/boards/${id}/room`);
          socket.onopen = () => socket.send(JSON.stringify({ t: 'auth', token: '', link }));
          socket.onmessage = (event) => {
            if (typeof event.data !== 'string') return;
            const message = JSON.parse(event.data) as { t: string; code?: string };
            if (message.t === 'ready') socket.send(new Uint8Array([2, ...bytes]));
            if (message.t === 'error') resolve(message.code ?? 'error');
          };
          setTimeout(() => resolve('no answer'), 5000);
        }),
      { boardId, token, update },
    );
    expect(answer).toBe('read-only');

    // Nobody received it and nothing stored it.
    await owner.page.waitForTimeout(2500);
    await expect(layers(owner.page)).toHaveCount(1);
    expect(await savedElementIds(owner.account, owner.boardId)).not.toContain('smuggled');

    await close(owner.context, visitor.context);
  });
});

test.describe('links in the words', () => {
  test('someone who can only look opens a link with a click, hand and all', async ({ browser }) => {
    const owner = await person(browser, 'linkwords');
    await createBoard(owner.page);
    await owner.page.keyboard.press('KeyT');
    await owner.page.mouse.move(300, 200);
    await owner.page.mouse.down();
    await owner.page.mouse.move(800, 250, { steps: 4 });
    await owner.page.mouse.up();
    await owner.page.keyboard.type('page');
    await owner.page.keyboard.press('Shift+Home');
    await owner.page.keyboard.press('ControlOrMeta+KeyK');
    await owner.page.getByTestId('link-input').fill('example.com/for-guests');
    await owner.page.keyboard.press('Enter');
    await owner.page.keyboard.press('Escape');
    await openShare(owner.page);
    const url = await enableLink(owner.page);
    await closeShare(owner.page);

    const visitor = await guest(browser);
    await visitor.context.route('https://example.com/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>example</title>' }),
    );
    await followAsGuest(visitor.page, url, 'Lin');
    await expect(visitor.page.getByTestId('tool-hand')).toHaveAttribute('aria-pressed', 'true');

    // The board opens fitted to the one line of words: find the link along it, as a
    // person would — the hand turns into a pointer over it.
    const stage = (await visitor.page.getByTestId('stage').boundingBox())!;
    const y = stage.y + stage.height / 2;
    let found: number | null = null;
    for (let x = stage.x + 10; x < stage.x + stage.width; x += 15) {
      await visitor.page.mouse.move(x, y);
      if ((await visitor.page.getByTestId('stage').getAttribute('data-cursor')) === 'pointer') {
        found = x;
        break;
      }
    }
    expect(found).not.toBeNull();
    const opened = visitor.context.waitForEvent('page');
    await visitor.page.mouse.click(found!, y);
    await (await opened).waitForURL('https://example.com/for-guests');

    await close(owner.context, visitor.context);
  });
});

test.describe('what each role sees', () => {
  test('a viewer: the hand, the laser and zoom; no Present, Tools, Insert, select or minimap', async ({
    browser,
  }) => {
    const owner = await ownerWithBoard(browser, 'seeowner');
    const viewer = await person(browser, 'seeviewer');
    const editor = await person(browser, 'seeeditor');
    await openShare(owner.page);
    for (const [index, [who, role]] of [
      [viewer, 'viewer'],
      [editor, 'editor'],
    ].entries() as IterableIterator<[number, [typeof viewer, string]]>) {
      await owner.page.getByTestId('person-email').fill(emailOf(who.account));
      await owner.page.getByTestId('person-role').selectOption(role);
      await owner.page.getByTestId('add-person').click();
      // Each is saved before the next is added.
      await expect(owner.page.getByTestId('person-row')).toHaveCount(index + 1);
    }
    await closeShare(owner.page);

    // The owner has everything.
    for (const id of ['tool-select', 'insert-menu', 'tools-menu', 'spotlight', 'view-minimap']) {
      await expect(owner.page.getByTestId(id)).toBeVisible();
    }

    await viewer.page.goto(`/b/${owner.boardId}`);
    await expect(viewer.page.getByTestId('connection-status')).toHaveAttribute(
      'data-status',
      'connected',
    );
    for (const id of ['tool-hand', 'tool-laser', 'zoom-readout']) {
      await expect(viewer.page.getByTestId(id)).toBeVisible();
    }
    for (const id of ['tool-select', 'insert-menu', 'tools-menu', 'spotlight', 'view-minimap']) {
      await expect(viewer.page.getByTestId(id)).toHaveCount(0);
    }
    // M does not bring the minimap, and a right-click offers nothing.
    await viewer.page.mouse.move(600, 500);
    await viewer.page.keyboard.press('KeyM');
    await expect(viewer.page.getByTestId('minimap')).toHaveCount(0);
    await viewer.page.mouse.click(600, 500, { button: 'right' });
    await expect(viewer.page.getByTestId('context-menu')).toHaveCount(0);

    // An editor has Insert and Tools, but presenting and the minimap stay the owner's.
    await editor.page.goto(`/b/${owner.boardId}`);
    await expect(editor.page.getByTestId('connection-status')).toHaveAttribute(
      'data-status',
      'connected',
    );
    for (const id of ['tool-select', 'insert-menu', 'tools-menu']) {
      await expect(editor.page.getByTestId(id)).toBeVisible();
    }
    // The board opened read-only until the role was known; an editor then selects.
    await expect(editor.page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
    for (const id of ['spotlight', 'view-minimap']) {
      await expect(editor.page.getByTestId(id)).toHaveCount(0);
    }
    await editor.page.getByTestId('insert-menu').click();
    await expect(editor.page.getByTestId('insert-tool-text')).toBeVisible();
    await expect(editor.page.getByTestId('present-start')).toHaveCount(0);
    await expect(editor.page.getByTestId('toggle-minimap')).toHaveCount(0);

    await close(owner.context, viewer.context, editor.context);
  });
});

test.describe('people and links together', () => {
  // Checklist item 3.
  test('a named editor can edit while the public link still only views', async ({ browser }) => {
    const owner = await ownerWithBoard(browser, 'mixowner');
    const bob = await person(browser, 'mixbob');

    await openShare(owner.page);
    const url = await enableLink(owner.page);
    await owner.page.getByTestId('person-email').fill(emailOf(bob.account));
    await owner.page.getByTestId('person-role').selectOption('editor');
    await owner.page.getByTestId('add-person').click();
    await expect(owner.page.getByTestId('person-row')).toHaveAttribute(
      'data-email',
      emailOf(bob.account),
    );
    await closeShare(owner.page);

    // Bob opens it from "Shared with me" and edits.
    await bob.page.goto('/');
    await bob.page.getByTestId('nav-shared').click();
    await bob.page.getByTestId(`shared-item-${owner.boardId}`).getByRole('link').first().click();
    await expect(bob.page.getByTestId('connection-status')).toHaveAttribute(
      'data-status',
      'connected',
    );
    await drawRect(bob.page, [600, 300], [700, 380]);
    await expect(layers(owner.page)).toHaveCount(2);

    // The link is still view-only.
    const visitor = await guest(browser);
    await followAsGuest(visitor.page, url, 'Vic');
    await expect(visitor.page.getByTestId('board-title')).toBeVisible();
    await drawRect(visitor.page, [300, 500], [380, 560]);
    await expect(layers(owner.page)).toHaveCount(2);

    // Bob was told it was shared with him.
    await bob.page.goto('/');
    await expect(bob.page.getByTestId('notifications-unread')).toHaveText(/[1-9]/);

    await close(owner.context, bob.context, visitor.context);
  });

  // Checklist item 4.
  test('a link for signed-in people asks a stranger to sign in', async ({ browser }) => {
    const owner = await ownerWithBoard(browser, 'signedowner');
    await openShare(owner.page);
    const url = await enableLink(owner.page);
    await owner.page.getByTestId('link-audience').selectOption('signed-in');
    await expect(owner.page.getByTestId('link-audience')).toHaveValue('signed-in');
    await closeShare(owner.page);

    const visitor = await guest(browser);
    await visitor.page.goto(url);
    await expect(visitor.page.getByTestId('sign-in')).toBeVisible();
    await expect(visitor.page.getByTestId('sign-in-message')).toHaveText('Sign in to open this');
    await expect(visitor.page.getByTestId('board-canvas')).toHaveCount(0);

    // Signed in, the same link opens it.
    const carol = await person(browser, 'signedcarol');
    await carol.page.goto(url);
    await expect(carol.page.getByTestId('board-canvas')).toBeVisible();

    await close(owner.context, visitor.context, carol.context);
  });
});

test.describe('folders', () => {
  // Checklist items 5 and 6.
  test('sharing a folder covers every board in it — even later ones — and a board can override it', async ({
    browser,
  }) => {
    const owner = await person(browser, 'folderowner');
    const bob = await person(browser, 'folderbob');

    owner.page.on('dialog', (dialog) => void dialog.accept('Team'));
    await owner.page.getByTestId('new-folder').click();
    await owner.page.getByText('Team').first().click();
    const first = await createBoard(owner.page);
    await owner.page.getByTestId('back-to-boards').click();

    await owner.page.getByTestId('share-folder').click();
    await owner.page.getByTestId('person-email').fill(emailOf(bob.account));
    await owner.page.getByTestId('person-role').selectOption('editor');
    await owner.page.getByTestId('add-person').click();
    await expect(owner.page.getByTestId('person-row')).toHaveCount(1);
    await owner.page.getByTestId('close-share').click();

    // A board made after the folder was shared.
    const later = await createBoard(owner.page);
    await owner.page.getByTestId('back-to-boards').click();

    // 5. Bob finds the folder under "Shared with me", and both boards open editable.
    await bob.page.getByTestId('nav-shared').click();
    await expect(bob.page.getByTestId(/^shared-item-/)).toHaveCount(1);
    await bob.page.getByRole('link', { name: 'Team' }).first().click();
    await expect(bob.page.getByTestId('shared-folder')).toBeVisible();
    for (const id of [first, later]) {
      await bob.page.goto(`/b/${id}`);
      await expect(bob.page.getByTestId('connection-status')).toHaveAttribute(
        'data-status',
        'connected',
      );
      await expect(bob.page.getByTestId('inspector')).toBeVisible();
      await drawRect(bob.page, [400, 300], [480, 360]);
      await expect(layers(bob.page)).toHaveCount(1);
    }

    // 6. The owner makes one board view-only for Bob; the folder still says editor.
    await owner.page.getByTestId(`share-${first}`).click();
    await owner.page.getByTestId('person-email').fill(emailOf(bob.account));
    await owner.page.getByTestId('person-role').selectOption('viewer');
    await owner.page.getByTestId('add-person').click();
    await expect(owner.page.getByTestId('person-row')).toHaveCount(1);
    await owner.page.getByTestId('close-share').click();

    await bob.page.goto(`/b/${first}`);
    await expect(bob.page.getByTestId('board-title')).toBeVisible();
    await expect(bob.page.locator('header').getByText('Can view')).toBeVisible();
    await expect(bob.page.getByTestId('inspector')).toHaveCount(0);
    await bob.page.goto(`/b/${later}`);
    await expect(bob.page.locator('header').getByText('Can edit')).toBeVisible();

    await close(owner.context, bob.context);
  });
});

test.describe('ending access', () => {
  // Checklist item 7.
  test('an expired link stops working, and drops whoever is using it', async ({ browser }) => {
    const owner = await ownerWithBoard(browser, 'expiryowner');
    const auth = {
      authorization: `Bearer ${await tokenFor(owner.account)}`,
      'content-type': 'application/json',
    };
    // A few seconds rather than the dialog's shortest minute; the same code path.
    const response = await fetch(`${API}/api/shares/board/${owner.boardId}/link`, {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ role: 'viewer', audience: 'anyone', expiresInMinutes: 0.08 }),
    });
    const { link } = (await response.json()) as { link: { token: string } };

    const visitor = await guest(browser);
    await followAsGuest(visitor.page, `/s/${link.token}`, 'Eve');

    // Within seconds of the expiry, the open board goes and the link is dead.
    await expect(visitor.page.getByTestId('board-missing')).toBeVisible({ timeout: 15_000 });
    await visitor.page.goto(`/s/${link.token}`);
    await expect(visitor.page.getByTestId('link-dead')).toBeVisible();

    await close(owner.context, visitor.context);
  });

  // Checklist item 8.
  test('turning the link off drops someone who has the board open, within seconds', async ({
    browser,
  }) => {
    const owner = await ownerWithBoard(browser, 'revokeowner');
    await openShare(owner.page);
    const url = await enableLink(owner.page);

    const visitor = await guest(browser);
    await followAsGuest(visitor.page, url, 'Rex');

    await owner.page.getByTestId('link-enabled').click();
    await expect(visitor.page.getByTestId('board-missing')).toBeVisible({ timeout: 5000 });
    // And it stays gone: the old link does not come back to life.
    await owner.page.getByTestId('link-enabled').click();
    await visitor.page.goto(url);
    await expect(visitor.page.getByTestId('link-dead')).toBeVisible();

    await close(owner.context, visitor.context);
  });
});

test.describe('comments', () => {
  // Checklist item 9.
  test('a commenter comments and mentions; the person is notified; resolving hides it', async ({
    browser,
  }) => {
    const owner = await ownerWithBoard(browser, 'commentowner');
    const bob = await person(browser, 'commentbob');
    await openShare(owner.page);
    await owner.page.getByTestId('person-email').fill(emailOf(bob.account));
    await owner.page.getByTestId('person-role').selectOption('commenter');
    await owner.page.getByTestId('add-person').click();
    await expect(owner.page.getByTestId('person-row')).toHaveCount(1);
    await closeShare(owner.page);

    await bob.page.goto(`/b/${owner.boardId}`);
    await expect(bob.page.locator('header').getByText('Can comment')).toBeVisible();
    // A commenter cannot draw…
    await drawRect(bob.page, [600, 450], [700, 520]);
    await expect(layers(owner.page)).toHaveCount(1);

    // …nor open the Tools menu — but the right-click menu offers Comment, pinned
    // where it was opened, and the comment can mention the owner.
    await expect(bob.page.getByTestId('tools-menu')).toHaveCount(0);
    await bob.page.mouse.click(400, 300, { button: 'right' });
    await expect(bob.page.getByTestId('context-menu').getByRole('menuitem')).toHaveCount(1);
    await bob.page.getByTestId('menu-comment').click();
    await bob.page.getByTestId('comment-input').fill('What about this, @');
    await bob.page.getByTestId('mention-option').first().click();
    await expect(bob.page.getByTestId('comment-input')).toHaveValue(/@Person commentowner /);
    await bob.page.getByTestId('comment-input-submit').click();
    await expect(bob.page.getByTestId('comment-thread')).toHaveCount(1);

    // The owner's open board shows it straight away.
    await owner.page.getByTestId('tools-menu').click();
    await owner.page.getByTestId('open-comments').click();
    await expect(owner.page.getByTestId('comment-thread')).toContainText('What about this');
    await expect(owner.page.getByTestId('comment-pin')).toHaveCount(1);

    // And the owner was notified of the mention.
    await owner.page.getByTestId('back-to-boards').click();
    await owner.page.getByTestId('notifications').click();
    await expect(
      owner.page.getByTestId('notification-item').filter({ hasText: 'mentioned you' }),
    ).toHaveCount(1);
    await owner.page.getByTestId('notification-item').first().getByRole('link').click();

    // Resolving hides the thread; it can still be shown.
    await owner.page.getByTestId('tools-menu').click();
    await owner.page.getByTestId('open-comments').click();
    await owner.page.getByTestId('resolve-thread').click();
    await expect(owner.page.getByTestId('comment-thread')).toHaveCount(0);
    await expect(owner.page.getByTestId('comment-pin')).toHaveCount(0);
    await owner.page.getByTestId('show-resolved').check();
    await expect(owner.page.getByTestId('comment-thread')).toHaveAttribute('data-resolved', 'true');

    await close(owner.context, bob.context);
  });
});

test.describe('owner controls', () => {
  // Checklist item 10.
  test('turning off export for viewers removes it from their menu and the API refuses', async ({
    browser,
  }) => {
    const owner = await ownerWithBoard(browser, 'exportowner');
    await openShare(owner.page);
    const url = await enableLink(owner.page);
    const token = url.split('/s/')[1]!;

    const visitor = await guest(browser);
    await followAsGuest(visitor.page, url, 'Xan');
    const exportOffered = async () => {
      await visitor.page.keyboard.press('ControlOrMeta+KeyK');
      await visitor.page.keyboard.type('export');
      const count = await visitor.page.getByTestId('command-export-png').count();
      await visitor.page.keyboard.press('Escape');
      return count;
    };
    expect(await exportOffered()).toBe(1);
    const snapshot = () =>
      fetch(`${API}/api/boards/${owner.boardId}/snapshot`, { headers: { 'x-share-key': token } });
    expect((await snapshot()).status).not.toBe(403);

    await owner.page.getByTestId('viewer-export').click();
    await expect(owner.page.getByTestId('viewer-export')).not.toBeChecked();

    // The open board hears about it at once.
    await expect.poll(exportOffered).toBe(0);
    expect((await snapshot()).status).toBe(403);

    await close(owner.context, visitor.context);
  });

  // Checklist items 11 and 12.
  test('ownership moves to another account, and every change is in the activity log', async ({
    browser,
  }) => {
    const owner = await ownerWithBoard(browser, 'transferowner');
    const bob = await person(browser, 'transferbob');

    await openShare(owner.page);
    await enableLink(owner.page);
    await owner.page.getByTestId('link-role').selectOption('commenter');
    await expect(owner.page.getByTestId('link-role')).toHaveValue('commenter');
    await owner.page.getByTestId('person-email').fill(emailOf(bob.account));
    await owner.page.getByTestId('add-person').click();
    await expect(owner.page.getByTestId('person-row')).toHaveCount(1);

    // 12. Every change so far, with who did it.
    const log = owner.page.getByTestId('audit-log');
    await expect(log).toContainText('link on');
    await expect(log).toContainText('link changed');
    await expect(log).toContainText(`person added`);
    await expect(log).toContainText(emailOf(owner.account));

    // 11. Hand it to Bob.
    owner.page.on('dialog', (dialog) => void dialog.accept());
    await owner.page.getByTestId('transfer-email').fill(emailOf(bob.account));
    await owner.page.getByTestId('transfer-submit').click();
    await expect(owner.page.getByTestId('share-dialog')).toHaveCount(0);

    // The former owner keeps editing but no longer manages sharing.
    await expect(owner.page.locator('header').getByText('Can edit')).toBeVisible();
    await owner.page.reload();
    await expect(owner.page.getByTestId('board-canvas')).toBeVisible();
    await expect(owner.page.getByTestId('open-share')).toHaveCount(0);

    // Bob now owns it: it is among his own boards, and he can manage sharing.
    await bob.page.goto('/');
    await expect(bob.page.getByTestId(`board-${owner.boardId}`)).toBeVisible();
    await bob.page.goto(`/b/${owner.boardId}`);
    await openShare(bob.page);
    await expect(bob.page.getByTestId('audit-log')).toContainText('ownership');
    await expect(bob.page.getByTestId('person-row')).toHaveAttribute(
      'data-email',
      emailOf(owner.account),
    );

    await close(owner.context, bob.context);
  });
});
