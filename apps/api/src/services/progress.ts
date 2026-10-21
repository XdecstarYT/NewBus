/** Daily quests, personal skill levels and achievements. */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { gameDayKey } from '@dw/shared/live';
import { schema, type Db } from '../db';
import type { Account, Company } from '../http/router';
import { clock } from '../lib/time';
import { badRequest, conflict, notFound } from '../lib/errors';
import { getSettings, hint, topics } from './core';
import { fromTreasury, W } from './money';

// ------------------------------------------------------------ skill levels
/** Personal level from XP (work shifts, office jobs, quests). */
export const skillLevel = (xp: number) => Math.floor(Math.sqrt(Math.max(0, xp) / 60)) + 1;
/** Each level above 1 adds 2% output on shifts (max +40%). */
export const skillBonus = (xp: number) => Math.min(0.4, 0.02 * (skillLevel(xp) - 1));

export async function addXp(db: Db, accountId: string, xp: number) {
  if (xp > 0) await db.update(schema.accounts).set({ xp: sql`${schema.accounts.xp} + ${Math.round(xp)}` }).where(eq(schema.accounts.id, accountId));
}

// ------------------------------------------------------------ daily quests
export const QUESTS = [
  { id: 'shifts-10', kind: 'batches', target: 10, emoji: '⚒️', label: 'Work 10 batches' },
  { id: 'shifts-25', kind: 'batches', target: 25, emoji: '🏭', label: 'Work 25 batches' },
  { id: 'trade-1', kind: 'trade', target: 1, emoji: '📈', label: 'Make a market trade' },
  { id: 'trade-3', kind: 'trade', target: 3, emoji: '💹', label: 'Make 3 market trades' },
  { id: 'job-1', kind: 'job', target: 1, emoji: '💼', label: 'Finish an office job' },
  { id: 'job-2', kind: 'job', target: 2, emoji: '🗂️', label: 'Finish 2 office jobs' },
  { id: 'customer-1', kind: 'customer', target: 1, emoji: '🧑‍💼', label: 'Serve an AI customer' },
  { id: 'customer-2', kind: 'customer', target: 2, emoji: '🛎️', label: 'Serve 2 AI customers' },
  { id: 'eat-2', kind: 'eat', target: 2, emoji: '🍞', label: 'Eat 2 snacks' },
  { id: 'chat-3', kind: 'chat', target: 3, emoji: '💬', label: 'Send 3 chat messages' },
  { id: 'contract-1', kind: 'contract', target: 1, emoji: '📝', label: 'Deliver or accept a contract' },
  { id: 'sale-1', kind: 'sale', target: 1, emoji: '🧾', label: 'Buy from a player shop or register' },
] as const;
export type QuestKind = (typeof QUESTS)[number]['kind'];

