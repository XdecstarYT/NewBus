/**
 * Corporate actions & views: dividends + DRIP, bond coupons, board votes
 * (dividend size, buybacks, new workplace, takeovers), stock splits,
 * watchlists & price alerts, portfolio, market overview, heat map.
 */
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { db, schema, atomic, sqlite } from '../db';
import { cfg } from '../services/settings';
import { clock } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { SYS, post, balanceOf } from '../services/ledger';
import { companyWallet, recordEarnings } from '../services/money';
import { getCompany } from '../services/companies';
import { getIndustry } from '../services/catalog';
import { notify } from '../services/notifications';
import { addNews } from '../services/news';
import { audit } from '../services/audit';
import { bump } from '../services/stats';
import { unlockWorkplace } from '../services/office';
import { getAsset, holding, setHolding, stockOf, TREASURY_HOLDER, candles, changeOver, listedAssets, marketMaker, recordPrice } from './assets';
import { placeOrder, cancelAllForAsset } from './orders';
import { diversification } from './math';
import { setHoldingsValueFn } from '../services/products';

// ------------------------------------------------------------ dividends & DRIP
export function payDividends(now: number) {
  const c = cfg();
  const stocks = db.select().from(schema.assets).where(and(eq(schema.assets.type, 'STOCK'), eq(schema.assets.listed, true))).all();
  for (const a of stocks) {
    if (!a.companyId || a.dividendPct <= 0) continue;
    const data = (a.data ?? {}) as Record<string, any>;
    const last = data.lastDividendAt ?? a.createdAt;
    if (now - last < c.exchange.dividendIntervalMs) continue;
    atomic(() => {
      const wallet = companyWallet(a.companyId!);
      // profit since the last payout = everything that came in minus everything that went out
      const r = sqlite
        .prepare(
          `SELECT
            COALESCE(SUM(CASE WHEN to_wallet LIKE ? AND from_wallet NOT LIKE ? THEN amount END),0) AS inflow,
            COALESCE(SUM(CASE WHEN from_wallet LIKE ? AND to_wallet NOT LIKE ? THEN amount END),0) AS outflow
           FROM ledger_entries WHERE created_at > ? AND kind NOT LIKE 'trade.%' AND kind NOT LIKE 'dividend.%' AND kind NOT LIKE 'loan.%'`,
        )
        .get(`w:company:${a.companyId}:%`, `w:company:${a.companyId}:%`, `w:company:${a.companyId}:%`, `w:company:${a.companyId}:%`, last) as { inflow: number; outflow: number };
      const profit = r.inflow - r.outflow;
      data.lastDividendAt = now;
      db.update(schema.assets).set({ data }).where(eq(schema.assets.id, a.id)).run();
      if (profit <= 0) return;
      const holders = db.select().from(schema.holdings).where(and(eq(schema.holdings.assetId, a.id), sql`${schema.holdings.qty} > 0`)).all();
      const external = holders.filter((h) => h.holderId !== a.companyId);
      const extShares = external.reduce((s, h) => s + h.qty, 0);
      if (!extShares) return;
      // only the outside holders' share of the pool actually leaves the company
      const pool = Math.min(balanceOf(wallet), Math.floor(((profit * a.dividendPct) / 100) * (extShares / a.sharesOutstanding)));
      if (pool <= 0) return;
      const perShare = pool / extShares;
      let paidTotal = 0;
      for (const h of external) {
        const amount = Math.floor(perShare * h.qty);
        if (amount <= 0) continue;
        const to = h.holderId === TREASURY_HOLDER ? SYS.TREASURY : companyWallet(h.holderId);
        post({ kind: 'dividend.pay', memo: `$${a.symbol} dividend`, idempotencyKey: `div:${a.id}:${now}:${h.holderId}`, legs: [{ from: wallet, to, amount }] });
        paidTotal += amount;
        let reinvested = 0;
        if (h.holderId !== TREASURY_HOLDER) {
          recordEarnings(h.holderId, amount);
          bump(h.holderId, 'dividends', amount);
          if (h.drip) {
            const ask = marketMaker(getAsset(a.id)).ask ?? a.price;
            const qty = Math.floor(amount / (ask * 1.01));
            if (qty > 0) {
              try {
                const r2 = placeOrder({ holderId: h.holderId, assetId: a.id, side: 'buy', type: 'market', qty, system: 'drip' });
                reinvested = r2.order.filled;
                bump(h.holderId, 'dripShares', reinvested);
              } catch {}
            }
          }
          notify(h.holderId, 'dividend', `💸 $${a.symbol} dividend: +${amount} BT`, reinvested ? `🔁 Auto-reinvested into ${reinvested} more shares (DRIP).` : `${h.qty} shares x ${perShare.toFixed(2)} BT`);
        }
        db.insert(schema.dividends).values({ id: newId('div'), assetId: a.id, holderId: h.holderId, amount, reinvestedQty: reinvested, createdAt: now }).run();
      }
      if (paidTotal > 1000) addNews('market', `💸 $${a.symbol} pays ${paidTotal} BT in dividends!`, 'Shareholders do a little happy dance.', a.companyId);
    });
  }
}

