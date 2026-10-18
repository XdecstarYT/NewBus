/**
 * Feature modules register tick hooks / multipliers / routes at load time.
 * Imported once from bootstrap().
 */
import { onLevelUp } from './services/money';
import { toCompany } from './lib/bus';
import { notify } from './services/notifications';
import { addNews } from './services/news';
import { findCompany } from './services/companies';
import { registerJob } from './jobs';
import { autoBalance, snapshotEconomy } from './services/economy-health';
import { registerGlobalHook } from './services/tick';
import { cfg } from './services/settings';
import { SYS, post, balanceOf } from './services/ledger';
import { db, schema } from './db';
import { eq, sql } from 'drizzle-orm';
import { registerStaffRoutes } from './routes/staff';
import { registerGameplayRoutes } from './routes/gameplay';
import { registerCompanyHook } from './services/tick';
import { contractsTick } from './services/contracts';
import { eventsTick } from './services/events';
import './services/progression';
import { registerBankRoutes } from './routes/bank';
import { bankJobs } from './services/bank';
import { registerOwnerEconomyRoutes } from './routes/owner-economy';

export function loadFeatures() {
  onLevelUp((companyId, level) => {
    toCompany(companyId, { type: 'levelup', level });
    notify(companyId, 'levelup', `⭐ Level ${level}!`, 'New workplaces, pods and goodies may be unlocked.', level * 100);
    if (level % 5 === 0) {
      const co = findCompany(companyId);
      if (co) addNews('headline', `${co.emoji} ${co.name} hits level ${level}!`, 'Rivals are reportedly "only slightly jealous".', companyId);
    }
  });

  // NPC demand pool refill: budgeted per active company so Bits creation stays bounded.
  registerGlobalHook('npc-pool-refill', 0, (now) => {
    const c = cfg();
    const active = db.select({ n: sql<number>`count(*)` }).from(schema.companies).where(sql`${schema.companies.status} = 'active' AND ${schema.companies.lastActiveAt} > ${now - c.tick.offlineCapHours * 3600_000}`).get()!.n;
    const room = c.economy.npcPoolMax - balanceOf(SYS.NPC);
    const amount = Math.min(room, Math.round(active * c.economy.npcPoolRefillPerCompanyPerTick * c.economy.demandMultiplier));
    if (amount > 0) post({ kind: 'faucet.npc_refill', legs: [{ from: SYS.MINT, to: SYS.NPC, amount }] });
  });

  registerGlobalHook('auto-balancer', 15 * 60_000, () => {
    autoBalance();
  });
  registerJob('economy-snapshot', 3600_000, () => snapshotEconomy());
  registerStaffRoutes();
  registerGameplayRoutes();
  registerCompanyHook('contracts', contractsTick);
  registerCompanyHook('events', eventsTick);
  registerBankRoutes();
  registerOwnerEconomyRoutes();
  registerGlobalHook('bank-deposits', 30_000, bankJobs.matureDeposits);
  registerGlobalHook('bank-loans', 30_000, bankJobs.collectInstallments);
  registerGlobalHook('bank-savings-interest', cfg().bank.interestPayoutMs, bankJobs.paySavingsInterest);
  registerGlobalHook('wealth-tax', 24 * 3600_000, bankJobs.wealthTax);
  void eq;
}
