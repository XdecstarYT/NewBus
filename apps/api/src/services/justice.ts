/**
 * Justice: Owner tax audits, the courthouse (company v. company or the State v. a
 * company) with evidence, settlements, verdicts and one appeal, and sanctions
 * (asset freezes, feature suspensions).
 */
import { and, desc, eq, gt, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { CASE_KINDS, EVIDENCE_KINDS, FEATURES, type CaseKind, type EvidenceKind, type Feature, GAME_HOUR, GAME_MINUTE } from '@dw/shared/live';
import { schema, type Db } from '../db';
import type { Remedy } from '../db/schema';
import type { Account, Company } from '../http/router';
import { clock, DAY } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { addNews, getSettings, hint, notify, topics } from './core';
import { pay, payUpTo, W } from './money';

type Case = typeof schema.cases.$inferSelect;

async function co(db: Db, id: string | null) {
  if (!id) return { id: null, name: 'The State', emoji: '🏛️', color: '#334155' };
  const r = (await db.select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji, color: schema.companies.color }).from(schema.companies).where(eq(schema.companies.id, id)))[0];
  return r ?? { id, name: '(gone)', emoji: '❓', color: '#888' };
}

// ------------------------------------------------------------ sanctions
export async function addSanction(db: Db, companyId: string, kind: 'freeze' | 'suspend', hours: number, reason: string, feature: string | null = null) {
  if (kind === 'suspend' && (!feature || !(feature in FEATURES))) throw badRequest('Pick a feature to suspend.');
  const now = clock.now();
  const row = { id: newId('snc', 12), companyId, kind, feature: kind === 'suspend' ? feature : null, reason: reason.slice(0, 200), until: now + Math.max(1, Math.min(720, hours)) * GAME_HOUR, liftedAt: null, createdAt: now };
  await db.insert(schema.sanctions).values(row);
  await notify(db, { companyId }, 'justice', kind === 'freeze' ? '🧊 Your assets are frozen' : `⛔ ${FEATURES[feature as Feature].label} suspended`, `${reason} (${Math.round(hours)} h)`);
  return row;
}

export async function liftSanction(db: Db, id: string) {
  const s = (await db.select().from(schema.sanctions).where(eq(schema.sanctions.id, id)))[0];
  if (!s) throw notFound('No such sanction.');
  await db.update(schema.sanctions).set({ liftedAt: clock.now() }).where(eq(schema.sanctions.id, id));
  await notify(db, { companyId: s.companyId }, 'justice', '✅ Sanction lifted');
  return { ok: true };
}

export async function sanctionsList(db: Db, companyId?: string) {
  const rows = await db
    .select()
    .from(schema.sanctions)
    .where(and(gt(schema.sanctions.until, clock.now()), isNull(schema.sanctions.liftedAt), companyId ? eq(schema.sanctions.companyId, companyId) : undefined))
    .orderBy(desc(schema.sanctions.createdAt));
  const out = [];
  for (const s of rows) out.push({ ...s, company: await co(db, s.companyId) });
  return out;
}

