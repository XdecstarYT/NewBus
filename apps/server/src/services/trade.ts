/**
 * Player-to-player trade:
 *  - Supply market: sell commodities/products to other players (both sides earn a
 *    Treasury-funded "supply deal" bonus), plus private escrow deals for one company.
 *  - Marketplace & auction house: workers, decor, pets (escrowed while listed).
 *  - Invoices between companies.
 *  - Property (plots in districts) & vehicles (fleet).
 */
import { and, desc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { db, schema, atomic, sqlite } from '../db';
import { cfg } from './settings';
import { clock } from '../lib/time';
import { newId } from '../lib/ids';
import { SYS, post, balanceOf, walletId } from './ledger';
import { companyWallet, chargeCompany, payCompany, recordEarnings } from './money';
import { getCompany } from './companies';
import { getCompanyPermissions } from '../permissions';
import { getProduct, findProduct, getCommodity, findCommodity, getIndustry } from './catalog';
import { addStock, takeStock, getRow, freeSpace } from './inventory';
import { areLinked } from './bank';
import { recordFlag } from './anticheat';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { bump } from './stats';
import { notify } from './notifications';
import { audit } from './audit';
import { ITEM_MAP } from '../catalog/decor';
import { registerMultiplier } from './multipliers';
import { workerView } from './office';
import { toCompany } from '../lib/bus';

const itemName = (type: string, id: string) => (type === 'commodity' ? findCommodity(id) : findProduct(id));

// ============================================================ supply market
export function supplyMarket(companyId: string) {
  const co = getCompany(companyId);
  const ind = getIndustry(co.industryId);
  const rows = db
    .select()
    .from(schema.supplyListings)
    .where(and(eq(schema.supplyListings.status, 'open'), or(sql`${schema.supplyListings.targetId} IS NULL`, eq(schema.supplyListings.targetId, companyId), eq(schema.supplyListings.sellerId, companyId))))
    .orderBy(schema.supplyListings.unitPrice)
    .limit(200)
    .all();
  const names = new Map(db.select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji }).from(schema.companies).all().map((c) => [c.id, c]));
  const c = cfg();
  return {
    listings: rows.map((l) => ({ ...l, seller: names.get(l.sellerId), item: itemName(l.itemType, l.itemId), mine: l.sellerId === companyId, privateDeal: !!l.targetId })),
    needs: ind.needs.map((n) => ({ ...getCommodity(n), wholesaleBuy: Math.ceil(getCommodity(n).basePrice * c.products.commoditySellRatio), wholesaleSell: Math.floor(getCommodity(n).basePrice * c.products.commodityBuyRatio) })),
    supplies: ind.supplies.map((n) => ({ ...getCommodity(n), wholesaleSell: Math.floor(getCommodity(n).basePrice * c.products.commodityBuyRatio) })),
    dealBonusBps: c.products.supplyDealBonusBps,
    history: sqlite.prepare(`SELECT item_key AS itemKey, price, qty, created_at AS createdAt FROM price_ticks WHERE market='supply' ORDER BY id DESC LIMIT 40`).all(),
  };
}

export function listSupply(companyId: string, input: { itemType: 'commodity' | 'product'; itemId: string; qty: number; unitPrice: number; targetId?: string | null }, actorId: string) {
  return atomic(() => {
    const perms = getCompanyPermissions(companyId);
    if (!perms.limits.canSellToPlayers) throw forbidden('The Owner has not allowed you to sell to other players.', 'limit');
    if (input.itemType === 'product' && !perms.limits.allowedSalesChannels.includes('players')) throw forbidden('Selling products to players is not an allowed channel for you.', 'limit');
    const def = itemName(input.itemType, input.itemId);
    if (!def) throw notFound('Unknown item.');
    const base = input.itemType === 'commodity' ? getCommodity(input.itemId).basePrice : getProduct(input.itemId).basePrice;
    const c = cfg();
    // NPC wholesalers set the floor & ceiling for player prices
    const min = Math.max(1, Math.floor(base * c.products.commodityBuyRatio * 0.8));
    const max = Math.ceil(base * c.products.commoditySellRatio * 2);
    if (input.unitPrice < min || input.unitPrice > max) throw badRequest(`Price must be between ${min} and ${max} BT per unit.`, 'price_bounds');
    if (input.targetId) {
      getCompany(input.targetId);
      if (input.targetId === companyId) throw badRequest('A deal with yourself? Bold.');
    }
    const row = getRow(companyId, input.itemType, input.itemId);
    takeStock(companyId, input.itemType, input.itemId, input.qty); // escrowed: removed from stock while listed
    const id = newId('sup');
    db.insert(schema.supplyListings).values({ id, sellerId: companyId, itemType: input.itemType, itemId: input.itemId, qty: input.qty, unitPrice: input.unitPrice, status: 'open', targetId: input.targetId ?? null, quality: row?.quality ?? 50, createdAt: clock.now() }).run();
    if (input.targetId) notify(input.targetId, 'trade', `🤝 Private supply deal from ${getCompany(companyId).name}`, `${input.qty}x ${def.name} at ${input.unitPrice} BT each. Check the Supply Chain page.`);
    audit({ actorId, action: 'supply.list', targetType: 'listing', targetId: id, newValue: input });
    return { id };
  });
}

