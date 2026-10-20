/**
 * Unions: businesses band together. Each member business names a rep (one of its
 * logins) who votes and stands for office. Members elect a President, Vice
 * President and Treasurer for fixed terms, can hold votes of no confidence, pay
 * daily dues into a treasury, and trade with each other at half the sales tax.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { UNION_OFFICES, type UnionOffice } from '@dw/shared/live';
import { schema, type Db } from '../db';
import type { Account, Company } from '../http/router';
import { clock, dayKey, DAY, MINUTE } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { addNews, getSettings, hint, notify, topics } from './core';
import { balance, pay, post, W } from './money';

type Union = typeof schema.unions.$inferSelect;
const OFFICES = Object.keys(UNION_OFFICES) as UnionOffice[];
const col = { president: 'presidentId', vp: 'vpId', treasurer: 'treasurerId' } as const;

export async function getUnion(db: Db, id: string): Promise<Union> {
  const r = await db.select().from(schema.unions).where(eq(schema.unions.id, id));
  if (!r[0]) throw notFound('No such union.');
  return r[0];
}

export async function membership(db: Db, companyId: string) {
  return (await db.select().from(schema.unionMembers).where(eq(schema.unionMembers.companyId, companyId)))[0] ?? null;
}

async function members(db: Db, unionId: string) {
  return db.select().from(schema.unionMembers).where(eq(schema.unionMembers.unionId, unionId)).orderBy(asc(schema.unionMembers.joinedAt));
}

const held = (u: Union, companyId: string) => OFFICES.filter((o) => u[col[o]] === companyId);

async function tell(db: Db, unionId: string, title: string, body = '') {
  for (const m of await members(db, unionId)) await notify(db, { companyId: m.companyId }, 'union', title, body);
}
async function ping(db: Db, unionId: string) {
  for (const m of await members(db, unionId)) await hint(db, topics.company(m.companyId), { t: 'union' });
}

/** The rep (or the company admin) speaks for a member business. */
async function speaker(db: Db, account: Account, company: Company) {
  const m = await membership(db, company.id);
  if (!m) throw badRequest('Your company is not in a union.');
  if (m.repAccountId !== account.id && account.role !== 'ADMIN') throw forbidden("Only your company's union rep (or admin) can do that.", 'not_rep');
  return m;
}

// ------------------------------------------------------------ membership
export async function createUnion(db: Db, account: Account, company: Company, o: { name: string; emoji: string; motto: string; dues: number }) {
  if (await membership(db, company.id)) throw conflict('Leave your current union first.');
  const name = o.name.trim();
  if (name.length < 3) throw badRequest('Union names need at least 3 letters.');
  if ((await db.select({ id: schema.unions.id }).from(schema.unions).where(sql`lower(${schema.unions.name}) = lower(${name})`)).length) throw conflict('That union name is taken.');
  const s = await getSettings(db);
  await pay(db, W.company(company.id), W.treasury, s.unionCreateCost, 'union.create', `Founded ${name}`, account.id);
  const now = clock.now();
  const id = newId('uni');
  await db.insert(schema.unions).values({ id, name, emoji: o.emoji || '✊', motto: o.motto.slice(0, 120), presidentId: company.id, dues: clampDues(o.dues), termEndsAt: now + s.unionTermDays * DAY, duesDay: dayKey(now), createdAt: now });
  await db.insert(schema.unionMembers).values({ companyId: company.id, unionId: id, repAccountId: account.id, joinedAt: now });
  await addNews(db, 'union', `${o.emoji || '✊'} ${company.name} founds the union "${name}"`, o.motto, company.id);
  return { id };
}

const clampDues = (n: number) => Math.max(0, Math.min(5000, Math.floor(n || 0)));

export async function joinUnion(db: Db, account: Account, company: Company, unionId: string) {
  if (await membership(db, company.id)) throw conflict('Your company is already in a union.');
  const u = await getUnion(db, unionId);
  if (!u.open) throw forbidden('This union is not taking new members right now.');
  await db.insert(schema.unionMembers).values({ companyId: company.id, unionId, repAccountId: account.id, joinedAt: clock.now() });
  await tell(db, unionId, `✊ ${company.emoji} ${company.name} joined ${u.name}`);
  await ping(db, unionId);
  return { ok: true };
}

