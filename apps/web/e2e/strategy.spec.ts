import { test, expect, type Browser } from '@playwright/test';
import { dismissPopups, login, noConsoleErrors, skipTutorial } from './helpers';

async function player(browser: Browser, account: string, password: string, name: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, account, password);
  await expect(page.getByText(name).first()).toBeVisible();
  await skipTutorial(page);
  return page;
}

test('strategy room: run a play and see it running', async ({ browser }) => {
  const page = await player(browser, '04', 'demo1234', 'Golden Wheat Co');
  const check = await noConsoleErrors(page);
  await page.goto('/strategy');
  await dismissPopups(page);
  await page.getByTestId('play-flyers-1').getByRole('button', { name: 'Run play' }).click();
  await page.getByRole('tab', { name: /Running/ }).click();
  await expect(page.getByText('Scrappy Flyer Blitz').first()).toBeVisible();
  await page.getByRole('tab', { name: /Territory/ }).click();
  await expect(page.getByTestId('district-downtown')).toBeVisible();
  await page.getByRole('tab', { name: /Policies/ }).click();
  await page.getByRole('button', { name: /Premium/ }).click();
  await expect(page.getByText('Policy changed.')).toBeVisible();
  await page.getByRole('tab', { name: /Bills/ }).click();
  check();
});

test('unions: found one, a second business joins and runs for office', async ({ browser }) => {
  const a = await player(browser, '04', 'demo1234', 'Golden Wheat Co');
  const b = await player(browser, '05', 'demo1234', 'Moonshot Holidays');
  await a.goto('/unions');
  await dismissPopups(a);
  await a.getByLabel('Name').fill('Farmers & Rockets');
  await a.getByTestId('union-create').click();
  await expect(a.getByRole('heading', { name: 'Farmers & Rockets' })).toBeVisible();
  await a.getByRole('button', { name: /Early election: Treasurer/ }).click();
  await expect(a.locator('[data-testid^="election-"]').first()).toBeVisible();

  await b.goto('/unions');
  await dismissPopups(b);
  await b.locator('[data-testid^="union-"]', { hasText: 'Farmers & Rockets' }).getByRole('button', { name: 'Join' }).click();
  await expect(b.getByRole('heading', { name: 'Farmers & Rockets' })).toBeVisible();
  await b.getByLabel('Campaign pitch').fill('More rockets');
  await b.getByRole('button', { name: /Run for office/ }).click();
  await expect(b.getByText('"More rockets"')).toBeVisible();
});

test('owner: audit a company, take another to court and rule', async ({ browser }) => {
  const owner = await player(browser, '01', 'Diddy', 'Owner');
  const check = await noConsoleErrors(owner);
  await owner.goto('/owner/justice');
  await owner.getByLabel('Company to audit').selectOption({ label: '🥐 Crusty Dreams' });
  await owner.getByTestId('open-audit').click();
  await expect(owner.locator('[data-testid^="audit-"]').first()).toBeVisible();
  await owner.getByRole('button', { name: '✅ Clean' }).click();

  await owner.getByRole('tab', { name: /Court/ }).click();
  await owner.getByLabel('Defendant').selectOption({ label: '👾 Pixel Pals Studio' });
  await owner.getByLabel('Title').fill('State v. Pixel Pals: too many bugs');
  await owner.getByRole('button', { name: /Take them to court/ }).click();
  await owner.locator('[data-testid^="case-"]').first().click();
  await expect(owner.getByTestId('rule-form')).toBeVisible();
  await owner.getByRole('button', { name: 'Rule for the plaintiff' }).click();
  await expect(owner.getByText(/The State wins/)).toBeVisible();
  check();
});
