import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Express } from 'express';
import { setupGame, makeCompany, login } from './helpers';
import { db, schema } from '../src/db';
import { clock } from '../src/lib/time';
import { cfg } from '../src/services/settings';
import { bump, getStat } from '../src/services/stats';
import { balanceOf, verifyLedger, SYS } from '../src/services/ledger';
import { companyWallet } from '../src/services/money';
import { getCompany } from '../src/services/companies';
import { projectCompany } from '../src/services/tick';
import * as research from '../src/services/research';
import * as goals from '../src/services/goals';
import * as mg from '../src/services/minigames';
import * as chaos from '../src/services/chaos';
import { ACHIEVEMENTS } from '../src/catalog/achievements';
import { RESEARCH } from '../src/catalog/research';

let app: Express;

describe('The Big Byte Update', () => {
  beforeAll(() => {
    app = setupGame();
  });

  it('ships 250+ achievements and a 30-node research tree', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(250);
    expect(RESEARCH.length).toBe(30);
    for (const n of RESEARCH) if (n.requires) expect(RESEARCH.some((x) => x.key === n.requires)).toBe(true);
  });

  it('research: RP accrue, nodes need prerequisites, and effects change the economy', () => {
    const { company } = makeCompany({ name: 'Lab Co' });
    const before = projectCompany(getCompany(company.id)).incomePerTick;
    expect(() => research.buyResearch(company.id, 'coin-polisher')).toThrow(/first|Not enough/);
    db.update(schema.companies).set({ research: { _rp: 500 } }).where(eq(schema.companies.id, company.id)).run();
    expect(() => research.buyResearch(company.id, 'coin-polisher')).toThrow(/Piggy Bank AI first/);
    research.buyResearch(company.id, 'piggy-bank-ai');
    research.buyResearch(company.id, 'piggy-bank-ai');
    const after = projectCompany(getCompany(company.id)).incomePerTick;
    expect(after).toBeCloseTo(before * 1.06, 1);
    const v = research.researchView(company.id);
    expect(v.totals.income).toBe(6);
    expect(v.points).toBeLessThan(500);
  });

  it('achievements unlock from real stats, pay from the Treasury and grant titles', () => {
    const { company } = makeCompany({ name: 'Achiever' });
    bump(company.id, 'taps', 120);
    const bal = balanceOf(companyWallet(company.id));
    const fresh = goals.checkAchievements(company.id);
    expect(fresh.map((a) => a.key)).toEqual(expect.arrayContaining(['taps-1', 'taps-2']));
    expect(balanceOf(companyWallet(company.id))).toBeGreaterThan(bal);
    expect(goals.checkAchievements(company.id).length).toBe(0);
    const view = goals.achievementsView(company.id);
    expect(view.titles).toContain('Tapper');
    goals.setTitle(company.id, 'Tapper');
    expect(getCompany(company.id).title).toBe('Tapper');
    expect(() => goals.setTitle(company.id, 'Moon Owner')).toThrow(/not earned/);
  });

  it('quests: 3 daily + 3 weekly, claim only when done, once', () => {
    const { company } = makeCompany({ name: 'Quester' });
    const qs = goals.questsView(company.id);
    expect(qs.filter((q) => q.period === 'daily').length).toBe(3);
    expect(qs.filter((q) => q.period === 'weekly').length).toBe(3);
    const q = qs.find((x) => x.period === 'daily')!;
    expect(() => goals.claimQuest(company.id, q.id)).toThrow(/Not finished/);
    const row = db.select().from(schema.quests).where(eq(schema.quests.id, q.id)).get()!;
    bump(company.id, row.stat, row.target);
    const r = goals.claimQuest(company.id, q.id);
    expect(r.paid).toBeGreaterThan(0);
    expect(() => goals.claimQuest(company.id, q.id)).toThrow(/Already/);
    expect(goals.questsView(company.id).length).toBe(6); // stable, not regenerated
  });

  it('seasons: pass XP unlocks cosmetic tiers, season end pays prizes and fills the Hall of Fame', () => {
    const a = makeCompany({ name: 'Season A' });
    const b = makeCompany({ name: 'Season B' });
    goals.startSeason({ name: 'Spring Fling', theme: 'flowers', days: 7 }, 'owner');
    expect(() => goals.startSeason({ name: 'X', theme: 'x', days: 1 }, 'owner')).toThrow(/already/);
    goals.addPassXp(a.company.id, cfg().seasons.passXpPerTier * 5);
    expect(() => goals.claimPassTier(a.company.id, 6)).toThrow(/more pass XP/);
    const t5 = goals.claimPassTier(a.company.id, 5);
    expect(t5.reward.kind).toBe('title');
    goals.claimPassTier(a.company.id, 3);
    expect(db.select().from(schema.items).where(eq(schema.items.companyId, a.company.id)).all().some((i) => i.itemKey.startsWith('pass-'))).toBe(true);
    bump(a.company.id, 'earned', 5000); // season twin keys are live now
    bump(b.company.id, 'earned', 1000);
    const bal = balanceOf(companyWallet(a.company.id));
    const { winners } = goals.endSeason('owner');
    expect(winners[0].companyId).toBe(a.company.id);
    expect(balanceOf(companyWallet(a.company.id))).toBe(bal + cfg().seasons.prizes[0]);
    expect(goals.seasonView(a.company.id).hallOfFame[0].winners![0].companyId).toBe(a.company.id);
    expect(goals.achievementsView(a.company.id).titles.some((t) => t.includes('Spring Fling Champion'))).toBe(true);
    expect(verifyLedger().sum).toBe(0);
  });

  it('mini-games: plausible scores pay (capped), impossible ones are flagged, quiz is graded server-side', () => {
    const { company, account } = makeCompany({ name: 'Gamer' });
    const t0 = clock.now();
    const s = mg.startGame(company.id, 'debug-rush') as any;
    clock.set(t0 + 30_000);
    const ok = mg.finishGame(company.id, account.id, s.sessionId, { score: 40 });
    expect(ok.payout).toBe(Math.min(40 * cfg().minigames.payoutPerPoint, cfg().minigames.maxPayoutPerPlay));
    expect(() => mg.finishGame(company.id, account.id, s.sessionId, { score: 40 })).toThrow(/already/);
    const cheat = mg.startGame(company.id, 'debug-rush') as any;
    clock.set(t0 + 40_000);
    const bad = mg.finishGame(company.id, account.id, cheat.sessionId, { score: 9999 });
    expect(bad.payout).toBe(0);
    expect(db.select().from(schema.flags).where(eq(schema.flags.companyId, company.id)).all().length).toBe(1);
    const q = mg.startGame(company.id, 'quiz-show') as any;
    expect(q.questions.length).toBe(8);
    expect(JSON.stringify(q.questions)).not.toContain('answer');
    clock.set(t0 + 90_000);
    const graded = mg.finishGame(company.id, account.id, q.sessionId, { score: 9999, answers: [0, 0, 0, 0, 0, 0, 0, 0] });
    expect(graded.score).toBeLessThanOrEqual(24);
    expect(graded.answers!.length).toBe(8);
    clock.set(null);
    expect(getStat(company.id, 'minigames')).toBe(3);
  });

  it('chaos: Credit Rain pays every active company from the Treasury; Double Bits doubles income', () => {
    const { company } = makeCompany({ name: 'Rainy' });
    db.update(schema.companies).set({ lastActiveAt: clock.now() }).where(eq(schema.companies.id, company.id)).run();
    const bal = balanceOf(companyWallet(company.id));
    const treasury = balanceOf(SYS.TREASURY);
    const r = chaos.creditRain(100, 'owner');
    expect(balanceOf(companyWallet(company.id))).toBe(bal + 100);
    expect(balanceOf(SYS.TREASURY)).toBe(treasury - r.total);
    const before = projectCompany(getCompany(company.id)).grossIncomePerTick;
    chaos.doubleBits(30, 2, 'owner');
    clock.set(clock.now() + 1);
    expect(projectCompany(getCompany(company.id)).grossIncomePerTick).toBeCloseTo(before * 2, 1);
    clock.set(null);
    expect(() => chaos.creditRain(10_000_000, 'owner')).toThrow();
    expect(verifyLedger().sum).toBe(0);
  });

  it('progressive production tax leaves small companies alone and trims big earners', async () => {
    const { afterProductionTax } = await import('../src/services/tick');
    const c = cfg().economy;
    expect(afterProductionTax(c.incomeTaxFreePerTick - 1)).toBe(c.incomeTaxFreePerTick - 1);
    expect(afterProductionTax(c.incomeTaxFreePerTick + 100)).toBeCloseTo(c.incomeTaxFreePerTick + 100 * (1 - c.incomeTaxRate), 5);
  });

  it('API: the new pages answer and owner tools stay owner-only', async () => {
    const { account } = makeCompany({ name: 'Api Co', accountNumber: '99930', password: 'apipass1' });
    const p = await login(app, account.accountNumber, 'apipass1');
    for (const url of ['/api/game/arcade', '/api/game/research', '/api/game/achievements', '/api/game/quests', '/api/game/season', '/api/game/collection']) {
      expect((await p.get(url)).status, url).toBe(200);
    }
    expect((await p.get('/api/owner/chaos')).status).toBe(403);
    const o = await login(app, '01', 'Diddy');
    expect((await o.get('/api/owner/chaos')).status).toBe(200);
    expect((await o.get('/api/owner/seasons')).status).toBe(200);
  });
});
