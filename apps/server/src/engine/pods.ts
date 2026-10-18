/**
 * Recruit Pod rolls with pity timers. Pure: pass the rng and current pity counters.
 *
 * pityEpic:      pulls since the last Epic-or-better. At economy.pods.pityEpic-1 the next pull is >= Epic.
 * pityLegendary: pulls since the last Legendary. At pityLegendary-1 the next pull is Legendary.
 */
import type { Rarity } from '@dw/shared';
import type { Rng } from './rng';

export interface PityState {
  pityEpic: number;
  pityLegendary: number;
}

export function rollRarity(rng: Rng, odds: Record<string, number>, pity: PityState, limits: { pityEpic: number; pityLegendary: number }) {
  let rarity: Rarity;
  let pityHit = false;
  if (pity.pityLegendary + 1 >= limits.pityLegendary) {
    rarity = 'LEGENDARY';
    pityHit = true;
  } else if (pity.pityEpic + 1 >= limits.pityEpic) {
    // guaranteed Epic or better: renormalise odds over EPIC + LEGENDARY
    const e = odds.EPIC ?? 0;
    const l = odds.LEGENDARY ?? 0;
    rarity = rng.next() < l / (e + l || 1) ? 'LEGENDARY' : 'EPIC';
    pityHit = true;
  } else {
    const entries = Object.entries(odds) as [Rarity, number][];
    rarity = rng.weighted(entries, ([, w]) => w)[0];
  }
  const isEpicPlus = rarity === 'EPIC' || rarity === 'LEGENDARY';
  return {
    rarity,
    pityHit,
    next: {
      pityEpic: isEpicPlus ? 0 : pity.pityEpic + 1,
      pityLegendary: rarity === 'LEGENDARY' ? 0 : pity.pityLegendary + 1,
    },
  };
}
