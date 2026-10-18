/**
 * Recruit Pods: gacha capsules for Bits only, odds shown openly, pity timers.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Rarity } from '@dw/shared';
import { db, schema, atomic } from '../db';
import { cfg } from './settings';
import { getCompany, insertWorker } from './companies';
import { getCompanyPermissions } from '../permissions';
import { chargeCompany } from './money';
import { rollRarity } from '../engine/pods';
import { liveRng } from '../engine/rng';
import { badRequest, forbidden } from '../lib/errors';
import { workerView } from './office';
import { bump } from './stats';
import { addNews } from './news';
import { maybeCreateRelationship } from './relationships';
import { getIndustry } from './catalog';

export function podCatalog(companyId: string) {
  const c = cfg();
  const co = getCompany(companyId);
  return {
    pods: Object.entries(c.pods.types).map(([id, p]) => ({ id, ...p, unlocked: co.level >= p.minLevel })),
    pity: { epic: co.pityEpic, legendary: co.pityLegendary, epicAt: c.pods.pityEpic, legendaryAt: c.pods.pityLegendary },
    level: co.level,
  };
}

export function openPod(companyId: string, podType: string, actorId: string | null, opts: { free?: boolean; forceRarity?: Rarity } = {}) {
  return atomic(() => {
    const c = cfg();
    const pod = c.pods.types[podType];
    if (!pod) throw badRequest('No such pod. Did you make that up?');
    const co = getCompany(companyId);
    if (co.level < pod.minLevel && !opts.free) throw badRequest(`${pod.name} unlocks at company level ${pod.minLevel}.`);
    const perms = getCompanyPermissions(companyId);
    const count = db.select({ n: sql<number>`count(*)` }).from(schema.workers).where(eq(schema.workers.companyId, companyId)).get()!.n;
    if (perms.limits.maxWorkers != null && count >= perms.limits.maxWorkers) throw forbidden(`Worker limit reached (${perms.limits.maxWorkers}). Fire someone or ask the Owner!`, 'limit');
    if (!opts.free) chargeCompany({ companyId, amount: pod.cost, kind: 'spend.pod', memo: `${pod.name}`, actorId });
    const roll = opts.forceRarity
      ? { rarity: opts.forceRarity, pityHit: false, next: { pityEpic: co.pityEpic, pityLegendary: co.pityLegendary } }
      : rollRarity(liveRng(), pod.odds, { pityEpic: co.pityEpic, pityLegendary: co.pityLegendary }, { pityEpic: c.pods.pityEpic, pityLegendary: c.pods.pityLegendary });
    db.update(schema.companies).set({ pityEpic: roll.next.pityEpic, pityLegendary: roll.next.pityLegendary }).where(eq(schema.companies.id, companyId)).run();
    const w = insertWorker(companyId, co.industryId, roll.rarity);
    maybeCreateRelationship(companyId, w.id);
    bump(companyId, 'pods');
    if (roll.rarity === 'LEGENDARY') {
      bump(companyId, 'legendaries');
      addNews('headline', `${co.emoji} ${co.name} hired a LEGENDARY ${getIndustry(co.industryId).workers.find((a) => a.id === w.archetype)?.name ?? 'worker'}!`, `Recruiters everywhere weep with envy.`, companyId);
    }
    if (roll.rarity === 'CURSED') bump(companyId, 'cursed');
    const full = db.select().from(schema.workers).where(and(eq(schema.workers.id, w.id))).get()!;
    return { worker: workerView(full), rarity: roll.rarity, pityHit: roll.pityHit, pity: roll.next };
  });
}
