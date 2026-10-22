/**
 * Laws: the government (the Owner or an elected Mayor) or a union proposes, every
 * company gets one vote, and the government can sign or veto, except that a bill
 * two thirds voted for can not be vetoed. Demands are free-text requests the
 * government has to answer publicly.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { LAW_KINDS, type LawKind, GAME_HOUR, GAME_DAY } from '@dw/shared/live';
import { schema, type Db } from '../db';
import type { Company } from '../http/router';
import { clock } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, conflict, notFound } from '../lib/errors';
import { addNews, getSettings, hint, patchSettings, setValue, topics } from './core';
import { balance, pay, W } from './money';

export function lawTitle(kind: LawKind, value: number, text = '') {
  if (kind === 'demand') return `Demand: ${text}`;
  if (kind === 'tax') return `Set the sales tax to ${value}%`;
  if (kind === 'stimulus') return `Stimulus: ${value} BT for every company`;
  return `Energy boost: +${value} Energy/hour for 24 hours`;
}

export async function propose(db: Db, kind: string, value: number, o: { text?: string; unionId?: string | null; unionName?: string } = {}) {
  if (!(kind in LAW_KINDS)) throw badRequest('Unknown kind of law.');
  const v = kind === 'demand' ? 0 : Math.floor(value);
  const text = (o.text ?? '').trim().slice(0, 160);
  if (kind === 'demand' && text.length < 5) throw badRequest('Say what you are demanding (at least 5 letters).');
  if (kind === 'tax' && (v < 0 || v > 50)) throw badRequest('Tax must be 0 to 50%.');
  if (kind === 'stimulus' && (v < 1 || v > 100_000)) throw badRequest('Stimulus must be 1 to 100,000 BT.');
  if (kind === 'energy' && (v < 1 || v > 50)) throw badRequest('Energy boost must be 1 to 50 per hour.');
  const s = await getSettings(db);
  const now = clock.now();
  const row = { id: newId('law', 12), kind, value: v, title: lawTitle(kind as LawKind, v, text), status: 'voting', yes: 0, no: 0, createdAt: now, closesAt: now + s.lawVoteHours * GAME_HOUR, decidedAt: null, proposedBy: o.unionId ?? null, response: null };
  await db.insert(schema.laws).values(row);
  await addNews(db, 'law', `🏛️ New bill${o.unionName ? ` from ${o.unionName}` : ''}: ${row.title}`, 'Every company gets one vote. Vote in 🏛️ Town Hall.');
  await hint(db, topics.all, { t: 'law' });
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
  else if (law.kind === 'energy') await setValue(db, 'energyBoost', { value: law.value, until: clock.now() + GAME_DAY });
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
  if (decision === 'veto' && law.kind !== 'demand' && supermajority(law)) throw conflict('Two thirds of the votes are yes: the people have spoken, this bill can not be vetoed.');
  const passed = decision === 'pass' || (decision === 'count' && law.yes > law.no);
  const status = decision === 'veto' ? 'vetoed' : passed ? 'passed' : 'failed';
  await db.update(schema.laws).set({ status, decidedAt: clock.now() }).where(eq(schema.laws.id, lawId));
  if (passed) await enact(db, law);
  const verb = law.kind === 'demand' ? (status === 'passed' ? (decision === 'pass' ? 'is ACCEPTED by the government' : 'PASSES: the government must answer') : status === 'vetoed' ? 'is REJECTED by the government' : 'fails') : status === 'passed' ? 'PASSES' : status === 'vetoed' ? 'is VETOED by the government' : 'fails';
  await addNews(db, 'law', `🏛️ "${law.title}" ${verb}`, `${law.yes} yes, ${law.no} no.`);
  await hint(db, topics.all, { t: 'law' });
  return { status };
}

/** Two thirds yes (with at least 2 yes votes). */
export const supermajority = (l: { yes: number; no: number }) => l.yes >= 2 && l.yes * 3 >= (l.yes + l.no) * 2;

/** The government answers a demand in public. */
export async function respond(db: Db, lawId: string, text: string) {
  const law = (await db.select().from(schema.laws).where(eq(schema.laws.id, lawId)).for('update'))[0];
  if (!law || law.kind !== 'demand') throw notFound('No such demand.');
  await db.update(schema.laws).set({ response: text.trim().slice(0, 500) }).where(eq(schema.laws.id, lawId));
  await addNews(db, 'law', `📣 The government answers: "${law.title}"`, text.trim().slice(0, 300));
  await hint(db, topics.all, { t: 'law' });
  return { ok: true };
}

/** A union puts a bill to the Town Hall (President only, paid from the union treasury, one open bill at a time). */
export async function unionPropose(db: Db, unionId: string, unionName: string, kind: string, value: number, text: string) {
  const open = await db.select({ id: schema.laws.id }).from(schema.laws).where(and(eq(schema.laws.proposedBy, unionId), eq(schema.laws.status, 'voting')));
  if (open.length) throw conflict('Your union already has a bill being voted on.');
  const s = await getSettings(db);
  if (s.unionBillCost > 0) await pay(db, W.union(unionId), W.treasury, s.unionBillCost, 'union.bill', 'Filing a bill');
  return propose(db, kind, value, { text, unionId, unionName });
}

export async function sweepLaws(db: Db, now: number) {
  for (const l of await db.select().from(schema.laws).where(and(eq(schema.laws.status, 'voting'), sql`${schema.laws.closesAt} <= ${now}`))) await decide(db, l.id, 'count');
}

export async function lawsView(db: Db, companyId: string | null) {
  const rows = await db.select().from(schema.laws).orderBy(desc(schema.laws.createdAt)).limit(30);
  const unions = await db.select({ id: schema.unions.id, name: schema.unions.name, emoji: schema.unions.emoji }).from(schema.unions);
  const mine = companyId ? await db.select().from(schema.lawVotes).where(eq(schema.lawVotes.companyId, companyId)) : [];
  const s = await getSettings(db);
  return { laws: rows.map((l) => ({ ...l, union: unions.find((u) => u.id === l.proposedBy) ?? null, supermajority: supermajority(l), myVote: mine.find((m) => m.lawId === l.id)?.vote ?? null })), salesTaxPct: s.salesTaxPct, treasury: await balance(db, W.treasury) };
}
