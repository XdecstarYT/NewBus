/**
 * Strategy layer: 500 timed business actions, company policies, market
 * districts (presence -> control -> customers) and laws that companies lobby
 * for with influence. Effects ride on the temporary-modifier system.
 */
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import {
  DEFAULT_POLICIES,
  DISTRICTS,
  LAW_TEMPLATES,
  POLICIES,
  STRATEGY_ACTIONS,
  findStrategyAction,
  type DistrictId,
  type LawKey,
  type Policies,
  type PolicyKey,
  type StrategyFx,
} from '@dw/shared';
import { db, schema, atomic } from '../db';
import { clock, HOUR_MS, MINUTE_MS } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { liveRng } from '../engine/rng';
import { chargeCompany } from './money';
import { findCompany, getCompany } from './companies';
import { addModifier, registerMultiplier } from './multipliers';
import { addNews } from './news';
import { notify } from './notifications';
import { audit } from './audit';
import { toCompany, toAll } from '../lib/bus';

export type StrategyState = typeof schema.companyStrategy.$inferSelect;

const MAX_ACTIVE = 6;
const POLICY_COOLDOWN = HOUR_MS;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function stateOf(companyId: string): StrategyState {
  const row = db.select().from(schema.companyStrategy).where(eq(schema.companyStrategy.companyId, companyId)).get();
  if (row) return row;
  const fresh = { companyId, influence: 0, legal: 0, auditRisk: 0, undeclared: 0, focusDistrict: 'downtown', policies: { ...DEFAULT_POLICIES }, policyChangedAt: null, actionsRun: 0, updatedAt: clock.now() };
  db.insert(schema.companyStrategy).values(fresh).onConflictDoNothing().run();
  return fresh;
}

export function patchState(companyId: string, patch: Partial<Omit<StrategyState, 'companyId'>>) {
  stateOf(companyId);
  db.update(schema.companyStrategy).set({ ...patch, updatedAt: clock.now() }).where(eq(schema.companyStrategy.companyId, companyId)).run();
  policyMemo.delete(companyId);
}

/** Add to influence / legal / audit risk (clamped). */
export function bumpState(companyId: string, d: { influence?: number; legal?: number; auditRisk?: number; undeclared?: number }) {
  const s = stateOf(companyId);
  patchState(companyId, {
    influence: Math.max(0, s.influence + (d.influence ?? 0)),
    legal: clamp(s.legal + (d.legal ?? 0), -50, 100),
    auditRisk: clamp(s.auditRisk + (d.auditRisk ?? 0), 0, 100),
    undeclared: Math.max(0, s.undeclared + (d.undeclared ?? 0)),
  });
}

// ------------------------------------------------------------ policies
const policyMemo = new Map<string, Policies>();
function policiesOf(companyId: string): Policies {
  let p = policyMemo.get(companyId);
  if (!p) {
    const row = db.select({ p: schema.companyStrategy.policies }).from(schema.companyStrategy).where(eq(schema.companyStrategy.companyId, companyId)).get();
    p = { ...DEFAULT_POLICIES, ...((row?.p as Partial<Policies>) ?? {}) };
    if (policyMemo.size > 5000) policyMemo.clear();
    policyMemo.set(companyId, p);
  }
  return p;
}