export function setDrip(holderId: string, assetId: string, on: boolean) {
  const h = holding(holderId, assetId);
  if (!h) throw notFound('You do not hold that.');
  db.update(schema.holdings).set({ drip: on }).where(and(eq(schema.holdings.holderId, holderId), eq(schema.holdings.assetId, assetId))).run();
  return { ok: true };
}

// ------------------------------------------------------------ bonds
export function bondTick(now: number) {
  const b = cfg().exchange.bonds;
  const bonds = db.select().from(schema.assets).where(and(eq(schema.assets.type, 'BOND'), eq(schema.assets.listed, true))).all();
  for (const a of bonds) {
    const data = (a.data ?? {}) as Record<string, any>;
    if (now - (data.lastCouponAt ?? a.createdAt) < b.periodMs) continue;
    atomic(() => {
      data.lastCouponAt = now;
      db.update(schema.assets).set({ data }).where(eq(schema.assets.id, a.id)).run();
      const issuerWallet = data.issuer === 'treasury' ? SYS.TREASURY : companyWallet(data.issuer);
      const holders = db.select().from(schema.holdings).where(and(eq(schema.holdings.assetId, a.id), sql`${schema.holdings.qty} > 0`)).all();
      const matured = data.maturesAt && now >= data.maturesAt;
      for (const h of holders) {
        if (h.holderId === TREASURY_HOLDER) continue;
        const coupon = Math.floor((b.parValue * h.qty * (data.couponBps ?? b.couponBpsPerPeriod)) / 10_000);
        const due = coupon + (matured ? b.parValue * h.qty : 0);
        if (due <= 0) continue;
        const pay = Math.min(due, balanceOf(issuerWallet));
        if (pay > 0) post({ kind: 'bond.coupon', memo: `$${a.symbol} ${matured ? 'maturity' : 'coupon'}`, legs: [{ from: issuerWallet, to: companyWallet(h.holderId), amount: pay }] });
        if (pay < due && data.issuer !== 'treasury') {
          db.update(schema.companies).set({ creditScore: sql`MAX(300, ${schema.companies.creditScore} - 30)` }).where(eq(schema.companies.id, data.issuer)).run();
          notify(h.holderId, 'exchange', `😬 $${a.symbol} missed a payment`, `The issuer could only pay ${pay} of ${due} BT.`);
        }
      }
      if (matured) {
        db.delete(schema.holdings).where(eq(schema.holdings.assetId, a.id)).run();
        db.update(schema.assets).set({ listed: false, halted: true, haltReason: 'Matured' }).where(eq(schema.assets.id, a.id)).run();
      }
    });
  }
}

// ------------------------------------------------------------ board votes
export function createProposal(proposerId: string, assetId: string, kind: 'dividend' | 'buyback' | 'workplace' | 'takeover', data: Record<string, unknown>) {
  const a = getAsset(assetId);
  if (a.type !== 'STOCK' || !a.listed || !a.companyId) throw badRequest('Votes are only for listed stocks.');
  const c = cfg();
  const h = holding(proposerId, assetId);
  const pct = ((h?.qty ?? 0) / a.sharesOutstanding) * 100;
  if (proposerId !== a.companyId && pct < 5) throw forbidden('You need at least 5% of the shares (or be the company) to make a proposal.', 'proposal');
  if (kind === 'takeover' && pct < c.exchange.takeoverThresholdPct) throw forbidden(`Takeovers need ${c.exchange.takeoverThresholdPct}% of the shares.`, 'takeover');
  if (kind === 'dividend' && (typeof data.pct !== 'number' || data.pct < 0 || data.pct > 100)) throw badRequest('Dividend % must be 0-100.');
  if (kind === 'buyback' && (typeof data.amount !== 'number' || data.amount <= 0)) throw badRequest('Buyback needs a Bits amount.');
  const open = db.select({ n: sql<number>`count(*)` }).from(schema.proposals).where(and(eq(schema.proposals.assetId, assetId), eq(schema.proposals.status, 'open'))).get()!.n;
  if (open >= 3) throw badRequest('Too many open proposals. Let the shareholders breathe.');
  const id = newId('prp');
  db.insert(schema.proposals).values({ id, assetId, kind, data, proposerId, yes: 0, no: 0, status: 'open', endsAt: clock.now() + c.exchange.proposalDurationMs, createdAt: clock.now() }).run();
  for (const hh of db.select().from(schema.holdings).where(and(eq(schema.holdings.assetId, assetId), sql`${schema.holdings.qty} > 0`)).all()) {
    if (hh.holderId !== TREASURY_HOLDER) notify(hh.holderId, 'vote', `🗳️ New $${a.symbol} board vote: ${kind}`, 'Cast your vote on the Bit Exchange.');
  }
  return { id };
}

