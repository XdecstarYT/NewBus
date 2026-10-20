/** Shared building blocks: settings, audit log, live hints, notifications, news, sanctions. */
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { DEFAULT_SETTINGS, FEATURES, type Feature, type Settings } from '@dw/shared/live';
import { schema, type Db } from '../db';
import { clock } from '../lib/time';
import { forbidden } from '../lib/errors';

// ------------------------------------------------------------ settings
export async function getSettings(db: Db): Promise<Settings> {
  const r = await db.select().from(schema.settings).where(eq(schema.settings.key, 'game'));
  return { ...DEFAULT_SETTINGS, ...((r[0]?.value as Partial<Settings>) ?? {}) };
}

export async function patchSettings(db: Db, patch: Partial<Settings>) {
  const next = { ...(await getSettings(db)), ...patch };
  await db.insert(schema.settings).values({ key: 'game', value: next }).onConflictDoUpdate({ target: schema.settings.key, set: { value: next } });
  return next;
}

export async function getValue<T>(db: Db, key: string): Promise<T | null> {
  const r = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
  return (r[0]?.value as T) ?? null;
}

export async function setValue(db: Db, key: string, value: unknown) {
  await db.insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } });
}

// ------------------------------------------------------------ audit
export async function audit(db: Db, actorId: string | null, action: string, target: string | null = null, data: unknown = null) {
  await db.insert(schema.auditLog).values({ actorId, action, target, data, createdAt: clock.now() });
}

// ------------------------------------------------------------ live hints (Supabase Realtime)
export const topics = {
  company: (id: string) => `dw-co-${id}`,
  account: (id: string) => `dw-acc-${id}`,
  all: 'dw-all',
};

/** Tell browsers listening on `topic` to refetch something. Sent on commit. */
export async function hint(db: Db, topic: string, payload: Record<string, unknown>) {
  await db.execute(sql`SELECT live.hint(${topic}, ${JSON.stringify(payload)}::jsonb)`);
}

// ------------------------------------------------------------ notifications + news
export async function notify(db: Db, to: { companyId?: string | null; accountId?: string | null }, kind: string, title: string, body = '') {
  await db.insert(schema.notifications).values({ companyId: to.companyId ?? null, accountId: to.accountId ?? null, kind, title, body, createdAt: clock.now() });
  if (to.companyId) await hint(db, topics.company(to.companyId), { t: 'notify' });
  if (to.accountId) await hint(db, topics.account(to.accountId), { t: 'notify' });
}

export async function addNews(db: Db, kind: string, headline: string, body = '', companyId: string | null = null) {
  await db.insert(schema.news).values({ kind, headline, body, companyId, createdAt: clock.now() });
  await hint(db, topics.all, { t: 'news' });
}

// ------------------------------------------------------------ sanctions
export async function activeSanctions(db: Db, companyId: string) {
  return db
    .select()
    .from(schema.sanctions)
    .where(and(eq(schema.sanctions.companyId, companyId), gt(schema.sanctions.until, clock.now()), isNull(schema.sanctions.liftedAt)));
}

/** Throws if a court or the Owner has suspended this feature (or frozen the company's assets). */
export async function assertAllowed(db: Db, companyId: string, feature: Feature) {
  for (const s of await activeSanctions(db, companyId)) {
    if (s.kind === 'suspend' && s.feature === feature) throw forbidden(`⛔ Your ${FEATURES[feature].label.toLowerCase()} licence is suspended until ${new Date(s.until).toUTCString()}: ${s.reason}`, 'suspended');
  }
}

export async function assertNotFrozen(db: Db, companyId: string) {
  for (const s of await activeSanctions(db, companyId)) {
    if (s.kind === 'freeze') throw forbidden(`🧊 Your assets are frozen until ${new Date(s.until).toUTCString()}: ${s.reason}`, 'frozen');
  }
}
