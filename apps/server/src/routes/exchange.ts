import { Router } from 'express';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { PRICE_MODES } from '@dw/shared';
import { registerGameRoutes } from './game';
import { registerOwnerRoutes } from './owner-extras';
import { h, parse, ctx, companyOf, requireModule } from './http';
import { db, schema } from '../db';
import * as assets from '../exchange/assets';
import * as orders from '../exchange/orders';
import * as corp from '../exchange/corporate';
import { getCompany } from '../services/companies';
import { badRequest } from '../lib/errors';
import { recordFlag } from '../services/anticheat';

const id = z.string().min(1).max(80);

export function registerExchangeRoutes() {
  registerGameRoutes((r) => {
    const x = Router();
    x.use(requireModule('exchange'));
    x.get('/', h((req) => corp.marketOverview(companyOf(req))));
    x.get('/heatmap', h(() => corp.heatmap()));
    x.get('/portfolio', h((req) => corp.portfolio(companyOf(req))));
    x.get('/assets/:id', h((req) => corp.assetDetail(req.params.id, companyOf(req))));
    x.get('/assets/:id/book', h((req) => ({ book: orders.orderBook(req.params.id), trades: orders.recentTrades(req.params.id) })));
    x.post('/orders', h((req) => {
      const v = parse(z.object({ assetId: id, side: z.enum(['buy', 'sell']), type: z.enum(['market', 'limit']), qty: z.number().int().min(1).max(1e6), limitPrice: z.number().int().min(1).max(1e9).nullable().optional() }), req.body);
      return orders.placeOrder({ holderId: companyOf(req), ...v, actorId: ctx(req).account.id });
    }));
    x.post('/orders/:id/cancel', h((req) => orders.cancelOrder(companyOf(req), req.params.id)));
    x.post('/assets/:id/drip', h((req) => corp.setDrip(companyOf(req), req.params.id, parse(z.object({ on: z.boolean() }), req.body).on)));
    x.post('/assets/:id/watch', h((req) => {
      const v = parse(z.object({ on: z.boolean(), alertAbove: z.number().int().min(1).nullable().optional(), alertBelow: z.number().int().min(1).nullable().optional() }), req.body);
      return corp.setWatch(companyOf(req), req.params.id, v.on, v.alertAbove, v.alertBelow);
    }));
    x.post('/assets/:id/proposals', h((req) => {
      const v = parse(z.object({ kind: z.enum(['dividend', 'buyback', 'workplace', 'takeover']), data: z.record(z.string(), z.unknown()).default({}) }), req.body);
      return corp.createProposal(companyOf(req), req.params.id, v.kind, v.data);
    }));
    x.post('/proposals/:id/vote', h((req) => corp.vote(companyOf(req), req.params.id, parse(z.object({ yes: z.boolean() }), req.body).yes)));
    x.post('/ipo', h((req) => {
      const v = parse(z.object({ shares: z.number().int().min(100).max(10_000_000), price: z.number().int().min(1).max(100_000), founderPct: z.number().int().min(1).max(95), pitch: z.string().max(300).default('') }), req.body);
      return assets.requestIpo(companyOf(req), v);
    }));
    x.get('/ipo-suggestion', h((req) => ({ price: assets.suggestedIpoPrice(companyOf(req), Math.max(100, Number(req.query.shares ?? 10_000))) })));
    r.use('/exchange', x);
  });

  registerOwnerRoutes((r) => {
    r.get('/market', h(() => {
      const list = db.select().from(schema.assets).all();
      const ipoRequests = db.select().from(schema.companies).where(eq(schema.companies.ipoStatus, 'requested')).all().map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, request: c.ipoRequest, suggestedPrice: assets.suggestedIpoPrice(c.id, Number((c.ipoRequest as any)?.shares ?? 10_000)) }));
      const takeovers = db.select().from(schema.proposals).where(eq(schema.proposals.status, 'awaiting_owner')).all();
      return { assets: list, ipoRequests, takeovers, events: assets.MARKET_EVENTS };
    }));
    r.get('/market/trades', h((req, res) => {
      const rows = db.select().from(schema.trades).orderBy(desc(schema.trades.createdAt)).limit(Math.min(Number(req.query.limit ?? 300), 100_000)).all();
      if (req.query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="trades.csv"');
        res.send(['id,assetId,buyerId,sellerId,qty,price,fee,createdAt', ...rows.map((t) => [t.id, t.assetId, t.buyerId, t.sellerId, t.qty, t.price, t.fee, t.createdAt].join(','))].join('\n'));
        return;
      }
      return rows;
    }));
    r.get('/market/orders', h(() => db.select().from(schema.orders).where(eq(schema.orders.status, 'open')).all()));
    r.post('/market/ipo/:companyId/approve', h((req) => {
      const v = parse(z.object({ shares: z.number().int().min(100).max(10_000_000), price: z.number().int().min(1).max(100_000), founderPct: z.number().int().min(1).max(95), priceMode: z.enum(PRICE_MODES), dividendPct: z.number().int().min(0).max(100), symbol: z.string().max(6).optional() }), req.body);
      return assets.approveIpo(req.params.companyId, v, ctx(req).account.id);
    }));
    r.post('/market/ipo/:companyId/reject', h((req) => (assets.rejectIpo(req.params.companyId, parse(z.object({ reason: z.string().max(200).default('') }), req.body).reason, ctx(req).account.id), { ok: true })));
    r.post('/market/assets/:id/halt', h((req) => {
      const v = parse(z.object({ halted: z.boolean(), reason: z.string().max(120).default('Owner pause') }), req.body);
      assets.setHalt(req.params.id, v.halted, v.reason, ctx(req).account.id);
      return { ok: true };
    }));
    r.post('/market/assets/:id/delist', h((req) => (assets.delist(req.params.id, ctx(req).account.id), { ok: true })));
    r.post('/market/assets/:id/mode', h((req) => (assets.setPriceMode(req.params.id, parse(z.object({ mode: z.enum(PRICE_MODES) }), req.body).mode, ctx(req).account.id), { ok: true })));
    r.post('/market/assets/:id/price', h((req) => (assets.setOwnerPrice(req.params.id, parse(z.object({ price: z.number().int().min(1).max(1e7) }), req.body).price, ctx(req).account.id), { ok: true })));
    r.post('/market/assets/:id/split', h((req) => corp.split(req.params.id, parse(z.object({ ratio: z.number().int().min(2).max(10) }), req.body).ratio, ctx(req).account.id)));
    r.post('/market/assets/:id/dividend', h((req) => {
      const { pct } = parse(z.object({ pct: z.number().int().min(0).max(100) }), req.body);
      db.update(schema.assets).set({ dividendPct: pct }).where(eq(schema.assets.id, req.params.id)).run();
      return { ok: true };
    }));
    r.post('/market/mode-all', h((req) => {
      const { mode } = parse(z.object({ mode: z.enum(PRICE_MODES) }), req.body);
      for (const a of db.select().from(schema.assets).where(eq(schema.assets.type, 'STOCK')).all()) assets.setPriceMode(a.id, mode, ctx(req).account.id);
      return { ok: true };
    }));
    r.post('/market/bonds', h((req) => {
      const v = parse(z.object({ companyId: id, couponBps: z.number().int().min(1).max(2000), termPeriods: z.number().int().min(1).max(500) }), req.body);
      getCompany(v.companyId);
      return assets.issueCompanyBond(v.companyId, v.couponBps, v.termPeriods, ctx(req).account.id);
    }));
    r.post('/market/indexes', h((req) => {
      const v = parse(z.object({ symbol: z.string().min(2).max(6), name: z.string().min(2).max(40), categories: z.array(z.string()).min(1) }), req.body);
      const symbol = v.symbol.toUpperCase();
      if (assets.findAssetBySymbol(symbol)) throw badRequest('Symbol taken.');
      db.insert(schema.indexes).values({ id: `idx_${symbol}`, symbol, name: v.name, rule: { kind: 'category', category: v.categories.join(',') }, value: 100, createdAt: Date.now() }).run();
      assets.seedMarket();
      db.insert(schema.assets).values({ id: `ast_${symbol}`, symbol, name: v.name, type: 'ETF', companyId: null, priceMode: 'FUNDAMENTALS', price: 100, fairValue: 100, sharesOutstanding: 0, primaryRemaining: 0, founderPct: 0, dividendPct: 0, dayOpen: 100, dayKey: '', halted: false, haltReason: null, haltUntil: null, lockupUntil: null, listed: true, data: { index: symbol, divisor: 0 }, createdAt: Date.now() }).run();
      return { ok: true };
    }));
    r.post('/market/takeovers/:id', h((req) => corp.approveTakeover(req.params.id, parse(z.object({ approve: z.boolean() }), req.body).approve, ctx(req).account.id)));
    r.post('/market/events/:key', h((req) => assets.triggerMarketEvent(req.params.key)));
    r.post('/market/flags/:tradeId', h((req) => {
      const t = db.select().from(schema.trades).where(eq(schema.trades.id, req.params.tradeId)).get();
      if (!t) throw badRequest('No such trade.');
      recordFlag('owner_flagged_trade', t.buyerId, `Owner flagged trade ${t.id}: ${t.qty} @ ${t.price}`, 2);
      return { ok: true };
    }));
  });
}
