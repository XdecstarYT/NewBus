import { Router } from 'express';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { h, parse, ctx, companyOf, requireCompany, requireModule } from './http';
import { db, schema, sqlite } from '../db';
import { cfg } from '../services/settings';
import { clock } from '../lib/time';
import { companyBalance } from '../services/money';
import { balanceOf } from '../services/ledger';
import { getCompany } from '../services/companies';
import { projectCompany } from '../services/tick';
import * as office from '../services/office';
import { listNotifications, unreadCount, markAllRead, claimNotification } from '../services/notifications';
import { listNews, reactToNews } from '../services/news';

/** Feature routers register here so each module keeps its own guard. */
const extra: Array<(r: Router) => void> = [];
export function registerGameRoutes(fn: (r: Router) => void) {
  extra.push(fn);
}

const AWAY_MIN_MS = 10 * 60_000;

export function gameRouter() {
  const r = Router();
  r.use(requireCompany);

  // Always available to a company login: top-bar state + welcome-back summary.
  r.get(
    '/state',
    h((req) => {
      const companyId = companyOf(req);
      const co = getCompany(companyId);
      const c = cfg();
      const proj = projectCompany(co);
      let away: { earned: number; minutes: number } | null = null;
      const now = clock.now();
      if (!ctx(req).access.viewAs && co.lastSeenSummaryAt && now - co.lastSeenSummaryAt > AWAY_MIN_MS) {
        const earned = (sqlite
          .prepare(`SELECT COALESCE(SUM(amount),0) s FROM ledger_entries WHERE to_wallet = ? AND kind LIKE 'income.%' AND created_at > ?`)
          .get(`w:company:${companyId}:main`, co.lastSeenSummaryAt) as { s: number }).s;
        away = { earned, minutes: Math.round((now - co.lastSeenSummaryAt) / 60_000) };
      }
      if (!ctx(req).access.viewAs) db.update(schema.companies).set({ lastSeenSummaryAt: now }).where(eq(schema.companies.id, companyId)).run();
      return {
        balance: companyBalance(companyId),
        pots: Object.fromEntries(['main', 'payroll', 'savings', 'investing'].map((p) => [p, balanceOf(`w:company:${companyId}:${p}`)])),
        incomePerTick: proj.incomePerTick,
        wagesPerTick: proj.wagesPerTick,
        upkeepPerTick: proj.upkeepPerTick,
        level: co.level,
        xp: co.xp,
        xpNext: c.company.levelXp(co.level),
        unread: unreadCount(companyId),
        away,
      };
    }),
  );

  // ------------------------------------------------------------ notifications (always on)
  r.get('/notifications', h((req) => ({ items: listNotifications(companyOf(req)), unread: unreadCount(companyOf(req)) })));
  r.post('/notifications/read', h((req) => (markAllRead(companyOf(req)), { ok: true })));
  r.post('/notifications/:id/claim', h((req) => claimNotification(companyOf(req), req.params.id, ctx(req).account.id)));

  // ------------------------------------------------------------ office
  const officeR = Router();
  officeR.use(requireModule('office'));
  officeR.get('/', h((req) => ({ ...office.officeView(companyOf(req)), goals: office.nextGoals(companyOf(req)) })));
  officeR.post(
    '/boost',
    h((req) => {
      const { workplaceId } = parse(z.object({ workplaceId: z.string().min(1).max(64) }), req.body);
      return office.boost(companyOf(req), workplaceId);
    }),
  );
  r.use('/office', officeR);

  // ------------------------------------------------------------ workforce
  const wf = Router();
  wf.use(requireModule('workforce'));
  wf.get(
    '/',
    h((req) => {
      const companyId = companyOf(req);
      const co = getCompany(companyId);
      const proj = projectCompany(co);
      return proj.workers.map((w) => office.workerView(w, w.workplaceId ? (proj.focus.get(w.workplaceId) as string) : undefined));
    }),
  );
  wf.post(
    '/assign',
    h((req) => {
      const b = parse(z.object({ workerId: z.string().min(1).max(64), workplaceId: z.string().min(1).max(64).nullable(), desk: z.number().int().min(0).max(50).nullable().optional() }), req.body);
      return office.assignWorker(companyOf(req), b.workerId, b.workplaceId, b.desk ?? null);
    }),
  );
  wf.post('/auto-assign', h((req) => office.autoAssign(companyOf(req))));
  wf.post('/:id/train', h((req) => office.trainWorker(companyOf(req), req.params.id, ctx(req).account.id)));
  wf.post('/:id/promote', h((req) => office.promoteWorker(companyOf(req), req.params.id, ctx(req).account.id)));
  wf.post('/:id/coffee', h((req) => office.coffee(companyOf(req), [req.params.id], ctx(req).account.id)));
  wf.post('/coffee-all', h((req) => office.coffee(companyOf(req), 'all', ctx(req).account.id)));
  wf.post(
    '/:id/rename',
    h((req) => {
      const { name } = parse(z.object({ name: z.string().min(2).max(30) }), req.body);
      return office.renameWorker(companyOf(req), req.params.id, name, ctx(req).account.id);
    }),
  );
  wf.post('/:id/fire', h((req) => office.fireWorker(companyOf(req), req.params.id, ctx(req).account.id)));
  r.use('/workforce', wf);

  // workplaces live with the office module
  const wpR = Router();
  wpR.use(requireModule('office'));
  wpR.post('/:id/upgrade', h((req) => office.upgradeWorkplace(companyOf(req), req.params.id, ctx(req).account.id)));
  wpR.post(
    '/unlock',
    h((req) => {
      const { kind } = parse(z.object({ kind: z.number().int().min(0).max(10) }), req.body);
      return office.unlockWorkplace(companyOf(req), kind, ctx(req).account.id);
    }),
  );
  r.use('/workplaces', wpR);

  // ------------------------------------------------------------ news (Daily Byte)
  const newsR = Router();
  newsR.use(requireModule('news'));
  newsR.get('/', h((req) => listNews(80, req.query.kind ? String(req.query.kind) : undefined)));
  newsR.post(
    '/:id/react',
    h((req) => {
      const { emoji } = parse(z.object({ emoji: z.enum(['👏', '😂', '🔥', '😮', '💸', '🚀']) }), req.body);
      return { reactions: reactToNews(req.params.id, emoji) };
    }),
  );
  r.use('/news', newsR);

  for (const fn of extra) fn(r);
  return r;
}

export { and, gt, inArray, sql };
