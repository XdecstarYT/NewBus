/**
 * Random office events with choices and consequences, plus owner-triggered
 * events (Chaos Controls). Bad events can be covered by insurance.
 */
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { EventTemplate } from '@dw/shared';
import { db, schema, atomic } from '../db';
import { cfg } from './settings';
import { clock } from '../lib/time';
import { newId } from '../lib/ids';
import { liveRng } from '../engine/rng';
import { OFFICE_EVENTS, DRAMA_EVENTS } from '../catalog/events';
import { getIndustry } from './catalog';
import { getCompany } from './companies';
import { getCompanyPermissions } from '../permissions';
import { flag } from './flags';
import { companyBalance, payCompany } from './money';
import { SYS, post } from './ledger';
import { companyWallet } from './money';
import { addModifier } from './multipliers';
import { badRequest, notFound } from '../lib/errors';
import { toCompany } from '../lib/bus';
import { bump } from './stats';
import type { TickCtx } from './tick';

export function eventTemplates(industryId: string): EventTemplate[] {
  return [...OFFICE_EVENTS, ...getIndustry(industryId).events];
}

export function findTemplate(industryId: string, id: string): EventTemplate | undefined {
  return [...eventTemplates(industryId), ...DRAMA_EVENTS].find((e) => e.id === id);
}

export function pendingEvent(companyId: string) {
  return db.select().from(schema.companyEvents).where(and(eq(schema.companyEvents.companyId, companyId), eq(schema.companyEvents.status, 'pending'))).get() ?? null;
}

export function spawnEvent(companyId: string, tpl: EventTemplate, vars: Record<string, string> = {}) {
  if (pendingEvent(companyId)) return null;
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? k);
  const row = {
    id: newId('evt'),
    companyId,
    eventKey: tpl.id,
    data: { title: fill(tpl.title), emoji: tpl.emoji, text: fill(tpl.text), bad: !!tpl.bad, insurable: tpl.insurable ?? null, choices: tpl.choices.map((c) => ({ label: c.label })) },
    status: 'pending',
    choice: null,
    outcome: null,
    createdAt: clock.now(),
  };
  db.insert(schema.companyEvents).values(row).run();
  toCompany(companyId, { type: 'event', event: row });
  return row;
}

/** Insurance check: active policy whose kind covers this event. */
function coveredBy(companyId: string, insurable: string | null | undefined) {
  if (!insurable || !flag('insurance')) return null;
  const now = clock.now();
  return (
    db
      .select()
      .from(schema.insurancePolicies)
      .where(and(eq(schema.insurancePolicies.companyId, companyId), eq(schema.insurancePolicies.kind, insurable), gt(schema.insurancePolicies.activeUntil, now)))
      .get() ?? null
  );
}

