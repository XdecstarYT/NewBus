/** Seed sample market data: list a couple of demo companies and backfill an hour of price history. */
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { clock } from '../lib/time';
import { getAccountByNumber } from '../services/auth';
import { approveIpo, stockOf, marketTick, suggestedIpoPrice } from './assets';
import { placeOrder } from './orders';

export function seedDemoMarket(say: (s: string) => void) {
  const crusty = getAccountByNumber('02')?.companyId;
  const pixel = getAccountByNumber('03')?.companyId;
  const wheat = getAccountByNumber('04')?.companyId;
  const moon = getAccountByNumber('05')?.companyId;
  if (!crusty || !pixel || stockOf(crusty)) return;
  const a1 = approveIpo(crusty, { shares: 10_000, price: suggestedIpoPrice(crusty, 10_000), founderPct: 60, priceMode: 'FUNDAMENTALS', dividendPct: 25, symbol: 'CRUST' }, null as any);
  const a2 = approveIpo(pixel, { shares: 20_000, price: suggestedIpoPrice(pixel, 20_000), founderPct: 70, priceMode: 'FUNDAMENTALS', dividendPct: 15, symbol: 'PIXL' }, null as any);
  // backfill an hour of minute candles so charts aren't empty on day one
  const now = clock.now();
  for (let i = 60; i >= 1; i--) {
    clock.set(now - i * 60_000);
    marketTick(clock.now());
  }
  clock.set(null);
  for (const [buyer, asset, qty] of [
    [wheat, a1.id, 120],
    [moon, a1.id, 60],
    [wheat, a2.id, 200],
  ] as const) {
    if (!buyer) continue;
    try {
      placeOrder({ holderId: buyer, assetId: asset, side: 'buy', type: 'market', qty });
    } catch {}
  }
  db.update(schema.companies).set({ ipoStatus: 'listed' }).where(eq(schema.companies.id, crusty)).run();
  say('📈 Demo stocks $CRUST and $PIXL listed with an hour of price history');
}
