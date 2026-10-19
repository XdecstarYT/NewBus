import { test, expect, type Browser } from '@playwright/test';
import { dismissPopups, login, skipTutorial } from './helpers';

async function player(browser: Browser, account: string, name: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, account, 'demo1234');
  await expect(page.getByText(name).first()).toBeVisible();
  await skipTutorial(page);
  return page;
}

test('ring up a sale at the register and pay it from another company', async ({ browser }) => {
  const seller = await player(browser, '02', 'Crusty Dreams');
  const buyer = await player(browser, '03', 'Pixel Pals Studio');

  await seller.goto('/pos');
  await dismissPopups(seller);
  await seller.locator('[data-testid^="pos-add-"]').first().click();
  await seller.getByTestId('pos-charge').click();
  const code = (await seller.getByTestId('pos-code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);

  await buyer.goto(`/pay/${code}`);
  await dismissPopups(buyer);
  await expect(buyer.getByTestId('pay-receipt')).toBeVisible();
  await buyer.getByTestId('pay-confirm').click();
  await expect(buyer.getByTestId('pay-done')).toBeVisible();
  await expect(seller.getByTestId('pos-paid')).toBeVisible({ timeout: 15_000 });
});

test('order online, pay at pickup', async ({ browser }) => {
  const seller = await player(browser, '02', 'Crusty Dreams');
  const buyer = await player(browser, '03', 'Pixel Pals Studio');

  await buyer.goto('/shops');
  await dismissPopups(buyer);
  await buyer.locator('[data-testid^="shop-"]', { hasText: 'Crusty Dreams' }).click();
  await buyer.locator('[data-testid^="shop-add-"]').first().click();
  await buyer.getByTestId('order-pay-pickup').click();
  await expect(buyer).toHaveURL(/\/orders$/);
  const pickup = (await buyer.getByTestId('pickup-code').first().textContent())!.trim();

  await seller.goto('/pos');
  await dismissPopups(seller);
  await seller.getByRole('tab', { name: /Online orders/ }).click();
  await seller.getByLabel('Pickup code').fill(pickup);
  await seller.getByRole('button', { name: 'Find' }).click();
  await seller.getByRole('button', { name: /Take payment & hand over/ }).click();
  const payCode = (await seller.getByTestId('handover-code').textContent())!.trim();

  await buyer.goto(`/pay/${payCode}`);
  await buyer.getByTestId('pay-confirm').click();
  await expect(buyer.getByTestId('pay-done')).toBeVisible();
  await buyer.goto('/orders');
  await expect(buyer.getByText('✅ Collected').first()).toBeVisible();
});
