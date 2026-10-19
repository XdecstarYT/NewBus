/**
 * Justice: Owner-run tax audits, the courthouse (company vs company, or the
 * State vs a company) with evidence, settlements, verdicts and one appeal,
 * and the sanctions courts hand out (asset freezes, licence suspensions).
 */
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { CASE_KINDS, EVIDENCE_KINDS, MODULES, MODULE_INFO, STRATEGY_ACTIONS, type CaseKind, type EvidenceKind, type Module } from '@dw/shared';
import { db, schema, atomic } from '../db';
import type { CaseRemedy } from '../db/schema';
import { clock, DAY_MS, HOUR_MS, MINUTE_MS } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { liveRng } from '../engine/rng';
import { cfg } from './settings';
import { SYS, balanceOf, post } from './ledger';
import { chargeCompany, companyWallet, registerSpendGuard } from './money';
import { findCompany, getCompany } from './companies';
import { registerAccessFilter } from '../permissions';
import { addNews } from './news';
import { notify } from './notifications';
import { audit } from './audit';
import { toCompany } from '../lib/bus';
import { bumpState, stateOf, patchState } from './strategy';

type Case = typeof schema.courtCases.$inferSelect;
const SHADY = new Set(STRATEGY_ACTIONS.filter((a) => a.shady).map((a) => a.id));

// ------------------------------------------------------------ sanctions
const sanctionMemo = new Map<string, { at: number; rows: Array<typeof schema.sanctions.$inferSelect> }>();
export function activeSanctions(companyId: string) {
  const now = clock.now();
  const hit = sanctionMemo.get(companyId);
  if (hit && now - hit.at < 5000) return hit.rows;
  const rows = db.select().from(schema.sanctions).where(and(eq(schema.sanctions.companyId, companyId), gt(schema.sanctions.until, now), isNull(schema.sanctions.liftedAt))).all();
  if (sanctionMemo.size > 5000) sanctionMemo.clear();
  sanctionMemo.set(companyId, { at: now, rows });
  return rows;
}

export function addSanction(companyId: string, kind: 'freeze' | 'suspend', hours: number, reason: string, source: string, sourceId: string | null, module: string | null = null) {
  if (kind === 'suspend' && (!module || !MODULES.includes(module as Module))) throw badRequest('Pick a module to suspend.');
  const now = clock.now();
  const row = { id: newId('snc'), companyId, kind, module, reason, source, sourceId, until: now + Math.max(1, Math.min(24 * 30, hours)) * HOUR_MS, createdAt: now, liftedAt: null };
  db.insert(schema.sanctions).values(row).run();
  sanctionMemo.delete(companyId);
  notify(companyId, 'justice', kind === 'freeze' ? '🧊 Your assets are frozen' : `⛔ Licence suspended: ${MODULE_INFO[module as Module]?.label ?? module}`, `${reason} (${Math.round(hours)} h)`);
  toCompany(companyId, { type: 'perms' });
  return row;
}

export function liftSanction(id: string, actorId: string) {
  const s = db.select().from(schema.sanctions).where(eq(schema.sanctions.id, id)).get();
  if (!s) throw notFound('No such sanction.');
  db.update(schema.sanctions).set({ liftedAt: clock.now() }).where(eq(schema.sanctions.id, id)).run();
  sanctionMemo.delete(s.companyId);
  notify(s.companyId, 'justice', '✅ Sanction lifted', s.kind === 'freeze' ? 'Your assets are unfrozen.' : 'Your licence is back.');
  toCompany(s.companyId, { type: 'perms' });
  audit({ actorId, action: 'sanction.lift', targetType: 'company', targetId: s.companyId, oldValue: s });
  return { ok: true };
}

// Frozen companies can still pay fines, court costs and union dues they owe the system.
registerSpendGuard((companyId, kind) => {
  if (kind.startsWith('justice.')) return;
  const f = activeSanctions(companyId).find((s) => s.kind === 'freeze');
  if (f) throw forbidden(`🧊 Your assets are frozen until ${new Date(f.until).toUTCString()}: ${f.reason}`, 'frozen');
});
registerAccessFilter((companyId, modules) => {
  for (const s of activeSanctions(companyId)) if (s.kind === 'suspend' && s.module) modules[s.module as Module] = false;
});