export function cancelSupply(companyId: string, id: string) {
  return atomic(() => {
    const l = db.select().from(schema.supplyListings).where(and(eq(schema.supplyListings.id, id), eq(schema.supplyListings.sellerId, companyId))).get();
    if (!l || l.status !== 'open') throw notFound('No such open listing.');
    addStock(companyId, l.itemType as any, l.itemId, l.qty, l.quality);
    db.update(schema.supplyListings).set({ status: 'cancelled' }).where(eq(schema.supplyListings.id, id)).run();
    return { ok: true };
  });
}

export function buySupply(buyerId: string, id: string, qty: number, actorId: string) {
  return atomic(() => {
    const l = db.select().from(schema.supplyListings).where(eq(schema.supplyListings.id, id)).get();
    if (!l || l.status !== 'open') throw notFound('That listing just sold out.');
    if (l.sellerId === buyerId) throw badRequest('Buying your own stuff? Cancel the listing instead.');
    if (l.targetId && l.targetId !== buyerId) throw forbidden('That is a private deal for another company.');
    if (areLinked(l.sellerId, buyerId)) {
      recordFlag('linked_trade', buyerId, `Blocked supply trade with linked company ${l.sellerId}`, 2);
      throw forbidden('Trades between linked accounts are blocked.', 'linked');
    }
    const n = Math.min(qty, l.qty);
    if (n <= 0) throw badRequest('Quantity must be positive.');
    const co = getCompany(buyerId);
    if (freeSpace(buyerId, co.warehouseLevel) < n) throw badRequest('Not enough warehouse space.');
    const total = n * l.unitPrice;
    const c = cfg();
    const fee = Math.floor((total * c.economy.marketplaceFeeBps) / 10_000);
    chargeCompany({ companyId: buyerId, amount: total, to: companyWallet(l.sellerId), kind: 'supply.buy', memo: `${n}x ${itemName(l.itemType, l.itemId)?.name}`, actorId });
    if (fee) post({ kind: 'fee.market', legs: [{ from: companyWallet(l.sellerId), to: SYS.TREASURY, amount: fee }] });
    recordEarnings(l.sellerId, total - fee);
    addStock(buyerId, l.itemType as any, l.itemId, n, l.quality);
    const left = l.qty - n;
    db.update(schema.supplyListings).set({ qty: left, status: left <= 0 ? 'sold' : 'open' }).where(eq(schema.supplyListings.id, id)).run();
    // player-to-player supply deals earn both sides a Treasury-funded bonus
    const bonus = Math.floor((total * c.products.supplyDealBonusBps) / 10_000);
    if (bonus > 0) {
      payCompany({ companyId: buyerId, amount: bonus, from: SYS.TREASURY, kind: 'reward.supply_deal', memo: 'Supply deal bonus', partial: true });
      payCompany({ companyId: l.sellerId, amount: bonus, from: SYS.TREASURY, kind: 'reward.supply_deal', memo: 'Supply deal bonus', partial: true });
    }
    db.insert(schema.priceTicks).values({ market: 'supply', itemKey: `${l.itemType}:${l.itemId}`, price: l.unitPrice, qty: n, createdAt: clock.now() }).run();
    db.insert(schema.salesOrders).values({ id: newId('so'), companyId: l.sellerId, productId: l.itemId, qty: n, unitPrice: l.unitPrice, total, channel: 'players', customerType: null, buyerCompanyId: buyerId, createdAt: clock.now() }).run();
    bump(buyerId, 'supplyDeals');
    if (l.itemType === 'commodity') bump('global', `commodity:${l.itemId}:bought`, n);
    bump(l.sellerId, 'supplyDeals');
    notify(l.sellerId, 'trade', `📦 Sold ${n}x ${itemName(l.itemType, l.itemId)?.name}`, `${co.name} paid ${total} BT (+${bonus} BT deal bonus for you both!)`);
    return { qty: n, total, bonus };
  });
}