function pickFor(accountId: string, day: string) {
  let h = 0;
  for (const ch of accountId + day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const kinds = new Set<string>();
  const out: (typeof QUESTS)[number][] = [];
  for (let i = 0; out.length < 3 && i < 50; i++) {
    const q = QUESTS[(h + i * 7) % QUESTS.length];
    if (kinds.has(q.kind)) continue;
    kinds.add(q.kind);
    out.push(q);
  }
  return out;
}

async function ensureToday(db: Db, accountId: string) {
  const day = gameDayKey(clock.now());
  const have = await db.select().from(schema.quests).where(and(eq(schema.quests.accountId, accountId), eq(schema.quests.day, day)));
  if (have.length) return have;
  const rows = pickFor(accountId, day).map((q) => ({ accountId, day, questId: q.id, kind: q.kind, target: q.target, progress: 0, claimed: false }));
  await db.insert(schema.quests).values(rows).onConflictDoNothing();
  return db.select().from(schema.quests).where(and(eq(schema.quests.accountId, accountId), eq(schema.quests.day, day)));
}

/** Count progress toward today's quests. Cheap no-op when the player has no matching quest. */
export async function bumpQuest(db: Db, accountId: string | null | undefined, kind: QuestKind, n = 1) {
  if (!accountId || n <= 0) return;
  await ensureToday(db, accountId);
  await db
    .update(schema.quests)
    .set({ progress: sql`least(${schema.quests.target}, ${schema.quests.progress} + ${n})` })
    .where(and(eq(schema.quests.accountId, accountId), eq(schema.quests.day, gameDayKey(clock.now())), eq(schema.quests.kind, kind)));
}

export async function questsView(db: Db, account: Account) {
  const rows = await ensureToday(db, account.id);
  const s = await getSettings(db);
  return {
    quests: rows.map((r) => ({ ...r, ...QUESTS.find((q) => q.id === r.questId) })),
    reward: s.questReward,
    xp: account.xp,
    level: skillLevel(account.xp),
    nextLevelXp: 60 * skillLevel(account.xp) ** 2,
    bonusPct: Math.round(skillBonus(account.xp) * 100),
  };
}

export async function claimQuest(db: Db, account: Account, company: Company, questId: string) {
  const r = (await db.select().from(schema.quests).where(and(eq(schema.quests.accountId, account.id), eq(schema.quests.day, gameDayKey(clock.now())), eq(schema.quests.questId, questId))).for('update'))[0];
  if (!r) throw notFound('No such quest today.');
  if (r.claimed) throw conflict('Already claimed.');
  if (r.progress < r.target) throw badRequest('Not finished yet!');
  const s = await getSettings(db);
  await db.update(schema.quests).set({ claimed: true }).where(and(eq(schema.quests.accountId, account.id), eq(schema.quests.day, r.day), eq(schema.quests.questId, questId)));
  const paid = await fromTreasury(db, W.company(company.id), s.questReward, 'quest.reward', `Daily quest: ${questId}`);
  await addXp(db, account.id, 50);
  await hint(db, topics.company(company.id), { t: 'company' });
  return { paid, xp: 50 };
}

// ------------------------------------------------------------ achievements
interface Badge {
  id: string;
  emoji: string;
  label: string;
  target: number;
}
const LADDERS: Array<{ key: string; emoji: string; name: (n: number) => string; steps: number[] }> = [
  { key: 'batches', emoji: '⚒️', name: (n) => `Work ${n} batches`, steps: [10, 100, 500, 2000] },
  { key: 'trades', emoji: '📈', name: (n) => `${n} market trades`, steps: [1, 25, 100] },
  { key: 'jobs', emoji: '💼', name: (n) => `${n} office jobs done`, steps: [1, 10, 50] },
  { key: 'perfect', emoji: '💯', name: (n) => `${n} perfect office job${n === 1 ? '' : 's'}`, steps: [1, 10] },
  { key: 'customers', emoji: '🧑‍💼', name: (n) => `Serve ${n} AI customers`, steps: [1, 10, 50] },
  { key: 'contracts', emoji: '📝', name: (n) => `Deliver ${n} contracts`, steps: [1, 10] },
  { key: 'facilities', emoji: '🏭', name: (n) => `Own ${n} facilities`, steps: [2, 5, 10] },
  { key: 'prestige', emoji: '✨', name: (n) => `${n} prestige`, steps: [50, 250, 1000] },
  { key: 'officer', emoji: '👑', name: () => 'Hold a union office', steps: [1] },
  { key: 'won', emoji: '⚖️', name: () => 'Win a court case', steps: [1] },
];

export async function achievements(db: Db, company: Company) {
  const id = company.id;
  const one = async (q: Promise<Array<{ n: number | string | null }>>) => Number((await q)[0]?.n ?? 0);
  const stats: Record<string, number> = {
    batches: await one(db.select({ n: sql<number>`coalesce(sum(${schema.workLog.batches}),0)` }).from(schema.workLog).where(eq(schema.workLog.companyId, id))),
    trades: await one(db.select({ n: sql<number>`count(*)` }).from(schema.trades).where(and(eq(schema.trades.venue, 'market'), sql`(${schema.trades.buyerId} = ${id} or ${schema.trades.sellerId} = ${id})`))),
    jobs: await one(db.select({ n: sql<number>`count(*)` }).from(schema.submissions).where(and(eq(schema.submissions.companyId, id), eq(schema.submissions.status, 'graded')))),
    perfect: await one(db.select({ n: sql<number>`count(*)` }).from(schema.submissions).where(and(eq(schema.submissions.companyId, id), eq(schema.submissions.score, 100)))),
    customers: await one(db.select({ n: sql<number>`count(*)` }).from(schema.customerOrders).where(eq(schema.customerOrders.filledBy, id))),
    contracts: await one(db.select({ n: sql<number>`count(*)` }).from(schema.contracts).where(and(eq(schema.contracts.sellerId, id), eq(schema.contracts.status, 'delivered')))),
    facilities: await one(db.select({ n: sql<number>`count(*)` }).from(schema.facilities).where(eq(schema.facilities.companyId, id))),
    prestige: company.prestige,
    officer: await one(db.select({ n: sql<number>`count(*)` }).from(schema.unions).where(sql`${id} in (${schema.unions.presidentId}, ${schema.unions.vpId}, ${schema.unions.treasurerId})`)),
    won: await one(db.select({ n: sql<number>`count(*)` }).from(schema.cases).where(and(eq(schema.cases.status, 'closed'), sql`((${schema.cases.verdict} = 'plaintiff' and ${schema.cases.plaintiffId} = ${id}) or (${schema.cases.verdict} = 'defendant' and ${schema.cases.defendantId} = ${id}))`))),
  };
  const badges: Array<Badge & { progress: number; earned: boolean }> = [];
  for (const l of LADDERS) for (const step of l.steps) badges.push({ id: `${l.key}-${step}`, emoji: l.emoji, label: l.name(step), target: step, progress: Math.min(step, stats[l.key]), earned: stats[l.key] >= step });
  return { badges, earned: badges.filter((b) => b.earned).length, total: badges.length, stats };
}

export async function badgeCounts(db: Db, companyIds: string[]) {
  if (!companyIds.length) return {} as Record<string, number>;
  const cos = await db.select().from(schema.companies).where(inArray(schema.companies.id, companyIds));
  const out: Record<string, number> = {};
  for (const c of cos) out[c.id] = (await achievements(db, c)).earned;
  return out;
}

