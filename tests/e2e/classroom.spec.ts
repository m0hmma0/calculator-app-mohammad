import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { API, createBoard, newAccount, signIn, tokenFor } from './accounts';

/**
 * Phase 14 with other people, on the real Worker and the board's real room: the
 * Answer role — placeholders and nothing else, the room the judge — and locks that
 * bind everyone but the owner.
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

const close = async (...contexts: BrowserContext[]) => {
  for (const context of contexts) await context.close();
};

async function drawRect(page: Page, from: [number, number], to: [number, number]) {
  await page.keyboard.press('KeyR');
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 4 });
  await page.mouse.up();
}

async function shareWith(owner: Page, someone: Account, role: string) {
  await owner.getByTestId('open-share').click();
  await owner.getByTestId('person-email').fill(emailOf(someone));
  await owner.getByTestId('person-role').selectOption(role);
  await owner.getByTestId('add-person').click();
  await expect(owner.getByTestId('person-row')).toHaveCount(1);
  await owner.getByTestId('close-share').click();
}

async function openAs(page: Page, boardId: string) {
  await page.goto(`/b/${boardId}`);
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');
}

/** The board as the room last saved it, read back through the owner's API. */
async function saved(account: Account, boardId: string): Promise<Y.Doc> {
  const response = await fetch(`${API}/api/boards/${boardId}/snapshot`, {
    headers: { authorization: `Bearer ${await tokenFor(account)}` },
  });
  const doc = new Y.Doc();
  if (response.status === 200) Y.applyUpdate(doc, new Uint8Array(await response.arrayBuffer()));
  return doc;
}

const elementsOf = (doc: Y.Doc) => [...doc.getMap('elements').values()] as Array<Y.Map<unknown>>;
const textOf = (map: Y.Map<unknown> | undefined) => String(map?.get('text') ?? '');

/** Finds the board's placeholder on screen: where the pointer turns to "type here". */
async function findPlaceholder(page: Page) {
  const stage = (await page.getByTestId('stage').boundingBox())!;
  for (let y = stage.y + 30; y < stage.y + stage.height - 30; y += 30) {
    for (let x = stage.x + 30; x < stage.x + stage.width - 30; x += 30) {
      await page.mouse.move(x, y);
      if ((await page.getByTestId('stage').getAttribute('data-cursor')) === 'text') return { x, y };
    }
  }
  throw new Error('No placeholder on screen');
}

/** Sends a change straight to the room as this person, the way DevTools could. */
async function sendByHand(page: Page, boardId: string, token: string, update: Uint8Array) {
  return page.evaluate(
    async ({ id, token: key, bytes }) =>
      new Promise<string>((resolve) => {
        const socket = new WebSocket(`ws://${location.host}/api/boards/${id}/room`);
        socket.onopen = () => socket.send(JSON.stringify({ t: 'auth', token: key }));
        socket.onmessage = (event) => {
          if (typeof event.data !== 'string') return;
          const message = JSON.parse(event.data) as { t: string; code?: string };
          if (message.t === 'ready') socket.send(new Uint8Array([2, ...bytes]));
          if (message.t === 'error') resolve(message.code ?? 'error');
          if (message.t === 'ack') resolve('ack');
        };
        setTimeout(() => resolve('no answer'), 5000);
      }),
    { id: boardId, token, bytes: [...update] },
  );
}