// ============================================================ marketplace / auction house
export function marketListings(companyId: string) {
  const rows = db.select().from(schema.marketListings).where(eq(schema.marketListings.status, 'open')).orderBy(schema.marketListings.endsAt).limit(200).all();
  const names = new Map(db.select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji }).from(schema.companies).all().map((c) => [c.id, c]));
  return {
    listings: rows.map((l) => ({ ...l, seller: names.get(l.sellerId), mine: l.sellerId === companyId, leading: l.highBidder === companyId, preview: listingPreview(l) })),
    history: sqlite.prepare(`SELECT item_key AS itemKey, price, created_at AS createdAt FROM price_ticks WHERE market='auction' ORDER BY id DESC LIMIT 30`).all(),
    feeBps: cfg().economy.marketplaceFeeBps,
  };
}

function listingPreview(l: typeof schema.marketListings.$inferSelect) {
  if (l.itemType === 'worker') {
    const w = db.select().from(schema.workers).where(eq(schema.workers.id, l.itemRef)).get();
    return w ? workerView(w) : null;
  }
  const it = db.select().from(schema.items).where(eq(schema.items.id, l.itemRef)).get();
  return it ? { ...it, def: ITEM_MAP.get(it.itemKey) } : null;
}

export function createListing(companyId: string, input: { itemType: 'worker' | 'item'; itemRef: string; buyNowPrice?: number | null; startPrice: number; hours: number }, actorId: string) {
  return atomic(() => {
    if (input.hours < 1 || input.hours > 72) throw badRequest('Listings run 1-72 hours.');
    if (input.buyNowPrice != null && input.buyNowPrice < input.startPrice) throw badRequest('Buy-it-now must be at least the starting bid.');
    let title = '';
    if (input.itemType === 'worker') {
      const w = db.select().from(schema.workers).where(and(eq(schema.workers.id, input.itemRef), eq(schema.workers.companyId, companyId))).get();
      if (!w) throw notFound('Not your worker.');
      if (w.listed) throw badRequest('Already listed.');
      db.update(schema.workers).set({ listed: true, workplaceId: null, desk: null }).where(eq(schema.workers.id, w.id)).run();
      title = `${w.rarity} ${w.name}`;
    } else {
      const it = db.select().from(schema.items).where(and(eq(schema.items.id, input.itemRef), eq(schema.items.companyId, companyId))).get();
      if (!it) throw notFound('Not your item.');
      if (it.kind === 'equipment') throw badRequest('Machines are bolted to the floor. They cannot be sold.');
      if (it.listed) throw badRequest('Already listed.');
      db.update(schema.items).set({ listed: true, equipped: false }).where(eq(schema.items.id, it.id)).run();
      title = ITEM_MAP.get(it.itemKey)?.name ?? it.itemKey;
    }
    const id = newId('mkt');
    db.insert(schema.marketListings)
      .values({ id, sellerId: companyId, itemType: input.itemType, itemRef: input.itemRef, title, buyNowPrice: input.buyNowPrice ?? null, startPrice: input.startPrice, highBid: null, highBidder: null, endsAt: clock.now() + input.hours * 3600_000, status: 'open', createdAt: clock.now() })
      .run();
    audit({ actorId, action: 'market.list', targetType: 'listing', targetId: id, newValue: input });
    return { id };
  });
}

const escrowWallet = (listingId: string) => walletId('system', `escrow-${listingId}`, 'main');