async function removeMember(db: Db, unionId: string, companyId: string, why: string) {
  const u = await getUnion(db, unionId);
  await db.delete(schema.unionMembers).where(eq(schema.unionMembers.companyId, companyId));
  const rest = await members(db, unionId);
  if (!rest.length) {
    const left = await balance(db, W.union(unionId));
    if (left > 0) await pay(db, W.union(unionId), W.company(companyId), left, 'union.disband');
    await db.delete(schema.elections).where(eq(schema.elections.unionId, unionId));
    await db.delete(schema.unions).where(eq(schema.unions.id, unionId));
    await addNews(db, 'union', `${u.emoji} The union "${u.name}" has disbanded.`);
    return;
  }
  const patch: Partial<Union> = {};
  for (const o of held(u, companyId)) patch[col[o]] = null;
  if (patch.presidentId === null && u.vpId && u.vpId !== companyId) {
    patch.presidentId = u.vpId;
    patch.vpId = null;
    await notify(db, { companyId: u.vpId }, 'union', `👑 You are now President of ${u.name}`, 'The President left, so the Vice President steps up.');
  }
  if (Object.keys(patch).length) await db.update(schema.unions).set(patch).where(eq(schema.unions.id, unionId));
  await tell(db, unionId, `👋 A member left ${u.name}`, why);
  await ping(db, unionId);
}

export async function leaveUnion(db: Db, account: Account, company: Company) {
  const m = await speaker(db, account, company);
  await removeMember(db, m.unionId, company.id, `${company.name} walked out.`);
  return { ok: true };
}

export async function kick(db: Db, account: Account, company: Company, targetId: string) {
  const m = await speaker(db, account, company);
  const u = await getUnion(db, m.unionId);
  if (u.presidentId !== company.id) throw forbidden('Only the President can expel members.');
  const t = await membership(db, targetId);
  if (!t || t.unionId !== u.id || targetId === company.id) throw notFound('They are not another member of your union.');
  await removeMember(db, u.id, targetId, 'Expelled by the President.');
  await notify(db, { companyId: targetId }, 'union', `🚪 You were expelled from ${u.name}`);
  return { ok: true };
}

export async function setRep(db: Db, account: Account, company: Company, repAccountId: string) {
  const m = await membership(db, company.id);
  if (!m) throw badRequest('Your company is not in a union.');
  if (account.role !== 'ADMIN' && m.repAccountId !== account.id) throw forbidden('Only the admin or the current rep can change the rep.');
  const acc = (await db.select().from(schema.accounts).where(and(eq(schema.accounts.id, repAccountId), eq(schema.accounts.companyId, company.id))))[0];
  if (!acc || acc.status !== 'active') throw badRequest('The rep must be an active login of your company.');
  await db.update(schema.unionMembers).set({ repAccountId }).where(eq(schema.unionMembers.companyId, company.id));
  return { ok: true };
}

export async function donate(db: Db, account: Account, company: Company, amount: number) {
  const m = await membership(db, company.id);
  if (!m) throw badRequest('Your company is not in a union.');
  await pay(db, W.company(company.id), W.union(m.unionId), Math.floor(amount), 'union.donate', 'Donation', account.id);
  await ping(db, m.unionId);
  return { ok: true };
}

export async function updateUnion(db: Db, account: Account, company: Company, patch: { motto?: string; dues?: number; open?: boolean }) {
  const m = await speaker(db, account, company);
  const u = await getUnion(db, m.unionId);
  if (u.presidentId !== company.id) throw forbidden('Only the President can change union settings.');
  await db.update(schema.unions).set({ ...(patch.motto != null ? { motto: patch.motto.slice(0, 120) } : {}), ...(patch.dues != null ? { dues: clampDues(patch.dues) } : {}), ...(patch.open != null ? { open: patch.open } : {}) }).where(eq(schema.unions.id, u.id));
  await ping(db, u.id);
  return { ok: true };
}

