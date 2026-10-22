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
  for (const p of ['/owner', '/owner/work', '/owner/ai', '/owner/town', '/owner/economy', '/owner/justice', '/owner/codes', '/chat', '/news', '/leaderboard']) {
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
  for (const p of ['/office', '/work', '/customers', '/contracts', '/quests', '/bank', '/town', '/auctions', '/world', '/market', '/shops', '/shop', '/pay', '/send', '/unions', '/townhall', '/court', '/chat', '/news', '/leaderboard', '/team', '/redeem', '/settings']) {
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

test('the town builds a project together and the Owner auctions a gadget', async ({ browser }) => {
  const owner = await (await browser.newContext()).newPage();
  await login(owner, '01', 'owner-secret');
  await owner.goto('/owner/town');
  await owner.getByRole('button', { name: /Fund a tax holiday/ }).click();
  await owner.getByLabel(/Size/).fill('0.25');
  await owner.getByTestId('start-project').click();
  await expect(owner.getByText(/Project started/)).toBeVisible();
  await owner.getByRole('button', { name: /Start auction/ }).click();
  await expect(owner.getByText(/Auction started/)).toBeVisible();

  const farm = await (await browser.newContext()).newPage();
  await login(farm, logins['Wheaty Farms'].number, 'secret-123');
  const check = noConsoleErrors(farm);
  await farm.goto('/town');
  await farm.getByTestId('give').first().click();
  await farm.getByLabel('Bits to give').fill('1500');
  await farm.getByRole('button', { name: 'Give Bits' }).click();
  await expect(farm.getByText(/Project finished/)).toBeVisible();
  await expect(farm.getByText('No sales tax')).toBeVisible();
  await farm.goto('/auctions');
  await farm.getByTestId('bid').first().click();
  await expect(farm.getByText(/top bid/)).toBeVisible();
  check();
});

test('buy land in the 3D town and build a little house brick by brick', async ({ browser }) => {
  const farm = await (await browser.newContext()).newPage();
  await login(farm, logins['Wheaty Farms'].number, 'secret-123');
  const check = noConsoleErrors(farm);
  await farm.goto('/world');
  await expect(farm.getByTestId('world-canvas').locator('canvas')).toBeVisible();
  await farm.getByTestId('map-p0_0').click();
  await farm.getByTestId('buy-plot').click();
  await expect(farm.getByText(/It's yours/)).toBeVisible();
  await farm.getByTestId('start-building').click();
  // wheat thatch: the farm has wheat from earlier shifts
  await farm.getByRole('button', { name: /Thatch/ }).click();
  await farm.getByTestId('cell-0-0').click();
  await farm.getByTestId('cell-1-0').click();
  await farm.getByLabel('Floor up').click();
  await farm.getByTestId('cell-0-0').click();
  await expect(farm.getByText('3 unsaved changes')).toBeVisible();
  await farm.getByTestId('save-building').click();
  await expect(farm.getByText(/Your building has 3 blocks/)).toBeVisible();
  await farm.screenshot({ path: 'test-results/world.png' });
  await farm.getByRole('button', { name: /Back to the map/ }).click();
  await farm.waitForTimeout(800);
  await farm.screenshot({ path: 'test-results/world-map.png' });
  check();
});

test('a union calls a vote of no confidence in the Owner from the Town Hall', async ({ browser }) => {
  const farm = await (await browser.newContext()).newPage();
  await login(farm, logins['Crusty Dreams'].number, 'secret-123');
  const check = noConsoleErrors(farm);
  await farm.goto('/unions');
  await farm.getByLabel('Name', { exact: true }).fill('Bakers First');
  await farm.getByTestId('union-create').click();
  await expect(farm.getByText(/Bakers First/).first()).toBeVisible();
  await farm.getByText(/Bakers First/).first().click();
  await farm.getByRole('tab', { name: /Treasury/ }).click();
  await farm.getByLabel('Donation').fill('300');
  await farm.getByRole('button', { name: 'Donate' }).click();
  await expect(farm.getByText('💝 Thanks!')).toBeVisible();
  await farm.goto('/townhall');
  await expect(farm.getByTestId('government')).toContainText('The Owner');
  await farm.getByTestId('call-no-confidence').click();
  await farm.getByRole('button', { name: 'Yes, do it!' }).click();
  // a one-company union can not do it yet: the game explains why
  await expect(farm.getByText(/at least 2 member companies/)).toBeVisible();
  await farm.getByTestId('propose-bill').click();
  await farm.getByLabel('Your demand').fill('Build a park in the town square');
  await farm.getByRole('button', { name: /Put it to the vote/ }).click();
  await expect(farm.getByText('Demand: Build a park in the town square')).toBeVisible();
  check();
});
