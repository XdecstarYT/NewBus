/**
 * Settle timed events (elections, hearings, appeal windows, bills, union dues).
 * Runs on API traffic at most once a minute and from the scheduled Netlify function.
 */
import { and, eq, lt } from 'drizzle-orm';
import { schema, type Db } from '../db';
import { clock, MINUTE } from '../lib/time';
import { getValue, setValue } from './core';
import { sweepUnions } from './unions';
import { sweepCourt } from './justice';
import { sweepLaws } from './laws';

let lastLocal = 0;

export async function sweep(db: Db, force = false) {
  const now = clock.now();
  if (!force && now - lastLocal < MINUTE) return false;
  lastLocal = now;
  const ran = await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const last = (await getValue<number>(t, 'sweepAt')) ?? 0;
    if (!force && now - last < MINUTE) return false;
    await setValue(t, 'sweepAt', now);
    await sweepUnions(t, now);
    await sweepCourt(t, now);
    await sweepLaws(t, now);
    await t.update(schema.checkouts).set({ status: 'cancelled' }).where(and(eq(schema.checkouts.status, 'open'), lt(schema.checkouts.expiresAt, now - 60 * MINUTE)));
    return true;
  });
  return ran;
}