// ------------------------------------------------------------ tax audits
/** Look at a company's last 7 days of books. Sales are taxed automatically; transfers are not. */
export async function openAudit(db: Db, companyId: string) {
  if ((await db.select().from(schema.audits).where(and(eq(schema.audits.companyId, companyId), eq(schema.audits.status, 'open')))).length) throw conflict('This company is already under audit.');
  const c = await co(db, companyId);
  const since = clock.now() - 7 * DAY;
  const w = W.company(companyId);
  const sum = async (cond: ReturnType<typeof and>) => Number((await db.select({ s: sql<string>`coalesce(sum(${schema.ledger.amount}),0)` }).from(schema.ledger).where(and(cond, gt(schema.ledger.createdAt, since))))[0].s);
  const salesIncome = await sum(and(eq(schema.ledger.toWallet, w), like(schema.ledger.kind, 'sale.%')));
  const transfersIn = await sum(and(eq(schema.ledger.toWallet, w), eq(schema.ledger.kind, 'transfer.bits')));
  const transfersOut = await sum(and(eq(schema.ledger.fromWallet, w), eq(schema.ledger.kind, 'transfer.bits')));
  const taxPaid = Number((await db.select({ s: sql<string>`coalesce(sum(${schema.trades.tax}),0)` }).from(schema.trades).where(and(eq(schema.trades.sellerId, companyId), gt(schema.trades.createdAt, since))))[0].s);
  const itemsIn = Number((await db.select({ n: sql<string>`count(*)` }).from(schema.auditLog).where(and(eq(schema.auditLog.action, 'transfer.items'), eq(schema.auditLog.target, companyId), gt(schema.auditLog.createdAt, since))))[0].n);
  const s = await getSettings(db);
  const untaxed = transfersIn;
  const suggestedFine = Math.round(((untaxed * s.salesTaxPct) / 100) * 1.5);
  const flags: string[] = [];
  if (transfersIn > salesIncome && transfersIn > 500) flags.push('More Bits arrived as transfers than as taxed sales');
  if (itemsIn > 5) flags.push(`${itemsIn} item shipments received outside the market`);
  if (transfersIn > 0) flags.push(`${transfersIn} BT received in untaxed transfers`);
  const findings = { periodDays: 7, salesIncome, taxPaid, transfersIn, transfersOut, itemsIn, flags };
  const row = { id: newId('aud', 12), companyId, status: 'open', findings, suggestedFine, fine: 0, outcome: null, note: null, createdAt: clock.now(), closedAt: null };
  await db.insert(schema.audits).values(row);
  await notify(db, { companyId }, 'justice', '🔦 You are being audited', 'The tax office is looking at your books.');
  return { ...row, company: c };
}

export async function closeAudit(db: Db, ownerId: string, auditId: string, outcome: 'clean' | 'warning' | 'fined' | 'referred', o: { fine?: number; note?: string; freezeHours?: number }) {
  const a = (await db.select().from(schema.audits).where(eq(schema.audits.id, auditId)))[0];
  if (!a) throw notFound('No such audit.');
  if (a.status !== 'open') throw conflict('This audit is already closed.');
  const c = await co(db, a.companyId);
  let fine = 0;
  let caseId: string | null = null;
  if (outcome === 'fined') {
    fine = await payUpTo(db, W.company(a.companyId), W.treasury, o.fine ?? a.suggestedFine, 'justice.fine', 'Tax audit fine');
    if (o.freezeHours) await addSanction(db, a.companyId, 'freeze', o.freezeHours, 'Tax audit');
    await addNews(db, 'justice', `🧾 ${c.emoji} ${c.name} fined ${fine} BT after a tax audit`, o.note ?? '', a.companyId);
  } else if (outcome === 'referred') {
    caseId = (await fileCase(db, null, ownerId, { defendantId: a.companyId, kind: 'tax', title: `The State v. ${c.name}: tax evasion`, claim: Math.max(100, o.fine ?? a.suggestedFine) })).id;
  }
  await notify(db, { companyId: a.companyId }, 'justice', outcome === 'clean' ? '✅ Audit closed: your books are clean' : outcome === 'warning' ? '⚠️ Audit closed with a warning' : outcome === 'fined' ? `🧾 Audit closed: fined ${fine} BT` : '⚖️ Audit referred to court', o.note ?? '');
  await db.update(schema.audits).set({ status: 'closed', outcome, fine, note: o.note ?? null, closedAt: clock.now() }).where(eq(schema.audits.id, auditId));
  return { ok: true, fine, caseId };
}

export async function auditsList(db: Db, companyId?: string) {
  const rows = await db.select().from(schema.audits).where(companyId ? eq(schema.audits.companyId, companyId) : undefined).orderBy(desc(schema.audits.createdAt)).limit(100);
  const out = [];
  for (const a of rows) out.push({ ...a, company: await co(db, a.companyId) });
  return out;
}

