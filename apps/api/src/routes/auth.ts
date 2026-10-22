import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { schema } from '../db';
import { governs } from '../services/government';
import { parse, route, type Ctx } from '../http/router';
import * as accounts from '../services/accounts';
import { energyNow, energyStats } from '../services/energy';
import { balance, W } from '../services/money';
import { companyLevel } from '../services/production';

export async function mePayload(c: Ctx) {
  if (!c.account) return { account: null, company: null };
  const a = c.account;
  const stats = await energyStats(c.db, c.company);
  const unread = await c.db.$count(schema.notifications, and(eq(schema.notifications.read, false), c.company ? eq(schema.notifications.companyId, c.company.id) : eq(schema.notifications.accountId, a.id)));
  return {
    account: { id: a.id, number: a.number, name: a.name, role: a.role, mustChangePassword: a.mustChangePassword, xp: a.xp },
    company: c.company ? { ...c.company, level: companyLevel(c.company.xp), balance: await balance(c.db, W.company(c.company.id)) } : null,
    energy: { now: Math.floor(energyNow(a, stats)), ...stats },
    unread,
    /** an elected Mayor has the Owner's powers */
    governing: a.role === 'OWNER' || (await governs(c.db, a)),
  };
}

route('GET', '/auth/me', 'public', async (c) => {
  await accounts.ensureOwner(c.db);
  return mePayload(c);
});

route('POST', '/auth/login', 'public', async (c) => {
  const v = parse(z.object({ number: z.string().min(1).max(20), password: z.string().min(1).max(200) }), c.body);
  const acc = await accounts.login(c, v.number, v.password);
  c.account = acc;
  if (acc.companyId) c.company = (await c.db.select().from(schema.companies).where(eq(schema.companies.id, acc.companyId)))[0] ?? null;
  return mePayload(c);
});

route('POST', '/auth/logout', 'public', async (c) => {
  await accounts.logout(c);
  return { ok: true };
});

route(
  'POST',
  '/auth/password',
  'user',
  async (c) => {
    const v = parse(z.object({ current: z.string().max(200), next: z.string().min(6).max(200) }), c.body);
    await accounts.changePassword(c.db, c.account, v.current, v.next);
    return { ok: true };
  },
  { pw: true },
);
