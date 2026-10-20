/** Laws: the Owner proposes, every company gets one vote, the Owner can sign or veto. */
import { and, desc, eq, sql } from 'drizzle-orm';
import { LAW_KINDS, type LawKind } from '@dw/shared/live';
import { schema, type Db } from '../db';
import type { Company } from '../http/router';
import { clock, DAY, HOUR } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, conflict, notFound } from '../lib/errors';
import { addNews, getSettings, hint, patchSettings, setValue, topics } from './core';
import { balance, pay, W } from './money';

export function lawTitle(kind: LawKind, value: number) {
  if (kind === 'tax') return `Set the sales tax to ${value}%`;
  if (kind === 'stimulus') return `Stimulus: ${value} BT for every company`;
  return `Energy boost: +${value} Energy/hour for 24 hours`;
}

export async function propose(db: Db, kind: string, value: number) {
  if (!(kind in LAW_KINDS)) throw badRequest('Unknown kind of law.');
  const v = Math.floor(value);
  if (kind === 'tax' && (v < 0 || v > 50)) throw badRequest('Tax must be 0 to 50%.');
  if (kind === 'stimulus' && (v < 1 || v > 100_000)) throw badRequest('Stimulus must be 1 to 100,000 BT.');
  if (kind === 'energy' && (v < 1 || v > 50)) throw badRequest('Energy boost must be 1 to 50 per hour.');
  const s = await getSettings(db);
  const now = clock.now();
  const row = { id: newId('law', 12), kind, value: v, title: lawTitle(kind as LawKind, v), status: 'voting', yes: 0, no: 0, createdAt: now, closesAt: now + s.lawVoteHours * HOUR, decidedAt: null };
  await db.insert(schema.laws).values(row);
  await addNews(db, 'law', `🏛️ New bill: ${row.title}`, 'Every company gets one vote. Vote in 🏛️ Town Hall.');
  return row;
}

export async function vote(db: Db, company: Company, lawId: string, choice: 'yes' | 'no') {
  const law = (await db.select().from(schema.laws).where(eq(schema.laws.id, lawId)).for('update'))[0];
  if (!law) throw notFound('No such bill.');
  if (law.status !== 'voting' || law.closesAt < clock.now()) throw conflict('Voting on this bill has closed.');
  await db
    .insert(schema.lawVotes)
    .values({ lawId, companyId: company.id, vote: choice, at: clock.now() })
    .onConflictDoUpdate({ target: [schema.lawVotes.lawId, schema.lawVotes.companyId], set: { vote: choice, at: clock.now() } });
  const t = await db
    .select({ yes: sql<number>`count(*) filter (where ${schema.lawVotes.vote} = 'yes')::int`, no: sql<number>`count(*) filter (where ${schema.lawVotes.vote} = 'no')::int` })
    .from(schema.lawVotes)
    .where(eq(schema.lawVotes.lawId, lawId));
  await db.update(schema.laws).set({ yes: t[0].yes, no: t[0].no }).where(eq(schema.laws.id, lawId));
  await hint(db, topics.all, { t: 'law' });
  return { ok: true };
}

async function enact(db: Db, law: typeof schema.laws.$inferSelect) {
  if (law.kind === 'tax') await patchSettings(db, { salesTaxPct: law.value });
  else if (law.kind === 'energy') await setValue(db, 'energyBoost', { value: law.value, until: clock.now() + DAY });
  else if (law.kind === 'stimulus') {
    const cos = await db.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.status, 'active'));
    if (!cos.length) return;
    const each = Math.min(law.value, Math.floor((await balance(db, W.treasury)) / cos.length));
    if (each > 0) for (const c of cos) await pay(db, W.treasury, W.company(c.id), each, 'law.stimulus', law.title);
  }
}

/** Owner signs it, vetoes it, or lets the votes decide (also what happens when voting closes). */
export async function decide(db: Db, lawId: string, decision: 'pass' | 'veto' | 'count') {
  const law = (await db.select().from(schema.laws).where(eq(schema.laws.id, lawId)).for('update'))[0];
  if (!law) throw notFound('No such bill.');
  if (law.status !== 'voting') throw conflict('This bill was already decided.');
  const passed = decision === 'pass' || (decision === 'count' && law.yes > law.no);
  const status = decision === 'veto' ? 'vetoed' : passed ? 'passed' : 'failed';
  await db.update(schema.laws).set({ status, decidedAt: clock.now() }).where(eq(schema.laws.id, lawId));
  if (passed) await enact(db, law);
  await addNews(db, 'law', `🏛️ "${law.title}" ${status === 'passed' ? 'PASSES' : status === 'vetoed' ? 'is VETOED by the Owner' : 'fails'}`, `${law.yes} yes, ${law.no} no.`);
  return { status };
}

export async function sweepLaws(db: Db, now: number) {
  for (const l of await db.select().from(schema.laws).where(and(eq(schema.laws.status, 'voting'), sql`${schema.laws.closesAt} <= ${now}`))) await decide(db, l.id, 'count');
}

export async function lawsView(db: Db, companyId: string | null) {
  const rows = await db.select().from(schema.laws).orderBy(desc(schema.laws.createdAt)).limit(30);
  const mine = companyId ? await db.select().from(schema.lawVotes).where(eq(schema.lawVotes.companyId, companyId)) : [];
  const s = await getSettings(db);
  return { laws: rows.map((l) => ({ ...l, myVote: mine.find((m) => m.lawId === l.id)?.vote ?? null })), salesTaxPct: s.salesTaxPct, treasury: await balance(db, W.treasury) };
}
