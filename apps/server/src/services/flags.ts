import { ALL_FLAGS, FLAGS_DEFAULT_OFF, type FeatureFlag } from '@dw/shared';
import { db, schema } from '../db';
import { clock } from '../lib/time';

/** Global feature flags (owner can toggle any module or system live). */
let cache: Record<string, boolean> | null = null;

export function getFlags(): Record<FeatureFlag, boolean> {
  if (!cache) {
    const out: Record<string, boolean> = {};
    for (const f of ALL_FLAGS) out[f] = !FLAGS_DEFAULT_OFF.includes(f);
    for (const r of db.select().from(schema.featureFlags).all()) out[r.key] = r.enabled;
    cache = out;
  }
  return cache as Record<FeatureFlag, boolean>;
}

export function flag(f: FeatureFlag): boolean {
  return !!getFlags()[f];
}

export function setFlag(f: FeatureFlag, enabled: boolean) {
  const now = clock.now();
  db.insert(schema.featureFlags)
    .values({ key: f, enabled, updatedAt: now })
    .onConflictDoUpdate({ target: schema.featureFlags.key, set: { enabled, updatedAt: now } })
    .run();
  cache = null;
}

export function invalidateFlags() {
  cache = null;
}
