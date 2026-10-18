/**
 * Company admins create STAFF logins (if the owner allows it) and hand down
 * module access. An admin can NEVER grant more than the company has, and only
 * modules the owner marked as "grantable".
 */
import { and, eq, sql } from 'drizzle-orm';
import { ungrantableModules, type Module } from '@dw/shared';
import { db, schema, atomic } from '../db';
import { getCompanyPermissions, getStaffPermissions, setStaffPermissions } from '../permissions';
import { createAccount, revokeSessions, getAccount } from './auth';
import { forbidden, notFound, badRequest } from '../lib/errors';
import { audit } from './audit';
import { toAccount } from '../lib/bus';

export function listStaff(companyId: string) {
  return db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.role, 'STAFF')))
    .all()
    .map((a) => ({ id: a.id, accountNumber: a.accountNumber, displayName: a.displayName, jobTitle: a.jobTitle, status: a.status, lastLogin: a.lastLogin, modules: getStaffPermissions(a.id).modules }));
}

export function createStaff(companyId: string, actorId: string, input: { displayName: string; jobTitle: string; modules: Partial<Record<Module, boolean>>; password?: string }) {
  return atomic(() => {
    const perms = getCompanyPermissions(companyId);
    if (!perms.limits.canCreateStaff) throw forbidden('The Owner has not allowed you to create staff logins.', 'staff_disabled');
    const count = db.select({ n: sql<number>`count(*)` }).from(schema.accounts).where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.role, 'STAFF'))).get()!.n;
    if (count >= perms.limits.maxStaff) throw forbidden(`Staff limit reached (${perms.limits.maxStaff}).`, 'limit');
    const bad = ungrantableModules(perms, input.modules);
    if (bad.length) throw forbidden(`You can't grant modules you don't have permission to hand out: ${bad.join(', ')}`, 'over_grant');
    const { account, tempPassword } = createAccount({ role: 'STAFF', displayName: input.displayName, jobTitle: input.jobTitle, companyId, password: input.password, mustChangePassword: true, createdBy: actorId });
    setStaffPermissions(account.id, { modules: input.modules }, actorId);
    audit({ actorId, action: 'staff.create', targetType: 'account', targetId: account.id, newValue: { modules: input.modules, jobTitle: input.jobTitle } });
    return { account: { id: account.id, accountNumber: account.accountNumber, displayName: account.displayName }, tempPassword };
  });
}

export function updateStaff(companyId: string, staffId: string, actorId: string, patch: { modules?: Partial<Record<Module, boolean>>; jobTitle?: string; status?: string }) {
  const acc = getAccount(staffId);
  if (!acc || acc.companyId !== companyId || acc.role !== 'STAFF') throw notFound('No such staff member.');
  if (patch.modules) {
    const bad = ungrantableModules(getCompanyPermissions(companyId), patch.modules);
    if (bad.length) throw forbidden(`You can't grant modules you don't have permission to hand out: ${bad.join(', ')}`, 'over_grant');
    const old = getStaffPermissions(staffId);
    setStaffPermissions(staffId, { modules: patch.modules }, actorId);
    audit({ actorId, action: 'staff.permissions', targetType: 'account', targetId: staffId, oldValue: old.modules, newValue: patch.modules });
  }
  if (patch.jobTitle || patch.status) {
    if (patch.status && !['active', 'suspended'].includes(patch.status)) throw badRequest('Bad status.');
    db.update(schema.accounts).set({ ...(patch.jobTitle ? { jobTitle: patch.jobTitle } : {}), ...(patch.status ? { status: patch.status } : {}) }).where(eq(schema.accounts.id, staffId)).run();
    if (patch.status === 'suspended') revokeSessions(staffId);
  }
  toAccount(staffId, { type: 'perms' });
  return { ok: true };
}
