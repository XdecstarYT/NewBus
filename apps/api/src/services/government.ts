/**
 * Who runs the town. Normally the Owner (account 01, the game's creator). A union
 * President can call a vote of no confidence; if the companies vote yes, an
 * election follows and the winner becomes Mayor, with the Owner's powers for a
 * term. Everything a Mayor does with those powers is listed publicly. The creator
 * account always keeps full access and can dismiss a Mayor.
 */
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { GAME_DAY, GAME_MINUTE } from '@dw/shared/live';
import { schema, type Db } from '../db';
import type { Account, Company } from '../http/router';
import { clock } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { addNews, audit, getSettings, getValue, hint, notify, setValue, topics } from './core';
import { pay, W } from './money';

/** Elections for the town use this pseudo union id. */
export const TOWN = 'town';

export interface Mayor {
  companyId: string;
  accountId: string;
  since: number;
  termEndsAt: number;
}

export async function mayor(db: Db): Promise<Mayor | null> {
  return (await getValue<Mayor | null>(db, 'mayor')) ?? null;
}

async function clearMayor(db: Db) {
  await db.delete(schema.settings).where(eq(schema.settings.key, 'mayor'));
}

/** Is this login allowed to use the Owner's powers? */
export async function governs(db: Db, account: Account) {
  if (account.role === 'OWNER') return true;
  const m = await mayor(db);
  return !!m && m.accountId === account.id;
}

async function adminOf(db: Db, companyId: string) {
  return (await db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.role, 'ADMIN'), eq(schema.accounts.status, 'active'))).orderBy(asc(schema.accounts.createdAt)).limit(1))[0] ?? null;
}

async function companyCard(db: Db, id: string | null) {
  if (!id) return null;
  return (await db.select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji, color: schema.companies.color }).from(schema.companies).where(eq(schema.companies.id, id)))[0] ?? null;
}

async function running(db: Db) {
  return (await db.select().from(schema.elections).where(and(eq(schema.elections.unionId, TOWN), sql`${schema.elections.status} <> 'closed'`)))[0] ?? null;
}

async function everyone(db: Db, title: string, body = '') {
  await addNews(db, 'government', title, body);
  await hint(db, topics.all, { t: 'government' });
}

// ------------------------------------------------------------ vote of no confidence
/** A union President calls it; the union treasury pays. */
export async function callNoConfidence(db: Db, account: Account, company: Company) {
  const m = (await db.select().from(schema.unionMembers).where(eq(schema.unionMembers.companyId, company.id)))[0];
  if (!m) throw forbidden('Only a union can call a vote of no confidence. Join or found one first.');
  const u = (await db.select().from(schema.unions).where(eq(schema.unions.id, m.unionId)))[0];
  if (u.presidentId !== company.id || (m.repAccountId !== account.id && account.role !== 'ADMIN')) throw forbidden(`Only the President of ${u.name} can call it.`);
  const size = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.unionMembers).where(eq(schema.unionMembers.unionId, u.id)))[0].n;
  if (size < 2) throw conflict('Your union needs at least 2 member companies to call a vote of no confidence.');
  if (await running(db)) throw conflict('A town vote or election is already running.');
  const now = clock.now();
  const recent = await db.select({ id: schema.elections.id }).from(schema.elections).where(and(eq(schema.elections.unionId, TOWN), eq(schema.elections.office, 'noconfidence'), gt(schema.elections.createdAt, now - 3 * GAME_DAY)));
  if (recent.length) throw conflict('There was a vote of no confidence in the last 3 game days. Give it a little time.');
  const s = await getSettings(db);
  if (s.noConfidenceCost > 0) await pay(db, W.union(u.id), W.treasury, s.noConfidenceCost, 'union.noconfidence', 'Vote of no confidence', account.id);
  const cur = await mayor(db);
  const row = { id: newId('el', 12), unionId: TOWN, office: 'noconfidence', targetId: cur?.companyId ?? 'owner', targetOffice: u.id, status: 'voting', votingAt: now, closesAt: now + s.voteMinutes * GAME_MINUTE, winnerId: null, result: null, createdAt: now };
  await db.insert(schema.elections).values(row);
  const who = cur ? `Mayor ${(await companyCard(db, cur.companyId))?.name ?? ''}` : 'the Owner';
  await everyone(db, `⚠️ ${u.emoji} ${u.name} calls a vote of no confidence in ${who}!`, 'Every company gets one vote in 🏛️ Town Hall. If it passes, an election for Mayor follows.');
  return row;
}

// ------------------------------------------------------------ elections for Mayor
async function startMayorElection(db: Db, why: string) {
  const s = await getSettings(db);
  const now = clock.now();
  const row = { id: newId('el', 12), unionId: TOWN, office: 'mayor', targetId: null, targetOffice: null, status: 'nominating', votingAt: now + s.nominateMinutes * GAME_MINUTE, closesAt: now + (s.nominateMinutes + s.voteMinutes) * GAME_MINUTE, winnerId: null, result: null, createdAt: now };
  await db.insert(schema.elections).values(row);
  await everyone(db, `🗳️ Election for Mayor! ${why}`, 'Any company can run. The winner gets the Owner\'s powers for a term.');
  return row;
}

