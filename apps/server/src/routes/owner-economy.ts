import { desc, eq } from 'drizzle-orm';
import { registerOwnerRoutes } from './owner-extras';
import { h, ctx } from './http';
import { db, schema } from '../db';
import { economyHealth, economyHistory, autoBalance } from '../services/economy-health';
import { forgiveLoan } from '../services/bank';
import { flag } from '../services/flags';

export function registerOwnerEconomyRoutes() {
  registerOwnerRoutes((r) => {
    r.get('/economy', h(() => ({ health: economyHealth(), history: economyHistory(), autoBalancer: flag('autoBalancer') })));
    r.post('/economy/autobalance', h(() => ({ changed: autoBalance() })));
    r.get('/loans', h(() => {
      const names = new Map(db.select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji }).from(schema.companies).all().map((c) => [c.id, `${c.emoji} ${c.name}`]));
      return db.select().from(schema.loans).orderBy(desc(schema.loans.createdAt)).limit(300).all().map((l) => ({ ...l, borrower: names.get(l.borrowerId) ?? l.borrowerId, lender: l.lenderType === 'treasury' ? '🏦 Treasury' : names.get(l.lenderId ?? '') ?? l.lenderId }));
    }));
    r.post('/loans/:id/forgive', h((req) => (forgiveLoan(req.params.id, ctx(req).account.id), { ok: true })));
    void eq;
  });
}
