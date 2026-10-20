import type { Db } from '../db';
import type { Ctx } from './router';

/** Run a handler body in one database transaction (all or nothing). */
export function tx<T>(c: Ctx, fn: (db: Db) => Promise<T>): Promise<T> {
  return c.db.transaction((t) => fn(t as unknown as Db));
}