function policyFx(companyId: string): StrategyFx {
  const p = policiesOf(companyId);
  const out: StrategyFx = {};
  for (const key of ['pricing', 'labor'] as const) {
    const fx = (POLICIES[key].options as Record<string, { fx: StrategyFx }>)[p[key]]?.fx ?? {};
    for (const [k, v] of Object.entries(fx) as Array<[keyof StrategyFx, number]>) out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

for (const kind of ['income', 'traffic', 'speed', 'wages'] as const) {
  registerMultiplier(kind, (co) => 1 + (policyFx(co.id)[kind] ?? 0));
}
registerMultiplier('mood', (co) => policyFx(co.id).mood ?? 0);

export function setPolicy(companyId: string, key: PolicyKey, value: string, actorId: string) {
  const def = POLICIES[key];
  if (!def) throw badRequest('Unknown policy.');
  if (!(value in def.options)) throw badRequest('Unknown policy option.');
  const s = stateOf(companyId);
  const now = clock.now();
  if (s.policyChangedAt && now - s.policyChangedAt < POLICY_COOLDOWN) throw conflict(`Policies can change once an hour. Try again in ${Math.ceil((s.policyChangedAt + POLICY_COOLDOWN - now) / MINUTE_MS)} min.`);
  patchState(companyId, { policies: { ...policiesOf(companyId), [key]: value }, policyChangedAt: now });
  audit({ actorId, action: 'strategy.policy', targetType: 'company', targetId: companyId, newValue: { [key]: value } });
  return { ok: true };
}

// ------------------------------------------------------------ actions
const MOD_KINDS = ['income', 'traffic', 'speed', 'research', 'wages'] as const;
const ADD_KINDS = ['mood', 'quality'] as const;

export function runAction(companyId: string, actionId: string, actorId: string) {
  return atomic(() => {
    const a = findStrategyAction(actionId);
    if (!a) throw notFound('No such strategic action.');
    const co = getCompany(companyId);
    if (co.level < a.level) throw forbidden(`Reach level ${a.level} to unlock ${a.name}.`, 'level');
    const now = clock.now();
    const last = db.select().from(schema.strategyRuns).where(and(eq(schema.strategyRuns.companyId, companyId), eq(schema.strategyRuns.actionId, actionId))).orderBy(desc(schema.strategyRuns.startedAt)).get();
    if (last && last.readyAt > now) throw conflict(`${a.name} is cooling down for ${Math.ceil((last.readyAt - now) / MINUTE_MS)} more min.`);
    const active = db.select({ n: sql<number>`count(*)` }).from(schema.strategyRuns).where(and(eq(schema.strategyRuns.companyId, companyId), gt(schema.strategyRuns.endsAt, now))).get()!.n;
    if (active >= MAX_ACTIVE) throw conflict(`You can run ${MAX_ACTIVE} plays at once. Wait for one to finish.`);
    const s = stateOf(companyId);
    if (a.influenceCost > s.influence) throw badRequest(`Needs ${a.influenceCost} influence (you have ${s.influence}).`);
    chargeCompany({ companyId, amount: a.cost, kind: 'strategy.action', memo: a.name, actorId });

    const risk = policiesOf(companyId).risk;
    const power = risk === 'bold' ? 1.2 : risk === 'careful' ? 0.9 : 1;
    const backfireChance = a.risk * (risk === 'bold' ? 1.5 : risk === 'careful' ? 0.5 : 1);
    const backfired = backfireChance > 0 && liveRng().chance(backfireChance);
    const sign = backfired ? -0.5 : 1;
    const fx = a.fx;
    for (const k of MOD_KINDS) {
      const v = fx[k];
      if (v) addModifier(companyId, k, Math.max(0.1, 1 + v * power * sign), a.minutes, `strategy:${a.id}`);
    }
    for (const k of ADD_KINDS) {
      const v = fx[k];
      if (v) addModifier(companyId, k, Math.round(v * power * sign), a.minutes, `strategy:${a.id}`);
    }
    const scale = (n?: number) => (n ? Math.round(n * power * (backfired ? 0 : 1)) : 0);
    let note: string | null = null;
    const d = { influence: scale(fx.influence) - a.influenceCost, legal: scale(fx.legal), auditRisk: fx.auditRisk ?? 0, undeclared: fx.undeclared ? Math.round(a.cost * fx.undeclared * 1.5) : 0 };
    let repDelta = scale(fx.reputation);
    if (backfired) {
      repDelta = -5 * a.tier;
      d.auditRisk += a.shady ? 5 * a.tier : 0;
      note = a.shady ? 'Caught red-handed! Reputation and audit risk took a hit.' : 'It backfired! The effect went the wrong way.';
      addNews('gossip', `🙈 ${co.emoji} ${co.name}'s "${a.name}" backfired!`, a.shady ? 'Auditors are said to be "very interested".' : 'Rivals are pretending not to laugh.', companyId);
    }
    bumpState(companyId, d);
    if (repDelta) db.update(schema.companies).set({ reputation: clamp(co.reputation + repDelta, 0, 500) }).where(eq(schema.companies.id, companyId)).run();
    if (fx.presence && !backfired) addPresence(companyId, s.focusDistrict as DistrictId, fx.presence * power);
    db.update(schema.companyStrategy).set({ actionsRun: sql`${schema.companyStrategy.actionsRun} + 1` }).where(eq(schema.companyStrategy.companyId, companyId)).run();
    const run = { id: newId('srun'), companyId, actionId, cost: a.cost, startedAt: now, endsAt: now + a.minutes * MINUTE_MS, readyAt: now + a.cooldownMinutes * MINUTE_MS, backfired, note };
    db.insert(schema.strategyRuns).values(run).run();
    toCompany(companyId, { type: 'company' });
    return { ...run, action: a };
  });
}

export function strategyView(companyId: string) {
  const now = clock.now();
  const s = stateOf(companyId);
  const runs = db.select().from(schema.strategyRuns).where(eq(schema.strategyRuns.companyId, companyId)).orderBy(desc(schema.strategyRuns.startedAt)).limit(200).all();
  const cooldowns: Record<string, number> = {};
  for (const r of runs) if (r.readyAt > now && !(r.actionId in cooldowns)) cooldowns[r.actionId] = r.readyAt;
  const co = getCompany(companyId);
  return {
    state: { ...s, policies: policiesOf(companyId) },
    level: co.level,
    reputation: co.reputation,
    active: runs.filter((r) => r.endsAt > now).map((r) => ({ ...r, action: findStrategyAction(r.actionId) })),
    recent: runs.slice(0, 15).map((r) => ({ ...r, name: findStrategyAction(r.actionId)?.name ?? r.actionId, emoji: findStrategyAction(r.actionId)?.emoji ?? '♟️' })),
    cooldowns,
    maxActive: MAX_ACTIVE,
    districts: districtsView(companyId),
    laws: lawsView(companyId),
    total: STRATEGY_ACTIONS.length,
  };
}

// ------------------------------------------------------------ districts
const DISTRICT_IDS = new Set<string>(DISTRICTS.map((d) => d.id));
let controllers = new Map<string, string>(); // district -> company
let controllersAt = 0;

export function addPresence(companyId: string, districtId: DistrictId, points: number) {
  const now = clock.now();
  db.insert(schema.districtPresence)
    .values({ districtId, companyId, points, updatedAt: now })
    .onConflictDoUpdate({ target: [schema.districtPresence.districtId, schema.districtPresence.companyId], set: { points: sql`${schema.districtPresence.points} + ${points}`, updatedAt: now } })
    .run();
  controllersAt = 0;
}

export function setFocus(companyId: string, districtId: string) {
  if (!DISTRICT_IDS.has(districtId)) throw badRequest('Unknown district.');
  patchState(companyId, { focusDistrict: districtId });
  return { ok: true };
}

function computeControllers() {
  const rows = db.select().from(schema.districtPresence).where(gt(schema.districtPresence.points, 0.5)).all();
  const next = new Map<string, string>();
  for (const d of DISTRICTS) {
    const here = rows.filter((r) => r.districtId === d.id).sort((a, b) => b.points - a.points);
    const total = here.reduce((s, r) => s + r.points, 0);
    if (here[0] && here[0].points >= 10 && here[0].points / total >= 0.35) next.set(d.id, here[0].companyId);
  }
  controllers = next;
  controllersAt = clock.now();
}

export function controlledBy(companyId: string) {
  if (clock.now() - controllersAt > MINUTE_MS) computeControllers();
  return [...controllers.entries()].filter(([, c]) => c === companyId).map(([d]) => d);
}

// Every district you control brings +5% customers (max 3 districts count).
registerMultiplier('traffic', (co) => 1 + 0.05 * Math.min(3, controlledBy(co.id).length));

export function districtsView(viewerId: string | null) {
  controlledBy('');
  const rows = db.select().from(schema.districtPresence).where(gt(schema.districtPresence.points, 0.5)).all();
  return DISTRICTS.map((d) => {
    const here = rows.filter((r) => r.districtId === d.id).sort((a, b) => b.points - a.points);
    const total = here.reduce((s, r) => s + r.points, 0);
    const top = here.slice(0, 5).map((r) => {
      const c = findCompany(r.companyId);
      return { companyId: r.companyId, name: c?.name ?? '?', emoji: c?.emoji ?? '❓', color: c?.color ?? '#888', share: total ? Math.round((r.points / total) * 1000) / 10 : 0, points: Math.round(r.points) };
    });
    const mine = viewerId ? here.find((r) => r.companyId === viewerId) : null;
    return { ...d, controller: controllers.get(d.id) ?? null, top, total: Math.round(total), mine: mine ? Math.round(mine.points) : 0, myShare: mine && total ? Math.round((mine.points / total) * 1000) / 10 : 0 };
  });
}

/** Presence fades ~0.5% a minute, so territory has to be defended. */
export function decayPresence(minutes: number) {
  const f = Math.pow(0.995, minutes);
  db.update(schema.districtPresence).set({ points: sql`${schema.districtPresence.points} * ${f}` }).run();
  db.delete(schema.districtPresence).where(sql`${schema.districtPresence.points} < 0.5`).run();
  const before = new Map(controllers);
  computeControllers();
  for (const [d, c] of controllers) {
    if (before.get(d) !== c) {
      const co = findCompany(c);
      const dist = DISTRICTS.find((x) => x.id === d)!;
      if (co) {
        addNews('headline', `${dist.emoji} ${co.emoji} ${co.name} now controls ${dist.name}!`, 'Shops there report a sudden rush of customers.', c);
        notify(c, 'strategy', `${dist.emoji} You control ${dist.name}!`, '+5% customers while you hold it.');
      }
    }
  }
}

/** Audit risk cools off slowly when you behave. */
export function coolAuditRisk() {
  db.update(schema.companyStrategy).set({ auditRisk: sql`max(0, ${schema.companyStrategy.auditRisk} - 1)` }).where(gt(schema.companyStrategy.auditRisk, 0)).run();
}

// ------------------------------------------------------------ laws
export function proposeLaw(templateKey: LawKey, hoursOpen: number, actorId: string) {
  const t = LAW_TEMPLATES.find((l) => l.key === templateKey);
  if (!t) throw badRequest('Unknown law.');
  const now = clock.now();
  const row = { id: newId('law'), templateKey: t.key, title: t.title, emoji: t.emoji, blurb: t.blurb, kind: t.kind, value: t.value, hours: t.hours, status: 'lobbying', support: 0, oppose: 0, proposedBy: actorId, createdAt: now, closesAt: now + clamp(hoursOpen, 1, 168) * HOUR_MS, decidedAt: null };
  db.insert(schema.laws).values(row).run();
  addNews('headline', `🏛️ New bill: ${t.emoji} ${t.title}`, `${t.blurb} Lobby for or against it in the ♟️ Strategy Room.`);
  toAll({ type: 'law', id: row.id });
  audit({ actorId, action: 'law.propose', targetType: 'law', targetId: row.id, newValue: { templateKey } });
  return row;
}

export function lobby(companyId: string, lawId: string, side: 'for' | 'against', influence: number) {
  return atomic(() => {
    const law = db.select().from(schema.laws).where(eq(schema.laws.id, lawId)).get();
    if (!law) throw notFound('No such bill.');
    if (law.status !== 'lobbying' || law.closesAt < clock.now()) throw conflict('Lobbying on this bill has closed.');
    const amt = Math.floor(influence);
    if (amt < 1) throw badRequest('Spend at least 1 influence.');
    const s = stateOf(companyId);
    if (s.influence < amt) throw badRequest(`You only have ${s.influence} influence.`);
    const prev = db.select().from(schema.lawLobby).where(and(eq(schema.lawLobby.lawId, lawId), eq(schema.lawLobby.companyId, companyId))).get();
    if (prev && prev.side !== side) throw conflict(`You already lobbied ${prev.side} this bill. No flip-flopping!`);
    bumpState(companyId, { influence: -amt });
    if (prev) db.update(schema.lawLobby).set({ influence: prev.influence + amt, at: clock.now() }).where(and(eq(schema.lawLobby.lawId, lawId), eq(schema.lawLobby.companyId, companyId))).run();
    else db.insert(schema.lawLobby).values({ lawId, companyId, side, influence: amt, at: clock.now() }).run();
    addLawWeight(lawId, side, amt);
    return { ok: true };
  });
}

/** Union presidents can throw their union's influence behind a bill too. */
export function addLawWeight(lawId: string, side: 'for' | 'against', amt: number) {
  const col = side === 'for' ? schema.laws.support : schema.laws.oppose;
  db.update(schema.laws).set(side === 'for' ? { support: sql`${col} + ${amt}` } : { oppose: sql`${col} + ${amt}` }).where(eq(schema.laws.id, lawId)).run();
  toAll({ type: 'law', id: lawId });
}

function enact(law: typeof schema.laws.$inferSelect) {
  if (law.kind === 'auditRisk') db.update(schema.companyStrategy).set({ auditRisk: sql`min(100, ${schema.companyStrategy.auditRisk} + ${Math.round(law.value)})` }).run();
  else if (law.kind === 'amnesty') db.update(schema.companyStrategy).set({ auditRisk: sql`cast(${schema.companyStrategy.auditRisk} * ${law.value} as integer)` }).run();
  else addModifier(null, law.kind, law.value, law.hours * 60, `law:${law.id}`);
}

/** Owner decides a bill now: pass (enact), veto, or let the lobby count decide. */
export function decideLaw(lawId: string, decision: 'pass' | 'veto' | 'count', actorId: string | null) {
  return atomic(() => {
    const law = db.select().from(schema.laws).where(eq(schema.laws.id, lawId)).get();
    if (!law) throw notFound('No such bill.');
    if (law.status !== 'lobbying') throw conflict('This bill was already decided.');
    const passed = decision === 'pass' || (decision === 'count' && law.support > law.oppose && law.support > 0);
    const status = decision === 'veto' ? 'vetoed' : passed ? 'passed' : 'failed';
    db.update(schema.laws).set({ status, decidedAt: clock.now() }).where(eq(schema.laws.id, lawId)).run();
    if (passed) enact(law);
    addNews('headline', `🏛️ ${law.emoji} ${law.title} ${status === 'passed' ? 'PASSES' : status === 'vetoed' ? 'is VETOED by the Owner' : 'fails'}`, `Final lobbying count: ${law.support} for, ${law.oppose} against.`);
    toAll({ type: 'law', id: lawId });
    if (actorId) audit({ actorId, action: `law.${decision}`, targetType: 'law', targetId: lawId, newValue: { status } });
    return { status };
  });
}

export function lawsTick(now: number) {
  const due = db.select().from(schema.laws).where(and(eq(schema.laws.status, 'lobbying'), sql`${schema.laws.closesAt} <= ${now}`)).all();
  for (const l of due) decideLaw(l.id, 'count', null);
}

export function lawsView(companyId: string | null) {
  const rows = db.select().from(schema.laws).orderBy(desc(schema.laws.createdAt)).limit(20).all();
  const mine = companyId ? db.select().from(schema.lawLobby).where(eq(schema.lawLobby.companyId, companyId)).all() : [];
  return rows.map((l) => ({ ...l, mySide: mine.find((m) => m.lawId === l.id)?.side ?? null, myInfluence: mine.find((m) => m.lawId === l.id)?.influence ?? 0 }));
}
