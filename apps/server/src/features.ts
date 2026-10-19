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
import { registerSocialRoutes } from './routes/social';
import { setChatHandler, setGuildLookup } from './ws/hub';
import { sendMessage, pruneChat } from './services/chat';
import { guildIdOf, guildQuestTick } from './services/guilds';
import { warTick, autoScheduleWar } from './services/wars';
import { fairTick, autoFair } from './services/fairs';
import { onMenteeLevelUp } from './services/mentorship';
import { newsTick } from './services/newsgen';
import { registerPackageRoutes } from './routes/packages';
import { registerMegaRoutes } from './routes/mega';
import { registerOpsRoutes } from './routes/ops';
import { registerPosRoutes } from './routes/pos';
import { registerStrategyRoutes } from './routes/strategy';
import { lawsTick, decayPresence, coolAuditRisk } from './services/strategy';
import { unionsTick } from './services/unions';
import { courtTick } from './services/justice';
import { createBackup } from './services/ops';
import { env } from './env';
import { log } from './lib/log';
import { researchTick } from './services/research';
import { goalsTick, achievementSweep, loadSeason, checkAchievements } from './services/goals';

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

  // Real sink: Bits collected by the Treasury above its reserve are destroyed.
  registerGlobalHook('treasury-burn', 60_000, () => {
    const extra = balanceOf(SYS.TREASURY) - cfg().economy.treasuryReserve;
    if (extra > 0) post({ kind: 'sink.burn', memo: 'Treasury surplus destroyed', legs: [{ from: SYS.TREASURY, to: SYS.MINT, amount: extra }] });
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
  // Phase 8: social
  registerSocialRoutes();
  setChatHandler(({ accountId, channel, text }) => {
    try {
      sendMessage(accountId, channel, text);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'Chat failed.' };
    }
  });
  setGuildLookup(guildIdOf);
  onLevelUp(onMenteeLevelUp);
  registerGlobalHook('guild-quests', 60_000, guildQuestTick);
  registerGlobalHook('wars', 15_000, warTick);
  registerGlobalHook('fairs', 15_000, fairTick);
  registerGlobalHook('news-gen', 120_000, newsTick);
  registerJob('auto-war', Math.max(60_000, cfg().wars.autoScheduleEveryMs || 6 * 3600_000), () => cfg().wars.autoScheduleEveryMs && autoScheduleWar());
  registerJob('auto-fair', Math.max(60_000, cfg().tradeFairs.everyMs || 4 * 3600_000), () => cfg().tradeFairs.everyMs && autoFair());
  registerJob('prune-chat', 6 * 3600_000, () => pruneChat());
  registerPackageRoutes();
  // The Big Byte Update
  registerMegaRoutes();
  registerCompanyHook('research', researchTick);
  registerGlobalHook('seasons', 60_000, goalsTick);
  registerGlobalHook('achievements', 60_000, achievementSweep);
  onLevelUp((companyId) => checkAchievements(companyId));
  loadSeason();
  registerOpsRoutes();
  registerPosRoutes();
  registerStrategyRoutes();

  // strategy layer: union elections and dues, court hearings and verdicts, bills, district territory
  registerGlobalHook('unions', 30_000, (now) => unionsTick(now));
  registerGlobalHook('court', 30_000, (now) => courtTick(now));
  registerGlobalHook('laws', 30_000, (now) => lawsTick(now));
  let lastDecay = 0;
  registerGlobalHook('districts', 60_000, (now) => {
    if (lastDecay) decayPresence((now - lastDecay) / 60_000);
    lastDecay = now;
  });
  registerGlobalHook('audit-cooloff', 3600_000, () => coolAuditRisk());
  if (env.databasePath !== ':memory:' && env.backupEveryHours > 0) {
    registerJob('scheduled-backup', env.backupEveryHours * 3600_000, () => {
      createBackup('auto').catch((e) => log.error('scheduled backup failed', { err: String(e) }));
    });
  }
  void eq;
}
