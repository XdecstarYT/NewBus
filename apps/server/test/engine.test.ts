import { describe, it, expect } from 'vitest';
import { makeRng } from '../src/engine/rng';
import { rollRarity } from '../src/engine/pods';
import { accrualMs } from '../src/engine/accrual';
import { workerTickOutput, workerBaseOutput, companyTickOutput, workerVitals } from '../src/engine/workers';
import { economy } from '../src/config/economy';

describe('engine: pods', () => {
  it('rolls match the published odds (seeded, 50k pulls, no pity)', () => {
    const rng = makeRng(7);
    const odds = economy.pods.types.basic.odds;
    const counts: Record<string, number> = {};
    for (let i = 0; i < 50_000; i++) {
      const r = rollRarity(rng, odds, { pityEpic: 0, pityLegendary: 0 }, { pityEpic: 1e9, pityLegendary: 1e9 });
      counts[r.rarity] = (counts[r.rarity] ?? 0) + 1;
    }
    for (const [k, p] of Object.entries(odds)) expect(Math.abs(counts[k] / 50_000 - p)).toBeLessThan(0.01);
  });

  it('pity guarantees an Epic+ within N pulls and a Legendary within M', () => {
    const rng = makeRng(99);
    let pity = { pityEpic: 0, pityLegendary: 0 };
    let sinceEpic = 0;
    let sinceLeg = 0;
    let maxEpicGap = 0;
    let maxLegGap = 0;
    for (let i = 0; i < 5000; i++) {
      const r = rollRarity(rng, { COMMON: 1, RARE: 0, EPIC: 0.0001, LEGENDARY: 0.00001, CURSED: 0 }, pity, { pityEpic: 10, pityLegendary: 60 });
      pity = r.next;
      sinceEpic++;
      sinceLeg++;
      if (r.rarity === 'EPIC' || r.rarity === 'LEGENDARY') {
        maxEpicGap = Math.max(maxEpicGap, sinceEpic);
        sinceEpic = 0;
      }
      if (r.rarity === 'LEGENDARY') {
        maxLegGap = Math.max(maxLegGap, sinceLeg);
        sinceLeg = 0;
      }
    }
    expect(maxEpicGap).toBeLessThanOrEqual(10);
    expect(maxLegGap).toBeLessThanOrEqual(60);
  });

  it('is deterministic for the same seed', () => {
    const a = makeRng(5);
    const b = makeRng(5);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
});

describe('engine: offline earnings window', () => {
  const H = 3600_000;
  it('pays normally while active', () => {
    expect(accrualMs({ lastTickAt: 0, lastActiveAt: 0, now: 5000, offlineCapMs: 8 * H, maxCatchupMs: 8 * H })).toBe(5000);
  });
  it('stops accruing after the offline cap', () => {
    expect(accrualMs({ lastTickAt: 9 * H, lastActiveAt: 0, now: 9 * H + 5000, offlineCapMs: 8 * H, maxCatchupMs: 8 * H })).toBe(0);
  });
  it('caps catch-up after downtime and never exceeds the offline window', () => {
    expect(accrualMs({ lastTickAt: 0, lastActiveAt: 0, now: 20 * H, offlineCapMs: 8 * H, maxCatchupMs: 8 * H })).toBe(0);
    expect(accrualMs({ lastTickAt: 0, lastActiveAt: 10 * H, now: 12 * H, offlineCapMs: 8 * H, maxCatchupMs: 8 * H })).toBe(8 * H);
  });
});

describe('engine: production math', () => {
  const base = { id: 'w', role: 'MAKER', rarity: 'COMMON', quirk: 'steady-eddie', level: 1, energy: 100, mood: 100, workplaceId: 'wp', coffeeUntil: null };
  const wp = { id: 'wp', kind: 0, level: 1 };
  const ctx = { now: Date.UTC(2026, 0, 1, 12), focusOf: () => 'MAKER' as const, campaignActive: false };
  it('higher rarity and level produce more', () => {
    expect(workerBaseOutput({ rarity: 'LEGENDARY', level: 1 }, economy)).toBeGreaterThan(workerBaseOutput({ rarity: 'COMMON', level: 1 }, economy));
    expect(workerBaseOutput({ rarity: 'COMMON', level: 5 }, economy)).toBeGreaterThan(workerBaseOutput({ rarity: 'COMMON', level: 1 }, economy));
  });
  it('synergy gives the configured bonus', () => {
    const withS = workerTickOutput(base, wp, ctx, economy);
    const without = workerTickOutput(base, wp, { ...ctx, focusOf: () => 'SELLER' as const }, economy);
    expect(withS / without).toBeCloseTo(economy.workers.synergyMult, 5);
  });
  it('tired and grumpy workers produce less; unassigned produce nothing', () => {
    const fresh = workerTickOutput(base, wp, ctx, economy);
    const tired = workerTickOutput({ ...base, energy: 0, mood: 0 }, wp, ctx, economy);
    expect(tired).toBeLessThan(fresh);
    expect(workerTickOutput({ ...base, workplaceId: null }, wp, ctx, economy)).toBe(0);
  });
  it('company output sums workers and counts synergies', () => {
    const out = companyTickOutput([base, { ...base, id: 'w2', role: 'SELLER' }], [wp], ctx, economy);
    expect(out.synergies).toBe(1);
    expect(out.income).toBeGreaterThan(0);
  });
  it('working drains energy, resting restores it', () => {
    expect(workerVitals({ ...base, energy: 50 }, economy, 0, 60).energy).toBeLessThan(50);
    expect(workerVitals({ ...base, energy: 50, workplaceId: null }, economy, 0, 60).energy).toBeGreaterThan(50);
  });
});