export function bid(companyId: string, listingId: string, amount: number, actorId: string) {
  return atomic(() => {
    const l = db.select().from(schema.marketListings).where(eq(schema.marketListings.id, listingId)).get();
    if (!l || l.status !== 'open' || l.endsAt <= clock.now()) throw notFound('That auction has ended.');
    if (l.sellerId === companyId) throw badRequest('No bidding on your own stuff. Nice try, shill.');
    if (areLinked(l.sellerId, companyId)) throw forbidden('Bids between linked accounts are blocked.', 'linked');
    const min = l.highBid ? Math.ceil(l.highBid * 1.05) : l.startPrice;
    if (amount < min) throw badRequest(`Bid at least ${min} BT.`);
    if (l.buyNowPrice != null && amount >= l.buyNowPrice) return buyNow(companyId, listingId, actorId);
    // escrow the new bid, refund the previous leader
    post({ kind: 'market.bid_escrow', actorId, legs: [{ from: companyWallet(companyId), to: escrowWallet(listingId), amount }] });
    if (l.highBidder && l.highBid) {
      post({ kind: 'market.bid_refund', legs: [{ from: escrowWallet(listingId), to: companyWallet(l.highBidder), amount: l.highBid }] });
      notify(l.highBidder, 'market', `😱 Outbid on ${l.title}`, `Someone bid ${amount} BT. Your Bits were refunded.`);
    }
    // anti-sniping: bids in the last 2 minutes extend the auction
    const endsAt = l.endsAt - clock.now() < 120_000 ? clock.now() + 120_000 : l.endsAt;
    db.update(schema.marketListings).set({ highBid: amount, highBidder: companyId, endsAt }).where(eq(schema.marketListings.id, listingId)).run();
    bump(companyId, 'bids');
    return { ok: true, highBid: amount };
  });
}

function transferListed(l: typeof schema.marketListings.$inferSelect, buyerId: string) {
  if (l.itemType === 'worker') {
    const w = db.select().from(schema.workers).where(eq(schema.workers.id, l.itemRef)).get();
    if (w) db.update(schema.workers).set({ companyId: buyerId, listed: false, workplaceId: null, desk: null, industryId: getCompany(buyerId).industryId }).where(eq(schema.workers.id, w.id)).run();
  } else {
    db.update(schema.items).set({ companyId: buyerId, listed: false, equipped: false }).where(eq(schema.items.id, l.itemRef)).run();
  }
}

function settle(l: typeof schema.marketListings.$inferSelect, buyerId: string, price: number, fromEscrow: boolean, actorId?: string) {
  const fee = Math.floor((price * cfg().economy.marketplaceFeeBps) / 10_000);
  const from = fromEscrow ? escrowWallet(l.id) : companyWallet(buyerId);
  post({
    kind: 'market.sale',
    memo: l.title,
    actorId,
    legs: [
      { from, to: companyWallet(l.sellerId), amount: price - fee },
      { from, to: SYS.TREASURY, amount: fee, kind: 'fee.market' },
    ],
  });
  transferListed(l, buyerId);
  db.update(schema.marketListings).set({ status: 'sold', highBid: price, highBidder: buyerId }).where(eq(schema.marketListings.id, l.id)).run();
  db.insert(schema.priceTicks).values({ market: 'auction', itemKey: l.title, price, qty: 1, createdAt: clock.now() }).run();
  bump(buyerId, 'marketBuys');
  bump(l.sellerId, 'marketSales');
  notify(l.sellerId, 'market', `🛒 Sold: ${l.title}`, `For ${price} BT (minus ${fee} BT fee).`);
  notify(buyerId, 'market', `🎉 You got ${l.title}!`, `Paid ${price} BT.`);
  toCompany(buyerId, { type: 'balance' });
}

export function buyNow(companyId: string, listingId: string, actorId: string) {
  return atomic(() => {
    const l = db.select().from(schema.marketListings).where(eq(schema.marketListings.id, listingId)).get();
    if (!l || l.status !== 'open') throw notFound('Already gone!');
    if (l.buyNowPrice == null) throw badRequest('This one is auction-only.');
    if (l.sellerId === companyId) throw badRequest("That's your own listing.");
    if (areLinked(l.sellerId, companyId)) throw forbidden('Trades between linked accounts are blocked.', 'linked');
    if (l.itemType === 'worker') {
      const perms = getCompanyPermissions(companyId);
      const count = db.select({ n: sql<number>`count(*)` }).from(schema.workers).where(eq(schema.workers.companyId, companyId)).get()!.n;
      if (perms.limits.maxWorkers != null && count >= perms.limits.maxWorkers) throw forbidden('Worker limit reached.', 'limit');
    }
    if (balanceOf(companyWallet(companyId)) < l.buyNowPrice) throw badRequest(`You need ${l.buyNowPrice} BT.`);
    if (l.highBidder && l.highBid) post({ kind: 'market.bid_refund', legs: [{ from: escrowWallet(listingId), to: companyWallet(l.highBidder), amount: l.highBid }] });
    settle(l, companyId, l.buyNowPrice, false, actorId);
    return { ok: true, price: l.buyNowPrice };
  });
}

