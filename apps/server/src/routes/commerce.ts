import { Router } from 'express';
import { z } from 'zod';
import { registerGameRoutes } from './game';
import { h, parse, ctx, companyOf, requireModule } from './http';
import * as products from '../services/products';
import * as trade from '../services/trade';

const id = z.string().min(1).max(80);

export function registerCommerceRoutes() {
  registerGameRoutes((r) => {
    // ------------------------------------------------ products, production, warehouse, reviews
    const p = Router();
    p.use(requireModule('products'));
    p.get('/', h((req) => products.productsView(companyOf(req))));
    p.patch('/:productId', h((req) => products.setPricing(companyOf(req), req.params.productId, parse(z.object({ price: z.number().int().min(1).max(1e7).optional(), onSale: z.boolean().optional(), autoRestock: z.number().int().min(0).max(500).optional() }), req.body))));
    p.post('/queue', h((req) => {
      const v = parse(z.object({ workplaceId: id, productId: id, qty: z.number().int().min(1).max(100), autoBuy: z.boolean().optional() }), req.body);
      return products.queueProduction(companyOf(req), v.workplaceId, v.productId, v.qty, ctx(req).account.id, { autoBuy: v.autoBuy });
    }));
    p.post('/jobs/:id/cancel', h((req) => products.cancelJob(companyOf(req), req.params.id)));
    p.post('/equipment', h((req) => {
      const v = parse(z.object({ workplaceId: id, key: z.string().max(40) }), req.body);
      return products.buyEquipment(companyOf(req), v.workplaceId, v.key, ctx(req).account.id);
    }));
    p.post('/equipment/:id/repair', h((req) => products.repairEquipment(companyOf(req), req.params.id, ctx(req).account.id)));
    p.get('/customers', h((req) => products.recentCustomers(companyOf(req))));
    p.get('/reviews', h((req) => products.listReviews(companyOf(req))));
    p.post('/reviews/:id/reply', h((req) => products.replyReview(companyOf(req), req.params.id, parse(z.object({ reply: z.string().min(1).max(200) }), req.body).reply)));
    p.get('/complaint', h((req) => products.complaint(companyOf(req))));
    p.post('/complaint/:id', h((req) => products.answerComplaint(companyOf(req), req.params.id, parse(z.object({ option: z.enum(['sorry', 'blame', 'ignore']) }), req.body).option)));
    p.get('/financials', h((req) => products.financials(companyOf(req), Math.min(24 * 7, Math.max(1, Number(req.query.hours ?? 24))))));
    p.get('/market-data', h((req) => ({ trending: products.trendingBoard(), topSellers: products.topSellers(String(req.query.industryId ?? '') || undefined), priceIndex: products.priceIndex() })));
    p.post('/wholesale', h((req) => {
      const v = parse(z.object({ itemType: z.enum(['product', 'commodity']), itemId: id, qty: z.number().int().min(1).max(10000) }), req.body);
      return products.sellToWholesaler(companyOf(req), v.itemType, v.itemId, v.qty, ctx(req).account.id);
    }));
    r.use('/products', p);

    const inv = Router();
    inv.use(requireModule('inventory'));
    inv.post('/warehouse/upgrade', h((req) => products.upgradeWarehouse(companyOf(req), ctx(req).account.id)));
    r.use('/inventory', inv);

    const mk = Router();
    mk.use(requireModule('marketing'));
    mk.get('/', h((req) => ({ ...products.campaignOptions(), campaigns: products.listCampaigns(companyOf(req)) })));
    mk.post('/', h((req) => {
      const v = parse(z.object({ kind: z.string().max(20), minutes: z.number().int().min(5).max(240), slogan: z.number().int().min(0).max(2) }), req.body);
      return products.startCampaign(companyOf(req), v.kind, v.minutes, v.slogan, ctx(req).account.id);
    }));
    r.use('/marketing', mk);

    // ------------------------------------------------ supply chain
    const s = Router();
    s.use(requireModule('supplychain'));
    s.get('/', h((req) => trade.supplyMarket(companyOf(req))));
    s.post('/wholesaler/buy', h((req) => {
      const v = parse(z.object({ commodityId: id, qty: z.number().int().min(1).max(10000) }), req.body);
      return products.buyFromWholesaler(companyOf(req), v.commodityId, v.qty, ctx(req).account.id);
    }));
    s.post('/wholesaler/sell', h((req) => {
      const v = parse(z.object({ itemType: z.enum(['product', 'commodity']), itemId: id, qty: z.number().int().min(1).max(10000) }), req.body);
      return products.sellToWholesaler(companyOf(req), v.itemType, v.itemId, v.qty, ctx(req).account.id);
    }));
    s.post('/listings', h((req) => {
      const v = parse(z.object({ itemType: z.enum(['product', 'commodity']), itemId: id, qty: z.number().int().min(1).max(10000), unitPrice: z.number().int().min(1).max(1e6), targetId: id.nullable().optional() }), req.body);
      return trade.listSupply(companyOf(req), v, ctx(req).account.id);
    }));
    s.post('/listings/:id/buy', h((req) => trade.buySupply(companyOf(req), req.params.id, parse(z.object({ qty: z.number().int().min(1).max(10000) }), req.body).qty, ctx(req).account.id)));
    s.post('/listings/:id/cancel', h((req) => trade.cancelSupply(companyOf(req), req.params.id)));
    s.get('/invoices', h((req) => trade.listInvoices(companyOf(req))));
    s.post('/invoices', h((req) => {
      const v = parse(z.object({ toCompanyId: id, amount: z.number().int().min(1).max(1e9), memo: z.string().max(120).default('') }), req.body);
      return trade.sendInvoice(companyOf(req), v.toCompanyId, v.amount, v.memo, ctx(req).account.id);
    }));
    s.post('/invoices/:id', h((req) => trade.resolveInvoice(companyOf(req), req.params.id, parse(z.object({ accept: z.boolean() }), req.body).accept, ctx(req).account.id)));
    r.use('/supply', s);

    // ------------------------------------------------ marketplace & auction house
    const m = Router();
    m.use(requireModule('marketplace'));
    m.get('/', h((req) => trade.marketListings(companyOf(req))));
    m.post('/listings', h((req) => {
      const v = parse(z.object({ itemType: z.enum(['worker', 'item']), itemRef: id, buyNowPrice: z.number().int().min(1).max(1e9).nullable().optional(), startPrice: z.number().int().min(1).max(1e9), hours: z.number().int().min(1).max(72) }), req.body);
      return trade.createListing(companyOf(req), v, ctx(req).account.id);
    }));
    m.post('/listings/:id/bid', h((req) => trade.bid(companyOf(req), req.params.id, parse(z.object({ amount: z.number().int().min(1).max(1e9) }), req.body).amount, ctx(req).account.id)));
    m.post('/listings/:id/buy', h((req) => trade.buyNow(companyOf(req), req.params.id, ctx(req).account.id)));
    m.post('/listings/:id/cancel', h((req) => trade.cancelListing(companyOf(req), req.params.id)));
    r.use('/market', m);

    // ------------------------------------------------ property & fleet
    const pr = Router();
    pr.use(requireModule('property'));
    pr.get('/', h((req) => trade.propertyView(companyOf(req))));
    pr.post('/:id/buy', h((req) => trade.buyProperty(companyOf(req), req.params.id, ctx(req).account.id)));
    pr.post('/:id/sell', h((req) => trade.sellPropertyToBank(companyOf(req), req.params.id, ctx(req).account.id)));
    pr.post('/:id/rent', h((req) => trade.rentProperty(companyOf(req), req.params.id, parse(z.object({ on: z.boolean() }), req.body).on)));
    pr.post('/:id/rent-price', h((req) => trade.setRent(companyOf(req), req.params.id, parse(z.object({ rentPrice: z.number().int().min(1).max(1e6) }), req.body).rentPrice)));
    pr.post('/vehicles', h((req) => trade.buyVehicle(companyOf(req), parse(z.object({ kind: z.string().max(20) }), req.body).kind, ctx(req).account.id)));
    r.use('/property', pr);
  });
}