// ------------------------------------------------------------ court
async function caseOf(db: Db, id: string) {
  const c = (await db.select().from(schema.cases).where(eq(schema.cases.id, id)).for('update'))[0];
  if (!c) throw notFound('No such case.');
  return c;
}

function sideOf(c: Case, companyId: string | null, isOwner = false): 'plaintiff' | 'defendant' | null {
  if (companyId && c.defendantId === companyId) return 'defendant';
  if (companyId && c.plaintiffId === companyId) return 'plaintiff';
  if (isOwner && !c.plaintiffId) return 'plaintiff'; // the Owner argues for the State
  return null;
}

async function tellParties(db: Db, c: Case, title: string, body = '') {
  for (const id of [c.plaintiffId, c.defendantId]) {
    if (!id) continue;
    await notify(db, { companyId: id }, 'justice', title, body);
    await hint(db, topics.company(id), { t: 'court', id: c.id });
  }
}

export async function fileCase(db: Db, plaintiff: Company | null, actorId: string, o: { defendantId: string; kind: string; title: string; claim: number }) {
  if (!(o.kind in CASE_KINDS)) throw badRequest('Unknown kind of case.');
  if (plaintiff?.id === o.defendantId) throw badRequest('You can not sue yourself.');
  const def = await co(db, o.defendantId);
  if (!def.id) throw notFound('No such company.');
  const claim = Math.max(0, Math.min(10_000_000, Math.floor(o.claim)));
  const s = await getSettings(db);
  if (plaintiff) {
    const dup = await db.select({ id: schema.cases.id }).from(schema.cases).where(and(eq(schema.cases.plaintiffId, plaintiff.id), eq(schema.cases.defendantId, o.defendantId), inArray(schema.cases.status, ['filed', 'hearing', 'decided', 'appealed'])));
    if (dup.length) throw conflict('You already have an open case against them.');
  }
  const fee = plaintiff ? Math.max(50, Math.round((claim * s.courtFilingPct) / 100)) : 0;
  if (fee) await pay(db, W.company(plaintiff!.id), W.treasury, fee, 'court.filing', `Filing fee: ${o.title}`, actorId);
  const now = clock.now();
  const number = Number((await db.select({ n: sql<string>`coalesce(max(${schema.cases.number}),0)` }).from(schema.cases))[0].n) + 1;
  const row: Case = { id: newId('case', 12), number, kind: o.kind, title: o.title.slice(0, 120), plaintiffId: plaintiff?.id ?? null, defendantId: o.defendantId, claim, fee, status: 'filed', hearingAt: now + s.hearingMinutes * GAME_MINUTE, verdict: null, remedy: null, reasoning: null, appealed: false, appealDeadline: null, settleOffer: null, settleFrom: null, createdAt: now, closedAt: null };
  await db.insert(schema.cases).values(row);
  const p = await co(db, row.plaintiffId);
  await addNews(db, 'justice', `⚖️ Case #${number}: ${p.name} v. ${def.name}`, `${CASE_KINDS[o.kind as CaseKind].emoji} ${CASE_KINDS[o.kind as CaseKind].label}. Claim: ${claim} BT.`, o.defendantId);
  await tellParties(db, row, `⚖️ Case #${number} filed: ${row.title}`, `Hearing in ${s.hearingMinutes} min. Add evidence or offer a settlement.`);
  return row;
}

export async function addEvidence(db: Db, caseId: string, companyId: string | null, isOwner: boolean, actorId: string, o: { kind: string; text: string }) {
  const c = await caseOf(db, caseId);
  if (!['filed', 'hearing', 'appealed'].includes(c.status)) throw conflict('Evidence is closed for this case.');
  const side = sideOf(c, companyId, isOwner);
  if (!side) throw forbidden('Only the parties can add evidence.');
  const def = EVIDENCE_KINDS[o.kind as EvidenceKind];
  if (!def) throw badRequest('Unknown kind of evidence.');
  const n = await db.$count(schema.evidence, and(eq(schema.evidence.caseId, caseId), eq(schema.evidence.side, side)));
  if (n >= 8) throw conflict('Each side can file up to 8 pieces of evidence.');
  const payer = side === 'plaintiff' ? c.plaintiffId : c.defendantId;
  if (def.cost && payer) await pay(db, W.company(payer), W.treasury, def.cost, 'court.evidence', `${def.label} for case #${c.number}`, actorId);
  let text = o.text.trim().slice(0, 500);
  if (o.kind === 'ledger') text = `${text}\n${await ledgerSummary(db, c)}`.trim();
  if (!text) throw badRequest('Describe your evidence.');
  await db.insert(schema.evidence).values({ id: newId('ev', 12), caseId, side, kind: o.kind, text, weight: def.weight, createdAt: clock.now() });
  await tellParties(db, c, `📎 New evidence in case #${c.number}`, `${def.emoji} ${def.label} from the ${side}.`);
  return { ok: true };
}

