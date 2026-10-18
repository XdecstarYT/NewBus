import { z } from 'zod';
import { registerOwnerRoutes } from './owner-extras';
import { h, parse, ctx } from './http';
import * as catalog from '../services/catalog';
import { audit } from '../services/audit';
import { addModifier } from '../services/multipliers';
import { addNews } from '../services/news';
import { topSellers, trendingBoard, priceIndex, exploitSuspects } from '../services/products';
import { badRequest } from '../lib/errors';

const industryPatch = z.object({
  name: z.string().min(2).max(60).optional(),
  emoji: z.string().min(1).max(16).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  enabled: z.boolean().optional(),
  jokes: z.array(z.string().max(200)).max(50).optional(),
  slogans: z.array(z.string().max(120)).max(20).optional(),
  workplaces: z.array(z.object({ tier: z.number().int(), name: z.string().max(60), emoji: z.string().max(16), focus: z.string() })).min(3).max(5).optional(),
});
const productPatch = z.object({
  name: z.string().min(2).max(60).optional(),
  emoji: z.string().min(1).max(16).optional(),
  basePrice: z.number().int().min(1).max(1e7).optional(),
  baseCost: z.number().int().min(0).max(1e7).optional(),
  productionMs: z.number().int().min(1000).max(3600_000).optional(),
  unlockLevel: z.number().int().min(1).max(50).optional(),
  enabled: z.boolean().optional(),
});

export function registerOwnerCatalogRoutes() {
  registerOwnerRoutes((r) => {
    r.get('/catalog/industries', h(() => catalog.listIndustries(true).map((i) => ({ id: i.id, name: i.name, emoji: i.emoji, color: i.color, category: i.category, enabled: i.enabled, custom: i.custom, products: i.products.length }))));
    r.patch('/catalog/industries/:id', h((req) => {
      const patch = parse(industryPatch, req.body);
      const old = catalog.getIndustry(req.params.id);
      const res = catalog.updateIndustry(req.params.id, patch as any);
      audit({ actorId: ctx(req).account.id, action: 'catalog.industry.update', targetType: 'industry', targetId: req.params.id, oldValue: { name: old.name, enabled: old.enabled }, newValue: patch });
      return res;
    }));
    r.post('/catalog/industries/:id/duplicate', h((req) => {
      const { name } = parse(z.object({ name: z.string().min(2).max(60) }), req.body);
      const res = catalog.duplicateIndustry(req.params.id, name);
      audit({ actorId: ctx(req).account.id, action: 'catalog.industry.duplicate', targetType: 'industry', targetId: res.id, newValue: { from: req.params.id } });
      return res;
    }));
    r.get('/catalog/products', h((req) => {
      const ind = req.query.industryId ? String(req.query.industryId) : '';
      const q = String(req.query.q ?? '').toLowerCase();
      return catalog.listProducts(true).filter((p) => (!ind || p.industryId === ind) && (!q || p.name.toLowerCase().includes(q))).slice(0, 500);
    }));
    r.patch('/catalog/products/:id', h((req) => {
      const patch = parse(productPatch, req.body);
      const res = catalog.updateProduct(req.params.id, patch as any);
      audit({ actorId: ctx(req).account.id, action: 'catalog.product.update', targetType: 'product', targetId: req.params.id, newValue: patch });
      return res;
    }));
    r.post('/catalog/products/:id/duplicate', h((req) => catalog.duplicateProduct(req.params.id, parse(z.object({ name: z.string().min(2).max(60) }), req.body).name)));
    r.get('/catalog/products-export', h((req, res) => {
      const list = catalog.listProducts(true);
      if (req.query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="products.csv"');
        res.send(catalog.productsToCsv(list));
        return;
      }
      res.setHeader('Content-Disposition', 'attachment; filename="products.json"');
      return list;
    }));
    r.post('/catalog/products-import', h((req) => {
      const items = parse(z.array(z.object({ id: z.string().min(3).max(120) }).passthrough()).max(5000), req.body);
      if (!items.length) throw badRequest('Nothing to import.');
      const n = catalog.importProducts(items as any);
      audit({ actorId: ctx(req).account.id, action: 'catalog.product.import', newValue: { count: n } });
      return { imported: n };
    }));

    // market controls: trends, fads, recalls; data views
    r.get('/market-data', h(() => ({ trending: trendingBoard(20), topSellers: topSellers(undefined, 20), priceIndex: priceIndex(), exploitSuspects: exploitSuspects() })));
    r.post('/market-controls/demand', h((req) => {
      const v = parse(z.object({ productId: z.string().max(120).nullable(), mult: z.number().min(0).max(5), minutes: z.number().int().min(1).max(1440), label: z.enum(['fad', 'recall', 'trend']).default('fad') }), req.body);
      const kind = v.productId ? `demand:${v.productId}` : 'demand:*';
      addModifier(null, kind, v.mult, v.minutes, `owner:${v.label}`);
      const pname = v.productId ? catalog.getProduct(v.productId).name : 'everything';
      if (v.label === 'recall') addNews('headline', `⚠️ RECALL: ${pname} pulled from shelves!`, 'Officials cite "excessive wobbliness". Demand plummets.');
      else addNews('headline', `🔥 ${v.label === 'trend' ? 'TRENDING' : 'NEW FAD'}: everyone wants ${pname}!`, `Demand x${v.mult} for ${v.minutes} minutes.`);
      audit({ actorId: ctx(req).account.id, action: `market.${v.label}`, newValue: v });
      return { ok: true };
    }));
  });
}