/** Take up to `amount` from a company for the State (fines never overdraw). */
function collect(companyId: string, amount: number, kind: string, memo: string, to: string = SYS.TREASURY) {
  const amt = Math.min(Math.floor(amount), balanceOf(companyWallet(companyId)));
  if (amt > 0) post({ kind, memo, legs: [{ from: companyWallet(companyId), to, amount: amt }] });
  return Math.max(0, amt);
}

// ------------------------------------------------------------ tax audits
export type AuditDepth = 'desk' | 'field' | 'forensic';

export function openAudit(companyId: string, depth: AuditDepth, actorId: string) {
  return atomic(() => {
    const co = getCompany(companyId);
    if (db.select().from(schema.taxAudits).where(and(eq(schema.taxAudits.companyId, companyId), eq(schema.taxAudits.status, 'open'))).get()) throw conflict('This company is already under audit.');
    const now = clock.now();
    const since = now - 7 * DAY_MS;
    const w = companyWallet(companyId);
    const income = db.select({ s: sql<number>`coalesce(sum(${schema.ledgerEntries.amount}),0)` }).from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.toWallet, w), gt(schema.ledgerEntries.createdAt, since))).get()!.s;
    const taxPaid = db.select({ s: sql<number>`coalesce(sum(${schema.ledgerEntries.amount}),0)` }).from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.fromWallet, w), eq(schema.ledgerEntries.toWallet, SYS.TREASURY), sql`${schema.ledgerEntries.kind} like 'tax.%'`, gt(schema.ledgerEntries.createdAt, since))).get()!.s;
    const runs = db.select().from(schema.strategyRuns).where(and(eq(schema.strategyRuns.companyId, companyId), gt(schema.strategyRuns.startedAt, since))).all();
    const shady = runs.filter((r) => SHADY.has(r.actionId));
    const st = stateOf(companyId);
    const base = cfg().justice.auditDetect[depth] ?? 0.5;
    const detection = Math.min(0.98, base * (0.6 + st.auditRisk / 250));
    const found = Math.round(st.undeclared * detection);
    const penalty = Math.round((found * cfg().justice.auditPenaltyPct) / 100);
    const flags: string[] = [];
    if (shady.length) flags.push(`${shady.length} shady deal${shady.length === 1 ? '' : 's'} this week`);
    if (st.auditRisk >= 50) flags.push(`High audit risk (${st.auditRisk})`);
    if (income > 0 && taxPaid / income < 0.01) flags.push('Very little tax paid for its income');
    if (found > 0) flags.push(`${found} BT of hidden income found`);
    const findings = { periodDays: 7, income, taxPaid, auditRisk: st.auditRisk, legal: st.legal, hiddenIncomeFound: found, detection: Math.round(detection * 100), shadyDeals: shady.length, flags, level: co.level };
    const row = { id: newId('aud'), companyId, depth, status: 'open', findings, suggestedFine: found + penalty, fine: 0, outcome: null, note: null, openedBy: actorId, createdAt: now, closedAt: null };
    db.insert(schema.taxAudits).values(row).run();
    notify(companyId, 'justice', '🔦 You are being audited', 'The tax office is looking at your books. Clean books and a good lawyer help.');
    audit({ actorId, action: 'audit.open', targetType: 'company', targetId: companyId, newValue: { depth } });
    return row;
  });
}