test.describe('the Answer role', () => {
  // Checklist items 2 and 3 — item 3 is the gate.
  test('types in placeholders and nothing else; the room refuses anything else sent by hand', async ({
    browser,
  }) => {
    const teacher = await person(browser, 'teacher');
    const boardId = await createBoard(teacher.page);
    await drawRect(teacher.page, [900, 500], [1000, 580]);
    await teacher.page.getByTestId('insert-menu').click();
    await teacher.page.getByTestId('insert-placeholder').click();
    await teacher.page.mouse.click(400, 200);
    await teacher.page.getByTestId('placeholder-hint').fill('Your answer');
    await expect(layers(teacher.page)).toHaveCount(2);

    const student = await person(browser, 'student');
    await shareWith(teacher.page, student.account, 'answer');
    await openAs(student.page, boardId);
    await expect(student.page.getByText('Can answer')).toBeVisible();
    // The tools of someone who looks: the hand and the laser; no Insert, no panel.
    await expect(student.page.locator('[role="toolbar"] button')).toHaveCount(2);
    await expect(student.page.getByTestId('insert-menu')).toHaveCount(0);

    // One click into the placeholder, with the hand they hold, and they type.
    const spot = await findPlaceholder(student.page);
    await student.page.mouse.click(spot.x, spot.y);
    await expect(student.page.getByTestId('text-editor')).toBeVisible();
    await student.page.keyboard.type('Forty-two');
    await student.page.keyboard.press('Escape');

    // It reaches the room, and the teacher.
    await expect
      .poll(async () =>
        textOf(
          elementsOf(await saved(teacher.account, boardId)).find((each) => each.has('placeholder')),
        ),
      )
      .toBe('Forty-two');

    // The gate. Straight to the room: moving the rectangle is refused…
    const doc = await saved(teacher.account, boardId);
    const rect = elementsOf(doc).find((each) => each.get('type') === 'rect')!;
    const placeholder = elementsOf(doc).find((each) => each.has('placeholder'))!;
    const forger = new Y.Doc();
    Y.applyUpdate(forger, Y.encodeStateAsUpdate(doc));
    const theirs = (id: unknown) => forger.getMap('elements').get(String(id)) as Y.Map<unknown>;
    theirs(rect.get('id')).set('x', 5000);
    const move = Y.encodeStateAsUpdate(forger, Y.encodeStateVector(doc));
    const token = await tokenFor(student.account);
    expect(await sendByHand(student.page, boardId, token, move)).toBe('read-only');

    // …while words typed in the placeholder, sent the same way, are taken.
    const writer = new Y.Doc();
    Y.applyUpdate(writer, Y.encodeStateAsUpdate(doc));
    const words = (
      writer.getMap('elements').get(String(placeholder.get('id'))) as Y.Map<unknown>
    ).get('text') as Y.Text;
    words.insert(words.length, '!');
    const answer = Y.encodeStateAsUpdate(writer, Y.encodeStateVector(doc));
    expect(await sendByHand(student.page, boardId, token, answer)).toBe('ack');

    await expect
      .poll(async () =>
        textOf(
          elementsOf(await saved(teacher.account, boardId)).find((each) => each.has('placeholder')),
        ),
      )
      .toBe('Forty-two!');
    const after = elementsOf(await saved(teacher.account, boardId)).find(
      (each) => each.get('type') === 'rect',
    )!;
    expect(after.get('x')).toBe(rect.get('x'));

    await close(teacher.context, student.context);
  });
});

test.describe('locks', () => {
  // Checklist items 4 and 5.
  test('bind everyone but the owner; locked things select, and unlock together', async ({
    browser,
  }) => {
    const owner = await person(browser, 'lockowner');
    const boardId = await createBoard(owner.page);
    await drawRect(owner.page, [300, 250], [400, 330]);
    await drawRect(owner.page, [500, 250], [600, 330]);
    await owner.page.keyboard.press('ControlOrMeta+KeyA');
    await owner.page.keyboard.press('Shift+ControlOrMeta+KeyL');
    await expect(owner.page.getByTestId('layer-locked')).toHaveCount(2);

    // The owner moves a locked one freely.
    await owner.page.mouse.click(800, 600);

    await owner.page.mouse.move(350, 290);
    await owner.page.mouse.down();
    await owner.page.mouse.move(350, 400, { steps: 5 });
    await owner.page.mouse.up();
    await expect(owner.page.getByTestId('geo-y')).toHaveText(/^3\d\d$/);

    const helper = await person(browser, 'lockhelper');
    await shareWith(owner.page, helper.account, 'editor');
    await openAs(helper.page, boardId);
    await expect(layers(helper.page)).toHaveCount(2);
    // The board opens fitted; take the shapes where they are now.
    await helper.page.keyboard.press('Shift+Digit0');
    const stage = (await helper.page.getByTestId('stage').boundingBox())!;

    // Someone else cannot move them by accident: a click selects, a drag does nothing.
    await helper.page.keyboard.press('KeyV');
    await helper.page.mouse.move(stage.x + 2, stage.y + 2);
    await helper.page.mouse.down();
    await helper.page.mouse.move(stage.x + stage.width - 10, stage.y + stage.height - 10, {
      steps: 6,
    });
    await helper.page.mouse.up();
    // A box dragged over both: both selected, locked as they are.
    await expect(helper.page.getByTestId('inspector')).toContainText('2 selected');
    const before = await helper.page.getByTestId('geo-x').innerText();
    await helper.page.keyboard.press('ArrowRight');
    await helper.page.keyboard.press('Delete');
    await expect(layers(helper.page)).toHaveCount(2);
    await expect(helper.page.getByTestId('geo-x')).toHaveText(before);

    // They may not lock — that is the owner's — but they may unlock, both at once.
    await helper.page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height - 5, {
      button: 'right',
    });
    await expect(helper.page.getByTestId('context-menu')).toBeVisible();
    await expect(helper.page.getByTestId('menu-unlock')).toBeVisible();
    await expect(helper.page.getByTestId('menu-lock')).toHaveCount(0);
    await helper.page.keyboard.press('Escape');
    await helper.page.mouse.move(stage.x + 2, stage.y + 2);
    await helper.page.mouse.down();
    await helper.page.mouse.move(stage.x + stage.width - 10, stage.y + stage.height - 10, {
      steps: 6,
    });
    await helper.page.mouse.up();
    await expect(helper.page.getByTestId('toggle-lock')).toHaveText('unlock');
    await helper.page.getByTestId('toggle-lock').click();
    await expect(owner.page.getByTestId('layer-locked')).toHaveCount(0);
    await expect(helper.page.getByTestId('toggle-lock')).toHaveCount(0);

    await close(owner.context, helper.context);
  });
});
