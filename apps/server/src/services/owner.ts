/**
 * Owner-only operations: permission templates, permissions edits (with audit
 * + live push), accounts management, money tools, bulk actions.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { MODULES, applyPermissionsPatch, type Permissions, type PermissionsPatch, PERMISSION_PRESETS } from '@dw/shared';
import { db, schema, atomic } from '../db';
import { newId } from '../lib/ids';
import { clock } from '../lib/time';
import { badRequest, notFound } from '../lib/errors';
import { audit } from './audit';
import { getCompanyPermissions, setCompanyPermissions } from '../permissions';
import { getCompany, updateCompany } from './companies';
import { SYS, post, balanceOf } from './ledger';
import { companyWallet, payCompany } from './money';
import { notify } from './notifications';
import { toAccount, toCompany } from '../lib/bus';
import { createAccount, resetPassword, revokeSessions, getAccount } from './auth';

// ------------------------------------------------------------ permissions
export function setPermissionsFor(companyId: string, next: Permissions, actorId: string | null, source = 'manual') {
  getCompany(companyId);
  const old = getCompanyPermissions(companyId);
  setCompanyPermissions(companyId, next, actorId);
  audit({ actorId, action: `permissions.set.${source}`, targetType: 'company', targetId: companyId, oldValue: diffPerms(old, next).old, newValue: diffPerms(old, next).new });
  // live update: every login of that company refetches what it may see
  toCompany(companyId, { type: 'perms' });
  return next;
}

export function patchPermissionsFor(companyId: string, patch: PermissionsPatch, actorId: string | null) {
  const next = applyPermissionsPatch(getCompanyPermissions(companyId), patch);
  return setPermissionsFor(companyId, next, actorId, 'patch');
}

/** Only keep keys that changed so the audit log reads nicely. */
function diffPerms(a: Permissions, b: Permissions) {
  const o: Record<string, unknown> = {};
  const n: Record<string, unknown> = {};
  for (const m of MODULES) if (a.modules[m] !== b.modules[m]) (o[`modules.${m}`] = a.modules[m]), (n[`modules.${m}`] = b.modules[m]);
  for (const k of Object.keys(b.limits) as (keyof Permissions['limits'])[]) {
    if (JSON.stringify(a.limits[k]) !== JSON.stringify(b.limits[k])) (o[`limits.${k}`] = a.limits[k]), (n[`limits.${k}`] = b.limits[k]);
  }
  return { old: o, new: n };
}

// ------------------------------------------------------------ templates
export function listTemplates() {
  const rows = db.select().from(schema.permissionTemplates).orderBy(desc(schema.permissionTemplates.updatedAt)).all();
  return rows.map((r) => ({ id: r.id, name: r.name, permissions: r.data as unknown as Permissions, updatedAt: r.updatedAt }));
}

export function createTemplate(name: string, permissions: Permissions, actorId: string | null) {
  const now = clock.now();
  const row = { id: newId('tpl'), name, data: permissions as any, createdAt: now, updatedAt: now };
  db.insert(schema.permissionTemplates).values(row).run();
  audit({ actorId, action: 'template.create', targetType: 'template', targetId: row.id, newValue: { name } });
  return { id: row.id, name, permissions };
}

export function updateTemplate(id: string, name: string, permissions: Permissions, actorId: string | null) {
  const cur = db.select().from(schema.permissionTemplates).where(eq(schema.permissionTemplates.id, id)).get();
  if (!cur) throw notFound('No such template.');
  db.update(schema.permissionTemplates).set({ name, data: permissions as any, updatedAt: clock.now() }).where(eq(schema.permissionTemplates.id, id)).run();
  audit({ actorId, action: 'template.update', targetType: 'template', targetId: id, oldValue: { name: cur.name }, newValue: { name } });
  return { id, name, permissions };
}

export function deleteTemplate(id: string, actorId: string | null) {
  db.delete(schema.permissionTemplates).where(eq(schema.permissionTemplates.id, id)).run();
  audit({ actorId, action: 'template.delete', targetType: 'template', targetId: id });
}