/** The Treasurer (or President) pays a member from the union treasury. */
export async function grant(db: Db, account: Account, company: Company, toId: string, amount: number) {
  const m = await speaker(db, account, company);
  const u = await getUnion(db, m.unionId);
  const h = held(u, company.id);
  if (!h.includes('treasurer') && !h.includes('president')) throw forbidden('Only the Treasurer or President can pay out grants.');
  const t = await membership(db, toId);
  if (!t || t.unionId !== u.id) throw badRequest('Grants go to members of your union.');
  await pay(db, W.union(u.id), W.company(toId), Math.floor(amount), 'union.grant', `${u.name} grant`, account.id);
  await notify(db, { companyId: toId }, 'union', `🎁 ${u.name} sent you a grant`, `${Math.floor(amount)} BT from the union treasury.`);
  await ping(db, u.id);
  return { ok: true };
}

// ------------------------------------------------------------ elections
async function openElection(db: Db, unionId: string, office: string) {
  return (await db.select().from(schema.elections).where(and(eq(schema.elections.unionId, unionId), eq(schema.elections.office, office), sql`${schema.elections.status} <> 'closed'`)))[0] ?? null;
}

async function startElection(db: Db, unionId: string, office: UnionOffice) {
  const existing = await openElection(db, unionId, office);
  if (existing) return existing;
  const s = await getSettings(db);
  const now = clock.now();
  const row = { id: newId('el', 12), unionId, office, targetId: null, targetOffice: null, status: 'nominating', votingAt: now + s.nominateMinutes * MINUTE, closesAt: now + (s.nominateMinutes + s.voteMinutes) * MINUTE, winnerId: null, result: null, createdAt: now };
  await db.insert(schema.elections).values(row);
  return row;
}

export async function callElection(db: Db, account: Account, company: Company, office: UnionOffice) {
  const m = await speaker(db, account, company);
  const u = await getUnion(db, m.unionId);
  if (u.presidentId && u.presidentId !== company.id) throw forbidden('Only the President can call an early election. Anyone can call a vote of no confidence.');
  const e = await startElection(db, u.id, office);
  await tell(db, u.id, `🗳️ ${u.name}: election for ${UNION_OFFICES[office].label}`, 'Nominations are open.');
  await ping(db, u.id);
  return e;
}

async function electionIn(db: Db, unionId: string, electionId: string) {
  const e = (await db.select().from(schema.elections).where(eq(schema.elections.id, electionId)))[0];
  if (!e || e.unionId !== unionId) throw notFound('No such election in your union.');
  return e;
}

export async function nominate(db: Db, account: Account, company: Company, electionId: string, pitch: string) {
  const m = await speaker(db, account, company);
  const e = await electionIn(db, m.unionId, electionId);
  if (e.office === 'recall') throw badRequest('Nobody runs in a vote of no confidence.');
  if (e.status !== 'nominating') throw conflict('Nominations have closed.');
  await db
    .insert(schema.candidates)
    .values({ electionId, companyId: company.id, pitch: pitch.slice(0, 200), at: clock.now() })
    .onConflictDoUpdate({ target: [schema.candidates.electionId, schema.candidates.companyId], set: { pitch: pitch.slice(0, 200) } });
  await ping(db, m.unionId);
  return { ok: true };
}

export async function withdraw(db: Db, account: Account, company: Company, electionId: string) {
  const m = await speaker(db, account, company);
  await db.delete(schema.candidates).where(and(eq(schema.candidates.electionId, electionId), eq(schema.candidates.companyId, company.id)));
  await ping(db, m.unionId);
  return { ok: true };
}

export async function vote(db: Db, account: Account, company: Company, electionId: string, choice: string) {
  const m = await speaker(db, account, company);
  const e = await electionIn(db, m.unionId, electionId);
  if (e.status !== 'voting') throw conflict(e.status === 'nominating' ? 'Voting has not opened yet.' : 'Voting has closed.');
  if (e.office === 'recall') {
    if (choice !== 'yes' && choice !== 'no') throw badRequest('Vote yes or no.');
  } else if (!(await db.select().from(schema.candidates).where(and(eq(schema.candidates.electionId, electionId), eq(schema.candidates.companyId, choice)))).length) {
    throw badRequest('That company is not on the ballot.');
  }
  await db
    .insert(schema.ballots)
    .values({ electionId, voterId: company.id, choice, at: clock.now() })
    .onConflictDoUpdate({ target: [schema.ballots.electionId, schema.ballots.voterId], set: { choice, at: clock.now() } });
  await ping(db, m.unionId);
  return { ok: true };
}

