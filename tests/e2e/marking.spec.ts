import { expect, test, type Page } from '@playwright/test';

/**
 * Marking things up: colours and highlights on words, links, a text box's fill, the
 * highlighter, and straight lines drawn with Shift held.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board-canvas')).toBeVisible();
});

const editor = (page: Page) => page.getByTestId('text-editor');
const geo = async (page: Page) => ({
  x: Number(await page.getByTestId('geo-x').innerText()),
  y: Number(await page.getByTestId('geo-y').innerText()),
  w: Number(await page.getByTestId('geo-w').innerText()),
  h: Number(await page.getByTestId('geo-h').innerText()),
});

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 8 });
  await page.mouse.up();
}

/** A text box dragged out at the top left, with these words typed in it. */
async function box(page: Page, words: string) {
  await page.keyboard.press('KeyT');
  await drag(page, [150, 150], [900, 300]);
  await page.keyboard.type(words);
}

/** Selects characters [from, to) of the box's first line with the keyboard. */
async function selectChars(page: Page, from: number, to: number) {
  await page.keyboard.press('Home');
  for (let step = 0; step < from; step += 1) await page.keyboard.press('ArrowRight');
  for (let step = from; step < to; step += 1) await page.keyboard.press('Shift+ArrowRight');
}

/** The box's runs as the editor shows them, with their colour, highlight and link. */
const runs = (page: Page) =>
  editor(page).evaluate((node) =>
    [...node.childNodes]
      .filter((child) => child.textContent)
      .map((child) => {
        const element = child instanceof HTMLElement ? child : null;
        return {
          text: child.textContent,
          color: element?.dataset.color ?? null,
          highlight: element?.dataset.highlight ?? null,
          link: element?.dataset.link ?? null,
        };
      }),
  );

/** How much of an area of the canvas is close to a colour (a CSS colour or a token). */
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
        if (distance < 60) near += 1;
      }
      return near / (data.length / 4);
    },
    [colour, area] as const,
  );
}

test.describe('colour and highlight on words', () => {
  test('the floating bar colours and highlights just the selected words', async ({ page }) => {
    await box(page, 'one two three');
    await selectChars(page, 4, 7);
    await page.getByTestId('format-colour').click();
    await page.getByTestId('format-color-red').click();
    await expect(editor(page)).toBeFocused();
    await expect
      .poll(() => runs(page))
      .toEqual([
        { text: 'one ', color: null, highlight: null, link: null },
        { text: 'two', color: '#e03131', highlight: null, link: null },
        { text: ' three', color: null, highlight: null, link: null },
      ]);

    await selectChars(page, 8, 13);
    await page.getByTestId('format-highlight').click();
    await page.getByTestId('format-highlight-yellow').click();
    await expect
      .poll(async () => (await runs(page)).at(-1))
      .toEqual({ text: 'three', color: null, highlight: '#ffe14d', link: null });

    // On the board too: red words and a yellow band where the box was.
    await page.keyboard.press('Escape');
    const area = { x: 150, y: 150, w: 750, h: 60 };
    await expect.poll(() => colourFraction(page, '#e03131', area)).toBeGreaterThan(0.002);
    await expect.poll(() => colourFraction(page, '#ffe14d', area)).toBeGreaterThan(0.02);
  });

  test('the side panel colours the selection, or the whole box', async ({ page }) => {
    await box(page, 'alpha beta');
    await selectChars(page, 0, 5);
    await page.getByTestId('text-colour-green').click();
    await expect(editor(page)).toBeFocused();
    await expect
      .poll(async () => (await runs(page))[0])
      .toEqual({ text: 'alpha', color: 'var(--shape-2)', highlight: null, link: null });

    // Not typing: the whole box, the green word included, turns blue.
    await page.keyboard.press('Escape');
    await page.getByTestId('text-colour-blue').click();
    await expect(page.getByTestId('text-colour-blue')).toHaveAttribute('aria-pressed', 'true');
    const area = { x: 150, y: 150, w: 750, h: 60 };
    await expect.poll(() => colourFraction(page, '--shape-6', area)).toBeGreaterThan(0.01);
    await expect.poll(() => colourFraction(page, '--shape-2', area)).toBeLessThan(0.001);
  });
});

