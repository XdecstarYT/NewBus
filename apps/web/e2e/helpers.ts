import { expect, type Page } from '@playwright/test';

export async function login(page: Page, account: string, password: string) {
  await page.goto('/');
  await page.fill('#acc', account);
  await page.fill('#pw', password);
  await page.click('button:has-text("Scan badge")');
}

/** Skip the guided tour through the API so it never covers the page under test. */
export async function skipTutorial(page: Page) {
  await page.evaluate(async () => {
    const csrf = document.cookie.match(/dw_csrf=([^;]+)/)?.[1] ?? '';
    await fetch('/api/auth/tutorial', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: '{"done":true}' });
  });
}

/** Close any pop-up (welcome back, events...) that might be open. */
export async function dismissPopups(page: Page) {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
}

export async function noConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/40[0-9]|409/.test(m.text()) && errors.push(m.text()));
  return () => expect(errors, errors.join('\n')).toEqual([]);
}