export async function callRecall(db: Db, account: Account, company: Company, office: UnionOffice) {
  const m = await speaker(db, account, company);
  const u = await getUnion(db, m.unionId);
  const holder = u[col[office]];
  if (!holder) throw badRequest('Nobody holds that office.');
  if (holder === company.id) throw badRequest('You can just resign instead.');
  if ((await members(db, u.id)).length < 3) throw conflict('A union needs at least 3 members for a vote of no confidence.');
  if (await openElection(db, u.id, 'recall')) throw conflict('A vote of no confidence is already running.');
  await pay(db, W.company(company.id), W.union(u.id), 100, 'union.recall', 'Vote of no confidence', account.id);
  const s = await getSettings(db);
  const now = clock.now();
  const row = { id: newId('el', 12), unionId: u.id, office: 'recall', targetId: holder, targetOffice: office, status: 'voting', votingAt: now, closesAt: now + s.voteMinutes * MINUTE, winnerId: null, result: null, createdAt: now };
  await db.insert(schema.elections).values(row);
  await tell(db, u.id, `⚠️ Vote of no confidence in ${u.name}`, `Should the ${UNION_OFFICES[office].label} stay? Vote now.`);
  await ping(db, u.id);
  return row;
}

export async function resign(db: Db, account: Account, company: Company, office: UnionOffice) {
  const m = await speaker(db, account, company);
  const u = await getUnion(db, m.unionId);
  if (u[col[office]] !== company.id) throw badRequest('You do not hold that office.');
  await db.update(schema.unions).set({ [col[office]]: null }).where(eq(schema.unions.id, u.id));
  await startElection(db, u.id, office);
  await tell(db, u.id, `📭 ${u.name}: the ${UNION_OFFICES[office].label} resigned`, 'An election has been called.');
  return { ok: true };
}

async function closeElection(db: Db, e: typeof schema.elections.$inferSelect) {
  const u = (await db.select().from(schema.unions).where(eq(schema.unions.id, e.unionId)))[0];
  if (!u) return;
  const votes = await db.select().from(schema.ballots).where(eq(schema.ballots.electionId, e.id));
  const tally: Record<string, number> = {};
  for (const v of votes) tally[v.choice] = (tally[v.choice] ?? 0) + 1;
  let winnerId: string | null = null;
  const nMembers = (await members(db, u.id)).length;
  if (e.office === 'recall') {
    const office = e.targetOffice as UnionOffice;
    const removed = (tally.yes ?? 0) > (tally.no ?? 0) && (tally.yes ?? 0) * 3 >= nMembers;
    if (removed && u[col[office]] === e.targetId) {
      await db.update(schema.unions).set({ [col[office]]: null }).where(eq(schema.unions.id, u.id));
      await startElection(db, u.id, office);
      await addNews(db, 'union', `${u.emoji} The ${UNION_OFFICES[office].label} of ${u.name} was voted out!`, `No confidence: ${tally.yes ?? 0} to ${tally.no ?? 0}.`);
    } else await tell(db, u.id, '🗳️ The office holder survived the vote of no confidence', `${tally.yes ?? 0} yes, ${tally.no ?? 0} no.`);
    winnerId = removed ? 'yes' : 'no';
  } else {
    const cands = await db.select().from(schema.candidates).where(eq(schema.candidates.electionId, e.id)).orderBy(asc(schema.candidates.at));
    const still = new Set((await members(db, u.id)).map((m) => m.companyId));
    const valid = cands.filter((c) => still.has(c.companyId));
    if (valid.length) {
      winnerId = valid.reduce((best, c) => ((tally[c.companyId] ?? 0) > (tally[best.companyId] ?? 0) ? c : best), valid[0]).companyId;
      const office = e.office as UnionOffice;
      const patch: Partial<Union> = { [col[office]]: winnerId };
      for (const o of OFFICES) if (o !== office && u[col[o]] === winnerId) patch[col[o]] = null; // one office per company
      await db.update(schema.unions).set(patch).where(eq(schema.unions.id, u.id));
      const w = (await db.select({ name: schema.companies.name, emoji: schema.companies.emoji }).from(schema.companies).where(eq(schema.companies.id, winnerId)))[0];
      await addNews(db, 'union', `${UNION_OFFICES[office].emoji} ${w?.emoji} ${w?.name} elected ${UNION_OFFICES[office].label} of ${u.emoji} ${u.name}`, `${tally[winnerId] ?? 0} of ${votes.length} votes.`, winnerId);
      await notify(db, { companyId: winnerId }, 'union', `${UNION_OFFICES[office].emoji} You won! ${UNION_OFFICES[office].label} of ${u.name}`);
    } else await tell(db, u.id, `🗳️ Nobody ran for ${UNION_OFFICES[e.office as UnionOffice].label}`, 'The office stays as it is.');
  }
  await db.update(schema.elections).set({ status: 'closed', winnerId, result: tally }).where(eq(schema.elections.id, e.id));
  await ping(db, u.id);
}