export function closeAudit(auditId: string, outcome: 'clean' | 'warning' | 'fined' | 'referred', opts: { fine?: number; note?: string; freezeHours?: number }, actorId: string) {
  return atomic(() => {
    const a = db.select().from(schema.taxAudits).where(eq(schema.taxAudits.id, auditId)).get();
    if (!a) throw notFound('No such audit.');
    if (a.status !== 'open') throw conflict('This audit is already closed.');
    const co = getCompany(a.companyId);
    const st = stateOf(a.companyId);
    const found = Number((a.findings as any).hiddenIncomeFound ?? 0);
    let fine = 0;
    let caseId: string | null = null;
    if (outcome === 'fined') {
      fine = collect(a.companyId, opts.fine ?? a.suggestedFine, 'justice.fine', `Tax audit fine`);
      if (opts.freezeHours) addSanction(a.companyId, 'freeze', opts.freezeHours, 'Tax audit', 'audit', a.id);
      patchState(a.companyId, { undeclared: Math.max(0, st.undeclared - found), auditRisk: Math.max(0, st.auditRisk - 20) });
      addNews('headline', `🧾 ${co.emoji} ${co.name} fined ${fine} BT after a tax audit`, opts.note || 'The tax office says "pay your taxes, kids".', co.id);
      notify(a.companyId, 'justice', `🧾 Audit closed: fined ${fine} BT`, opts.note ?? '');
    } else if (outcome === 'referred') {
      const c = fileCaseInner({ plaintiffId: null, defendantId: a.companyId, kind: 'tax', title: `State v. ${co.name}: tax evasion`, claim: Math.max(opts.fine ?? a.suggestedFine, 100), actorId, auditId: a.id });
      caseId = c.id;
      notify(a.companyId, 'justice', '⚖️ Audit referred to court', 'The State is taking you to court for tax evasion.');
    } else {
      patchState(a.companyId, { auditRisk: Math.max(0, st.auditRisk - (outcome === 'clean' ? 15 : 5)) });
      notify(a.companyId, 'justice', outcome === 'clean' ? '✅ Audit closed: your books are clean!' : '⚠️ Audit closed with a warning', opts.note ?? '');
    }
    db.update(schema.taxAudits).set({ status: 'closed', outcome, fine, note: opts.note ?? null, closedAt: clock.now() }).where(eq(schema.taxAudits.id, auditId)).run();
    audit({ actorId, action: 'audit.close', targetType: 'company', targetId: a.companyId, newValue: { outcome, fine, caseId } });
    return { ok: true, fine, caseId };
  });
}

export function auditsList(companyId?: string) {
  const q = db.select().from(schema.taxAudits);
  const rows = (companyId ? q.where(eq(schema.taxAudits.companyId, companyId)) : q).orderBy(desc(schema.taxAudits.createdAt)).limit(100).all();
  return rows.map((a) => ({ ...a, company: brief(a.companyId) }));
}

/** Who looks suspicious: highest audit risk and hidden income first. */
export function auditCandidates() {
  const rows = db.select().from(schema.companyStrategy).where(or(gt(schema.companyStrategy.auditRisk, 0), gt(schema.companyStrategy.undeclared, 0))).orderBy(desc(schema.companyStrategy.auditRisk)).limit(30).all();
  return rows.map((r) => ({ company: brief(r.companyId), auditRisk: r.auditRisk, legal: r.legal, actionsRun: r.actionsRun }));
}

// ------------------------------------------------------------ court
const brief = (id: string | null) => {
  if (!id) return { id: null, name: 'The State', emoji: '🏛️', color: '#334155' };
  const c = findCompany(id);
  return c ? { id: c.id, name: c.name, emoji: c.emoji, color: c.color } : { id, name: '(gone)', emoji: '❓', color: '#888' };
};

function getCase(id: string): Case {
  const c = db.select().from(schema.courtCases).where(eq(schema.courtCases.id, id)).get();
  if (!c) throw notFound('No such case.');
  return c;
}

function sideOf(c: Case, companyId: string | null): 'plaintiff' | 'defendant' | null {
  if (companyId && c.defendantId === companyId) return 'defendant';
  if (companyId && c.plaintiffId === companyId) return 'plaintiff';
  return null;
}

function tellParties(c: Case, title: string, body = '') {
  for (const id of [c.plaintiffId, c.defendantId]) if (id) notify(id, 'justice', title, body);
  for (const id of [c.plaintiffId, c.defendantId]) if (id) toCompany(id, { type: 'court', id: c.id });
}

