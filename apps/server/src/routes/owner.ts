import { Router } from 'express';
import { and, desc, eq, gte, like, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  createCompanySchema,
  updateCompanySchema,
  changeIndustrySchema,
  bulkActionSchema,
  permissionTemplateSchema,
  setPermissionsSchema,
  patchPermissionsSchema,
  createAccountSchema,
  updateAccountSchema,
  resetPasswordSchema,
  setFlagSchema,
  moneyToolSchema,
  totpEnableSchema,
  type FeatureFlag,
  PERMISSION_PRESETS,
} from '@dw/shared';
import { h, parse, ctx, requireRole } from './http';
import { db, schema } from '../db';
import * as companies from '../services/companies';
import * as owner from '../services/owner';
import * as catalog from '../services/catalog';
import { getCompanyPermissions } from '../permissions';
import { getFlags, setFlag } from '../services/flags';
import { listSettings, setSetting, resetSetting } from '../services/settings';
import { audit } from '../services/audit';
import { nextAccountNumber, getAccount } from '../services/auth';
import { newTotpSecret, otpauthUrl, verifyTotp } from '../lib/totp';
import { clock } from '../lib/time';
import { badRequest } from '../lib/errors';
import { toAll } from '../lib/bus';
import { ownerExtrasRouter } from './owner-extras';

const toCsv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
};