/** Advance election phases, start term elections, collect daily dues. */
export async function sweepUnions(db: Db, now: number) {
  for (const e of await db.select().from(schema.elections).where(and(eq(schema.elections.status, 'nominating'), sql`${schema.elections.votingAt} <= ${now}`))) {
    await db.update(schema.elections).set({ status: 'voting' }).where(eq(schema.elections.id, e.id));
    await tell(db, e.unionId, '🗳️ Voting is open', 'Your rep casts one vote for your company.');
  }
  for (const e of await db.select().from(schema.elections).where(and(eq(schema.elections.status, 'voting'), sql`${schema.elections.closesAt} <= ${now}`))) await closeElection(db, e);
  const s = await getSettings(db);
  for (const u of await db.select().from(schema.unions).where(sql`${schema.unions.termEndsAt} <= ${now}`)) {
    await db.update(schema.unions).set({ termEndsAt: now + s.unionTermDays * DAY }).where(eq(schema.unions.id, u.id));
    for (const o of OFFICES) await startElection(db, u.id, o);
    await tell(db, u.id, `🗳️ ${u.name}: the term is over!`, 'Elections for all three offices have started.');
  }
  const today = dayKey(now);
  for (const u of await db.select().from(schema.unions).where(sql`coalesce(${schema.unions.duesDay}, '') <> ${today}`)) {
    await db.update(schema.unions).set({ duesDay: today }).where(eq(schema.unions.id, u.id));
    if (u.dues <= 0) continue;
    for (const m of await members(db, u.id)) {
      const have = await balance(db, W.company(m.companyId));
      if (have >= u.dues) {
        await post(db, 'union.dues', [{ from: W.company(m.companyId), to: W.union(u.id), amount: u.dues }], { memo: `${u.name} dues` }).catch(() => null);
        if (m.duesOwed) await db.update(schema.unionMembers).set({ duesOwed: 0 }).where(eq(schema.unionMembers.companyId, m.companyId));
      } else if (m.duesOwed + 1 >= 3) {
        await removeMember(db, u.id, m.companyId, 'Expelled for not paying dues three days running.');
        await notify(db, { companyId: m.companyId }, 'union', `🚪 Expelled from ${u.name}`, 'Three days of unpaid dues.');
      } else {
        await db.update(schema.unionMembers).set({ duesOwed: m.duesOwed + 1 }).where(eq(schema.unionMembers.companyId, m.companyId));
        await notify(db, { companyId: m.companyId }, 'union', `💸 Could not pay ${u.name} dues`, `Strike ${m.duesOwed + 1} of 3.`);
      }
    }
  }
}