export function cancelListing(companyId: string, listingId: string) {
  return atomic(() => {
    const l = db.select().from(schema.marketListings).where(and(eq(schema.marketListings.id, listingId), eq(schema.marketListings.sellerId, companyId))).get();
    if (!l || l.status !== 'open') throw notFound('No such open listing.');
    if (l.highBidder) throw badRequest("Someone already bid. You can't back out now!");
    unlist(l);
    db.update(schema.marketListings).set({ status: 'cancelled' }).where(eq(schema.marketListings.id, l.id)).run();
    return { ok: true };
  });
}

function unlist(l: typeof schema.marketListings.$inferSelect) {
  if (l.itemType === 'worker') db.update(schema.workers).set({ listed: false }).where(eq(schema.workers.id, l.itemRef)).run();
  else db.update(schema.items).set({ listed: false }).where(eq(schema.items.id, l.itemRef)).run();
}

/** Global hook: close finished auctions. */
export function auctionTick(now: number) {
  const ended = db.select().from(schema.marketListings).where(and(eq(schema.marketListings.status, 'open'), lte(schema.marketListings.endsAt, now))).all();
  for (const l of ended) {
    atomic(() => {
      if (l.highBidder && l.highBid) settle(l, l.highBidder, l.highBid, true);
      else {
        unlist(l);
        db.update(schema.marketListings).set({ status: 'expired' }).where(eq(schema.marketListings.id, l.id)).run();
        notify(l.sellerId, 'market', `⌛ No bids on ${l.title}`, 'It has been returned to you.');
      }
    });
  }
}

// ============================================================ invoices
export function listInvoices(companyId: string) {
  const names = new Map(db.select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji }).from(schema.companies).all().map((c) => [c.id, c]));
  return db
    .select()
    .from(schema.invoices)
    .where(or(eq(schema.invoices.fromCompany, companyId), eq(schema.invoices.toCompany, companyId)))
    .orderBy(desc(schema.invoices.createdAt))
    .limit(50)
    .all()
    .map((i) => ({ ...i, from: names.get(i.fromCompany), to: names.get(i.toCompany), incoming: i.toCompany === companyId }));
}

export function sendInvoice(fromCompany: string, toCompany: string, amount: number, memo: string, actorId: string) {
  if (fromCompany === toCompany) throw badRequest('Invoicing yourself is just accounting with extra steps.');
  getCompany(toCompany);
  const id = newId('inv');
  db.insert(schema.invoices).values({ id, fromCompany, toCompany, amount, memo, status: 'pending', escrow: false, createdAt: clock.now(), resolvedAt: null }).run();
  notify(toCompany, 'invoice', `🧾 Invoice from ${getCompany(fromCompany).name}: ${amount} BT`, memo);
  audit({ actorId, action: 'invoice.send', targetType: 'invoice', targetId: id, newValue: { toCompany, amount } });
  return { id };
}

export function resolveInvoice(companyId: string, id: string, accept: boolean, actorId: string) {
  return atomic(() => {
    const inv = db.select().from(schema.invoices).where(and(eq(schema.invoices.id, id), eq(schema.invoices.toCompany, companyId))).get();
    if (!inv || inv.status !== 'pending') throw notFound('No pending invoice with that id.');
    if (accept) {
      if (areLinked(inv.fromCompany, companyId)) throw forbidden('Payments between linked accounts are blocked.', 'linked');
      chargeCompany({ companyId, amount: inv.amount, to: companyWallet(inv.fromCompany), kind: 'invoice.pay', memo: inv.memo, idempotencyKey: `invoice:${id}`, actorId });
      recordEarnings(inv.fromCompany, inv.amount);
    }
    db.update(schema.invoices).set({ status: accept ? 'paid' : 'rejected', resolvedAt: clock.now() }).where(eq(schema.invoices.id, id)).run();
    notify(inv.fromCompany, 'invoice', accept ? `✅ Invoice paid: ${inv.amount} BT` : `❌ Invoice rejected`, inv.memo);
    return { ok: true };
  });
}

