import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { db, schema, atomic } from '../db';
import { newId } from '../lib/ids';
import { clock } from '../lib/time';
import { toCompany } from '../lib/bus';
import { payCompany } from './money';
import { SYS } from './ledger';
import { badRequest, notFound } from '../lib/errors';

/** Notification centre: alerts and claimable rewards for a company. */
export function notify(companyId: string, kind: string, title: string, body = '', reward: number | null = null) {
  const row = { id: newId('ntf'), companyId, accountId: null, kind, title, body, reward, claimed: false, read: false, createdAt: clock.now() };
  db.insert(schema.notifications).values(row).run();
  toCompany(companyId, { type: 'notification', item: row });
  return row;
}

export function listNotifications(companyId: string, limit = 50) {
  return db.select().from(schema.notifications).where(eq(schema.notifications.companyId, companyId)).orderBy(desc(schema.notifications.createdAt)).limit(limit).all();
}

export function unreadCount(companyId: string) {
  return (db
    .select({ n: sql<number>`count(*)` })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.companyId, companyId), eq(schema.notifications.read, false)))
    .get()?.n ?? 0) as number;
}

export function markAllRead(companyId: string) {
  db.update(schema.notifications).set({ read: true }).where(eq(schema.notifications.companyId, companyId)).run();
}

/** Claim a reward notification. Idempotent via the notification id. */
export function claimNotification(companyId: string, id: string, actorId: string) {
  return atomic(() => {
    const n = db.select().from(schema.notifications).where(and(eq(schema.notifications.id, id), eq(schema.notifications.companyId, companyId))).get();
    if (!n) throw notFound('That reward blew away in the wind.');
    if (!n.reward) throw badRequest('Nothing to claim here.');
    if (n.claimed) throw badRequest('Already claimed! No double-dipping.');
    db.update(schema.notifications).set({ claimed: true, read: true }).where(eq(schema.notifications.id, id)).run();
    const paid = payCompany({ companyId, amount: n.reward, from: SYS.TREASURY, kind: 'reward.notification', memo: n.title, idempotencyKey: `claim:${id}`, actorId, partial: false });
    return { paid };
  });
}

export { isNull, or };