test.describe('a text box’s own fill and colour', () => {
  test('filling a text box paints its box; its colour paints its words', async ({ page }) => {
    await box(page, 'Filled');
    await page.keyboard.press('Escape');
    const area = { x: 160, y: 160, w: 700, h: 120 };
    expect(await colourFraction(page, '--wash-blue', area)).toBeLessThan(0.01);

    await page.getByTestId('fill-var(--wash-blue)').click();
    await expect.poll(() => colourFraction(page, '--wash-blue', area)).toBeGreaterThan(0.5);

    await page.getByTestId('text-colour-red').click();
    await expect.poll(() => colourFraction(page, '#e03131', area)).toBeGreaterThan(0.005);

    // Typing in it, the box shows its fill and its colour as they will be drawn.
    await page.mouse.dblclick(200, 180);
    await expect(editor(page)).toHaveCSS('color', 'rgb(224, 49, 49)');
    await expect(editor(page)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });
});

test.describe('links', () => {
  test.beforeEach(async ({ context }) => {
    // The address is never really visited; the tab that opens for it is answered here.
    await context.route('https://example.com/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>example</title>' }),
    );
  });

  test('Ctrl+K links the selected words; typing after the link is not linked', async ({ page }) => {
    await box(page, 'page one two');
    await selectChars(page, 0, 4);
    await page.keyboard.press('ControlOrMeta+KeyK');
    await expect(page.getByTestId('link-input')).toBeFocused();
    await page.keyboard.type('example.com/notes');
    await page.keyboard.press('Enter');
    await expect(editor(page)).toBeFocused();
    await expect
      .poll(async () => (await runs(page))[0])
      .toEqual({ text: 'page', color: null, highlight: null, link: 'https://example.com/notes' });

    // The caret in the link: the bar offers to open it.
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('format-open-link')).toHaveText(/example\.com/);

    // Words typed straight after the link carry on unlinked.
    for (let step = 0; step < 3; step += 1) await page.keyboard.press('ArrowRight');
    await page.keyboard.type('s');
    await expect
      .poll(async () => (await runs(page)).slice(0, 2))
      .toEqual([
        { text: 'page', color: null, highlight: null, link: 'https://example.com/notes' },
        { text: 's one two', color: null, highlight: null, link: null },
      ]);
  });

  test('pasting an address over words links them', async ({ page }) => {
    await box(page, 'read this');
    await selectChars(page, 5, 9);
    await editor(page).evaluate((node) => {
      const transfer = new DataTransfer();
      transfer.setData('text/plain', 'https://example.com/this');
      node.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertFromPaste',
          dataTransfer: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await expect
      .poll(async () => (await runs(page)).at(-1))
      .toEqual({ text: 'this', color: null, highlight: null, link: 'https://example.com/this' });
    await expect.poll(() => editor(page).evaluate((node) => node.textContent)).toBe('read this');
  });

  test('on the board, a link shows its address and opens with Ctrl/⌘-click', async ({
    page,
    context,
  }) => {
    await box(page, 'page one two');
    await selectChars(page, 0, 4);
    await page.getByTestId('format-link').click();
    await page.getByTestId('link-input').fill('example.com/board');
    await page.getByTestId('link-apply').click();
    await page.keyboard.press('Escape');
    await expect(editor(page)).toHaveCount(0);

    // Over the linked word: a hand, and the address.
    const stage = page.getByTestId('stage');
    await page.mouse.move(175, 180);
    await expect(stage).toHaveAttribute('data-cursor', 'pointer');
    await expect(stage).toHaveAttribute('title', /https:\/\/example\.com\/board/);
    // Over the plain words beside it, neither.
    await page.mouse.move(500, 180);
    await expect(stage).toHaveAttribute('data-cursor', 'move');

    // A plain click selects, so linked text can still be moved; Ctrl/⌘-click opens.
    const opened = context.waitForEvent('page');
    await page.keyboard.down('ControlOrMeta');
    await page.mouse.click(175, 180);
    await page.keyboard.up('ControlOrMeta');
    const tab = await opened;
    await tab.waitForURL('https://example.com/board');
  });

  test('an address that is not a web or email address is refused', async ({ page }) => {
    await box(page, 'click me');
    await selectChars(page, 0, 5);
    await page.keyboard.press('ControlOrMeta+KeyK');
    await page.keyboard.type('javascript:alert(1)');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toHaveText(/isn’t a web or email address/);
    await expect(page.getByTestId('link-input')).toHaveAttribute('aria-invalid', 'true');
    // Escape leaves the field and goes back to typing, nothing linked.
    await page.keyboard.press('Escape');
    await expect(editor(page)).toBeFocused();
    expect((await runs(page)).every((run) => run.link === null)).toBe(true);
  });
});

