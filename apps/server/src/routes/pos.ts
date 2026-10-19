import { z } from 'zod';
import { h, parse, ctx, companyOf, requireModule } from './http';
import { registerGameRoutes } from './game';
import * as pos from '../services/pos';

const lines = z.array(z.object({ productId: z.string().max(80), qty: z.number().int().min(1).max(10_000) })).min(1).max(50);

/** POS register (sellers need Products) and online shops / paying (buyers need Marketplace). */
export function registerPosRoutes() {
  registerGameRoutes((r) => {
    // the register
    r.get('/pos', requireModule('products'), h((req) => pos.posView(companyOf(req))));
    r.post('/pos/checkout', requireModule('products'), h((req) => pos.createCheckout(companyOf(req), ctx(req).account.id, parse(z.object({ lines, discountPct: z.number().int().min(0).max(50).default(0) }), req.body))));
    r.post('/pos/checkout/:id/cancel', requireModule('products'), h((req) => pos.cancelCheckout(companyOf(req), req.params.id)));
    r.get('/pos/pickup/:code', requireModule('products'), h((req) => pos.findPickup(companyOf(req), req.params.code)));
    r.post('/pos/orders/:id/ready', requireModule('products'), h((req) => pos.markReady(companyOf(req), req.params.id)));
    r.post('/pos/orders/:id/collect', requireModule('products'), h((req) => pos.collectOrder(companyOf(req), ctx(req).account.id, req.params.id)));
    r.post('/pos/orders/:id/cancel', requireModule('products'), h((req) => pos.cancelOrder(companyOf(req), req.params.id, ctx(req).account.id)));

    // shopping and paying
    r.get('/shops', requireModule('marketplace'), h((req) => pos.shopDirectory(companyOf(req))));
    r.get('/shops/:id', requireModule('marketplace'), h((req) => pos.storefront(req.params.id)));
    r.post('/shops/:id/order', requireModule('marketplace'), h((req) => {
      const v = parse(z.object({ lines, payMode: z.enum(['now', 'pickup']), note: z.string().max(200).default('') }), req.body);
      return pos.placeOrder(companyOf(req), ctx(req).account.id, { sellerId: req.params.id, ...v });
    }));
    r.get('/orders', requireModule('marketplace'), h((req) => pos.myOrders(companyOf(req))));
    r.post('/orders/:id/cancel', requireModule('marketplace'), h((req) => pos.cancelOrder(companyOf(req), req.params.id, ctx(req).account.id)));
    r.get('/pay/:code', requireModule('marketplace'), h((req) => pos.viewCheckout(req.params.code)));
    r.post('/pay/:code', requireModule('marketplace'), h((req) => pos.payCheckout(companyOf(req), ctx(req).account.id, req.params.code)));
  });
}