export function vote(holderId: string, proposalId: string, yes: boolean) {
  return atomic(() => {
    const p = db.select().from(schema.proposals).where(eq(schema.proposals.id, proposalId)).get();
    if (!p || p.status !== 'open') throw notFound('That vote is closed.');
    const h = holding(holderId, p.assetId);
    if (!h || h.qty <= 0) throw forbidden('Only shareholders can vote.', 'vote');
    const prev = db.select().from(schema.votes).where(and(eq(schema.votes.proposalId, proposalId), eq(schema.votes.holderId, holderId))).get();
    if (prev) {
      db.update(schema.proposals).set(prev.choice ? { yes: sql`${schema.proposals.yes} - ${prev.weight}` } : { no: sql`${schema.proposals.no} - ${prev.weight}` }).where(eq(schema.proposals.id, proposalId)).run();
      db.delete(schema.votes).where(and(eq(schema.votes.proposalId, proposalId), eq(schema.votes.holderId, holderId))).run();
    }
    db.insert(schema.votes).values({ proposalId, holderId, weight: h.qty, choice: yes }).run();
    db.update(schema.proposals).set(yes ? { yes: sql`${schema.proposals.yes} + ${h.qty}` } : { no: sql`${schema.proposals.no} + ${h.qty}` }).where(eq(schema.proposals.id, proposalId)).run();
    bump(holderId, 'votes');
    return { ok: true };
  });
}

/** Close finished votes and apply what passed. Takeovers wait for the owner. */
export function proposalTick(now: number) {
  const due = db.select().from(schema.proposals).where(and(eq(schema.proposals.status, 'open'), lte(schema.proposals.endsAt, now))).all();
  for (const p of due) {
    atomic(() => {
      const passed = p.yes > p.no;
      if (!passed) {
        db.update(schema.proposals).set({ status: 'rejected' }).where(eq(schema.proposals.id, p.id)).run();
        return;
      }
      if (p.kind === 'takeover') {
        db.update(schema.proposals).set({ status: 'awaiting_owner' }).where(eq(schema.proposals.id, p.id)).run();
        return;
      }
      applyProposal(p);
      db.update(schema.proposals).set({ status: 'passed' }).where(eq(schema.proposals.id, p.id)).run();
    });
  }
}

function applyProposal(p: typeof schema.proposals.$inferSelect) {
  const a = getAsset(p.assetId);
  const data = p.data as Record<string, any>;
  if (p.kind === 'dividend') {
    db.update(schema.assets).set({ dividendPct: Math.round(data.pct) }).where(eq(schema.assets.id, a.id)).run();
    addNews('market', `🗳️ $${a.symbol} shareholders set the dividend to ${Math.round(data.pct)}% of profit.`);
  } else if (p.kind === 'buyback') {
    buyback(a.id, data.amount);
  } else if (p.kind === 'workplace') {
    try {
      const co = getCompany(a.companyId!);
      unlockWorkplace(a.companyId!, Math.min(4, Number(data.kind ?? 1)), 'board');
      addNews('headline', `🏗️ ${co.name}'s shareholders voted for a new workplace!`);
    } catch (e: any) {
      notify(a.companyId!, 'vote', '🏗️ Workplace vote passed, but...', e.message);
    }
  }
}

