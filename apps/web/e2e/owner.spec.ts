import { test, expect } from '@playwright/test';
import { login, noConsoleErrors, skipTutorial } from './helpers';

test('owner builds a company, hands out the badge, and the new player gets in', async ({ page, browser }) => {
  const check = await noConsoleErrors(page);
  await login(page, '01', 'Diddy');
  await expect(page.getByText('Owner Control Panel')).toBeVisible();

  await page.goto('/owner/builder');
  await page.fill('#cname', 'E2E Taco Fleet');
  await page.click('button:has-text("Next →")');
  await page.fill('input[aria-label="Search industries"]', 'taco');
  await page.locator('[data-testid^="industry-"]').first().click();
  for (let i = 0; i < 4; i++) await page.click('button:has-text("Next →")');
  await page.click('[data-testid="create-company"]');
  const badge = page.getByTestId('welcome-badge');
  await expect(badge).toBeVisible();
  const account = (await page.getByTestId('badge-account').textContent())!.trim();
  const password = (await page.getByTestId('badge-password').textContent())!.trim();
  expect(account).toMatch(/^\d{2,}$/);

  // the new player, in a separate browser
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await login(p, account, password);
  await p.fill('#cur', password);
  await p.fill('#new', 'e2e-secret');
  await p.fill('#again', 'e2e-secret');
  await p.click('button:has-text("Save my password")');
  await skipTutorial(p);
  await p.goto('/office');
  await expect(p.getByText('E2E Taco Fleet').first()).toBeVisible();
  await ctx.close();

  // owner sees it in the company list
  await page.goto('/owner/companies');
  await expect(page.getByText('E2E Taco Fleet')).toBeVisible();
  check();
});

test('owner tools open without errors', async ({ page }) => {
  const check = await noConsoleErrors(page);
  await login(page, '01', 'Diddy');
  await expect(page.getByText('Owner Control Panel')).toBeVisible();
  for (const path of ['economy', 'market', 'social', 'moderation', 'chaos', 'packages', 'analytics', 'anticheat', 'backups', 'flags', 'audit', 'ledger', 'account']) {
    await page.goto(`/owner/${path}`);
    await expect(page.locator('h1').first(), path).toBeVisible();
  }
  // one-click backup
  await page.goto('/owner/backups');
  await page.getByTestId('backup-now').click();
  await expect(page.getByText('manual').first()).toBeVisible();
  check();
});