async function ledgerSummary(db: Db, c: Case) {
  if (!c.plaintiffId) return '[Ledger] Filed by the State.';
  const a = W.company(c.plaintiffId);
  const b = W.company(c.defendantId);
  const r = (
    await db
      .select({ n: sql<string>`count(*)`, s: sql<string>`coalesce(sum(${schema.ledger.amount}),0)` })
      .from(schema.ledger)
      .where(or(and(eq(schema.ledger.fromWallet, a), eq(schema.ledger.toWallet, b)), and(eq(schema.ledger.fromWallet, b), eq(schema.ledger.toWallet, a))))
  )[0];
  const t = (await db.select({ n: sql<string>`count(*)` }).from(schema.trades).where(or(and(eq(schema.trades.buyerId, c.plaintiffId), eq(schema.trades.sellerId, c.defendantId)), and(eq(schema.trades.buyerId, c.defendantId), eq(schema.trades.sellerId, c.plaintiffId)))))[0];
  return `[Ledger] ${r.n} direct payments (${r.s} BT) and ${t.n} trades between the parties.`;
}

export async function offerSettlement(db: Db, caseId: string, company: Company, amount: number) {
  const c = await caseOf(db, caseId);
  const side = sideOf(c, company.id);
  if (!side) throw forbidden('Only the parties can settle.');
  if (!['filed', 'hearing', 'appealed'].includes(c.status)) throw conflict('Too late to settle.');
  const amt = Math.max(0, Math.floor(amount));
  await db.update(schema.cases).set({ settleOffer: amt, settleFrom: side }).where(eq(schema.cases.id, caseId));
  await tellParties(db, c, `🤝 Settlement offer in case #${c.number}`, `The ${side} offers to settle for ${amt} BT (paid by the defendant).`);
  return { ok: true };
}

export async function acceptSettlement(db: Db, caseId: string, companyId: string | null, isOwner: boolean) {
  const c = await caseOf(db, caseId);
  if (c.settleOffer == null || !c.settleFrom) throw badRequest('There is no offer on the table.');
  const side = sideOf(c, companyId, isOwner);
  if (!side || side === c.settleFrom) throw forbidden('The other side has to accept the offer.');
  const paid = await payUpTo(db, W.company(c.defendantId), c.plaintiffId ? W.company(c.plaintiffId) : W.treasury, c.settleOffer, 'justice.settlement', `Settlement of case #${c.number}`);
  await db.update(schema.cases).set({ status: 'settled', closedAt: clock.now(), remedy: { damages: paid } }).where(eq(schema.cases.id, caseId));
  await tellParties(db, c, `🤝 Case #${c.number} settled`, `${paid} BT changed hands.`);
  return { ok: true, paid };
}

export async function withdrawCase(db: Db, caseId: string, companyId: string | null, isOwner: boolean) {
  const c = await caseOf(db, caseId);
  if (sideOf(c, companyId, isOwner) !== 'plaintiff') throw forbidden('Only the plaintiff can drop the case.');
  if (!['filed', 'hearing'].includes(c.status)) throw conflict('Too late to withdraw.');
  await db.update(schema.cases).set({ status: 'dismissed', reasoning: 'Withdrawn by the plaintiff.', closedAt: clock.now() }).where(eq(schema.cases.id, caseId));
  await tellParties(db, c, `📭 Case #${c.number} withdrawn`);
  return { ok: true };
}