export function resolveEvent(companyId: string, eventId: string, choiceIdx: number, actorId: string) {
  return atomic(() => {
    const ev = db.select().from(schema.companyEvents).where(and(eq(schema.companyEvents.id, eventId), eq(schema.companyEvents.companyId, companyId))).get();
    if (!ev || ev.status !== 'pending') throw notFound('That event already happened. Time moves on.');
    const co = getCompany(companyId);
    const tpl = findTemplate(co.industryId, ev.eventKey);
    if (!tpl) throw notFound('Event template vanished.');
    const choice = tpl.choices[choiceIdx];
    if (!choice) throw badRequest('Pick one of the options!');
    const e = choice.effect;
    const rng = liveRng();
    const success = e.chance == null || rng.chance(e.chance);
    const outcome: Record<string, unknown> = { success, text: success ? choice.result : choice.failResult ?? choice.result };
    const bal = companyBalance(companyId);
    const pct = success ? e.bitsPct : e.failBitsPct;
    if (pct) {
      // proportional to balance but bounded so events never wipe anyone out
      const raw = Math.round(Math.abs(pct) * Math.max(bal, 500));
      const amt = Math.min(raw, pct > 0 ? 5000 + co.level * 500 : Math.max(0, bal));
      if (pct > 0 && amt > 0) {
        outcome.bits = payCompany({ companyId, amount: amt, from: SYS.TREASURY, kind: 'reward.event', memo: tpl.title, actorId, partial: true });
      } else if (amt > 0) {
        const policy = ev.data && coveredBy(companyId, (ev.data as any).insurable);
        const loss = policy ? Math.round(amt * (1 - cfg().insurance.payoutRatio)) : amt;
        if (loss > 0) post({ kind: 'cost.event', memo: tpl.title, actorId, legs: [{ from: companyWallet(companyId), to: SYS.TREASURY, amount: loss }] });
        outcome.bits = -loss;
        if (policy) {
          outcome.insured = amt - loss;
          db.update(schema.insurancePolicies).set({ claims: sql`${schema.insurancePolicies.claims} + 1` }).where(eq(schema.insurancePolicies.id, policy.id)).run();
          bump(companyId, 'insuranceClaims');
        }
      }
    }
    if (success && e.mood) {
      db.update(schema.workers).set({ mood: sql`MAX(0, MIN(100, ${schema.workers.mood} + ${e.mood}))` }).where(eq(schema.workers.companyId, companyId)).run();
      outcome.mood = e.mood;
    }
    if (success && e.energy) {
      db.update(schema.workers).set({ energy: sql`MAX(0, MIN(100, ${schema.workers.energy} + ${e.energy}))` }).where(eq(schema.workers.companyId, companyId)).run();
      outcome.energy = e.energy;
    }
    if (success && e.incomeMult && e.minutes) {
      addModifier(companyId, 'income', e.incomeMult, e.minutes, `event:${tpl.id}`);
      outcome.incomeMult = e.incomeMult;
      outcome.minutes = e.minutes;
    }
    if (success && e.reputation) db.update(schema.companies).set({ reputation: sql`MAX(0, MIN(500, ${schema.companies.reputation} + ${e.reputation}))` }).where(eq(schema.companies.id, companyId)).run();
    db.update(schema.companyEvents).set({ status: 'resolved', choice: choiceIdx, outcome }).where(eq(schema.companyEvents.id, ev.id)).run();
    bump(companyId, 'events');
    return outcome;
  });
}

/** Tick hook: maybe start a random event (live ticks only). */
export function eventsTick(ctx: TickCtx) {
  if (ctx.ticks <= 0 || ctx.ticks > 1.5) return;
  if (!flag('events')) return;
  const perms = getCompanyPermissions(ctx.company.id);
  if (!perms.modules.events) return;
  const c = cfg();
  const diff = c.difficulty[ctx.company.difficulty] ?? c.difficulty.NORMAL;
  const rng = liveRng();
  if (!rng.chance(c.events.chancePerTick * diff.events)) return;
  if (pendingEvent(ctx.company.id)) return;
  const roll = rng.next();
  if (roll < 0.12) {
    // drama between two workers who share a relationship
    const ids = ctx.workers.map((w) => w.id);
    const rels = ids.length ? db.select().from(schema.relationships).where(inArray(schema.relationships.workerA, ids)).all().filter((r) => ids.includes(r.workerB)) : [];
    const r = rels.find((x) => x.kind !== 'chemistry');
    if (r) {
      const name = (id: string) => ctx.workers.find((w) => w.id === id)?.name ?? 'Someone';
      spawnEvent(ctx.company.id, DRAMA_EVENTS.find((d) => d.id === (r.kind === 'crush' ? 'drama-crush' : 'drama-rivalry'))!, { a: name(r.workerA), b: name(r.workerB) });
      return;
    }
  }
  const pool = roll < 0.6 ? OFFICE_EVENTS : getIndustry(ctx.company.industryId).events;
  spawnEvent(ctx.company.id, rng.pick(pool));
}

export function triggerEventFor(companyIds: string[], eventId: string | null) {
  let n = 0;
  for (const id of companyIds) {
    const co = getCompany(id);
    const tpl = eventId ? findTemplate(co.industryId, eventId) : liveRng().pick(eventTemplates(co.industryId));
    if (!tpl) continue;
    db.delete(schema.companyEvents).where(and(eq(schema.companyEvents.companyId, id), eq(schema.companyEvents.status, 'pending'))).run();
    if (spawnEvent(id, tpl)) n++;
  }
  return n;
}

export function recentEvents(companyId: string) {
  return db.select().from(schema.companyEvents).where(eq(schema.companyEvents.companyId, companyId)).orderBy(sql`${schema.companyEvents.createdAt} DESC`).limit(15).all();
}
