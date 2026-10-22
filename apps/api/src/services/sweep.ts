/**
 * Settle timed events (elections, hearings, appeal windows, bills, union dues,
 * contracts, office jobs) and keep AI clients and customers coming.
 * Runs on API traffic at most once a minute and from the scheduled Netlify function.
 */
import { and, eq, lt } from 'drizzle-orm';
import { schema, type Db } from '../db';
import { clock, MINUTE } from '../lib/time';
import { getValue, setValue } from './core';
import { sweepUnions } from './unions';
import { sweepCourt } from './justice';
import { sweepLaws } from './laws';
import { retryAiGrading, sweepWork } from './work';
import { sweepCustomers } from './customers';
import { sweepContracts } from './contracts';
import { sweepRequests } from './ownerai';
import { sweepLoans } from './bank';
import { sweepAuctions } from './auctions';
import { sweepTown } from './town';

let lastLocal = 0;

/**
 * `allowAi` is only set by the scheduled function: AI calls are slow, so players'
 * requests never wait on them. Player traffic still keeps jobs and customers coming.
 */
export async function sweep(db: Db, force = false, opts: { allowAi?: boolean } = {}) {
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
    await sweepContracts(t, now);
    await sweepRequests(t, now);
    await sweepLoans(t, now);
    await sweepAuctions(t, now);
    await sweepTown(t, now);
    if (!opts.allowAi) {
      await sweepWork(t, now, false);
      await sweepCustomers(t, now, false);
    }
    return true;
  });
  if (ran && opts.allowAi) {
    await db.transaction((t) => sweepWork(t as unknown as Db, now, true));
    await db.transaction((t) => sweepCustomers(t as unknown as Db, now, true));
    await retryAiGrading(db, now);
  }
  return ran;
}
