import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupGame, makeCompany } from './helpers';
import { db, schema, sqlite } from '../src/db';
import * as products from '../src/services/products';
import { addStock, getQty, takeStock } from '../src/services/inventory';
import { productsFor, getCommodity } from '../src/services/catalog';
import { balanceOf, verifyLedger, SYS, post } from '../src/services/ledger';
import { companyWallet } from '../src/services/money';
import { purchaseProbability, priceBounds } from '../src/engine/demand';
import { runTick } from '../src/services/tick';
import { clock } from '../src/lib/time';
import { cfg } from '../src/services/settings';
import { reseedLive } from '../src/engine/rng';

function bakery(bits = 50_000) {
  const r = makeCompany({ name: `Bakery ${Math.random()}`, industryId: 'bakery', startingBits: bits, startingWorkers: 3 });
  db.update(schema.companies).set({ level: 20 }).where(eq(schema.companies.id, r.company.id)).run();
  const wp = db.select().from(schema.workplaces).where(eq(schema.workplaces.companyId, r.company.id)).get()!;
  return { ...r, wp };
}

describe('products, production & sales', () => {
  beforeAll(() => {
    setupGame();
    reseedLive(4242);
  });

  it('recipes consume inputs (and auto-buy missing commodities from the wholesaler)', () => {
    const { company, wp } = bakery();
    const [dough, loaf] = productsFor('bakery');
    addStock(company.id, 'commodity', 'flour', 10, 50);
    addStock(company.id, 'commodity', 'eggs', 10, 50);
    const flourNeed = dough.recipe.find((r) => r.inputId === 'flour')!.qty * 2;
    products.queueProduction(company.id, wp.id, dough.id, 2, 'test', { autoBuy: false });
    expect(getQty(company.id, 'commodity', 'flour')).toBe(10 - flourNeed);
    // loaf needs a dough ball (intermediate good) that we don't have yet
    expect(() => products.queueProduction(company.id, wp.id, loaf.id, 1, 'test')).toThrow(/Dough Ball/);
    const before = balanceOf(companyWallet(company.id));
    takeStock(company.id, 'commodity', 'flour', getQty(company.id, 'commodity', 'flour'));
    const r = products.queueProduction(company.id, wp.id, dough.id, 1, 'test', { autoBuy: true });
    expect(r.wholesaleCost).toBeGreaterThan(0);
    expect(balanceOf(companyWallet(company.id))).toBe(before - r.wholesaleCost);
  });

  it('inventory never goes negative', () => {
    const { company } = bakery();
    addStock(company.id, 'commodity', 'flour', 3);
    expect(() => takeStock(company.id, 'commodity', 'flour', 4)).toThrow(/Not enough/);
    expect(getQty(company.id, 'commodity', 'flour')).toBe(3);
    const neg = sqlite.prepare('SELECT COUNT(*) n FROM inventory WHERE qty < 0').get() as { n: number };
    expect(neg.n).toBe(0);
  });

  it('production queues turn inputs into stock over ticks', () => {
    const { company, wp } = bakery();
    const dough = productsFor('bakery')[0];
    products.queueProduction(company.id, wp.id, dough.id, 3, 'test', { autoBuy: true });
    db.update(schema.companyProducts).set({ onSale: false }).where(eq(schema.companyProducts.companyId, company.id)).run();
    const t0 = clock.now();
    for (let i = 1; i <= 40; i++) {
      clock.set(t0 + i * cfg().tick.intervalMs);
      db.update(schema.companies).set({ lastActiveAt: clock.now() }).where(eq(schema.companies.id, company.id)).run();
      runTick(clock.now());
    }
    clock.set(null);
    expect(getQty(company.id, 'product', dough.id)).toBe(3);
  });

  it('perishables spoil over time', () => {
    const { company } = bakery();
    addStock(company.id, 'commodity', 'eggs', 1000);
    const t0 = clock.now();
    for (let i = 1; i <= 30; i++) {
      clock.set(t0 + i * cfg().tick.intervalMs);
      db.update(schema.companies).set({ lastActiveAt: clock.now() }).where(eq(schema.companies.id, company.id)).run();
      runTick(clock.now());
    }
    clock.set(null);
    const left = getQty(company.id, 'commodity', 'eggs');
    expect(left).toBeLessThan(1000);
    expect(left).toBeGreaterThan(800);
  });

  it('demand falls as price rises (for every customer type)', () => {
    for (const sens of [0.4, 1, 1.8]) {
      let prev = 1;
      for (const ratio of [0.5, 0.8, 1, 1.5, 2, 3, 4]) {
        const p = purchaseProbability({ price: 10 * ratio, basePrice: 10, quality: 50, reputation: 300, demandBase: 1, elasticity: 1.6, priceSensitivity: sens, qualityCare: 1, season: 1, trend: 1, competition: 1 });
        expect(p).toBeLessThanOrEqual(prev);
        prev = p;
      }
    }
  });

  it('price floors and ceilings hold', () => {
    const { company } = bakery();
    const p = productsFor('bakery')[2];
    const b = priceBounds(p.basePrice, cfg().products.priceFloor, cfg().products.priceCeiling, 4);
    expect(() => products.setPricing(company.id, p.id, { price: b.min - 1 })).toThrow(/between/);
    expect(() => products.setPricing(company.id, p.id, { price: b.max + 1 })).toThrow(/between/);
    expect(() => products.setPricing(company.id, p.id, { price: b.max })).not.toThrow();
  });

  it('no infinite-money loop: buying from and selling to the NPC wholesaler always loses', () => {
    const { company } = bakery(100_000);
    for (const cid of ['flour', 'eggs', 'gold', 'moon-rocks']) {
      const before = balanceOf(companyWallet(company.id));
      products.buyFromWholesaler(company.id, cid, 50, 'test');
      products.sellToWholesaler(company.id, 'commodity', cid, 50, 'test');
      expect(balanceOf(companyWallet(company.id))).toBeLessThan(before);
    }
    // producing goods from wholesale inputs and dumping them to the wholesaler also loses
    const { company: c2, wp } = bakery(100_000);
    const cake = productsFor('bakery')[5];
    db.update(schema.workplaces).set({ kind: 3 }).where(eq(schema.workplaces.id, wp.id)).run();
    const start = balanceOf(companyWallet(c2.id));
    const q = products.queueProduction(c2.id, wp.id, cake.id, 1, 'test', { autoBuy: true });
    addStock(c2.id, 'product', cake.id, 1);
    products.sellToWholesaler(c2.id, 'product', cake.id, 1, 'test');
    expect(balanceOf(companyWallet(c2.id))).toBeLessThan(start);
    void q;
  });

  it('the NPC demand pool never overspends and thousands of sales keep the ledger balanced', () => {
    const { company } = bakery();
    const dough = productsFor('bakery')[0];
    addStock(company.id, 'product', dough.id, 5000, 80);
    products.setPricing(company.id, dough.id, { price: dough.basePrice, onSale: true });
    // shrink the pool so it runs dry during the test
    const pool = balanceOf(SYS.NPC);
    post({ kind: 'test.drain', legs: [{ from: SYS.NPC, to: SYS.TREASURY, amount: pool - 2000 }] });
    const t0 = clock.now();
    let soldBefore = 0;
    for (let i = 1; i <= 400; i++) {
      clock.set(t0 + i * cfg().tick.intervalMs);
      db.update(schema.companies).set({ lastActiveAt: clock.now(), reputation: 500 }).where(eq(schema.companies.id, company.id)).run();
      runTick(clock.now());
      expect(balanceOf(SYS.NPC)).toBeGreaterThanOrEqual(0);
    }
    clock.set(null);
    const sold = (sqlite.prepare('SELECT COALESCE(SUM(qty),0) s FROM sales_orders WHERE company_id = ?').get(company.id) as { s: number }).s;
    expect(sold).toBeGreaterThan(soldBefore + 50);
    const v = verifyLedger();
    expect(v.sum).toBe(0);
    expect(v.mismatches).toEqual([]);
  });

  it('financial statements add up', () => {
    const { company } = bakery();
    const f = products.financials(company.id, 24);
    expect(f.balance.assets).toBe(f.balance.cash + f.balance.inventory + f.balance.properties + f.balance.investments);
    expect(f.income.grossMargin).toBe(f.income.revenue - f.income.cogs);
    expect(getCommodity('flour').basePrice).toBeGreaterThan(0);
  });
});