function fileCaseInner(o: { plaintiffId: string | null; defendantId: string; kind: CaseKind; title: string; claim: number; actorId: string; auditId?: string | null }) {
  const j = cfg().justice;
  if (!CASE_KINDS[o.kind]) throw badRequest('Unknown kind of case.');
  if (o.plaintiffId === o.defendantId) throw badRequest('You can not sue yourself.');
  const defendant = getCompany(o.defendantId);
  const claim = Math.max(0, Math.min(10_000_000, Math.floor(o.claim)));
  if (o.plaintiffId) {
    const dup = db.select().from(schema.courtCases).where(and(eq(schema.courtCases.plaintiffId, o.plaintiffId), eq(schema.courtCases.defendantId, o.defendantId), sql`${schema.courtCases.status} in ('filed','hearing','decided','appealed')`)).get();
    if (dup) throw conflict('You already have an open case against them.');
  }
  const fee = o.plaintiffId ? Math.max(j.minFilingFee, Math.round((claim * j.filingFeePct) / 100)) : 0;
  if (fee) chargeCompany({ companyId: o.plaintiffId!, amount: fee, kind: 'justice.filing', memo: `Filing fee: ${o.title}`, actorId: o.actorId });
  const now = clock.now();
  const number = (db.select({ n: sql<number>`coalesce(max(${schema.courtCases.number}),0)` }).from(schema.courtCases).get()!.n ?? 0) + 1;
  const row: Case = {
    id: newId('case'),
    number,
    kind: o.kind,
    title: o.title.slice(0, 120),
    plaintiffId: o.plaintiffId,
    defendantId: o.defendantId,
    claim,
    filingFee: fee,
    status: 'filed',
    hearingAt: now + j.hearingMinutes * MINUTE_MS,
    verdict: null,
    remedy: null,
    reasoning: null,
    appealed: false,
    appealDeadline: null,
    settleOffer: null,
    settleFrom: null,
    auditId: o.auditId ?? null,
    createdBy: o.actorId,
    createdAt: now,
    decidedAt: null,
    closedAt: null,
  };
  db.insert(schema.courtCases).values(row).run();
  const p = brief(o.plaintiffId);
  addNews('headline', `⚖️ Case #${number}: ${p.name} v. ${defendant.name}`, `${CASE_KINDS[o.kind].emoji} ${CASE_KINDS[o.kind].label}. Claim: ${claim} BT.`, o.defendantId);
  tellParties(row, `⚖️ Case #${number} filed: ${row.title}`, `Hearing in ${j.hearingMinutes} min. Add evidence or offer a settlement in ⚖️ Courthouse.`);
  return row;
}

export function fileCase(plaintiffId: string | null, input: { defendantId: string; kind: CaseKind; title: string; claim: number }, actorId: string) {
  return atomic(() => {
    const row = fileCaseInner({ plaintiffId, ...input, actorId });
    if (!plaintiffId) audit({ actorId, action: 'court.file', targetType: 'company', targetId: input.defendantId, newValue: input });
    return row;
  });
}

export function addEvidence(caseId: string, companyId: string | null, isOwner: boolean, input: { kind: EvidenceKind; text: string; side?: 'plaintiff' | 'defendant' }, actorId: string) {
  return atomic(() => {
    const c = getCase(caseId);
    if (!['filed', 'hearing', 'appealed'].includes(c.status)) throw conflict('Evidence is closed for this case.');
    let side = sideOf(c, companyId);
    if (!side && isOwner && !c.plaintiffId) side = 'plaintiff'; // the Owner argues the State's side
    if (!side) throw forbidden('Only the parties can add evidence.');
    const def = EVIDENCE_KINDS[input.kind];
    if (!def) throw badRequest('Unknown kind of evidence.');
    const count = db.select({ n: sql<number>`count(*)` }).from(schema.courtEvidence).where(and(eq(schema.courtEvidence.caseId, caseId), eq(schema.courtEvidence.side, side))).get()!.n;
    if (count >= 8) throw conflict('Each side can file up to 8 pieces of evidence.');
    const payer = side === 'plaintiff' ? c.plaintiffId : c.defendantId;
    if (def.cost && payer) chargeCompany({ companyId: payer, amount: def.cost, kind: 'justice.evidence', memo: `${def.label} for case #${c.number}`, actorId });
    let text = input.text.trim().slice(0, 500);
    if (input.kind === 'ledger') text = `${text}\n${ledgerSummary(c)}`.trim();
    if (!text) throw badRequest('Describe your evidence.');
    db.insert(schema.courtEvidence).values({ id: newId('evd'), caseId, side, kind: input.kind, text, weight: def.weight, byAccountId: actorId, createdAt: clock.now() }).run();
    tellParties(c, `📎 New evidence in case #${c.number}`, `${def.emoji} ${def.label} from the ${side}.`);
    return { ok: true };
  });
}

function ledgerSummary(c: Case) {
  if (!c.plaintiffId) {
    const st = stateOf(c.defendantId);
    return `[Ledger] Audit risk ${st.auditRisk}, ${st.actionsRun} strategic plays on record.`;
  }
  const a = companyWallet(c.plaintiffId);
  const b = companyWallet(c.defendantId);
  const r = db
    .select({ n: sql<number>`count(*)`, s: sql<number>`coalesce(sum(${schema.ledgerEntries.amount}),0)` })
    .from(schema.ledgerEntries)
    .where(or(and(eq(schema.ledgerEntries.fromWallet, a), eq(schema.ledgerEntries.toWallet, b)), and(eq(schema.ledgerEntries.fromWallet, b), eq(schema.ledgerEntries.toWallet, a))))
    .get()!;
  return `[Ledger] ${r.n} payments between the parties, ${r.s} BT in total.`;
}