/** Company buys back its own shares with Bits and retires them. */
export function buyback(assetId: string, amount: number) {
  const a = getAsset(assetId);
  if (!a.companyId) return;
  const budget = Math.min(amount, balanceOf(companyWallet(a.companyId)));
  const ask = marketMaker(a).ask ?? a.price;
  const qty = Math.floor(budget / (ask * 1.02));
  if (qty <= 0) return;
  const before = holding(a.companyId, a.id)?.qty ?? 0;
  try {
    placeOrder({ holderId: a.companyId, assetId: a.id, side: 'buy', type: 'market', qty, system: 'buyback' });
  } catch {
    return;
  }
  const bought = (holding(a.companyId, a.id)?.qty ?? 0) - before;
  if (bought > 0) {
    // retire the repurchased shares
    const h = holding(a.companyId, a.id)!;
    setHolding(a.companyId, a.id, h.qty - bought, h.costBasis);
    db.update(schema.assets).set({ sharesOutstanding: sql`${schema.assets.sharesOutstanding} - ${bought}` }).where(eq(schema.assets.id, a.id)).run();
    addNews('market', `🔁 $${a.symbol} bought back and retired ${bought} shares.`, 'Fewer shares, same company. Remaining holders rejoice.');
  }
}

export function approveTakeover(proposalId: string, approve: boolean, actorId: string) {
  return atomic(() => {
    const p = db.select().from(schema.proposals).where(eq(schema.proposals.id, proposalId)).get();
    if (!p || p.status !== 'awaiting_owner') throw notFound('No takeover awaiting approval.');
    const a = getAsset(p.assetId);
    if (approve) {
      // the acquirer buys the founder's remaining stake at the last price; the target gets the Bits
      const founder = holding(a.companyId!, a.id);
      const qty = founder?.qty ?? 0;
      if (qty > 0) {
        post({ kind: 'trade.takeover', memo: `Takeover of $${a.symbol}`, actorId, legs: [{ from: companyWallet(p.proposerId), to: companyWallet(a.companyId!), amount: qty * a.price }] });
        setHolding(a.companyId!, a.id, 0, 0);
        const acq = holding(p.proposerId, a.id);
        setHolding(p.proposerId, a.id, (acq?.qty ?? 0) + qty, (acq?.costBasis ?? 0) + qty * a.price);
      }
      const acquirer = getCompany(p.proposerId);
      db.update(schema.companies).set({ trophies: sql`json_insert(COALESCE(${schema.companies.trophies}, '[]'), '$[#]', ${`🦈 Took over $${a.symbol}`})` }).where(eq(schema.companies.id, p.proposerId)).run();
      addNews('headline', `🦈 TAKEOVER! ${acquirer.name} now controls $${a.symbol}!`, 'The boardroom is in shock. The snacks remain.');
    }
    db.update(schema.proposals).set({ status: approve ? 'passed' : 'vetoed' }).where(eq(schema.proposals.id, proposalId)).run();
    audit({ actorId, action: approve ? 'exchange.takeover_approve' : 'exchange.takeover_veto', targetType: 'proposal', targetId: proposalId });
    return { ok: true };
  });
}

export function proposalsFor(assetId: string, holderId?: string) {
  const rows = db.select().from(schema.proposals).where(eq(schema.proposals.assetId, assetId)).orderBy(desc(schema.proposals.createdAt)).limit(10).all();
  return rows.map((p) => ({ ...p, myVote: holderId ? db.select().from(schema.votes).where(and(eq(schema.votes.proposalId, p.id), eq(schema.votes.holderId, holderId))).get()?.choice ?? null : null }));
}

// ------------------------------------------------------------ split
export function split(assetId: string, ratio: number, actorId: string) {
  return atomic(() => {
    if (!Number.isInteger(ratio) || ratio < 2 || ratio > 10) throw badRequest('Split ratio must be 2-10.');
    const a = getAsset(assetId);
    if (a.type !== 'STOCK') throw badRequest('Only stocks split.');
    cancelAllForAsset(assetId);
    db.update(schema.holdings).set({ qty: sql`${schema.holdings.qty} * ${ratio}` }).where(eq(schema.holdings.assetId, assetId)).run();
    const price = Math.max(1, Math.round(a.price / ratio));
    db.update(schema.assets)
      .set({ sharesOutstanding: a.sharesOutstanding * ratio, primaryRemaining: a.primaryRemaining * ratio, price, fairValue: a.fairValue / ratio, dayOpen: Math.max(1, Math.round(a.dayOpen / ratio)) })
      .where(eq(schema.assets.id, assetId))
      .run();
    recordPrice(assetId, price, 0);
    audit({ actorId, action: 'exchange.split', targetType: 'asset', targetId: assetId, newValue: { ratio } });
    addNews('market', `✂️ $${a.symbol} splits ${ratio}-for-1!`, `Everyone now has ${ratio}x the shares at 1/${ratio} the price. Math!`);
    return { price };
  });
}

