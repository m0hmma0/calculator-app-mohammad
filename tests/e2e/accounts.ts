import { expect, type Page } from '@playwright/test';

/** Shared by the specs that run against the real Worker and its test key server. */
export const KEYS = 'http://localhost:8799';
export const API = 'http://localhost:8788';

/** A fresh account per test, so tests never see each other's folders or boards. */
export function newAccount(label: string) {
  const uid = `${label}-${Math.random().toString(36).slice(2, 10)}`;
  return { uid, name: `Person ${label}` };
}

export async function tokenFor(account: { uid: string; name: string }) {
  const response = await fetch(
    `${KEYS}/token?uid=${account.uid}&name=${encodeURIComponent(account.name)}`,
  );
  return response.text();
}

/** Signs in by handing the app a token the Worker will actually verify. */
export async function signIn(page: Page, account: { uid: string; name: string }) {
  const token = await tokenFor(account);
  await page.goto('/');
  await page.evaluate((value) => localStorage.setItem('sabboura:test-token', value), token);
  await page.goto('/');
  await expect(page.getByTestId('dashboard')).toBeVisible();
}

export const boardCards = (page: Page) => page.locator('[data-testid^="board-brd_"]');

export async function createBoard(page: Page) {
  await page.getByTestId('new-board').click();
  await expect(page.getByTestId('board-canvas')).toBeVisible();
  return new URL(page.url()).pathname.replace('/b/', '');
}