export function getTemplate(id: string) {
  const t = db.select().from(schema.permissionTemplates).where(eq(schema.permissionTemplates.id, id)).get();
  if (!t) throw notFound('No such template.');
  return { id: t.id, name: t.name, permissions: t.data as unknown as Permissions };
}

export function seedTemplates() {
  if (db.select({ n: sql<number>`count(*)` }).from(schema.permissionTemplates).get()!.n > 0) return;
  for (const p of Object.values(PERMISSION_PRESETS)) createTemplate(`${p.emoji} ${p.label}`, p.perms, null);
}

// ------------------------------------------------------------ accounts
export function listAccounts() {
  const accs = db.select().from(schema.accounts).orderBy(schema.accounts.accountNumber).all();
  const companies = new Map(db.select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji }).from(schema.companies).all().map((c) => [c.id, c]));
  const sessionCounts = new Map(
    db
      .select({ a: schema.sessions.accountId, n: sql<number>`count(*)` })
      .from(schema.sessions)
      .where(sql`${schema.sessions.expiresAt} > ${clock.now()}`)
      .groupBy(schema.sessions.accountId)
      .all()
      .map((r) => [r.a, r.n]),
  );
  return accs.map((a) => ({
    id: a.id,
    accountNumber: a.accountNumber,
    displayName: a.displayName,
    role: a.role,
    jobTitle: a.jobTitle,
    status: a.status,
    companyId: a.companyId,
    company: a.companyId ? companies.get(a.companyId) ?? null : null,
    createdBy: a.createdBy,
    createdAt: a.createdAt,
    lastLogin: a.lastLogin,
    mustChangePassword: a.mustChangePassword,
    linkedGroup: a.linkedGroup,
    moderatorTools: a.moderatorTools ?? [],
    lockedUntil: a.lockedUntil,
    totpEnabled: a.totpEnabled,
    activeSessions: sessionCounts.get(a.id) ?? 0,
  }));
}

export function updateAccount(
  id: string,
  patch: { displayName?: string; status?: string; role?: string; mustChangePassword?: boolean; linkedGroup?: string | null; moderatorTools?: string[]; jobTitle?: string | null },
  actorId: string,
) {
  const acc = getAccount(id);
  if (!acc) throw notFound('No such account.');
  if (acc.role === 'OWNER' && (patch.role || (patch.status && patch.status !== 'active'))) throw badRequest('The Owner cannot be demoted or suspended. Nice try.');
  db.update(schema.accounts).set(patch as any).where(eq(schema.accounts.id, id)).run();
  if (patch.status && patch.status !== 'active') revokeSessions(id);
  audit({ actorId, action: 'account.update', targetType: 'account', targetId: id, oldValue: Object.fromEntries(Object.keys(patch).map((k) => [k, (acc as any)[k]])), newValue: patch });
  toAccount(id, { type: 'perms' });
  return getAccount(id);
}

export function ownerResetPassword(id: string, actorId: string, password?: string, mustChange = true) {
  const acc = getAccount(id);
  if (!acc) throw notFound('No such account.');
  const pw = resetPassword(id, actorId, password, mustChange);
  toAccount(id, { type: 'logout' });
  return { accountNumber: acc.accountNumber, tempPassword: pw };
}

export function forceLogout(id: string, actorId: string) {
  revokeSessions(id);
  audit({ actorId, action: 'account.force_logout', targetType: 'account', targetId: id });
  toAccount(id, { type: 'logout' });
}

export function ownerCreateAccount(input: Parameters<typeof createAccount>[0]) {
  if (input.companyId) getCompany(input.companyId);
  const r = createAccount(input);
  audit({ actorId: input.createdBy ?? null, action: 'account.create', targetType: 'account', targetId: r.account.id, newValue: { role: input.role, number: r.account.accountNumber } });
  return r;
}

// ------------------------------------------------------------ money tools
/** Mint new Bits straight to a company (creates money). */
export function mint(companyId: string, amount: number, reason: string, actorId: string, idempotencyKey?: string) {
  getCompany(companyId);
  const r = post({ kind: 'owner.mint', memo: reason, idempotencyKey, actorId, legs: [{ from: SYS.MINT, to: companyWallet(companyId), amount }] });
  audit({ actorId, action: 'money.mint', targetType: 'company', targetId: companyId, newValue: { amount, reason } });
  toCompany(companyId, { type: 'balance' });
  return r;
}

