import { expect, type Browser, type Page } from '@playwright/test';

export async function login(page: Page, number: string, password: string) {
  await page.goto('/');
  await page.fill('#acc', number);
  await page.fill('#pw', password);
  await page.click('button:has-text("Scan badge")');
}

/** First login: pick a real password. */
export async function changePassword(page: Page, current: string, next: string) {
  await page.fill('#cur', current);
  await page.fill('#new', next);
  await page.fill('#again', next);
  await page.getByRole('button', { name: /Save my password/ }).click();
}

export async function player(browser: Browser, number: string, temp: string, name: string) {
  const page = await (await browser.newContext()).newPage();
  await login(page, number, temp);
  await changePassword(page, temp, 'secret-123');
  await expect(page.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
  return page;
}

export function noConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/40[0-9]|Failed to load resource|WebSocket|realtime|supabase/i.test(m.text()) && errors.push(m.text()));
  return () => expect(errors, errors.join('\n')).toEqual([]);
}