export function offerSettlement(caseId: string, companyId: string, amount: number) {
  const c = getCase(caseId);
  const side = sideOf(c, companyId);
  if (!side) throw forbidden('Only the parties can settle.');
  if (!['filed', 'hearing', 'appealed'].includes(c.status)) throw conflict('Too late to settle.');
  const amt = Math.max(0, Math.floor(amount));
  db.update(schema.courtCases).set({ settleOffer: amt, settleFrom: side }).where(eq(schema.courtCases.id, caseId)).run();
  tellParties(c, `🤝 Settlement offer in case #${c.number}`, `The ${side} offers to settle for ${amt} BT (paid by the defendant).`);
  return { ok: true };
}

export function acceptSettlement(caseId: string, companyId: string | null, isOwner: boolean) {
  return atomic(() => {
    const c = getCase(caseId);
    if (c.settleOffer == null || !c.settleFrom) throw badRequest('There is no offer on the table.');
    const side = sideOf(c, companyId) ?? (isOwner && !c.plaintiffId ? 'plaintiff' : null);
    if (!side || side === c.settleFrom) throw forbidden('The other side has to accept the offer.');
    const paid = collect(c.defendantId, c.settleOffer, 'justice.settlement', `Settlement of case #${c.number}`, c.plaintiffId ? companyWallet(c.plaintiffId) : SYS.TREASURY);
    db.update(schema.courtCases).set({ status: 'settled', closedAt: clock.now(), remedy: { damages: paid } }).where(eq(schema.courtCases.id, caseId)).run();
    tellParties(c, `🤝 Case #${c.number} settled`, `${paid} BT changed hands. Everyone shakes hands awkwardly.`);
    return { ok: true, paid };
  });
}

export function withdrawCase(caseId: string, companyId: string | null, isOwner: boolean) {
  const c = getCase(caseId);
  const mine = (companyId && c.plaintiffId === companyId) || (isOwner && !c.plaintiffId);
  if (!mine) throw forbidden('Only the plaintiff can drop the case.');
  if (!['filed', 'hearing'].includes(c.status)) throw conflict('Too late to withdraw.');
  db.update(schema.courtCases).set({ status: 'dismissed', reasoning: 'Withdrawn by the plaintiff.', closedAt: clock.now() }).where(eq(schema.courtCases.id, caseId)).run();
  tellParties(c, `📭 Case #${c.number} withdrawn`);
  return { ok: true };
}

const cleanRemedy = (r: CaseRemedy | undefined): CaseRemedy => ({
  damages: Math.max(0, Math.floor(r?.damages ?? 0)),
  fine: Math.max(0, Math.floor(r?.fine ?? 0)),
  freezeHours: Math.max(0, Math.min(720, r?.freezeHours ?? 0)),
  suspendModule: r?.suspendModule && MODULES.includes(r.suspendModule as Module) ? r.suspendModule : null,
  suspendHours: Math.max(0, Math.min(720, r?.suspendHours ?? 0)),
});

/** The judge (the Owner, or the auto-judge) rules. Remedies apply once the appeal window closes. */
export function decideCase(caseId: string, verdict: 'plaintiff' | 'defendant', remedy: CaseRemedy | undefined, reasoning: string, actorId: string | null) {
  return atomic(() => {
    const c = getCase(caseId);
    if (!['filed', 'hearing', 'appealed'].includes(c.status)) throw conflict('This case has already been decided.');
    const now = clock.now();
    const rem = verdict === 'plaintiff' ? cleanRemedy(remedy) : {};
    const final = c.appealed;
    db.update(schema.courtCases)
      .set({ status: final ? 'closed' : 'decided', verdict, remedy: rem, reasoning: reasoning.slice(0, 500), decidedAt: now, appealDeadline: final ? null : now + cfg().justice.appealHours * HOUR_MS })
      .where(eq(schema.courtCases.id, caseId))
      .run();
    const winner = verdict === 'plaintiff' ? brief(c.plaintiffId) : brief(c.defendantId);
    tellParties(c, `🔨 Verdict in case #${c.number}: ${winner.name} wins`, final ? 'This ruling is final.' : `The loser can appeal within ${cfg().justice.appealHours} h.`);
    if (final) applyRemedy({ ...c, verdict, remedy: rem });
    if (actorId) audit({ actorId, action: 'court.decide', targetType: 'case', targetId: caseId, newValue: { verdict, remedy: rem } });
    return { ok: true };
  });
}