// ------------------------------------------------------------ watchlist & alerts
export function setWatch(companyId: string, assetId: string, on: boolean, alertAbove?: number | null, alertBelow?: number | null) {
  if (!on) {
    db.delete(schema.watchlist).where(and(eq(schema.watchlist.companyId, companyId), eq(schema.watchlist.assetId, assetId))).run();
    return { ok: true };
  }
  getAsset(assetId);
  db.insert(schema.watchlist)
    .values({ companyId, assetId, alertAbove: alertAbove ?? null, alertBelow: alertBelow ?? null })
    .onConflictDoUpdate({ target: [schema.watchlist.companyId, schema.watchlist.assetId], set: { alertAbove: alertAbove ?? null, alertBelow: alertBelow ?? null } })
    .run();
  return { ok: true };
}

export function alertTick() {
  const rows = db.select().from(schema.watchlist).where(sql`${schema.watchlist.alertAbove} IS NOT NULL OR ${schema.watchlist.alertBelow} IS NOT NULL`).all();
  for (const w of rows) {
    const a = db.select().from(schema.assets).where(eq(schema.assets.id, w.assetId)).get();
    if (!a) continue;
    if (w.alertAbove != null && a.price >= w.alertAbove) {
      notify(w.companyId, 'alert', `📈 $${a.symbol} hit ${a.price} BT`, `Your "above ${w.alertAbove}" alert fired.`);
      db.update(schema.watchlist).set({ alertAbove: null }).where(and(eq(schema.watchlist.companyId, w.companyId), eq(schema.watchlist.assetId, w.assetId))).run();
    }
    if (w.alertBelow != null && a.price <= w.alertBelow) {
      notify(w.companyId, 'alert', `📉 $${a.symbol} fell to ${a.price} BT`, `Your "below ${w.alertBelow}" alert fired.`);
      db.update(schema.watchlist).set({ alertBelow: null }).where(and(eq(schema.watchlist.companyId, w.companyId), eq(schema.watchlist.assetId, w.assetId))).run();
    }
  }
}

// ------------------------------------------------------------ views
function assetSummary(a: typeof schema.assets.$inferSelect) {
  const co = a.companyId ? getCompany(a.companyId) : null;
  return {
    id: a.id,
    symbol: a.symbol,
    name: a.name,
    type: a.type,
    price: a.price,
    marketCap: a.price * a.sharesOutstanding,
    change24h: changeOver(a.id, 24 * 3600_000),
    change7d: changeOver(a.id, 7 * 24 * 3600_000),
    halted: a.halted,
    haltReason: a.haltReason,
    priceMode: a.priceMode,
    company: co ? { id: co.id, name: co.name, emoji: co.emoji, color: co.color, industry: getIndustry(co.industryId).name, category: getIndustry(co.industryId).categoryId } : null,
    volume24h: (sqlite.prepare(`SELECT COALESCE(SUM(qty),0) s FROM trades WHERE asset_id = ? AND created_at > ?`).get(a.id, clock.now() - 24 * 3600_000) as { s: number }).s,
  };
}

export function marketOverview(companyId: string) {
  const assets = listedAssets().map(assetSummary);
  const watch = new Set(db.select().from(schema.watchlist).where(eq(schema.watchlist.companyId, companyId)).all().map((w) => w.assetId));
  const co = getCompany(companyId);
  const indexes = db.select().from(schema.indexes).all();
  return {
    assets: assets.map((a) => ({ ...a, watched: watch.has(a.id) })),
    indexes,
    myStock: stockOf(companyId) ?? null,
    ipoStatus: co.ipoStatus,
    ipoRequest: co.ipoRequest,
    fees: { tradingBps: cfg().economy.tradingFeeBps },
  };
}