// ------------------------------------------------------------ views
async function brief(db: Db, ids: Array<string | null>) {
  const list = ids.filter(Boolean) as string[];
  if (!list.length) return new Map<string, { id: string; name: string; emoji: string; color: string }>();
  const r = await db.select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji, color: schema.companies.color }).from(schema.companies).where(inArray(schema.companies.id, list));
  return new Map(r.map((x) => [x.id, x]));
}

export async function listUnions(db: Db) {
  const all = await db.select().from(schema.unions).orderBy(desc(schema.unions.createdAt));
  const counts = await db.select({ u: schema.unionMembers.unionId, n: sql<number>`count(*)::int` }).from(schema.unionMembers).groupBy(schema.unionMembers.unionId);
  const cos = await brief(db, all.map((u) => u.presidentId));
  const out = [];
  for (const u of all) out.push({ ...u, members: counts.find((c) => c.u === u.id)?.n ?? 0, president: u.presidentId ? cos.get(u.presidentId) ?? null : null, treasury: await balance(db, W.union(u.id)) });
  return out;
}

export async function unionView(db: Db, unionId: string, account: Account, company: Company | null) {
  const u = await getUnion(db, unionId);
  const ms = await members(db, u.id);
  const cos = await brief(db, [...ms.map((m) => m.companyId), u.presidentId, u.vpId, u.treasurerId]);
  const reps = ms.length ? await db.select({ id: schema.accounts.id, name: schema.accounts.name }).from(schema.accounts).where(inArray(schema.accounts.id, ms.map((m) => m.repAccountId))) : [];
  const mine = company ? ms.find((m) => m.companyId === company.id) ?? null : null;
  const els = await db.select().from(schema.elections).where(eq(schema.elections.unionId, u.id)).orderBy(desc(schema.elections.createdAt)).limit(12);
  const elections = [];
  for (const e of els) {
    const cands = await db.select().from(schema.candidates).where(eq(schema.candidates.electionId, e.id));
    const votes = await db.select().from(schema.ballots).where(eq(schema.ballots.electionId, e.id));
    const cc = await brief(db, [...cands.map((x) => x.companyId), e.targetId]);
    elections.push({
      ...e,
      target: e.targetId ? cc.get(e.targetId) ?? null : null,
      candidates: cands.map((x) => ({ ...(cc.get(x.companyId) ?? { id: x.companyId, name: '?', emoji: '❓', color: '#888' }), pitch: x.pitch })),
      votesCast: votes.length,
      myVote: mine ? votes.find((v) => v.voterId === mine.companyId)?.choice ?? null : null,
      result: e.status === 'closed' ? e.result : null, // secret until the vote closes
    });
  }
  return {
    ...u,
    treasury: await balance(db, W.union(u.id)),
    president: u.presidentId ? cos.get(u.presidentId) ?? null : null,
    vp: u.vpId ? cos.get(u.vpId) ?? null : null,
    treasurer: u.treasurerId ? cos.get(u.treasurerId) ?? null : null,
    members: ms.map((m) => ({ ...(cos.get(m.companyId) ?? { id: m.companyId, name: '?', emoji: '❓', color: '#888' }), rep: reps.find((r) => r.id === m.repAccountId)?.name ?? '?', repAccountId: m.repAccountId, joinedAt: m.joinedAt, duesOwed: m.duesOwed, offices: held(u, m.companyId) })),
    elections,
    me: mine && company ? { companyId: company.id, offices: held(u, company.id), isRep: mine.repAccountId === account.id, canSpeak: mine.repAccountId === account.id || account.role === 'ADMIN', repAccountId: mine.repAccountId } : null,
  };
}

export async function dissolve(db: Db, unionId: string) {
  const u = await getUnion(db, unionId);
  const left = await balance(db, W.union(u.id));
  if (left > 0) await pay(db, W.union(u.id), W.treasury, left, 'union.dissolve');
  await tell(db, u.id, `🏛️ ${u.name} was dissolved by the Owner`);
  await db.delete(schema.unionMembers).where(eq(schema.unionMembers.unionId, u.id));
  await db.delete(schema.elections).where(eq(schema.elections.unionId, u.id));
  await db.delete(schema.unions).where(eq(schema.unions.id, u.id));
  return { ok: true };
}
