import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { setupGame, makeCompany } from './helpers';
import * as D from '../src/db';
import { ensureMirrorSchema, queueEverything, flushAll, hydrate, installTriggers, localTables, remoteHasData, type Pg } from '../src/db/supabase';
import { balanceOf, verifyLedger, SYS } from '../src/services/ledger';
import { companyWallet } from '../src/services/money';
import * as bank from '../src/services/bank';
import { deleteCompany } from '../src/services/companies';

/** A real Postgres engine (in-process) standing in for Supabase. */
function pglite(): Pg {
  const db = new PGlite();
  const wrap = (x: { query: PGlite['query'] }) => async (text: string, params: unknown[] = []) => (await x.query(text, params as any[])).rows as Array<Record<string, unknown>>;
  return { query: wrap(db), tx: (fn) => db.transaction((t) => fn(wrap(t as any))) as any, end: () => db.close() };
}

async function remoteCounts(pg: Pg) {
  const out: Record<string, number> = {};
  for (const t of localTables()) out[t.name] = Number((await pg.query(`SELECT COUNT(*)::int n FROM game."${t.name}"`))[0].n);
  return out;
}
function localCounts() {
  const out: Record<string, number> = {};
  for (const t of localTables()) out[t.name] = (D.sqlite.prepare(`SELECT COUNT(*) n FROM "${t.name}"`).get() as { n: number }).n;
  return out;
}

describe('Supabase sync (Postgres system of record)', () => {
  let pg: Pg;
  beforeAll(() => {
    setupGame();
    pg = pglite();
  });

  it('creates the mirror schema and uploads the whole game', async () => {
    await ensureMirrorSchema(pg);
    expect(await remoteHasData(pg)).toBe(false);
    queueEverything();
    await flushAll(pg);
    expect(await remoteHasData(pg)).toBe(true);
    expect(await remoteCounts(pg)).toEqual(localCounts());
  });

  it('streams inserts, updates and deletes', async () => {
    const a = makeCompany({ name: 'Sync A', startingBits: 5000 });
    const b = makeCompany({ name: 'Sync B', startingBits: 100 });
    D.db.update(D.schema.companies).set({ level: 9 }).where(eq(D.schema.companies.id, b.company.id)).run();
    bank.transfer(a.company.id, b.company.id, 1000, 'sync test', 'actor');
    await flushAll(pg);
    const remoteBal = await pg.query(`SELECT balance FROM game.wallets WHERE id = $1`, [companyWallet(b.company.id)]);
    expect(Number(remoteBal[0].balance)).toBe(balanceOf(companyWallet(b.company.id)));
    const lvl = await pg.query(`SELECT level FROM game.companies WHERE id = $1`, [b.company.id]);
    expect(Number(lvl[0].level)).toBe(9);
    deleteCompany(a.company.id, null);
    await flushAll(pg);
    expect((await pg.query(`SELECT 1 FROM game.companies WHERE id = $1`, [a.company.id])).length).toBe(0);
    expect(await remoteCounts(pg)).toEqual(localCounts());
  });

  it('rebuilds an empty server from Supabase (restart on a fresh disk)', async () => {
    const before = localCounts();
    const treasury = balanceOf(SYS.TREASURY);
    D.closeDb();
    D.openDb(':memory:');
    D.runMigrations();
    expect(localCounts().accounts).toBe(0);
    await hydrate(pg);
    installTriggers();
    expect(localCounts()).toEqual(before);
    expect(balanceOf(SYS.TREASURY)).toBe(treasury);
    expect(verifyLedger().sum).toBe(0);
    // and it keeps syncing afterwards
    makeCompany({ name: 'After Restart' });
    await flushAll(pg);
    expect(await remoteCounts(pg)).toEqual(localCounts());
  });
});