export function assetDetail(assetId: string, companyId: string) {
  const a = getAsset(assetId);
  const h = holding(companyId, assetId);
  const w = db.select().from(schema.watchlist).where(and(eq(schema.watchlist.companyId, companyId), eq(schema.watchlist.assetId, assetId))).get();
  const holders = db.select().from(schema.holdings).where(and(eq(schema.holdings.assetId, assetId), sql`${schema.holdings.qty} > 0`)).orderBy(desc(schema.holdings.qty)).limit(10).all();
  const names = new Map(db.select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji }).from(schema.companies).all().map((c) => [c.id, `${c.emoji} ${c.name}`]));
  return {
    ...assetSummary(a),
    sharesOutstanding: a.sharesOutstanding,
    primaryRemaining: a.primaryRemaining,
    dividendPct: a.dividendPct,
    lockupUntil: a.lockupUntil,
    dayOpen: a.dayOpen,
    data: a.data,
    candles: candles(assetId, 120),
    position: h ?? null,
    watch: w ?? null,
    topHolders: holders.map((x) => ({ holder: x.holderId === TREASURY_HOLDER ? '🏦 Treasury desk' : names.get(x.holderId) ?? x.holderId, qty: x.qty, pct: a.sharesOutstanding ? Math.round((x.qty / a.sharesOutstanding) * 1000) / 10 : 0 })),
    proposals: proposalsFor(assetId, companyId),
    dividends: db.select().from(schema.dividends).where(and(eq(schema.dividends.assetId, assetId), eq(schema.dividends.holderId, companyId))).orderBy(desc(schema.dividends.createdAt)).limit(20).all(),
  };
}

export function portfolio(companyId: string) {
  const rows = db.select().from(schema.holdings).where(eq(schema.holdings.holderId, companyId)).all();
  const positions = rows.map((h) => {
    const a = getAsset(h.assetId);
    const value = h.qty * a.price;
    return { assetId: a.id, symbol: a.symbol, name: a.name, type: a.type, qty: h.qty, price: a.price, value, costBasis: h.costBasis, pnl: value - h.costBasis, pnlPct: h.costBasis ? Math.round(((value - h.costBasis) / h.costBasis) * 1000) / 10 : 0, drip: h.drip, own: a.companyId === companyId };
  });
  const dividends = db.select().from(schema.dividends).where(eq(schema.dividends.holderId, companyId)).orderBy(desc(schema.dividends.createdAt)).limit(30).all();
  const cash = (sqlite.prepare(`SELECT COALESCE(SUM(balance),0) s FROM wallets WHERE owner_type='company' AND owner_id = ?`).get(companyId) as { s: number }).s;
  const invested = positions.filter((p) => !p.own).reduce((s, p) => s + p.value, 0);
  const history = db.select().from(schema.snapshots).where(eq(schema.snapshots.scope, `company:${companyId}`)).orderBy(desc(schema.snapshots.createdAt)).limit(72).all().reverse();
  return {
    positions,
    dividends: dividends.map((d) => ({ ...d, symbol: getAsset(d.assetId).symbol })),
    totals: { invested, cash, netWorth: cash + invested, pnl: positions.filter((p) => !p.own).reduce((s, p) => s + p.pnl, 0), diversification: diversification(positions.filter((p) => !p.own).map((p) => p.value)) },
    netWorthHistory: history.map((s) => ({ t: s.createdAt, v: (s.data as any).netWorth })),
    orders: db.select().from(schema.orders).where(and(eq(schema.orders.holderId, companyId), eq(schema.orders.status, 'open'))).all().map((o) => ({ ...o, symbol: getAsset(o.assetId).symbol })),
  };
}

export function heatmap() {
  return listedAssets()
    .filter((a) => a.type === 'STOCK')
    .map((a) => ({ symbol: a.symbol, cap: a.price * a.sharesOutstanding, change: changeOver(a.id, 24 * 3600_000) }));
}

/** Hourly net-worth snapshots for portfolio charts. */
export function snapshotNetWorth() {
  const companies = db.select({ id: schema.companies.id }).from(schema.companies).all();
  const now = clock.now();
  for (const c of companies) {
    const cash = (sqlite.prepare(`SELECT COALESCE(SUM(balance),0) s FROM wallets WHERE owner_type='company' AND owner_id = ?`).get(c.id) as { s: number }).s;
    const invested = holdingsValue(c.id);
    db.insert(schema.snapshots).values({ scope: `company:${c.id}`, data: { netWorth: cash + invested, cash, invested }, createdAt: now }).run();
  }
}

export function holdingsValue(companyId: string) {
  return (sqlite.prepare(`SELECT COALESCE(SUM(h.qty * a.price),0) s FROM holdings h JOIN assets a ON a.id = h.asset_id WHERE h.holder_id = ? AND (a.company_id IS NULL OR a.company_id != ?)`).get(companyId, companyId) as { s: number }).s;
}
setHoldingsValueFn(holdingsValue);

export { inArray };