export function ownerRouter() {
  const r = Router();
  r.use(requireRole('OWNER'));

  // ------------------------------------------------------------ catalog for the builder
  r.get(
    '/industries',
    h((req) => {
      const q = String(req.query.q ?? '').toLowerCase();
      const cat = String(req.query.category ?? '');
      const all = catalog.listIndustries(req.query.all === '1');
      return all
        .filter((i) => !q || i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q))
        .filter((i) => !cat || i.categoryId === cat)
        .map((i) => ({ id: i.id, name: i.name, emoji: i.emoji, color: i.color, category: i.category, categoryId: i.categoryId, enabled: i.enabled, custom: i.custom, service: i.service, perishable: i.perishable }));
    }),
  );
  r.get(
    '/industries/:id',
    h((req) => {
      const ind = catalog.getIndustry(req.params.id);
      return { ...ind, productDefs: catalog.productsFor(ind.id, true) };
    }),
  );
  r.get(
    '/suggest-slogan',
    h((req) => {
      const ind = catalog.getIndustry(String(req.query.industryId ?? ''));
      return { slogan: ind.slogans[Math.floor(Math.random() * ind.slogans.length)] };
    }),
  );
  r.get('/next-account-number', h(() => ({ accountNumber: nextAccountNumber() })));
  r.get('/presets', h(() => PERMISSION_PRESETS));

  // ------------------------------------------------------------ companies
  r.get(
    '/companies',
    h((req) => {
      const list = companies.listCompanies({
        search: req.query.q ? String(req.query.q) : undefined,
        industryId: req.query.industryId ? String(req.query.industryId) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
        listed: req.query.listed === '1' ? true : req.query.listed === '0' ? false : undefined,
      });
      return list.map(companies.companySummary);
    }),
  );

  r.post(
    '/companies',
    h((req) => {
      const input = parse(createCompanySchema, req.body);
      const res = companies.createCompany(input, ctx(req).account.id);
      return { company: companies.companySummary(res.company), account: res.account, tempPassword: res.tempPassword };
    }),
  );

  r.get(
    '/companies/:id',
    h((req) => {
      const c = companies.getCompany(req.params.id);
      const accounts = db
        .select({ id: schema.accounts.id, accountNumber: schema.accounts.accountNumber, displayName: schema.accounts.displayName, role: schema.accounts.role, jobTitle: schema.accounts.jobTitle, status: schema.accounts.status, lastLogin: schema.accounts.lastLogin })
        .from(schema.accounts)
        .where(eq(schema.accounts.companyId, c.id))
        .all();
      return { ...companies.companySummary(c), permissions: getCompanyPermissions(c.id), accounts, raw: c };
    }),
  );

  r.patch(
    '/companies/:id',
    h((req) => {
      const patch = parse(updateCompanySchema, req.body);
      return companies.companySummary(companies.updateCompany(req.params.id, patch, ctx(req).account.id));
    }),
  );

  r.delete(
    '/companies/:id',
    h((req) => {
      const { confirmName } = parse(z.object({ confirmName: z.string() }), req.body);
      const c = companies.getCompany(req.params.id);
      if (confirmName !== c.name) throw badRequest('Type the company name exactly to confirm deletion.');
      companies.deleteCompany(c.id, ctx(req).account.id);
      return { ok: true };
    }),
  );

  r.get('/companies/:id/template', h((req) => companies.companyTemplate(req.params.id)));

  r.post(
    '/companies/:id/industry',
    h((req) => {
      const { industryId } = parse(changeIndustrySchema, req.body);
      return companies.companySummary(companies.changeIndustry(req.params.id, industryId, ctx(req).account.id));
    }),
  );

  r.get('/companies/:id/permissions', h((req) => getCompanyPermissions(req.params.id)));
  r.put(
    '/companies/:id/permissions',
    h((req) => {
      const { permissions } = parse(setPermissionsSchema, req.body);
      return owner.setPermissionsFor(req.params.id, permissions, ctx(req).account.id);
    }),
  );
  r.patch(
    '/companies/:id/permissions',
    h((req) => {
      const { patch } = parse(patchPermissionsSchema, req.body);
      return owner.patchPermissionsFor(req.params.id, patch, ctx(req).account.id);
    }),
  );

  r.post(
    '/companies/bulk',
    h((req) => {
      const { companyIds, action } = parse(bulkActionSchema, req.body);
      return { results: owner.bulk(companyIds, action, ctx(req).account.id) };
    }),
  );

  // ------------------------------------------------------------ templates
  r.get('/templates', h(() => owner.listTemplates()));
  r.post(
    '/templates',
    h((req) => {
      const { name, permissions } = parse(permissionTemplateSchema, req.body);
      return owner.createTemplate(name, permissions, ctx(req).account.id);
    }),
  );
  r.put(
    '/templates/:id',
    h((req) => {
      const { name, permissions } = parse(permissionTemplateSchema, req.body);
      return owner.updateTemplate(req.params.id, name, permissions, ctx(req).account.id);
    }),
  );
  r.delete(
    '/templates/:id',
    h((req) => {
      owner.deleteTemplate(req.params.id, ctx(req).account.id);
      return { ok: true };
    }),
  );

  // ------------------------------------------------------------ accounts
  r.get('/accounts', h(() => owner.listAccounts()));
  r.post(
    '/accounts',
    h((req) => {
      const input = parse(createAccountSchema, req.body);
      if ((input.role === 'COMPANY_ADMIN' || input.role === 'STAFF') && !input.companyId) throw badRequest('Company logins need a company.');
      const res = owner.ownerCreateAccount({ ...input, createdBy: ctx(req).account.id });
      return { account: { id: res.account.id, accountNumber: res.account.accountNumber, displayName: res.account.displayName, role: res.account.role }, tempPassword: res.tempPassword };
    }),
  );
  r.patch(
    '/accounts/:id',
    h((req) => {
      const patch = parse(updateAccountSchema, req.body);
      owner.updateAccount(req.params.id, patch, ctx(req).account.id);
      return { ok: true };
    }),
  );
  r.post(
    '/accounts/:id/reset-password',
    h((req) => {
      const { password, mustChangePassword } = parse(resetPasswordSchema, req.body ?? {});
      return owner.ownerResetPassword(req.params.id, ctx(req).account.id, password, mustChangePassword);
    }),
  );
  r.post(
    '/accounts/:id/logout',
    h((req) => {
      owner.forceLogout(req.params.id, ctx(req).account.id);
      return { ok: true };
    }),
  );
  r.get(
    '/accounts/:id/sessions',
    h((req) =>
      db
        .select({ createdAt: schema.sessions.createdAt, lastSeen: schema.sessions.lastSeen, ip: schema.sessions.ip, userAgent: schema.sessions.userAgent })
        .from(schema.sessions)
        .where(eq(schema.sessions.accountId, req.params.id))
        .all(),
    ),
  );

  // ------------------------------------------------------------ TOTP for the owner
  r.post(
    '/totp/setup',
    h((req) => {
      const secret = newTotpSecret();
      db.update(schema.accounts).set({ totpSecret: secret, totpEnabled: false }).where(eq(schema.accounts.id, ctx(req).account.id)).run();
      return { secret, url: otpauthUrl(secret, `Owner ${ctx(req).account.accountNumber}`) };
    }),
  );
  r.post(
    '/totp/enable',
    h((req) => {
      const { code } = parse(totpEnableSchema, req.body);
      const acc = getAccount(ctx(req).account.id)!;
      if (!acc.totpSecret || !verifyTotp(acc.totpSecret, code, clock.now())) throw badRequest('That code did not match. Check your phone clock.');
      db.update(schema.accounts).set({ totpEnabled: true }).where(eq(schema.accounts.id, acc.id)).run();
      audit({ actorId: acc.id, action: 'auth.totp_enabled', targetType: 'account', targetId: acc.id });
      return { ok: true };
    }),
  );
  r.post(
    '/totp/disable',
    h((req) => {
      const { code } = parse(totpEnableSchema, req.body);
      const acc = getAccount(ctx(req).account.id)!;
      if (!acc.totpSecret || !verifyTotp(acc.totpSecret, code, clock.now())) throw badRequest('That code did not match.');
      db.update(schema.accounts).set({ totpEnabled: false, totpSecret: null }).where(eq(schema.accounts.id, acc.id)).run();
      audit({ actorId: acc.id, action: 'auth.totp_disabled', targetType: 'account', targetId: acc.id });
      return { ok: true };
    }),
  );

  // ------------------------------------------------------------ flags & settings
  r.get('/flags', h(() => getFlags()));
  r.put(
    '/flags',
    h((req) => {
      const { flag, enabled } = parse(setFlagSchema, req.body);
      const old = getFlags()[flag as FeatureFlag];
      setFlag(flag as FeatureFlag, enabled);
      audit({ actorId: ctx(req).account.id, action: 'flag.set', targetType: 'flag', targetId: flag, oldValue: old, newValue: enabled });
      toAll({ type: 'perms' });
      return getFlags();
    }),
  );
  r.get('/settings', h(() => listSettings()));
  r.put(
    '/settings',
    h((req) => {
      const { key, value } = parse(z.object({ key: z.string().min(1).max(100), value: z.union([z.number(), z.string().max(200), z.boolean(), z.array(z.number())]) }), req.body);
      const res = setSetting(key, value);
      audit({ actorId: ctx(req).account.id, action: 'setting.set', targetType: 'setting', targetId: key, oldValue: res.old, newValue: value });
      return { ok: true };
    }),
  );
  r.delete(
    '/settings/:key',
    h((req) => {
      resetSetting(req.params.key);
      audit({ actorId: ctx(req).account.id, action: 'setting.reset', targetType: 'setting', targetId: req.params.key });
      return { ok: true };
    }),
  );

  // ------------------------------------------------------------ money tools
  for (const kind of ['mint', 'burn', 'grant', 'take'] as const) {
    r.post(
      `/money/${kind}`,
      h((req) => {
        const { companyId, amount, reason, idempotencyKey } = parse(moneyToolSchema, req.body);
        return owner[kind](companyId, amount, reason, ctx(req).account.id, idempotencyKey);
      }),
    );
  }

  // ------------------------------------------------------------ audit & ledger viewers
  r.get(
    '/audit',
    h((req, res) => {
      const conds = [];
      if (req.query.action) conds.push(like(schema.auditLog.action, `${String(req.query.action)}%`));
      if (req.query.targetId) conds.push(eq(schema.auditLog.targetId, String(req.query.targetId)));
      if (req.query.actorId) conds.push(eq(schema.auditLog.actorId, String(req.query.actorId)));
      const limit = Math.min(Number(req.query.limit ?? 200), 5000);
      const rows = db
        .select()
        .from(schema.auditLog)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(schema.auditLog.id))
        .limit(limit)
        .all();
      if (req.query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
        res.send(toCsv(rows as any));
        return;
      }
      return rows;
    }),
  );

  r.get(
    '/ledger',
    h((req, res) => {
      const conds = [];
      if (req.query.wallet) {
        const w = String(req.query.wallet);
        conds.push(or(like(schema.ledgerEntries.fromWallet, `%${w}%`), like(schema.ledgerEntries.toWallet, `%${w}%`)));
      }
      if (req.query.kind) conds.push(like(schema.ledgerEntries.kind, `${String(req.query.kind)}%`));
      if (req.query.from) conds.push(gte(schema.ledgerEntries.createdAt, Number(req.query.from)));
      if (req.query.to) conds.push(lte(schema.ledgerEntries.createdAt, Number(req.query.to)));
      if (req.query.min) conds.push(gte(schema.ledgerEntries.amount, Number(req.query.min)));
      const limit = Math.min(Number(req.query.limit ?? 300), 100_000);
      const rows = db
        .select()
        .from(schema.ledgerEntries)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(schema.ledgerEntries.id))
        .limit(limit)
        .all();
      if (req.query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="ledger.csv"');
        res.send(toCsv(rows as any));
        return;
      }
      return rows;
    }),
  );

  r.get(
    '/ledger/verify',
    h(async () => {
      const { verifyLedger, moneySupply } = await import('../services/ledger');
      const v = verifyLedger();
      return { ...v, balanced: v.sum === 0 && v.mismatches.length === 0, supply: moneySupply() };
    }),
  );

  r.use(ownerExtrasRouter());

  return r;
}

export { sql };
