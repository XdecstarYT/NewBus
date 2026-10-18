/**
 * Worker relationships: chemistry (+output when sharing a workplace),
 * rivalry (-output, sparks drama events) and crushes (gossip events).
 */
import { eq, inArray, or } from 'drizzle-orm';
import { db, schema } from '../db';
import { liveRng } from '../engine/rng';
import { cfg } from './settings';

export function maybeCreateRelationship(companyId: string, workerId: string) {
  const rng = liveRng();
  if (!rng.chance(0.35)) return null;
  const others = db.select({ id: schema.workers.id }).from(schema.workers).where(eq(schema.workers.companyId, companyId)).all().filter((w) => w.id !== workerId);
  if (!others.length) return null;
  const other = rng.pick(others);
  const kind = rng.weighted(['chemistry', 'rivalry', 'crush'] as const, (k) => (k === 'chemistry' ? 5 : k === 'rivalry' ? 3 : 2));
  const [a, b] = [workerId, other.id].sort();
  db.insert(schema.relationships).values({ workerA: a, workerB: b, kind }).onConflictDoNothing().run();
  return { kind, with: other.id };
}

export function relationshipsFor(workerIds: string[]) {
  if (!workerIds.length) return [];
  return db
    .select()
    .from(schema.relationships)
    .where(or(inArray(schema.relationships.workerA, workerIds), inArray(schema.relationships.workerB, workerIds)))
    .all();
}

/** Output modifier per worker: chemistry/rivalry only count when both share a workplace. */
export function relationBonus(workers: Array<{ id: string; workplaceId: string | null }>): Map<string, number> {
  const c = cfg();
  const wp = new Map(workers.map((w) => [w.id, w.workplaceId]));
  const out = new Map<string, number>();
  for (const r of relationshipsFor(workers.map((w) => w.id))) {
    const a = wp.get(r.workerA);
    const b = wp.get(r.workerB);
    if (!a || a !== b) continue;
    const v = r.kind === 'chemistry' ? c.workers.chemistryBonus : r.kind === 'rivalry' ? -c.workers.rivalryPenalty : c.workers.chemistryBonus / 2;
    out.set(r.workerA, (out.get(r.workerA) ?? 0) + v);
    out.set(r.workerB, (out.get(r.workerB) ?? 0) + v);
  }
  return out;
}