function applyRemedy(c: Case) {
  const now = clock.now();
  const r = c.remedy ?? {};
  const bits: string[] = [];
  if (c.verdict === 'plaintiff') {
    if (r.damages && c.plaintiffId) bits.push(`${collect(c.defendantId, r.damages, 'justice.damages', `Damages, case #${c.number}`, companyWallet(c.plaintiffId))} BT damages`);
    if (r.fine) bits.push(`${collect(c.defendantId, r.fine, 'justice.fine', `Fine, case #${c.number}`)} BT fine`);
    if (r.freezeHours) {
      addSanction(c.defendantId, 'freeze', r.freezeHours, `Court order, case #${c.number}`, 'court', c.id);
      bits.push(`assets frozen ${r.freezeHours} h`);
    }
    if (r.suspendModule && r.suspendHours) {
      addSanction(c.defendantId, 'suspend', r.suspendHours, `Court order, case #${c.number}`, 'court', c.id, r.suspendModule);
      bits.push(`${MODULE_INFO[r.suspendModule as Module]?.label ?? r.suspendModule} licence suspended ${r.suspendHours} h`);
    }
    if (c.kind === 'tax') {
      const st = stateOf(c.defendantId);
      patchState(c.defendantId, { undeclared: 0, auditRisk: Math.max(0, st.auditRisk - 25) });
    }
  } else bumpState(c.defendantId, { legal: 1 });
  db.update(schema.courtCases).set({ status: 'closed', closedAt: now }).where(eq(schema.courtCases.id, c.id)).run();
  const d = brief(c.defendantId);
  const p = brief(c.plaintiffId);
  addNews('headline', `🔨 Case #${c.number}: ${c.verdict === 'plaintiff' ? `${d.name} loses to ${p.name}` : `${d.name} wins against ${p.name}`}`, bits.length ? bits.join(', ') : 'No penalties.', c.defendantId);
  tellParties(c, `🔨 Case #${c.number} is closed`, bits.join(', ') || 'No penalties.');
}

export function appealCase(caseId: string, companyId: string, actorId: string) {
  return atomic(() => {
    const c = getCase(caseId);
    const side = sideOf(c, companyId);
    if (!side) throw forbidden('Only the parties can appeal.');
    if (c.status !== 'decided' || c.appealed) throw conflict('This case can not be appealed.');
    if (c.verdict === side) throw badRequest('You won! No need to appeal.');
    if ((c.appealDeadline ?? 0) < clock.now()) throw conflict('The appeal window has closed.');
    const fee = Math.max(200, c.filingFee * cfg().justice.appealFeeMult);
    chargeCompany({ companyId, amount: fee, kind: 'justice.appeal', memo: `Appeal of case #${c.number}`, actorId });
    db.update(schema.courtCases).set({ status: 'appealed', appealed: true, hearingAt: clock.now() + cfg().justice.hearingMinutes * MINUTE_MS, appealDeadline: null }).where(eq(schema.courtCases.id, caseId)).run();
    tellParties(c, `📣 Case #${c.number} appealed`, 'The appeals court will hear it. Add more evidence!');
    return { ok: true, fee };
  });
}

/** Evidence weight + lawyers + a little luck. */
export function caseScore(c: Case) {
  const ev = db.select().from(schema.courtEvidence).where(eq(schema.courtEvidence.caseId, c.id)).all();
  const weight = (side: string) => ev.filter((e) => e.side === side).reduce((s, e) => s + e.weight, 0);
  const legal = (id: string | null) => (id ? stateOf(id).legal / 10 : 3);
  let p = weight('plaintiff') + legal(c.plaintiffId);
  const d = weight('defendant') + legal(c.defendantId);
  if (c.kind === 'tax') p += stateOf(c.defendantId).auditRisk / 20;
  return { plaintiff: Math.round(p * 10) / 10, defendant: Math.round(d * 10) / 10 };
}

function autoJudge(c: Case) {
  const s = caseScore(c);
  const luck = (liveRng().next() - 0.5) * 4;
  const plaintiffWins = s.plaintiff + luck > s.defendant;
  const strength = Math.min(1, Math.max(0.3, (s.plaintiff - s.defendant + 5) / 10));
  const remedy: CaseRemedy = c.plaintiffId ? { damages: Math.round(c.claim * strength) } : { fine: Math.round(c.claim * strength), freezeHours: c.kind === 'tax' && strength > 0.8 ? 12 : 0 };
  decideCase(c.id, plaintiffWins ? 'plaintiff' : 'defendant', remedy, `Auto-judge: evidence ${s.plaintiff} vs ${s.defendant}.`, null);
}

export function courtTick(now: number) {
  for (const c of db.select().from(schema.courtCases).where(and(eq(schema.courtCases.status, 'filed'), sql`${schema.courtCases.hearingAt} <= ${now}`)).all()) {
    db.update(schema.courtCases).set({ status: 'hearing' }).where(eq(schema.courtCases.id, c.id)).run();
    tellParties(c, `🏛️ Case #${c.number} is in session`, 'The judge will rule soon.');
  }
  // if the Owner has not ruled 2 h after the hearing, the auto-judge does
  for (const c of db.select().from(schema.courtCases).where(and(sql`${schema.courtCases.status} in ('hearing','appealed')`, sql`${schema.courtCases.hearingAt} <= ${now - 2 * HOUR_MS}`)).all()) autoJudge(c);
  for (const c of db.select().from(schema.courtCases).where(and(eq(schema.courtCases.status, 'decided'), sql`${schema.courtCases.appealDeadline} <= ${now}`)).all()) applyRemedy(c);
}

export function caseView(caseId: string, viewerCompanyId: string | null, isOwner: boolean) {
  const c = getCase(caseId);
  if (!isOwner && !sideOf(c, viewerCompanyId)) {
    // public record: no evidence details
    return { ...c, plaintiff: brief(c.plaintiffId), defendant: brief(c.defendantId), evidence: [], mySide: null, score: null };
  }
  const evidence = db.select().from(schema.courtEvidence).where(eq(schema.courtEvidence.caseId, caseId)).orderBy(schema.courtEvidence.createdAt).all();
  return { ...c, plaintiff: brief(c.plaintiffId), defendant: brief(c.defendantId), evidence, mySide: sideOf(c, viewerCompanyId) ?? (isOwner && !c.plaintiffId ? 'plaintiff' : null), score: isOwner ? caseScore(c) : null };
}

export function docket(filter: { companyId?: string; open?: boolean } = {}) {
  const conds = [];
  if (filter.companyId) conds.push(or(eq(schema.courtCases.plaintiffId, filter.companyId), eq(schema.courtCases.defendantId, filter.companyId)));
  if (filter.open) conds.push(sql`${schema.courtCases.status} in ('filed','hearing','decided','appealed')`);
  const rows = db
    .select()
    .from(schema.courtCases)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.courtCases.createdAt))
    .limit(100)
    .all();
  return rows.map((c) => ({ ...c, plaintiff: brief(c.plaintiffId), defendant: brief(c.defendantId) }));
}

export function sanctionsList(companyId?: string) {
  const now = clock.now();
  const rows = db
    .select()
    .from(schema.sanctions)
    .where(and(gt(schema.sanctions.until, now), isNull(schema.sanctions.liftedAt), companyId ? eq(schema.sanctions.companyId, companyId) : undefined))
    .orderBy(desc(schema.sanctions.createdAt))
    .all();
  return rows.map((s) => ({ ...s, company: brief(s.companyId) }));
}

/** What a company sees about its own legal standing. */
export function myLegal(companyId: string) {
  const st = stateOf(companyId);
  return {
    legal: st.legal,
    auditRisk: st.auditRisk,
    underAudit: !!db.select().from(schema.taxAudits).where(and(eq(schema.taxAudits.companyId, companyId), eq(schema.taxAudits.status, 'open'))).get(),
    audits: auditsList(companyId).map((a) => ({ id: a.id, depth: a.depth, status: a.status, outcome: a.outcome, fine: a.fine, note: a.note, createdAt: a.createdAt, closedAt: a.closedAt })),
    sanctions: sanctionsList(companyId),
    cases: docket({ companyId }),
  };
}
