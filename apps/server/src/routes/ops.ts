import { z } from 'zod';
import { h, parse, ctx } from './http';
import { registerOwnerRoutes } from './owner-extras';
import * as ops from '../services/ops';
import { syncStatus, syncNow } from '../db/supabase';
import { env } from '../env';

/** Owner operations: backups, config export/import, anti-cheat dashboard, analytics. */
export function registerOpsRoutes() {
  registerOwnerRoutes((r) => {
    r.get('/backups', h(() => ({ backups: ops.listBackups() })));
    r.post('/backups', h((req) => ops.createBackup('manual', ctx(req).account.id)));
    r.get('/backups/:name/download', (req, res, next) => {
      try {
        res.download(ops.backupPath(req.params.name), req.params.name);
      } catch (e) {
        next(e);
      }
    });
    r.post('/backups/:name/restore', h((req) => {
      parse(z.object({ confirm: z.literal(true) }), req.body);
      return ops.restoreBackup(req.params.name, ctx(req).account.id);
    }));
    r.delete('/backups/:name', h((req) => ops.deleteBackup(req.params.name, ctx(req).account.id)));

    r.get('/config/export', (req, res) => {
      res.setHeader('Content-Disposition', `attachment; filename="digital-workforce-config.json"`);
      res.json(ops.exportConfig());
    });
    r.post('/config/import', h((req) => ops.importConfig(req.body, ctx(req).account.id)));

    r.get('/anticheat', h(() => ops.anticheatView()));
    r.post('/anticheat/resolve', h((req) => ops.resolveFlags(parse(z.object({ ids: z.array(z.string().max(64)).min(1).max(500) }), req.body).ids, ctx(req).account.id)));

    r.get('/analytics', h(() => ops.analytics()));

    r.get('/sync', h(() => ({ configured: !!env.databaseUrl, ...syncStatus() })));
    r.post('/sync', h(() => syncNow()));
  });
}
