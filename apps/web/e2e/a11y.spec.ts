import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissPopups, login, skipTutorial } from './helpers';

// Accessibility scan (WCAG 2 A/AA rules) on the main screens. Fails on serious/critical issues.
async function scan(page: import('@playwright/test').Page, name: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = bad.map((v) => `${name}: [${v.impact}] ${v.id} - ${v.help} (${v.nodes.length}x) e.g. ${v.nodes[0]?.target.join(' ')}`).join('\n');
  return { bad, summary };
}

test('login screen is accessible', async ({ page }) => {
  await page.goto('/');
  const { bad, summary } = await scan(page, 'login');
  expect(bad, summary).toEqual([]);
});

test('main player screens are accessible', async ({ page }) => {
  await login(page, '02', 'demo1234');
  await expect(page.getByText('Crusty Dreams').first()).toBeVisible();
  await skipTutorial(page);
  const problems: string[] = [];
  for (const path of ['/office', '/workforce', '/minigames', '/bank', '/quests', '/research', '/achievements', '/leaderboard', '/exchange', '/settings']) {
    await page.goto(path);
    await dismissPopups(page);
    await page.waitForTimeout(400);
    const { bad, summary } = await scan(page, path);
    if (bad.length) problems.push(summary);
  }
  expect(problems, problems.join('\n')).toEqual([]);
});

test('owner screens are accessible', async ({ page }) => {
  await login(page, '01', 'Diddy');
  await expect(page.getByText('Owner Control Panel')).toBeVisible();
  const problems: string[] = [];
  for (const path of ['/owner', '/owner/builder', '/owner/companies', '/owner/chaos', '/owner/packages', '/owner/flags']) {
    await page.goto(path);
    await page.waitForTimeout(400);
    const { bad, summary } = await scan(page, path);
    if (bad.length) problems.push(summary);
  }
  expect(problems, problems.join('\n')).toEqual([]);
});
