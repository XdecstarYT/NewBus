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
  for (const p of ['/owner', '/owner/work', '/owner/ai', '/owner/economy', '/owner/justice', '/owner/codes', '/chat', '/news', '/leaderboard']) {
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
  for (const p of ['/office', '/work', '/customers', '/contracts', '/quests', '/market', '/shops', '/shop', '/pay', '/send', '/unions', '/townhall', '/court', '/chat', '/news', '/leaderboard', '/team', '/redeem', '/settings']) {
    await bakery.goto(p);
    await expect(bakery.locator('h1').first(), p).toBeVisible();
  }
  check();
});

test('owner builds an office-work template with reference data; a friend does the job and is paid', async ({ browser }) => {
  const ctx = await browser.newContext();
  const owner = await ctx.newPage();
  await login(owner, '01', 'owner-secret');
  await owner.goto('/owner/work');
  await owner.getByRole('tab', { name: /My templates/ }).click();
  await owner.getByTestId('new-template').click();
  await owner.getByLabel('Title').fill('Count the crates');
  await owner.getByLabel(/Brief/).fill('How many crates are in the yard altogether?');
  await owner.getByLabel(/Reference data/).fill('Row,Crates\nA,4\nB,7');
  await owner.getByRole('button', { name: /Instant check/ }).click();
  await owner.getByLabel('Answer', { exact: true }).fill('11');
  await owner.getByTestId('save-template').click();
  await expect(owner.getByText(/Template saved/)).toBeVisible();
  await owner.getByRole('button', { name: /Post/ }).first().click();
  await owner.getByTestId('post-job').click();
  await expect(owner.getByText(/Posted!/)).toBeVisible();

  // send a client (AI is off in tests, so a built-in character brings a ready-made job)
  await owner.goto('/owner/ai');
  const farmOption = owner.getByTestId('client-company').locator('option', { hasText: 'Wheaty Farms' });
  await expect(farmOption).toHaveCount(1);
  await owner.getByTestId('client-company').selectOption((await farmOption.getAttribute('value'))!);
  await owner.getByTestId('send-client').click();
  await expect(owner.getByText(/is on the way/)).toBeVisible();

  const farm = await (await browser.newContext()).newPage();
  await login(farm, logins['Wheaty Farms'].number, 'secret-123');
  const check = noConsoleErrors(farm);
  await expect(farm.getByTestId('game-clock')).toContainText('Day');
  await farm.goto('/work');
  await farm.locator('[data-testid^="job-"]', { hasText: 'Count the crates' }).getByTestId('take-job').click();
  await expect(farm.getByRole('columnheader', { name: 'Crates' })).toBeVisible();
  await farm.getByLabel('Answer').fill('11');
  await farm.getByTestId('hand-in').click();
  await expect(farm.getByTestId('job-result')).toContainText('100%');
  check();
});
