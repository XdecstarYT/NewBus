import { describe, it, expect, beforeAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { setupGame, makeCompany } from './helpers';
import { db, schema } from '../src/db';
import { approveIpo, getAsset, holding, marketTick, findAssetBySymbol, setOwnerPrice, TREASURY_HOLDER, setHalt } from '../src/exchange/assets';
import { placeOrder, cancelOrder, orderBook } from '../src/exchange/orders';
import { payDividends, setDrip } from '../src/exchange/corporate';
import { fundamentalValue, mmQuote, breakerTripped, driftToward } from '../src/exchange/math';
import { verifyLedger, balanceOf, post, SYS } from '../src/services/ledger';
import { companyWallet } from '../src/services/money';
import { clock } from '../src/lib/time';
import { cfg } from '../src/services/settings';
import { makeRng, reseedLive } from '../src/engine/rng';

function listed(mode: 'FUNDAMENTALS' | 'PLAYER' | 'OWNER', price = 20, name = `Listed ${Math.random()}`) {
  const { company } = makeCompany({ name, startingBits: 50_000 });
  const asset = approveIpo(company.id, { shares: 10_000, price, founderPct: 60, priceMode: mode, dividendPct: 50 }, 'test');
  return { company, asset };
}
/** In PLAYER mode the desk only sells the IPO float; buy it all so only players remain. */
function drainFloat(assetId: string, buyerId: string) {
  const left = getAsset(assetId).primaryRemaining;
  if (left > 0) placeOrder({ holderId: buyerId, assetId, side: 'buy', type: 'market', qty: left });
}
const shares = (assetId: string) => (db.select({ s: sql<number>`COALESCE(SUM(qty),0)` }).from(schema.holdings).where(eq(schema.holdings.assetId, assetId)).get()!.s);

describe('Bit Exchange', () => {
  beforeAll(() => {
    setupGame();
    reseedLive(777);
  });

  it('IPO: founder keeps their %, the float sits with the Treasury desk and primary sales pay the company', () => {
    const { company, asset } = listed('FUNDAMENTALS');
    expect(holding(company.id, asset.id)?.qty).toBe(6000);
    expect(holding(TREASURY_HOLDER, asset.id)?.qty).toBe(4000);
    const buyer = makeCompany({ name: 'Investor A', startingBits: 50_000 }).company;
    const before = balanceOf(companyWallet(company.id));
    const r = placeOrder({ holderId: buyer.id, assetId: asset.id, side: 'buy', type: 'market', qty: 100 });
    expect(r.order.filled).toBe(100);
    expect(holding(buyer.id, asset.id)?.qty).toBe(100);
    expect(balanceOf(companyWallet(company.id))).toBeGreaterThan(before); // IPO proceeds
    expect(getAsset(asset.id).primaryRemaining).toBe(3900);
    expect(shares(asset.id)).toBe(10_000);
  });

  it('matches limit orders between players with price-time priority', () => {
    const { asset } = listed('PLAYER', 10);
    const a = makeCompany({ name: 'Trader A', startingBits: 100_000 }).company;
    const b = makeCompany({ name: 'Trader B', startingBits: 100_000 }).company;
    drainFloat(asset.id, a.id);
    expect(holding(a.id, asset.id)?.qty).toBe(4000);
    // A posts two asks; B's buy limit should take the cheaper one first
    placeOrder({ holderId: a.id, assetId: asset.id, side: 'sell', type: 'limit', qty: 100, limitPrice: 12 });
    placeOrder({ holderId: a.id, assetId: asset.id, side: 'sell', type: 'limit', qty: 100, limitPrice: 11 });
    const book = orderBook(asset.id);
    expect(book.asks[0].price).toBe(11);
    const r = placeOrder({ holderId: b.id, assetId: asset.id, side: 'buy', type: 'limit', qty: 150, limitPrice: 12 });
    expect(r.fills[0].price).toBe(11);
    expect(r.fills[1].price).toBe(12);
    expect(holding(b.id, asset.id)?.qty).toBe(150);
    expect(getAsset(asset.id).price).toBe(12); // player-driven: last trade is the price
    expect(shares(asset.id)).toBe(10_000);
  });

  it('a resting buy limit escrows Bits and refunds them on cancel', () => {
    const { asset } = listed('PLAYER', 10);
    const a = makeCompany({ name: 'Escrower', startingBits: 10_000 }).company;
    const before = balanceOf(companyWallet(a.id));
    const r = placeOrder({ holderId: a.id, assetId: asset.id, side: 'buy', type: 'limit', qty: 50, limitPrice: 5 });
    expect(r.order.status).toBe('open');
    expect(balanceOf(companyWallet(a.id))).toBeLessThan(before);
    cancelOrder(a.id, r.order.id);
    expect(balanceOf(companyWallet(a.id))).toBe(before);
  });

  it('blocks wash trades: you never match against yourself or a linked account', () => {
    const { asset } = listed('PLAYER', 10);
    const a = makeCompany({ name: 'Washer A', startingBits: 50_000 });
    const b = makeCompany({ name: 'Washer B', startingBits: 50_000 });
    drainFloat(asset.id, a.company.id);
    placeOrder({ holderId: a.company.id, assetId: asset.id, side: 'sell', type: 'limit', qty: 50, limitPrice: 10 });
    // A's own buy must not match A's own ask (it goes to the book instead)
    const self = placeOrder({ holderId: a.company.id, assetId: asset.id, side: 'buy', type: 'limit', qty: 10, limitPrice: 10 });
    expect(self.fills.length).toBe(0);
    cancelOrder(a.company.id, self.order.id);
    // linked accounts can't trade with each other either
    db.update(schema.accounts).set({ linkedGroup: 'wash' }).where(eq(schema.accounts.id, a.account.id)).run();
    db.update(schema.accounts).set({ linkedGroup: 'wash' }).where(eq(schema.accounts.id, b.account.id)).run();
    const linked = placeOrder({ holderId: b.company.id, assetId: asset.id, side: 'buy', type: 'limit', qty: 10, limitPrice: 10 });
    expect(linked.fills.filter((f) => f.counter === a.company.id).length).toBe(0);
  });

  it('fundamentals mode pulls the price toward the fair value from real activity', () => {
    const w = cfg().exchange.fundamentals;
    const small = fundamentalValue({ netWorth: 1000, profitPerTick: 1, workers: 2, contracts: 0, level: 1, creditScore: 650, growth: 1, shares: 1000 }, w);
    const big = fundamentalValue({ netWorth: 100_000, profitPerTick: 50, workers: 20, contracts: 10, level: 10, creditScore: 800, growth: 1.2, shares: 1000 }, w);
    expect(big).toBeGreaterThan(small);
    let mid = 10;
    for (let i = 0; i < 300; i++) mid = driftToward(mid, 50, 0.03, 0, 0.5);
    expect(mid).toBeGreaterThan(49);
    const { company, asset } = listed('FUNDAMENTALS', 5);
    post({ kind: 'test.boost', legs: [{ from: SYS.MINT, to: companyWallet(company.id), amount: 2_000_000 }] });
    const p0 = getAsset(asset.id).price;
    for (let i = 0; i < 200; i++) marketTick(clock.now());
    expect(getAsset(asset.id).price).toBeGreaterThan(p0);
  });

  it('owner-controlled mode holds the owner price', () => {
    const { asset } = listed('OWNER', 20);
    setOwnerPrice(asset.id, 77, 'test');
    for (let i = 0; i < 20; i++) marketTick(clock.now());
    expect(getAsset(asset.id).price).toBe(77);
    const q = mmQuote(77, cfg().exchange.mmSpreadBps);
    expect(q.ask).toBeGreaterThanOrEqual(77);
    expect(q.bid).toBeLessThanOrEqual(77);
  });

  it('pays dividends through the ledger and auto-reinvests with DRIP', () => {
    const { company, asset } = listed('FUNDAMENTALS', 10);
    const inv = makeCompany({ name: 'Dividend Fan', startingBits: 50_000 }).company;
    placeOrder({ holderId: inv.id, assetId: asset.id, side: 'buy', type: 'market', qty: 1000 });
    setDrip(inv.id, asset.id, true);
    const sharesBefore = holding(inv.id, asset.id)!.qty;
    // the company makes a profit after the last payout
    clock.set(clock.now() + 1000);
    post({ kind: 'income.test', legs: [{ from: SYS.MINT, to: companyWallet(company.id), amount: 100_000 }] });
    clock.set(clock.now() + cfg().exchange.dividendIntervalMs + 1000);
    payDividends(clock.now());
    clock.set(null);
    const divs = db.select().from(schema.dividends).where(eq(schema.dividends.holderId, inv.id)).all();
    expect(divs.length).toBe(1);
    expect(divs[0].amount).toBeGreaterThan(0);
    expect(divs[0].reinvestedQty).toBeGreaterThan(0);
    expect(holding(inv.id, asset.id)!.qty).toBeGreaterThan(sharesBefore);
  });

  it('circuit breakers halt trading on big daily moves', () => {
    expect(breakerTripped(130, 100, 25)).toBe(true);
    expect(breakerTripped(120, 100, 25)).toBe(false);
    const { asset } = listed('PLAYER', 10);
    const a = makeCompany({ name: 'Pumper', startingBits: 500_000 }).company;
    const b = makeCompany({ name: 'Dumper', startingBits: 500_000 }).company;
    drainFloat(asset.id, a.id);
    placeOrder({ holderId: a.id, assetId: asset.id, side: 'sell', type: 'limit', qty: 10, limitPrice: 40 });
    placeOrder({ holderId: b.id, assetId: asset.id, side: 'buy', type: 'limit', qty: 10, limitPrice: 40 });
    expect(getAsset(asset.id).halted).toBe(true);
    expect(() => placeOrder({ holderId: b.id, assetId: asset.id, side: 'buy', type: 'market', qty: 1 })).toThrow(/halted/);
    setHalt(asset.id, false, '', null);
  });

  it('keeps the ledger balanced and shares conserved after thousands of random trades', () => {
    const stock = listed('FUNDAMENTALS', 15).asset;
    const etf = findAssetBySymbol('BIT500')!;
    const coin = findAssetBySymbol('DUCK')!;
    const traders = Array.from({ length: 8 }, (_, i) => makeCompany({ name: `Rnd ${i}`, startingBits: 200_000 }).company.id);
    const rng = makeRng(31337);
    let ok = 0;
    for (let i = 0; i < 2500; i++) {
      const who = rng.pick(traders);
      const a = rng.pick([stock, etf, coin]);
      const side = rng.chance(0.5) ? 'buy' : 'sell';
      const type = rng.chance(0.6) ? 'market' : 'limit';
      const price = Math.max(1, getAsset(a.id).price + rng.int(-2, 2));
      try {
        const r = placeOrder({ holderId: who, assetId: a.id, side, type, qty: rng.int(1, 30), limitPrice: type === 'limit' ? price : null });
        if (r.order.filled > 0) ok++;
        if (r.order.status === 'open' && rng.chance(0.5)) cancelOrder(who, r.order.id);
      } catch {}
      if (i % 250 === 0) marketTick(clock.now());
    }
    expect(ok).toBeGreaterThan(500);
    expect(shares(stock.id)).toBe(getAsset(stock.id).sharesOutstanding);
    for (const x of [etf, coin]) expect(shares(x.id)).toBe(getAsset(x.id).sharesOutstanding);
    const v = verifyLedger();
    expect(v.sum).toBe(0);
    expect(v.mismatches).toEqual([]);
    const neg = db.select().from(schema.wallets).all().filter((w) => w.balance < 0 && w.id !== SYS.MINT);
    expect(neg).toEqual([]);
  });
});
