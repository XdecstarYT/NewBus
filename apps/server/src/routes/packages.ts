import { z } from 'zod';
import { h, parse, ctx, companyOf } from './http';
import { registerGameRoutes } from './game';
import { registerOwnerRoutes } from './owner-extras';
import * as packages from '../services/packages';

const codeSchema = z.object({ code: z.string().min(4).max(300) });

export function registerPackageRoutes() {
  registerGameRoutes((r) => {
    r.post('/packages/peek', h((req) => packages.peek(companyOf(req), ctx(req).account.id, parse(codeSchema, req.body).code)));
    r.post('/packages/redeem', h((req) => packages.redeem(companyOf(req), ctx(req).account.id, parse(codeSchema, req.body).code)));
    r.get('/packages', h((req) => packages.myPackages(companyOf(req))));
  });

  registerOwnerRoutes((r) => {
    r.get('/packages', h(() => ({ batches: packages.listBatches(), options: packages.packageOptions() })));
    r.get('/packages/:batchId/claims', h((req) => packages.batchClaims(req.params.batchId)));
    r.post('/packages', h((req) => {
      const v = parse(
        z.object({
          name: z.string().trim().min(1).max(60),
          emoji: z.string().max(8).default('📦'),
          message: z.string().max(200).default(''),
          mystery: z.boolean().default(false),
          cards: z.number().int().min(1).max(1000),
          maxClaims: z.number().int().min(1).max(100_000),
          expiresInDays: z.number().int().min(1).max(3650).nullable().default(null),
          targetCompanyId: z.string().max(64).nullable().default(null),
          contents: z.object({
            bits: z.number().int().min(0).optional(),
            pods: z.array(z.object({ type: z.string().max(20), count: z.number().int().min(0).max(10) })).max(5).optional(),
            items: z.array(z.string().max(60)).max(10).optional(),
            boost: z.object({ mult: z.number().min(1).max(3), minutes: z.number().int().min(1).max(1440) }).optional(),
          }),
        }),
        req.body,
      );
      return packages.createBatch(v, ctx(req).account.id);
    }));
    r.post('/packages/void', h((req) => packages.voidPackages(parse(z.object({ batchId: z.string().max(64).optional(), id: z.string().max(64).optional() }), req.body), ctx(req).account.id)));
  });
}