const cleanRemedy = (r: Remedy | undefined): Remedy => ({
  damages: Math.max(0, Math.floor(r?.damages ?? 0)),
  fine: Math.max(0, Math.floor(r?.fine ?? 0)),
  freezeHours: Math.max(0, Math.min(720, r?.freezeHours ?? 0)),
  suspend: r?.suspend && r.suspend in FEATURES ? r.suspend : null,
  suspendHours: Math.max(0, Math.min(720, r?.suspendHours ?? 0)),
});

/** The judge rules. Penalties apply when the appeal window closes (or at once on appeal). */
export async function decide(db: Db, caseId: string, verdict: 'plaintiff' | 'defendant', remedy: Remedy | undefined, reasoning: string) {
  const c = await caseOf(db, caseId);
  if (!['filed', 'hearing', 'appealed'].includes(c.status)) throw conflict('This case has already been decided.');
  const s = await getSettings(db);
  const rem = verdict === 'plaintiff' ? cleanRemedy(remedy) : {};
  const final = c.appealed;
  const now = clock.now();
  await db.update(schema.cases).set({ status: final ? 'closed' : 'decided', verdict, remedy: rem, reasoning: reasoning.slice(0, 500), appealDeadline: final ? null : now + s.appealHours * GAME_HOUR }).where(eq(schema.cases.id, caseId));
  const w = await co(db, verdict === 'plaintiff' ? c.plaintiffId : c.defendantId);
  await tellParties(db, c, `🔨 Verdict in case #${c.number}: ${w.name} wins`, final ? 'This ruling is final.' : `The loser can appeal within ${s.appealHours} h.`);
  if (final) await applyRemedy(db, { ...c, verdict, remedy: rem });
  return { ok: true };
}

