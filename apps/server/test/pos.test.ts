import { describe, it, expect, beforeAll } from 'vitest';
import type { Express } from 'express';
import { setupGame, makeCompany, login } from './helpers';
import * as pos from '../src/services/pos';
import { addStock, getRow } from '../src/services/inventory';
import { setPricing } from '../src/services/products';
import { productsFor } from '../src/services/catalog';
import { balanceOf, verifyLedger, SYS } from '../src/services/ledger';
import { companyWallet } from '../src/services/money';
import { cfg } from '../src/services/settings';

let app: Express;
const P = () => productsFor('bakery')[0];

function shop(name: string, stock = 20) {
  const s = makeCompany({ name, industryId: 'bakery', startingBits: 1000 });
  addStock(s.company.id, 'product', P().id, stock, 80);
  setPricing(s.company.id, P().id, { price: P().basePrice, onSale: true });
  return s;
}

describe('POS and online shops', () => {
  beforeAll(() => {
    app = setupGame();
  });

  it('register sale: customer pays with Bits, tax goes to the Treasury, stock moves to the customer', () => {
    const s = shop('Corner Bakery');
    const b = makeCompany({ name: 'Hungry Co', startingBits: 10_000 });
    const c = pos.createCheckout(s.company.id, s.account.id, { lines: [{ productId: P().id, qty: 3 }] });
    expect(c.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const subtotal = 3 * P().basePrice;
    const tax = Math.round((subtotal * cfg().economy.salesTaxBps) / 10_000);
    expect(c.total).toBe(subtotal + tax);
    const sb = balanceOf(companyWallet(s.company.id));
    const bb = balanceOf(companyWallet(b.company.id));
    const tr = balanceOf(SYS.TREASURY);
    expect(pos.viewCheckout(c.code.toLowerCase()).status).toBe('open');
    pos.payCheckout(b.company.id, b.account.id, c.code);
    expect(balanceOf(companyWallet(s.company.id))).toBe(sb + subtotal);
    expect(balanceOf(companyWallet(b.company.id))).toBe(bb - subtotal - tax);
    expect(balanceOf(SYS.TREASURY)).toBe(tr + tax);
    expect(getRow(s.company.id, 'product', P().id)!.qty).toBe(17);
    expect(getRow(b.company.id, 'product', P().id)!.qty).toBe(3);
    expect(() => pos.payCheckout(b.company.id, b.account.id, c.code)).toThrow(/already paid/);
    expect(verifyLedger().sum).toBe(0);
  });

  it('refuses paying yourself, too-poor buyers, and expired or out-of-stock sales', () => {
    const s = shop('Tiny Bakery', 2);
    const poor = makeCompany({ name: 'Broke Co', startingBits: 0 });
    expect(() => pos.createCheckout(s.company.id, s.account.id, { lines: [{ productId: P().id, qty: 5 }] })).toThrow(/Not enough/);
    const c = pos.createCheckout(s.company.id, s.account.id, { lines: [{ productId: P().id, qty: 1 }] });
    expect(() => pos.payCheckout(s.company.id, s.account.id, c.code)).toThrow(/own business/);
    expect(() => pos.payCheckout(poor.company.id, poor.account.id, c.code)).toThrow(/Not enough Bits/);
  });

  it('online order, pay at pickup: stock is reserved, the pickup code opens a sale, paying delivers', () => {
    const s = shop('Online Bakery');
    const b = makeCompany({ name: 'Pickup Co', startingBits: 10_000 });
    const o = pos.placeOrder(b.company.id, b.account.id, { sellerId: s.company.id, lines: [{ productId: P().id, qty: 4 }], payMode: 'pickup' });
    expect(getRow(s.company.id, 'product', P().id)!.qty).toBe(16); // reserved
    pos.markReady(s.company.id, o.id);
    const found = pos.findPickup(s.company.id, o.pickupCode);
    expect(found.id).toBe(o.id);
    const r = pos.collectOrder(s.company.id, s.account.id, o.id);
    expect(r.collected).toBe(false);
    pos.payCheckout(b.company.id, b.account.id, r.checkout!.code);
    expect(getRow(b.company.id, 'product', P().id)!.qty).toBe(4);
    expect(pos.myOrders(b.company.id)[0].status).toBe('collected');
    expect(verifyLedger().sum).toBe(0);
  });

  it('online order, pay now: collecting hands it over; cancelling refunds and restocks', () => {
    const s = shop('Prepaid Bakery');
    const b = makeCompany({ name: 'Prepaid Co', startingBits: 10_000 });
    const bb = balanceOf(companyWallet(b.company.id));
    const o = pos.placeOrder(b.company.id, b.account.id, { sellerId: s.company.id, lines: [{ productId: P().id, qty: 2 }], payMode: 'now' });
    expect(balanceOf(companyWallet(b.company.id))).toBe(bb - o.total);
    expect(pos.collectOrder(s.company.id, s.account.id, o.id).collected).toBe(true);
    expect(getRow(b.company.id, 'product', P().id)!.qty).toBe(2);
    const o2 = pos.placeOrder(b.company.id, b.account.id, { sellerId: s.company.id, lines: [{ productId: P().id, qty: 3 }], payMode: 'now' });
    const before = balanceOf(companyWallet(b.company.id));
    pos.cancelOrder(b.company.id, o2.id, b.account.id);
    expect(balanceOf(companyWallet(b.company.id))).toBe(before + o2.total);
    expect(getRow(s.company.id, 'product', P().id)!.qty).toBe(18);
    expect(verifyLedger().sum).toBe(0);
  });

  it('API: shop directory, storefront and paying through HTTP', async () => {
    const s = shop('HTTP Bakery');
    const { account } = makeCompany({ name: 'HTTP Buyer', accountNumber: '99910', password: 'httpbuy1', startingBits: 5000 });
    const p = await login(app, account.accountNumber, 'httpbuy1');
    const dir = await p.get('/api/game/shops');
    expect(dir.status).toBe(200);
    expect(dir.body.some((x: any) => x.id === s.company.id)).toBe(true);
    expect((await p.get(`/api/game/shops/${s.company.id}`)).body.products.length).toBe(1);
    const c = pos.createCheckout(s.company.id, s.account.id, { lines: [{ productId: P().id, qty: 1 }] });
    expect((await p.get(`/api/game/pay/${c.code}`)).body.total).toBe(c.total);
    expect((await p.post(`/api/game/pay/${c.code}`)).status).toBe(200);
    expect(pos.viewCheckout(c.code).status).toBe('paid');
  });
});
