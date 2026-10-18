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
import { registerCommerceRoutes } from './routes/commerce';
import { registerOwnerCatalogRoutes } from './routes/owner-catalog';
import { productionTick, supplyTick, salesTick, campaignTick, pruneCustomers } from './services/products';
import { auctionTick, propertyTick, propertyRevalue, seedProperties } from './services/trade';
import { registerSeedHook } from './db/seed-hooks';
import { registerExchangeRoutes } from './routes/exchange';
import { seedMarket, marketTick, randomMarketEvent } from './exchange/assets';
import { marginTick } from './exchange/orders';
import { payDividends, bondTick, proposalTick, alertTick, snapshotNetWorth } from './exchange/corporate';
import { seedDemoMarket } from './exchange/demo';

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
  registerCommerceRoutes();
  registerOwnerCatalogRoutes();
  registerCompanyHook('production', productionTick);
  registerCompanyHook('supply', supplyTick);
  registerCompanyHook('sales', salesTick);
  registerGlobalHook('campaigns', 15_000, campaignTick);
  registerGlobalHook('auctions', 15_000, auctionTick);
  registerGlobalHook('property-rent', 60_000, propertyTick);
  registerGlobalHook('property-revalue', 3600_000, () => propertyRevalue());
  registerJob('prune-customers', 3600_000, pruneCustomers);
  registerSeedHook('properties', (say) => {
    seedProperties();
  registerExchangeRoutes();
  seedMarket();
  registerGlobalHook('market', 0, marketTick);
  registerGlobalHook('dividends', 30_000, payDividends);
  registerGlobalHook('bonds', 60_000, bondTick);
  registerGlobalHook('proposals', 30_000, proposalTick);
  registerGlobalHook('price-alerts', 0, alertTick);
  registerGlobalHook('margin', 30_000, marginTick);
  registerGlobalHook('random-market-event', 3600_000, randomMarketEvent);
  registerJob('networth-snapshot', 3600_000, snapshotNetWorth);
  registerSeedHook('market-demo', (say) => seedDemoMarket(say));
    say('🏘️ Property districts ready');
  });
  seedProperties();
  registerExchangeRoutes();
  seedMarket();
  registerGlobalHook('market', 0, marketTick);
  registerGlobalHook('dividends', 30_000, payDividends);
  registerGlobalHook('bonds', 60_000, bondTick);
  registerGlobalHook('proposals', 30_000, proposalTick);
  registerGlobalHook('price-alerts', 0, alertTick);
  registerGlobalHook('margin', 30_000, marginTick);
  registerGlobalHook('random-market-event', 3600_000, randomMarketEvent);
  registerJob('networth-snapshot', 3600_000, snapshotNetWorth);
  registerSeedHook('market-demo', (say) => seedDemoMarket(say));
  registerGlobalHook('bank-deposits', 30_000, bankJobs.matureDeposits);
  registerGlobalHook('bank-loans', 30_000, bankJobs.collectInstallments);
  registerGlobalHook('bank-savings-interest', cfg().bank.interestPayoutMs, bankJobs.paySavingsInterest);
  registerGlobalHook('wealth-tax', 24 * 3600_000, bankJobs.wealthTax);
  void eq;
}
