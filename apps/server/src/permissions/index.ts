/**
 * Permission engine. Deny-by-default:
 *   effective module access = global feature flag
 *                           AND company module toggle
 *                           AND (for STAFF) the staff toggle AND company.staffGrantable
 * Permissions are read from the DB on every request / WS message, so owner
 * edits apply instantly without re-login.
 */
import { and, eq } from 'drizzle-orm';
import {
  MODULES,
  normalizePermissions,
  effectiveStaffModules,
  type Module,
  type Permissions,
  type StaffPermissions,
  type Limits,
  type Role,
} from '@dw/shared';
import { db, schema } from '../db';
import { getFlags } from '../services/flags';
import { clock } from '../lib/time';

export function getCompanyPermissions(companyId: string): Permissions {
  const row = db
    .select()
    .from(schema.permissions)
    .where(and(eq(schema.permissions.subjectType, 'company'), eq(schema.permissions.subjectId, companyId)))
    .get();
  return normalizePermissions(row?.data as Partial<Permissions> | undefined);
}

export function setCompanyPermissions(companyId: string, perms: Permissions, actorId: string | null) {
  const now = clock.now();
  db.insert(schema.permissions)
    .values({ subjectType: 'company', subjectId: companyId, data: perms as any, updatedAt: now, updatedBy: actorId })
    .onConflictDoUpdate({
      target: [schema.permissions.subjectType, schema.permissions.subjectId],
      set: { data: perms as any, updatedAt: now, updatedBy: actorId },
    })
    .run();
}

export function getStaffPermissions(accountId: string): StaffPermissions {
  const row = db
    .select()
    .from(schema.permissions)
    .where(and(eq(schema.permissions.subjectType, 'account'), eq(schema.permissions.subjectId, accountId)))
    .get();
  return { modules: ((row?.data as any)?.modules ?? {}) as StaffPermissions['modules'] };
}

export function setStaffPermissions(accountId: string, perms: StaffPermissions, actorId: string | null) {
  const now = clock.now();
  db.insert(schema.permissions)
    .values({ subjectType: 'account', subjectId: accountId, data: perms as any, updatedAt: now, updatedBy: actorId })
    .onConflictDoUpdate({
      target: [schema.permissions.subjectType, schema.permissions.subjectId],
      set: { data: perms as any, updatedAt: now, updatedBy: actorId },
    })
    .run();
}

export interface AccessContext {
  accountId: string;
  role: Role;
  companyId: string | null;
  modules: Record<Module, boolean>;
  limits: Limits | null;
  /** true for owner "view as company" and maintenance mode (non-owners) */
  readOnly: boolean;
  viewAs: boolean;
  moderatorTools: string[];
}

/** Filters that can switch modules off for a company (e.g. a licence suspension). */
const accessFilters: Array<(companyId: string, modules: Record<Module, boolean>) => void> = [];
export function registerAccessFilter(fn: (companyId: string, modules: Record<Module, boolean>) => void) {
  accessFilters.push(fn);
}
function filtered(companyId: string, modules: Record<Module, boolean>) {
  for (const f of accessFilters) f(companyId, modules);
  return modules;
}

const none = () => Object.fromEntries(MODULES.map((m) => [m, false])) as Record<Module, boolean>;

/** Compute what an account may do right now. */
export function resolveAccess(
  account: { id: string; role: string; companyId: string | null; moderatorTools?: string[] | null },
  viewAsCompanyId?: string | null,
): AccessContext {
  const flags = getFlags();
  const role = account.role as Role;
  const base: AccessContext = {
    accountId: account.id,
    role,
    companyId: account.companyId,
    modules: none(),
    limits: null,
    readOnly: false,
    viewAs: false,
    moderatorTools: account.moderatorTools ?? [],
  };

  // Owner "view as company": exactly what the company admin sees, but read-only.
  if (role === 'OWNER' && viewAsCompanyId) {
    const perms = getCompanyPermissions(viewAsCompanyId);
    const modules = none();
    for (const m of MODULES) modules[m] = !!perms.modules[m] && !!flags[m];
    return { ...base, companyId: viewAsCompanyId, modules: filtered(viewAsCompanyId, modules), limits: perms.limits, readOnly: true, viewAs: true };
  }

  if (role === 'OWNER') {
    // The owner may also run a company of their own (optional).
    if (account.companyId) {
      const perms = getCompanyPermissions(account.companyId);
      const modules = none();
      for (const m of MODULES) modules[m] = !!flags[m];
      return { ...base, modules, limits: perms.limits, moderatorTools: ['mute', 'kick', 'reports', 'audit'] };
    }
    return { ...base, moderatorTools: ['mute', 'kick', 'reports', 'audit'] };
  }

  const maintenance = !!flags.maintenance;

  if (role === 'MODERATOR') {
    const modules = none();
    modules.chat = !!flags.chat;
    modules.news = !!flags.news;
    modules.leaderboard = !!flags.leaderboard;
    return { ...base, modules, readOnly: maintenance };
  }

  if (!account.companyId) return { ...base, readOnly: maintenance };
  const perms = getCompanyPermissions(account.companyId);
  const modules = none();
  if (role === 'COMPANY_ADMIN') {
    for (const m of MODULES) modules[m] = !!perms.modules[m] && !!flags[m];
  } else if (role === 'STAFF') {
    const eff = effectiveStaffModules(perms, getStaffPermissions(account.id));
    for (const m of MODULES) modules[m] = eff[m] && !!flags[m];
  }
  return { ...base, modules: filtered(account.companyId, modules), limits: perms.limits, readOnly: maintenance };
}