// ============================================================ property
export function seedProperties() {
  const n = db.select({ n: sql<number>`count(*)` }).from(schema.properties).get()!.n;
  if (n > 0) return;
  const c = cfg();
  const kinds = ['shopfront', 'warehouse', 'office'];
  for (const d of c.property.districts) {
    for (let i = 0; i < c.property.plotsPerDistrict; i++) {
      const price = Math.round(d.basePrice * (0.8 + ((i * 37) % 10) / 20));
      db.insert(schema.properties).values({ id: newId('prop'), district: d.id, plot: i + 1, kind: kinds[i % 3], ownerCompanyId: null, price, rentPrice: Math.round(price * c.property.rentPerTickRatio * 1000) / 1000 > 0 ? Math.max(1, Math.round(price * c.property.rentPerTickRatio)) : 1, rentedTo: null, traffic: Math.round(d.traffic * 100), createdAt: clock.now() }).run();
    }
  }
}

export function propertyView(companyId: string) {
  const c = cfg();
  const rows = db.select().from(schema.properties).orderBy(schema.properties.district, schema.properties.plot).all();
  const names = new Map(db.select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji }).from(schema.companies).all().map((x) => [x.id, x]));
  return {
    districts: c.property.districts.map((d) => ({ ...d, plots: rows.filter((r) => r.district === d.id).map((r) => ({ ...r, owner: r.ownerCompanyId ? names.get(r.ownerCompanyId) : null, tenant: r.rentedTo ? names.get(r.rentedTo) : null, mine: r.ownerCompanyId === companyId, renting: r.rentedTo === companyId })) })),
    bonus: propertyTrafficBonus(companyId),
    vehicles: db.select().from(schema.vehicles).where(eq(schema.vehicles.companyId, companyId)).all(),
    vehicleCatalog: VEHICLES,
  };
}

export function buyProperty(companyId: string, propertyId: string, actorId: string) {
  return atomic(() => {
    const p = db.select().from(schema.properties).where(eq(schema.properties.id, propertyId)).get();
    if (!p) throw notFound('No such plot.');
    if (p.ownerCompanyId) throw badRequest('Already owned. Make them an offer they cannot refuse (via chat).');
    chargeCompany({ companyId, amount: p.price, kind: 'spend.property', memo: `Plot ${p.district} #${p.plot}`, actorId });
    db.update(schema.properties).set({ ownerCompanyId: companyId }).where(eq(schema.properties.id, propertyId)).run();
    bump(companyId, 'properties');
    return { ok: true };
  });
}

export function sellPropertyToBank(companyId: string, propertyId: string, actorId: string) {
  return atomic(() => {
    const p = db.select().from(schema.properties).where(and(eq(schema.properties.id, propertyId), eq(schema.properties.ownerCompanyId, companyId))).get();
    if (!p) throw notFound('Not your plot.');
    const payout = Math.floor(p.price * 0.85);
    payCompany({ companyId, amount: payout, from: SYS.TREASURY, kind: 'sale.property', memo: `Sold plot ${p.district} #${p.plot}`, actorId, partial: false, earn: false });
    db.update(schema.properties).set({ ownerCompanyId: null, rentedTo: null }).where(eq(schema.properties.id, propertyId)).run();
    return { payout };
  });
}

export function setRent(companyId: string, propertyId: string, rentPrice: number) {
  const p = db.select().from(schema.properties).where(and(eq(schema.properties.id, propertyId), eq(schema.properties.ownerCompanyId, companyId))).get();
  if (!p) throw notFound('Not your plot.');
  db.update(schema.properties).set({ rentPrice: Math.max(1, Math.floor(rentPrice)) }).where(eq(schema.properties.id, propertyId)).run();
  return { ok: true };
}

export function rentProperty(companyId: string, propertyId: string, on: boolean) {
  return atomic(() => {
    const p = db.select().from(schema.properties).where(eq(schema.properties.id, propertyId)).get();
    if (!p) throw notFound('No such plot.');
    if (on) {
      if (!p.ownerCompanyId) throw badRequest('Nobody owns it - buy it instead!');
      if (p.ownerCompanyId === companyId) throw badRequest('You own it already.');
      if (p.rentedTo) throw badRequest('Already rented.');
      if (areLinked(p.ownerCompanyId, companyId)) throw forbidden('Renting between linked accounts is blocked.', 'linked');
      db.update(schema.properties).set({ rentedTo: companyId }).where(eq(schema.properties.id, propertyId)).run();
      notify(p.ownerCompanyId, 'property', `🏘️ New tenant!`, `${getCompany(companyId).name} is renting plot ${p.district} #${p.plot}.`);
    } else {
      if (p.rentedTo !== companyId) throw badRequest('You are not renting that.');
      db.update(schema.properties).set({ rentedTo: null }).where(eq(schema.properties.id, propertyId)).run();
    }
    return { ok: true };
  });
}

