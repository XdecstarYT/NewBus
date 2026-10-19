import { test, expect } from '@playwright/test';
import { dismissPopups, login, noConsoleErrors, skipTutorial } from './helpers';

test.beforeEach(async ({ page }) => {
  await login(page, '03', 'demo1234');
  await expect(page.getByText('Pixel Pals Studio').first()).toBeVisible();
  await skipTutorial(page);
});

test('every game page opens without errors', async ({ page }) => {
  const check = await noConsoleErrors(page);
  for (const path of ['/office', '/workforce', '/pods', '/contracts', '/minigames', '/bank', '/products', '/exchange', '/leaderboard', '/achievements', '/research', '/quests', '/chat', '/guilds', '/wars', '/news', '/shop', '/strategy', '/unions', '/court', '/pos', '/shops', '/orders', '/pay', '/packages', '/profile', '/settings']) {
    await page.goto(path);
    await dismissPopups(page);
    await expect(page.locator('h1').first(), path).toBeAttached();
  }
  check();
});

test('play Quiz Show and get scored by the server', async ({ page }) => {
  await page.goto('/minigames');
  await dismissPopups(page);
  await page.getByTestId('play-quiz-show').click();
  for (let i = 0; i < 8; i++) {
    const q = page.locator('[role="dialog"] button:has-text("A")').first();
    await q.click();
    await page.waitForTimeout(600);
  }
  await expect(page.getByTestId('arcade-result')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('arcade-result')).toContainText('Score');
});

test('open a Recruit Pod', async ({ page }) => {
  await page.goto('/pods');
  await dismissPopups(page);
  await page.locator('button:has-text("Open")').first().click();
  await expect(page.getByText(/common|rare|epic|legendary|cursed/i).first()).toBeVisible({ timeout: 15_000 });
});