export async function nominate(db: Db, account: Account, company: Company, electionId: string, pitch: string) {
  const e = (await db.select().from(schema.elections).where(eq(schema.elections.id, electionId)))[0];
  if (!e || e.unionId !== TOWN || e.office !== 'mayor') throw notFound('No such election.');
  if (e.status !== 'nominating') throw conflict('Nominations have closed.');
  if (account.role !== 'ADMIN') throw forbidden('Your company admin decides whether to run.');
  await db
    .insert(schema.candidates)
    .values({ electionId, companyId: company.id, pitch: pitch.slice(0, 200), at: clock.now() })
    .onConflictDoUpdate({ target: [schema.candidates.electionId, schema.candidates.companyId], set: { pitch: pitch.slice(0, 200) } });
  await hint(db, topics.all, { t: 'government' });
  return { ok: true };
}

export async function withdraw(db: Db, company: Company, electionId: string) {
  await db.delete(schema.candidates).where(and(eq(schema.candidates.electionId, electionId), eq(schema.candidates.companyId, company.id)));
  await hint(db, topics.all, { t: 'government' });
  return { ok: true };
}

/** One vote per company: yes/no on a no-confidence vote, a company id in an election. */
export async function vote(db: Db, company: Company, electionId: string, choice: string) {
  const e = (await db.select().from(schema.elections).where(eq(schema.elections.id, electionId)))[0];
  if (!e || e.unionId !== TOWN) throw notFound('No such vote.');
  if (e.status !== 'voting') throw conflict(e.status === 'nominating' ? 'Voting opens when nominations close.' : 'Voting has closed.');
  if (e.office === 'noconfidence') {
    if (choice !== 'yes' && choice !== 'no') throw badRequest('Vote yes or no.');
  } else if (!(await db.select().from(schema.candidates).where(and(eq(schema.candidates.electionId, electionId), eq(schema.candidates.companyId, choice)))).length) {
    throw badRequest('That company is not on the ballot.');
  }
  await db
    .insert(schema.ballots)
    .values({ electionId, voterId: company.id, choice, at: clock.now() })
    .onConflictDoUpdate({ target: [schema.ballots.electionId, schema.ballots.voterId], set: { choice, at: clock.now() } });
  await hint(db, topics.all, { t: 'government' });
  return { ok: true };
}

async function tallyOf(db: Db, electionId: string) {
  const votes = await db.select().from(schema.ballots).where(eq(schema.ballots.electionId, electionId));
  const tally: Record<string, number> = {};
  for (const v of votes) tally[v.choice] = (tally[v.choice] ?? 0) + 1;
  return { tally, total: votes.length };
}

async function close(db: Db, e: typeof schema.elections.$inferSelect) {
  const { tally, total } = await tallyOf(db, e.id);
  let winnerId: string | null = null;
  if (e.office === 'noconfidence') {
    const s = await getSettings(db);
    const companies = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.companies).where(eq(schema.companies.status, 'active')))[0].n;
    const yes = tally.yes ?? 0;
    const no = tally.no ?? 0;
    const passed = yes > no && yes * 100 >= s.noConfidenceQuorumPct * companies;
    winnerId = passed ? 'yes' : 'no';
    await db.update(schema.elections).set({ status: 'closed', winnerId, result: tally }).where(eq(schema.elections.id, e.id));
    if (passed) {
      const cur = await mayor(db);
      if (cur && cur.companyId === e.targetId) {
        await clearMayor(db);
        await notify(db, { companyId: cur.companyId }, 'government', '🏛️ You lost the vote of no confidence', 'Your term as Mayor is over.');
      }
      await startMayorElection(db, `The vote of no confidence passed, ${yes} to ${no}.`);
    } else await everyone(db, `🏛️ The vote of no confidence failed (${yes} yes, ${no} no)`, yes > no ? `Not enough companies voted yes (needs ${s.noConfidenceQuorumPct}% of all companies).` : 'The government stays.');
    return;
  }
  // Mayor election: most votes wins, ties go to whoever entered first
  const cands = await db.select().from(schema.candidates).where(eq(schema.candidates.electionId, e.id)).orderBy(asc(schema.candidates.at));
  const valid = [];
  for (const c of cands) if (await adminOf(db, c.companyId)) valid.push(c);
  if (valid.length) winnerId = valid.reduce((best, c) => ((tally[c.companyId] ?? 0) > (tally[best.companyId] ?? 0) ? c : best), valid[0]).companyId;
  await db.update(schema.elections).set({ status: 'closed', winnerId, result: tally }).where(eq(schema.elections.id, e.id));
  if (!winnerId) {
    await clearMayor(db);
    await everyone(db, '🏛️ Nobody ran for Mayor', 'The Owner runs the town again.');
    return;
  }
  const admin = (await adminOf(db, winnerId))!;
  const s = await getSettings(db);
  const now = clock.now();
  await setValue(db, 'mayor', { companyId: winnerId, accountId: admin.id, since: now, termEndsAt: now + s.mayorTermDays * GAME_DAY } satisfies Mayor);
  const w = await companyCard(db, winnerId);
  await everyone(db, `👑 ${w?.emoji} ${w?.name} is the new Mayor!`, `${tally[winnerId] ?? 0} of ${total} votes. ${admin.name} now has the Owner's powers for ${s.mayorTermDays} game days.`);
  await notify(db, { companyId: winnerId }, 'government', '👑 You won! You are the Mayor', 'You have the Owner panel now. Everything you do with it is shown in the Town Hall.');
}