function propertyTrafficBonus(companyId: string) {
  const c = cfg();
  const rows = db.select().from(schema.properties).where(or(and(eq(schema.properties.ownerCompanyId, companyId), sql`${schema.properties.rentedTo} IS NULL`), eq(schema.properties.rentedTo, companyId))).all();
  const used = rows.slice(0, 3);
  return used.reduce((s, r) => s + c.property.trafficBonusPerProperty * (r.traffic / 100), 0);
}
registerMultiplier('traffic', (co) => 1 + propertyTrafficBonus(co.id));

/** Global hook: tenants pay rent per tick; property values drift with district sales activity. */
export function propertyTick(now: number) {
  const rented = db.select().from(schema.properties).where(sql`${schema.properties.rentedTo} IS NOT NULL AND ${schema.properties.ownerCompanyId} IS NOT NULL`).all();
  for (const p of rented) {
    const bal = balanceOf(companyWallet(p.rentedTo!));
    if (bal < p.rentPrice) {
      db.update(schema.properties).set({ rentedTo: null }).where(eq(schema.properties.id, p.id)).run();
      notify(p.rentedTo!, 'property', '🏚️ Evicted (cartoonishly)', `You couldn't pay the rent on plot ${p.district} #${p.plot}.`);
      continue;
    }
    post({ kind: 'property.rent', legs: [{ from: companyWallet(p.rentedTo!), to: companyWallet(p.ownerCompanyId!), amount: p.rentPrice }] });
  }
  void now;
}

export function propertyRevalue() {
  // busy districts (more owned plots) appreciate, empty ones dip a little
  const c = cfg();
  for (const d of c.property.districts) {
    const plots = db.select().from(schema.properties).where(eq(schema.properties.district, d.id)).all();
    const occupancy = plots.filter((p) => p.ownerCompanyId).length / Math.max(1, plots.length);
    const drift = 1 + (occupancy - 0.3) * 0.02;
    for (const p of plots) db.update(schema.properties).set({ price: Math.max(1000, Math.round(p.price * drift)) }).where(eq(schema.properties.id, p.id)).run();
  }
}

// ============================================================ vehicles (fleet)
export const VEHICLES = [
  { kind: 'bike', name: 'Cargo Bike', emoji: '🚲', cost: 1200, capacity: 10, traffic: 0.03 },
  { kind: 'van', name: 'Delivery Van', emoji: '🚐', cost: 6000, capacity: 40, traffic: 0.06 },
  { kind: 'truck', name: 'Big Truck', emoji: '🚛', cost: 18000, capacity: 120, traffic: 0.1 },
  { kind: 'ship', name: 'Cargo Ship', emoji: '🚢', cost: 60000, capacity: 500, traffic: 0.15 },
];
const LOGISTICS = new Set(['transport', 'space', 'automotive', 'retail', 'food']);

export function buyVehicle(companyId: string, kind: string, actorId: string) {
  return atomic(() => {
    const v = VEHICLES.find((x) => x.kind === kind);
    if (!v) throw notFound('No such vehicle.');
    const co = getCompany(companyId);
    const ind = getIndustry(co.industryId);
    if (!LOGISTICS.has(ind.categoryId)) throw badRequest('Fleets are for logistics-heavy industries (transport, retail, food, space, automotive).');
    const count = db.select({ n: sql<number>`count(*)` }).from(schema.vehicles).where(eq(schema.vehicles.companyId, companyId)).get()!.n;
    if (count >= 6) throw badRequest('Your parking lot is full (6 vehicles).');
    chargeCompany({ companyId, amount: v.cost, kind: 'spend.vehicle', memo: v.name, actorId });
    db.insert(schema.vehicles).values({ id: newId('veh'), companyId, kind, capacity: v.capacity, createdAt: clock.now() }).run();
    return { ok: true };
  });
}

registerMultiplier('traffic', (co) => {
  const vs = db.select().from(schema.vehicles).where(eq(schema.vehicles.companyId, co.id)).all();
  return 1 + vs.reduce((s, v) => s + (VEHICLES.find((x) => x.kind === v.kind)?.traffic ?? 0), 0);
});

export { inArray };