test.describe('the highlighter', () => {
  test('marks over words without hiding them, and is not left selected', async ({ page }) => {
    await box(page, 'Highlight these words');
    await page.keyboard.press('Escape');
    await page.mouse.click(700, 600); // nothing selected

    await page.keyboard.press('KeyI');
    await expect(page.getByTestId('tool-highlighter')).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(400, 400);
    await expect(page.getByTestId('stage')).toHaveAttribute('data-cursor', 'highlighter');
    await expect(page.getByTestId('marker-colour-yellow')).toHaveAttribute('aria-pressed', 'true');

    // Across the line of words.
    await drag(page, [150, 179], [600, 179]);
    await expect(page.getByTestId('layers').locator('li')).toHaveText(['path', 'text']);
    await expect(page.getByTestId('geo')).toHaveCount(0);

    const band = { x: 160, y: 172, w: 420, h: 14 };
    // Yellow where it passed over the board…
    await expect.poll(() => colourFraction(page, '#ffe14d', band)).toBeGreaterThan(0.3);
    // …and the words still dark under it, not painted over.
    await expect.poll(() => colourFraction(page, '--text', band)).toBeGreaterThan(0.03);
  });

  test('has its own widths and colours, apart from the pen', async ({ page }) => {
    await page.keyboard.press('KeyI');
    await page.getByTestId('marker-width-32').click();
    await page.getByTestId('marker-colour-pink').click();
    await drag(page, [300, 400], [700, 400]);
    // An even band, 32 wide, from one end to the other — no taper.
    for (const x of [310, 500, 680]) {
      await expect
        .poll(() => colourFraction(page, '#ff9ccf', { x, y: 388, w: 10, h: 24 }))
        .toBeGreaterThan(0.8);
    }

    await page.keyboard.press('KeyP');
    await expect(page.getByTestId('ink-width-6')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('straight lines', () => {
  /** A wobbly stroke with the pen, Shift held all the way. */
  async function straight(page: Page, points: Array<[number, number]>) {
    await page.keyboard.press('KeyP');
    await page.keyboard.down('Shift');
    await page.mouse.move(points[0]![0], points[0]![1]);
    await page.mouse.down();
    for (const [x, y] of points.slice(1)) await page.mouse.move(x, y, { steps: 3 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
  }

  test('with Shift, a nearly level line comes out exactly level', async ({ page }) => {
    await straight(page, [
      [300, 400],
      [420, 412],
      [560, 396],
      [700, 428],
    ]);
    await page.getByTestId('layers').locator('li button').first().click();
    const line = await geo(page);
    expect(line.w).toBeGreaterThan(380);
    // Level: the stroke is no taller than its own width.
    expect(line.h).toBeLessThanOrEqual(8);
  });

  test('with Shift, a nearly upright line comes out exactly upright', async ({ page }) => {
    await straight(page, [
      [500, 200],
      [512, 320],
      [490, 450],
      [530, 600],
    ]);
    await page.getByTestId('layers').locator('li button').first().click();
    const line = await geo(page);
    expect(line.h).toBeGreaterThan(380);
    expect(line.w).toBeLessThanOrEqual(8);
  });

  test('a line well off level or upright keeps its own angle', async ({ page }) => {
    await straight(page, [
      [300, 300],
      [400, 400],
      [600, 500],
    ]);
    await page.getByTestId('layers').locator('li button').first().click();
    const line = await geo(page);
    expect(line.w).toBeGreaterThan(280);
    expect(line.h).toBeGreaterThan(180);
  });
});