export async function sweepGovernment(db: Db, now: number) {
  for (const e of await db.select().from(schema.elections).where(and(eq(schema.elections.unionId, TOWN), eq(schema.elections.status, 'nominating'), sql`${schema.elections.votingAt} <= ${now}`))) {
    await db.update(schema.elections).set({ status: 'voting' }).where(eq(schema.elections.id, e.id));
    await everyone(db, '🗳️ Voting for Mayor is open', 'Every company gets one vote in 🏛️ Town Hall.');
  }
  for (const e of await db.select().from(schema.elections).where(and(eq(schema.elections.unionId, TOWN), eq(schema.elections.status, 'voting'), sql`${schema.elections.closesAt} <= ${now}`))) await close(db, e);
  const m = await mayor(db);
  // the Mayor keeps the job until the election is decided, and may run again
  if (m && m.termEndsAt <= now && !(await running(db))) await startMayorElection(db, "The Mayor's term is over.");
}

/** The creator can always step in: end the Mayor's term now. */
export async function dismiss(db: Db, actor: Account) {
  const m = await mayor(db);
  if (!m) throw conflict('There is no Mayor right now.');
  await clearMayor(db);
  await audit(db, actor.id, 'government.dismiss', m.companyId);
  const w = await companyCard(db, m.companyId);
  await everyone(db, `🏛️ The Owner dismissed Mayor ${w?.emoji ?? ''} ${w?.name ?? ''}`, 'The Owner runs the town again.');
  return { ok: true };
}

/** Called by the router after a Mayor uses an Owner power, so everyone can see it. */
export async function logMayorAction(db: Db, account: Account, method: string, path: string, body: unknown) {
  await audit(db, account.id, `mayor ${method} ${path.replace(/^\/api/, '')}`, null, body ?? null);
}

export async function view(db: Db, company: Company | null) {
  const m = await mayor(db);
  const e = await running(db);
  const past = await db.select().from(schema.elections).where(and(eq(schema.elections.unionId, TOWN), eq(schema.elections.status, 'closed'))).orderBy(desc(schema.elections.createdAt)).limit(8);
  const cards = new Map<string, Awaited<ReturnType<typeof companyCard>>>();
  const card = async (id: string | null) => {
    if (!id || id === 'owner' || id === 'yes' || id === 'no') return null;
    if (!cards.has(id)) cards.set(id, await companyCard(db, id));
    return cards.get(id) ?? null;
  };
  let current = null;
  if (e) {
    const { tally, total } = await tallyOf(db, e.id);
    const cands = e.office === 'mayor' ? await db.select().from(schema.candidates).where(eq(schema.candidates.electionId, e.id)).orderBy(asc(schema.candidates.at)) : [];
    const mine = company ? (await db.select().from(schema.ballots).where(and(eq(schema.ballots.electionId, e.id), eq(schema.ballots.voterId, company.id))))[0]?.choice ?? null : null;
    const caller = e.office === 'noconfidence' ? (await db.select({ name: schema.unions.name, emoji: schema.unions.emoji }).from(schema.unions).where(eq(schema.unions.id, e.targetOffice ?? '')))[0] ?? null : null;
    current = { ...e, tally, total, myVote: mine, caller, target: await card(e.targetId), candidates: await Promise.all(cands.map(async (c) => ({ ...c, company: await card(c.companyId) }))) };
  }
  const log = m ? await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.actorId, m.accountId), gt(schema.auditLog.createdAt, m.since))).orderBy(desc(schema.auditLog.id)).limit(40) : [];
  const s = await getSettings(db);
  const companies = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.companies).where(eq(schema.companies.status, 'active')))[0].n;
  return {
    mayor: m ? { ...m, company: await card(m.companyId), name: (await db.select({ name: schema.accounts.name }).from(schema.accounts).where(eq(schema.accounts.id, m.accountId)))[0]?.name ?? '' } : null,
    current,
    past: await Promise.all(past.map(async (p) => ({ ...p, winner: await card(p.winnerId), target: await card(p.targetId) }))),
    log: log.map((l) => ({ id: l.id, action: l.action, data: l.data, at: l.createdAt })),
    rules: { cost: s.noConfidenceCost, quorumPct: s.noConfidenceQuorumPct, termDays: s.mayorTermDays, billCost: s.unionBillCost, companies },
  };
}

