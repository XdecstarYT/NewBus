import { test, expect } from '@playwright/test';
import { changePassword, login, noConsoleErrors, player } from './helpers';

test.describe.configure({ mode: 'serial' });

const logins: Record<string, { number: string; password: string }> = {};

test('owner signs in as 01 / Diddy and creates two friends\' companies', async ({ page }) => {
  const check = noConsoleErrors(page);
  await login(page, '01', 'Diddy');
  await changePassword(page, 'Diddy', 'owner-secret');
  await expect(page.getByRole('heading', { name: /Owner overview/ })).toBeVisible();
  for (const [name, industry, who] of [['Wheaty Farms', 'farm', 'Alex'], ['Crusty Dreams', 'bakery', 'Sam']]) {
    await page.goto('/owner/companies');
    await page.getByLabel('Company name').fill(name);
    await page.getByLabel('Starting facility').selectOption(industry);
    await page.getByLabel("Player's name").fill(who);
    await page.getByTestId('create-company').click();
    logins[name] = { number: (await page.getByTestId('new-number').textContent())!.trim(), password: (await page.getByTestId('new-password').textContent())!.trim() };
  }
  for (const p of ['/owner', '/owner/economy', '/owner/justice', '/owner/codes', '/chat', '/news', '/leaderboard']) {
    await page.goto(p);
    await expect(page.locator('h1').first()).toBeVisible();
  }
  check();
});

test('friends work, trade on the market and pay at the register', async ({ browser }) => {
  const farm = await player(browser, logins['Wheaty Farms'].number, logins['Wheaty Farms'].password, 'Wheaty Farms');
  const bakery = await player(browser, logins['Crusty Dreams'].number, logins['Crusty Dreams'].password, 'Crusty Dreams');
  const check = noConsoleErrors(bakery);

  // farmer works a shift: Energy -> wheat
  await farm.getByTestId('work-wheat').click();
  await expect(farm.getByTestId('inv-wheat')).toContainText('4');
  await farm.getByLabel('Batches of wheat').fill('5');
  await farm.getByTestId('work-wheat').click();
  await expect(farm.getByTestId('inv-wheat')).toContainText('24');

  // farmer sells wheat on the market
  await farm.goto('/market/wheat');
  await farm.getByRole('button', { name: 'Sell', exact: true }).click();
  await farm.getByLabel('Price each (BT)').fill('5');
  await farm.getByLabel('Quantity').fill('12');
  await farm.getByTestId('place-order').click();
  await expect(farm.getByText(/Order posted/)).toBeVisible();

  // baker buys it
  await bakery.goto('/market/wheat');
  await bakery.getByLabel('Price each (BT)').fill('6');
  await bakery.getByLabel('Quantity').fill('12');
  await bakery.getByTestId('place-order').click();
  await expect(bakery.getByText(/Traded 12 right away/)).toBeVisible();

  // farmer rings up a sale at the register; the baker pays with the code
  await farm.goto('/shop');
  await farm.getByTestId('pos-add-wheat').click();
  await farm.getByTestId('pos-charge').click();
  const code = (await farm.getByTestId('pos-code').textContent())!.trim();
  await bakery.goto(`/pay/${code}`);
  await bakery.getByTestId('pay-confirm').click();
  await expect(bakery.getByTestId('pay-done')).toBeVisible();
  await expect(farm.getByTestId('pos-paid')).toBeVisible({ timeout: 15_000 });

  // every page opens
  for (const p of ['/office', '/market', '/shops', '/shop', '/pay', '/send', '/unions', '/townhall', '/court', '/chat', '/news', '/leaderboard', '/team', '/redeem', '/settings']) {
    await bakery.goto(p);
    await expect(bakery.locator('h1').first(), p).toBeVisible();
  }
  check();
});
