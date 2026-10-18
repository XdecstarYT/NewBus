/**
 * Contracts board: timed jobs from NPC clients with personalities.
 * Progress = Bits the company earns while the contract is active. Hit the
 * target before time runs out for the reward; hit the bonus target for more.
 */
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { db, schema, atomic } from '../db';
import { cfg } from './settings';
import { clock } from '../lib/time';
import { newId } from '../lib/ids';
import { liveRng } from '../engine/rng';
import { getCompany } from './companies';
import { getIndustry } from './catalog';
import { projectCompany, type TickCtx } from './tick';
import { payCompany } from './money';
import { SYS } from './ledger';
import { badRequest, notFound } from '../lib/errors';
import { bump } from './stats';
import { notify } from './notifications';
import { toCompany } from '../lib/bus';

const MAX_ACTIVE = 2;

function makeOffer(companyId: string) {
  const c = cfg();
  const co = getCompany(companyId);
  const ind = getIndustry(co.industryId);
  const rng = liveRng();
  const tpl = rng.pick(ind.contracts);
  const durationMs = Math.round((c.contracts.minDurationMs + rng.next() * (c.contracts.maxDurationMs - c.contracts.minDurationMs)) / 60_000) * 60_000;
  const income = Math.max(5, projectCompany(co).incomePerTick);
  const ticks = durationMs / c.tick.intervalMs;
  const target = Math.max(50, Math.round(income * ticks * c.contracts.targetRatio));
  const now = clock.now();
  const row = {
    id: newId('ctr'),
    companyId,
    data: { ...tpl, difficulty: target > income * ticks ? 'hard' : 'normal' },
    status: 'offered',
    target,
    bonusTarget: Math.round(target * c.contracts.bonusRatio),
    progress: 0,
    reward: Math.round(target * c.contracts.rewardRatio),
    bonusReward: Math.round(target * c.contracts.bonusRewardRatio),
    durationMs,
    startedAt: null,
    endsAt: null,
    expiresAt: now + c.contracts.refreshMs,
    counterpartyId: null,
    createdAt: now,
  };
  db.insert(schema.contracts).values(row).run();
  return row;
}

export function board(companyId: string) {
  const now = clock.now();
  const c = cfg();
  db.delete(schema.contracts).where(and(eq(schema.contracts.companyId, companyId), eq(schema.contracts.status, 'offered'), lt(schema.contracts.expiresAt, now))).run();
  const offered = db.select().from(schema.contracts).where(and(eq(schema.contracts.companyId, companyId), eq(schema.contracts.status, 'offered'))).all();
  for (let i = offered.length; i < c.contracts.boardSize; i++) offered.push(makeOffer(companyId));
  const mine = db
    .select()
    .from(schema.contracts)
    .where(and(eq(schema.contracts.companyId, companyId), inArray(schema.contracts.status, ['active', 'success', 'failed'])))
    .orderBy(sql`${schema.contracts.createdAt} DESC`)
    .limit(10)
    .all();
  return { offered, mine, maxActive: MAX_ACTIVE };
}

export function accept(companyId: string, id: string) {
  return atomic(() => {
    const ct = db.select().from(schema.contracts).where(and(eq(schema.contracts.id, id), eq(schema.contracts.companyId, companyId))).get();
    if (!ct || ct.status !== 'offered') throw notFound('That contract is gone. The client found someone else (rude).');
    const active = db.select({ n: sql<number>`count(*)` }).from(schema.contracts).where(and(eq(schema.contracts.companyId, companyId), eq(schema.contracts.status, 'active'))).get()!.n;
    if (active >= MAX_ACTIVE) throw badRequest(`You can juggle at most ${MAX_ACTIVE} contracts at once.`);
    const now = clock.now();
    db.update(schema.contracts).set({ status: 'active', startedAt: now, endsAt: now + ct.durationMs }).where(eq(schema.contracts.id, id)).run();
    return { ok: true, endsAt: now + ct.durationMs };
  });
}

export function claim(companyId: string, id: string, actorId: string) {
  return atomic(() => {
    const ct = db.select().from(schema.contracts).where(and(eq(schema.contracts.id, id), eq(schema.contracts.companyId, companyId))).get();
    if (!ct) throw notFound('No such contract.');
    if (ct.status !== 'success') throw badRequest(ct.status === 'claimed' ? 'Already claimed!' : 'Not finished yet.');
    const bonus = !!(ct.data as any).speedBonus;
    const amount = ct.reward + (bonus ? ct.bonusReward : 0);
    db.update(schema.contracts).set({ status: 'claimed' }).where(eq(schema.contracts.id, id)).run();
    const paid = payCompany({ companyId, amount, from: SYS.TREASURY, kind: 'reward.contract', memo: (ct.data as any).title, idempotencyKey: `contract:${id}`, actorId, partial: false });
    bump(companyId, 'contracts');
    if (bonus) bump(companyId, 'contractBonuses');
    return { paid, bonus };
  });
}

export function abandon(companyId: string, id: string) {
  const ct = db.select().from(schema.contracts).where(and(eq(schema.contracts.id, id), eq(schema.contracts.companyId, companyId))).get();
  if (!ct || ct.status !== 'active') throw notFound('No active contract to abandon.');
  db.update(schema.contracts).set({ status: 'failed' }).where(eq(schema.contracts.id, id)).run();
  db.update(schema.companies).set({ reputation: sql`MAX(0, ${schema.companies.reputation} - 5)` }).where(eq(schema.companies.id, companyId)).run();
  return { ok: true };
}

/** Tick hook: add earnings to active contracts, settle finished ones. */
export function contractsTick(ctx: TickCtx) {
  const active = db.select().from(schema.contracts).where(and(eq(schema.contracts.companyId, ctx.company.id), eq(schema.contracts.status, 'active'))).all();
  for (const ct of active) {
    const progress = ct.progress + Math.max(0, ctx.earned);
    if (progress >= ct.target) {
      // Done! Bonus objective = finish in the first half of the time window.
      const speedBonus = ctx.now <= (ct.startedAt ?? 0) + ct.durationMs / 2;
      db.update(schema.contracts).set({ progress, status: 'success', data: { ...(ct.data as any), speedBonus, completedAt: ctx.now } }).where(eq(schema.contracts.id, ct.id)).run();
      notify(ctx.company.id, 'contract', `📜 Contract complete: ${(ct.data as any).title}`, speedBonus ? 'Speed bonus earned too! Claim your reward.' : 'Claim your reward on the Contracts board.');
      toCompany(ctx.company.id, { type: 'contract_done', id: ct.id });
    } else if (ctx.now >= (ct.endsAt ?? 0)) {
      db.update(schema.contracts).set({ progress, status: 'failed' }).where(eq(schema.contracts.id, ct.id)).run();
      notify(ctx.company.id, 'contract', `😬 Contract missed: ${(ct.data as any).title}`, 'The client is disappointed but will get over it.');
    } else {
      db.update(schema.contracts).set({ progress }).where(eq(schema.contracts.id, ct.id)).run();
    }
  }
}
