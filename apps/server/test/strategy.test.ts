import { describe, it, expect, beforeAll } from 'vitest';
import type { Express } from 'express';
import { STRATEGY_ACTIONS, findStrategyAction } from '@dw/shared';
import { setupGame, makeCompany, login } from './helpers';
import { db, schema } from '../src/db';
import { eq } from 'drizzle-orm';
import * as strat from '../src/services/strategy';
import * as unions from '../src/services/unions';
import * as justice from '../src/services/justice';
import { balanceOf, verifyLedger, SYS } from '../src/services/ledger';
import { companyWallet } from '../src/services/money';
import { multiplier } from '../src/services/multipliers';
import { getCompany } from '../src/services/companies';
import { getAccountByNumber } from '../src/services/auth';
import { clock, HOUR_MS, MINUTE_MS } from '../src/lib/time';
import { reseedLive } from '../src/engine/rng';

let app: Express;
const owner = () => getAccountByNumber('01')!.id;
const bal = (id: string) => balanceOf(companyWallet(id));
const setLevel = (id: string, level: number) => db.update(schema.companies).set({ level }).where(eq(schema.companies.id, id)).run();

describe('strategy layer', () => {
  beforeAll(() => {
    app = setupGame();
  });

  it('has 500 unique strategic actions in 10 categories', () => {
    expect(STRATEGY_ACTIONS).toHaveLength(500);
    expect(new Set(STRATEGY_ACTIONS.map((a) => a.id)).size).toBe(500);
    expect(new Set(STRATEGY_ACTIONS.map((a) => a.category)).size).toBe(10);
  });

  it('runs an action: pays, boosts, cools down, and respects the level gate', () => {
    reseedLive(1);
    const s = makeCompany({ name: 'Strat Co', startingBits: 50_000 });
    const co = () => getCompany(s.company.id);
    const before = multiplier('traffic', co());
    const a = findStrategyAction('flyers-1')!;
    const b0 = bal(s.company.id);
    strat.runAction(s.company.id, a.id, s.account.id);
    expect(bal(s.company.id)).toBe(b0 - a.cost);
    expect(multiplier('traffic', co())).toBeGreaterThan(before);
    expect(() => strat.runAction(s.company.id, a.id, s.account.id)).toThrow(/cooling down/);
    expect(() => strat.runAction(s.company.id, 'flyers-5', s.account.id)).toThrow(/level 35/);
    expect(strat.strategyView(s.company.id).active).toHaveLength(1);
    expect(verifyLedger().sum).toBe(0);
  });

  it('policies change multipliers and can only change once an hour', () => {
    const s = makeCompany({ name: 'Policy Co' });
    const co = getCompany(s.company.id);
    const inc = multiplier('income', co);
    strat.setPolicy(s.company.id, 'pricing', 'premium', s.account.id);
    expect(multiplier('income', co)).toBeCloseTo(inc * 1.08, 5);
    expect(() => strat.setPolicy(s.company.id, 'labor', 'lean', s.account.id)).toThrow(/once an hour/);
  });

  it('expansion builds presence until the company controls a district', () => {
    const s = makeCompany({ name: 'Expand Co', startingBits: 50_000 });
    strat.setFocus(s.company.id, 'harbor');
    strat.runAction(s.company.id, 'branch-1', s.account.id);
    strat.runAction(s.company.id, 'kiosk-1', s.account.id);
    strat.decayPresence(0);
    expect(strat.controlledBy(s.company.id)).toContain('harbor');
    const h = strat.districtsView(s.company.id).find((d) => d.id === 'harbor')!;
    expect(h.controller).toBe(s.company.id);
    expect(h.myShare).toBe(100);
  });

  it('laws: lobbying decides the vote and a passed law boosts everyone', () => {
    const a = makeCompany({ name: 'Lobby A' });
    const b = makeCompany({ name: 'Lobby B' });
    strat.bumpState(a.company.id, { influence: 10 });
    strat.bumpState(b.company.id, { influence: 4 });
    const law = strat.proposeLaw('relief', 1, owner());
    strat.lobby(a.company.id, law.id, 'for', 6);
    strat.lobby(b.company.id, law.id, 'against', 4);
    expect(() => strat.lobby(a.company.id, law.id, 'against', 1)).toThrow(/flip-flopping/);
    const co = getCompany(a.company.id);
    const before = multiplier('income', co);
    strat.lawsTick(clock.now() + 2 * HOUR_MS);
    expect(db.select().from(schema.laws).where(eq(schema.laws.id, law.id)).get()!.status).toBe('passed');
    expect(multiplier('income', co)).toBeCloseTo(before * 1.05, 5);
  });

  it('unions: reps, elections, recalls, dues and collective moves', () => {
    const f = makeCompany({ name: 'Founder Co', startingBits: 50_000 });
    const m1 = makeCompany({ name: 'Member One', startingBits: 20_000 });
    const m2 = makeCompany({ name: 'Member Two', startingBits: 20_000 });
    const outsider = makeCompany({ name: 'Scab Inc', startingBits: 5_000 });
    const { id } = unions.createUnion(f.company.id, f.account.id, { name: 'Bakers United', emoji: '🥖', motto: 'Rise together', dues: 50 });
    unions.joinUnion(m1.company.id, m1.account.id, id);
    unions.joinUnion(m2.company.id, m2.account.id, id);
    expect(() => unions.joinUnion(m1.company.id, m1.account.id, id)).toThrow(/already/);
    expect(unions.getUnion(id).presidentId).toBe(f.company.id);

    // election for treasurer: two candidates, the rep of each business votes
    const e = unions.callElection(f.company.id, f.account.id, 'treasurer');
    expect(() => unions.callElection(m1.company.id, m1.account.id, 'president')).toThrow(/Only the President/);
    unions.nominate(m1.company.id, m1.account.id, e.id, 'Every Bit counted');
    unions.nominate(m2.company.id, m2.account.id, e.id, 'Lower dues!');
    expect(() => unions.vote(f.company.id, f.account.id, e.id, m1.company.id)).toThrow(/not opened/);
    const t0 = clock.now();
    unions.unionsTick(e.votingAt);
    unions.vote(f.company.id, f.account.id, e.id, m2.company.id);
    unions.vote(m1.company.id, m1.account.id, e.id, m1.company.id);
    unions.vote(m2.company.id, m2.account.id, e.id, m2.company.id);
    unions.unionsTick(e.closesAt);
    expect(unions.getUnion(id).treasurerId).toBe(m2.company.id);
    expect(unions.unionView(id, f.company.id, f.account.id).elections[0].result).toEqual({ [m2.company.id]: 2, [m1.company.id]: 1 });

    // vote of no confidence against the treasurer
    const r = unions.callRecall(m1.company.id, m1.account.id, 'treasurer');
    unions.vote(f.company.id, f.account.id, r.id, 'yes');
    unions.vote(m1.company.id, m1.account.id, r.id, 'yes');
    unions.vote(m2.company.id, m2.account.id, r.id, 'no');
    unions.unionsTick(r.closesAt);
    expect(unions.getUnion(id).treasurerId).toBeNull();

    // dues fill the treasury, the President spends it on a strike
    unions.donate(f.company.id, f.account.id, 5_000);
    expect(balanceOf(unions.unionWallet(id))).toBeGreaterThanOrEqual(5_000 + 500);
    const co = getCompany(outsider.company.id);
    const before = multiplier('traffic', co);
    unions.unionMove(f.company.id, f.account.id, 'strike', { targetId: outsider.company.id });
    expect(multiplier('traffic', co)).toBeCloseTo(before * 0.88, 5);
    expect(() => unions.unionMove(f.company.id, f.account.id, 'strike', { targetId: outsider.company.id })).toThrow(/cooldown/);
    expect(() => unions.unionMove(m1.company.id, m1.account.id, 'coop', {})).toThrow(/Only the President/);
    expect(t0).toBeLessThanOrEqual(clock.now());
    expect(verifyLedger().sum).toBe(0);
  });

  it('tax audit finds hidden income from shady deals and fines it', () => {
    reseedLive(7);
    const s = makeCompany({ name: 'Sneaky Co', startingBits: 100_000 });
    strat.runAction(s.company.id, 'cashonly-1', s.account.id);
    strat.runAction(s.company.id, 'shellco-1', s.account.id);
    expect(strat.stateOf(s.company.id).undeclared).toBeGreaterThan(0);
    const a = justice.openAudit(s.company.id, 'forensic', owner());
    expect((a.findings as any).hiddenIncomeFound).toBeGreaterThan(0);
    expect(a.suggestedFine).toBeGreaterThan((a.findings as any).hiddenIncomeFound);
    const tr = balanceOf(SYS.TREASURY);
    const b0 = bal(s.company.id);
    const r = justice.closeAudit(a.id, 'fined', { note: 'Naughty' }, owner());
    expect(r.fine).toBe(a.suggestedFine);
    expect(bal(s.company.id)).toBe(b0 - r.fine);
    expect(balanceOf(SYS.TREASURY)).toBe(tr + r.fine);
    expect(verifyLedger().sum).toBe(0);
  });

  it('court: file, evidence, Owner verdict with freeze + licence suspension, appeal window, enforcement', async () => {
    const p = makeCompany({ name: 'Plaintiff Co', startingBits: 20_000, accountNumber: '71', password: 'pass1234' });
    const d = makeCompany({ name: 'Defendant Co', startingBits: 20_000, accountNumber: '72', password: 'pass1234' });
    const pa = await login(app, '71', 'pass1234');
    const da = await login(app, '72', 'pass1234');
    const oa = await login(app, '01', 'Diddy');

    const filed = await pa.post('/api/game/court/cases', { defendantId: d.company.id, kind: 'breach', title: 'They never delivered the croissants', claim: 4000 });
    expect(filed.status).toBe(200);
    const caseId = filed.body.id;
    expect(filed.body.filingFee).toBe(200);
    expect((await pa.post(`/api/game/court/cases/${caseId}/evidence`, { kind: 'document', text: 'Signed order form' })).status).toBe(200);
    expect((await da.post(`/api/game/court/cases/${caseId}/evidence`, { kind: 'witness', text: 'Our driver saw nobody home' })).status).toBe(200);
    expect((await pa.get(`/api/game/court/cases/${caseId}`)).body.evidence).toHaveLength(2);

    const v = await oa.post(`/api/owner/court/cases/${caseId}/decide`, { verdict: 'plaintiff', remedy: { damages: 3000, freezeHours: 2, suspendModule: 'marketplace', suspendHours: 2 }, reasoning: 'Croissants matter.' });
    expect(v.status).toBe(200);
    // the defendant may appeal before the remedy applies
    const ap = await da.post(`/api/game/court/cases/${caseId}/appeal`);
    expect(ap.status).toBe(200);
    expect((await pa.post(`/api/game/court/cases/${caseId}/appeal`)).status).toBe(409);
    const pb = bal(p.company.id);
    const v2 = await oa.post(`/api/owner/court/cases/${caseId}/decide`, { verdict: 'plaintiff', remedy: { damages: 3000, freezeHours: 2, suspendModule: 'marketplace', suspendHours: 2 }, reasoning: 'Upheld on appeal.' });
    expect(v2.status).toBe(200);
    expect(bal(p.company.id)).toBe(pb + 3000);
    // frozen: can not spend; suspended: marketplace locked
    expect(() => strat.runAction(d.company.id, 'flyers-1', d.account.id)).toThrow(/frozen/);
    expect((await da.get('/api/game/shops')).body.error).toBe('module_locked');
    const sanctions = justice.sanctionsList(d.company.id);
    expect(sanctions).toHaveLength(2);
    for (const s of sanctions) await oa.post(`/api/owner/sanctions/${s.id}/lift`);
    expect((await da.get('/api/game/shops')).status).toBe(200);
    expect(verifyLedger().sum).toBe(0);
  });

  it('court: settlement and the auto-judge', () => {
    reseedLive(3);
    const p = makeCompany({ name: 'Settler A', startingBits: 20_000 });
    const d = makeCompany({ name: 'Settler B', startingBits: 20_000 });
    const c = justice.fileCase(p.company.id, { defendantId: d.company.id, kind: 'defamation', title: 'Said our bread was stale', claim: 2000 }, p.account.id);
    justice.offerSettlement(c.id, d.company.id, 700);
    expect(() => justice.acceptSettlement(c.id, d.company.id, false)).toThrow(/other side/);
    const pb = bal(p.company.id);
    justice.acceptSettlement(c.id, p.company.id, false);
    expect(bal(p.company.id)).toBe(pb + 700);

    const state = justice.fileCase(null, { defendantId: d.company.id, kind: 'labor', title: 'State v. Settler B', claim: 1500 }, owner());
    justice.addEvidence(state.id, null, true, { kind: 'expert', text: 'Inspector report' }, owner());
    const now = clock.now();
    justice.courtTick(now + 61 * MINUTE_MS);
    justice.courtTick(now + 4 * HOUR_MS);
    const decided = justice.caseView(state.id, null, true);
    expect(['decided', 'closed']).toContain(decided.status);
    expect(decided.verdict).toBeTruthy();
    justice.courtTick(now + 30 * HOUR_MS);
    expect(justice.caseView(state.id, null, true).status).toBe('closed');
    expect(verifyLedger().sum).toBe(0);
  });
});
