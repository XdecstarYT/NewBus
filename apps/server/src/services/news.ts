import { desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { newId } from '../lib/ids';
import { clock } from '../lib/time';
import { toAll } from '../lib/bus';

/** The Daily Byte: auto-generated headlines about real in-game activity. */
export function addNews(kind: string, headline: string, body = '', companyId: string | null = null) {
  const row = { id: newId('news'), kind, headline, body, companyId, reactions: {}, createdAt: clock.now() };
  db.insert(schema.news).values(row).run();
  toAll({ type: 'news', item: row });
  return row;
}

export function listNews(limit = 50, kind?: string) {
  const q = db.select().from(schema.news);
  return (kind ? q.where(eq(schema.news.kind, kind)) : q).orderBy(desc(schema.news.createdAt)).limit(limit).all();
}

export function reactToNews(id: string, emoji: string) {
  const n = db.select().from(schema.news).where(eq(schema.news.id, id)).get();
  if (!n) return null;
  const reactions = { ...(n.reactions ?? {}) };
  reactions[emoji] = (reactions[emoji] ?? 0) + 1;
  db.update(schema.news).set({ reactions }).where(eq(schema.news.id, id)).run();
  return reactions;
}

export function pruneNews(keep = 500) {
  const cutoff = db.select({ c: schema.news.createdAt }).from(schema.news).orderBy(desc(schema.news.createdAt)).limit(1).offset(keep).get();
  if (cutoff) db.delete(schema.news).where(sql`${schema.news.createdAt} <= ${cutoff.c}`).run();
}
