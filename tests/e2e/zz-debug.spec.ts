import { expect, test } from '@playwright/test';
test('debug text + circle', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  await page.keyboard.press('KeyT');
  await page.mouse.click(300, 300);
  await page.keyboard.type('Hello there this is a text box with words');
  await page.mouse.click(800, 600);
  await page.waitForTimeout(200);
  const ed1 = await page.getByTestId('text-editor').count();
  const geo = await page.getByTestId('layers').innerText();
  console.log('after click out editor=', ed1, 'layers=', geo.replace(/\n/g, ' '));
  await page.mouse.move(330, 315);
  console.log('cursor inside text', await page.getByTestId('stage').getAttribute('data-cursor'));
  await page.mouse.click(330, 315);
  await page.waitForTimeout(200);
  console.log(
    'editor after single click',
    await page.getByTestId('text-editor').count(),
    'geo-x',
    await page.getByTestId('geo-x').count(),
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // circle
  await page.keyboard.press('KeyO');
  await page.mouse.move(500, 400);
  await page.mouse.down();
  await page.mouse.move(650, 520, { steps: 5 });
  await page.mouse.up();
  await page.mouse.click(900, 650);
  await page.mouse.move(575, 460);
  console.log('cursor in circle', await page.getByTestId('stage').getAttribute('data-cursor'));
  await page.mouse.click(575, 460);
  console.log('selected after click in circle', await page.getByTestId('geo-x').count());
});