/** Burn Bits from a company (destroys money). Capped at its balance. */
export function burn(companyId: string, amount: number, reason: string, actorId: string, idempotencyKey?: string) {
  const amt = Math.min(amount, balanceOf(companyWallet(companyId)));
  if (amt <= 0) throw badRequest('That company has no Bits to burn.');
  const r = post({ kind: 'owner.burn', memo: reason, idempotencyKey, actorId, legs: [{ from: companyWallet(companyId), to: SYS.MINT, amount: amt }] });
  audit({ actorId, action: 'money.burn', targetType: 'company', targetId: companyId, newValue: { amount: amt, reason } });
  toCompany(companyId, { type: 'balance' });
  return { ...r, amount: amt };
}

/** Grant from the Treasury (recycles existing money). */
export function grant(companyId: string, amount: number, reason: string, actorId: string, idempotencyKey?: string) {
  getCompany(companyId);
  const r = post({ kind: 'owner.grant', memo: reason, idempotencyKey, actorId, legs: [{ from: SYS.TREASURY, to: companyWallet(companyId), amount }] });
  audit({ actorId, action: 'money.grant', targetType: 'company', targetId: companyId, newValue: { amount, reason } });
  notify(companyId, 'gift', `🎁 The Owner sent you ${amount} BT`, reason);
  return r;
}

/** Take back into the Treasury. Capped at balance. */
export function take(companyId: string, amount: number, reason: string, actorId: string, idempotencyKey?: string) {
  const amt = Math.min(amount, balanceOf(companyWallet(companyId)));
  if (amt <= 0) throw badRequest('That company has no Bits to take.');
  const r = post({ kind: 'owner.take', memo: reason, idempotencyKey, actorId, legs: [{ from: companyWallet(companyId), to: SYS.TREASURY, amount: amt }] });
  audit({ actorId, action: 'money.take', targetType: 'company', targetId: companyId, newValue: { amount: amt, reason } });
  toCompany(companyId, { type: 'balance' });
  return { ...r, amount: amt };
}

// ------------------------------------------------------------ bulk actions
export type BulkAction =
  | { type: 'applyTemplate'; templateId: string }
  | { type: 'grantBits'; amount: number; reason: string }
  | { type: 'takeBits'; amount: number; reason: string }
  | { type: 'suspend'; suspended: boolean }
  | { type: 'message'; title: string; body: string }
  | { type: 'toggleModule'; module: (typeof MODULES)[number]; enabled: boolean };

export function bulk(companyIds: string[], action: BulkAction, actorId: string) {
  const results: Array<{ companyId: string; ok: boolean; error?: string }> = [];
  const tpl = action.type === 'applyTemplate' ? getTemplate(action.templateId) : null;
  for (const id of companyIds) {
    try {
      atomic(() => {
        switch (action.type) {
          case 'applyTemplate':
            setPermissionsFor(id, tpl!.permissions, actorId, `template:${tpl!.name}`);
            break;
          case 'grantBits':
            grant(id, action.amount, action.reason, actorId);
            break;
          case 'takeBits':
            take(id, action.amount, action.reason, actorId);
            break;
          case 'suspend':
            updateCompany(id, { status: action.suspended ? 'suspended' : 'active' }, actorId);
            break;
          case 'message':
            notify(id, 'owner', `📣 ${action.title}`, action.body);
            break;
          case 'toggleModule':
            patchPermissionsFor(id, { modules: { [action.module]: action.enabled } }, actorId);
            break;
        }
      });
      results.push({ companyId: id, ok: true });
    } catch (e: any) {
      results.push({ companyId: id, ok: false, error: e?.message ?? String(e) });
    }
  }
  audit({ actorId, action: `bulk.${action.type}`, targetType: 'companies', targetId: companyIds.slice(0, 20).join(','), newValue: { count: companyIds.length } });
  return results;
}

export { payCompany, inArray, and };