async function applyRemedy(db: Db, c: Case) {
  const r = c.remedy ?? {};
  const bits: string[] = [];
  if (c.verdict === 'plaintiff') {
    if (r.damages && c.plaintiffId) bits.push(`${await payUpTo(db, W.company(c.defendantId), W.company(c.plaintiffId), r.damages, 'justice.damages', `Damages, case #${c.number}`)} BT damages`);
    if (r.fine) bits.push(`${await payUpTo(db, W.company(c.defendantId), W.treasury, r.fine, 'justice.fine', `Fine, case #${c.number}`)} BT fine`);
    if (r.freezeHours) {
      await addSanction(db, c.defendantId, 'freeze', r.freezeHours, `Court order, case #${c.number}`);
      bits.push(`assets frozen ${r.freezeHours} h`);
    }
    if (r.suspend && r.suspendHours) {
      await addSanction(db, c.defendantId, 'suspend', r.suspendHours, `Court order, case #${c.number}`, r.suspend);
      bits.push(`${FEATURES[r.suspend as Feature].label} suspended ${r.suspendHours} h`);
    }
  }
  await db.update(schema.cases).set({ status: 'closed', closedAt: clock.now() }).where(eq(schema.cases.id, c.id));
  const d = await co(db, c.defendantId);
  const p = await co(db, c.plaintiffId);
  await addNews(db, 'justice', `🔨 Case #${c.number}: ${c.verdict === 'plaintiff' ? `${d.name} loses to ${p.name}` : `${d.name} wins against ${p.name}`}`, bits.join(', ') || 'No penalties.', c.defendantId);
  await tellParties(db, c, `🔨 Case #${c.number} is closed`, bits.join(', ') || 'No penalties.');
}

export async function appeal(db: Db, caseId: string, account: Account, company: Company) {
  const c = await caseOf(db, caseId);
  const side = sideOf(c, company.id);
  if (!side) throw forbidden('Only the parties can appeal.');
  if (c.status !== 'decided' || c.appealed) throw conflict('This case can not be appealed.');
  if (c.verdict === side) throw badRequest('You won! No need to appeal.');
  if ((c.appealDeadline ?? 0) < clock.now()) throw conflict('The appeal window has closed.');
  const fee = Math.max(100, c.fee * 2);
  await pay(db, W.company(company.id), W.treasury, fee, 'court.appeal', `Appeal of case #${c.number}`, account.id);
  const s = await getSettings(db);
  await db.update(schema.cases).set({ status: 'appealed', appealed: true, hearingAt: clock.now() + s.hearingMinutes * GAME_MINUTE, appealDeadline: null }).where(eq(schema.cases.id, caseId));
  await tellParties(db, c, `📣 Case #${c.number} appealed`, 'The appeals court will hear it. Add more evidence!');
  return { ok: true, fee };
}

export async function score(db: Db, caseId: string) {
  const ev = await db.select().from(schema.evidence).where(eq(schema.evidence.caseId, caseId));
  const w = (side: string) => ev.filter((e) => e.side === side).reduce((s, e) => s + e.weight, 0);
  return { plaintiff: w('plaintiff'), defendant: w('defendant') };
}

/** If the Owner has not ruled 2 hours after the hearing, the evidence decides. */
async function autoJudge(db: Db, c: Case) {
  const s = await score(db, c.id);
  const plaintiffWins = s.plaintiff > s.defendant;
  const strength = Math.min(1, Math.max(0.3, (s.plaintiff - s.defendant + 4) / 8));
  const remedy: Remedy = c.plaintiffId ? { damages: Math.round(c.claim * strength) } : { fine: Math.round(c.claim * strength) };
  await decide(db, c.id, plaintiffWins ? 'plaintiff' : 'defendant', remedy, `Auto-judge on the evidence: ${s.plaintiff} vs ${s.defendant}.`);
}

export async function sweepCourt(db: Db, now: number) {
  for (const c of await db.select().from(schema.cases).where(and(eq(schema.cases.status, 'filed'), sql`${schema.cases.hearingAt} <= ${now}`))) {
    await db.update(schema.cases).set({ status: 'hearing' }).where(eq(schema.cases.id, c.id));
    await tellParties(db, c, `🏛️ Case #${c.number} is in session`, 'The judge will rule soon.');
  }
  for (const c of await db.select().from(schema.cases).where(and(inArray(schema.cases.status, ['hearing', 'appealed']), sql`${schema.cases.hearingAt} <= ${now - 24 * GAME_HOUR}`))) await autoJudge(db, c);
  for (const c of await db.select().from(schema.cases).where(and(eq(schema.cases.status, 'decided'), sql`${schema.cases.appealDeadline} <= ${now}`))) await applyRemedy(db, c);
}

export async function caseView(db: Db, caseId: string, companyId: string | null, isOwner: boolean) {
  const c = (await db.select().from(schema.cases).where(eq(schema.cases.id, caseId)))[0];
  if (!c) throw notFound('No such case.');
  const mySide = sideOf(c, companyId, isOwner);
  const base = { ...c, plaintiff: await co(db, c.plaintiffId), defendant: await co(db, c.defendantId), mySide };
  if (!isOwner && !mySide) return { ...base, evidence: [], score: null }; // public record only
  return { ...base, evidence: await db.select().from(schema.evidence).where(eq(schema.evidence.caseId, caseId)).orderBy(schema.evidence.createdAt), score: isOwner ? await score(db, caseId) : null };
}

export async function docket(db: Db, f: { companyId?: string; open?: boolean } = {}) {
  const conds = [];
  if (f.companyId) conds.push(or(eq(schema.cases.plaintiffId, f.companyId), eq(schema.cases.defendantId, f.companyId)));
  if (f.open) conds.push(inArray(schema.cases.status, ['filed', 'hearing', 'decided', 'appealed']));
  const rows = await db.select().from(schema.cases).where(conds.length ? and(...conds) : undefined).orderBy(desc(schema.cases.createdAt)).limit(100);
  const out = [];
  for (const c of rows) out.push({ ...c, plaintiff: await co(db, c.plaintiffId), defendant: await co(db, c.defendantId) });
  return out;
}
