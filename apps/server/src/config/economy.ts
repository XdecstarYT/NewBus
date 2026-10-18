/**
 * ALL balance numbers live here. Every value can also be overridden live by the
 * owner (Owner Panel -> Economy settings); overrides are stored in the `settings`
 * table and merged on top of these defaults by services/settings.ts.
 *
 * Money is always integer Bits. Rates are expressed as fractions (0.02 = 2%)
 * or basis points (bps, 100 bps = 1%) where noted.
 *
 * See docs/ECONOMY.md for the reasoning behind each number.
 */
export const economy = {
  tick: {
    /** Real milliseconds between server ticks. */
    intervalMs: 5_000,
    /** Offline earnings stop accruing this many hours after the company was last active. */
    offlineCapHours: 8,
    /** Max catch-up for a single tick (e.g. server was down). */
    maxCatchupMs: 8 * 3600_000,
  },

  start: {
    bits: { CHILL: 3000, NORMAL: 1500, CHAOS: 600 } as Record<string, number>,
    treasuryInitial: 50_000_000,
    npcPoolInitial: 5_000_000,
  },

  difficulty: {
    /** income multiplier and event-frequency multiplier per difficulty */
    CHILL: { income: 1.15, events: 0.5, wages: 0.8 },
    NORMAL: { income: 1.0, events: 1.0, wages: 1.0 },
    CHAOS: { income: 1.0, events: 2.5, wages: 1.1 },
  } as Record<string, { income: number; events: number; wages: number }>,

  workers: {
    /** Bits per tick a level-1 Common worker produces before multipliers. Same for every industry (balance!). */
    baseOutputPerTick: 2,
    rarityOutput: { COMMON: 1, RARE: 1.6, EPIC: 2.5, LEGENDARY: 4, CURSED: 0.7 } as Record<string, number>,
    /** wage per tick as fraction of the worker's base output */
    wageRatio: 0.3,
    levelOutputBonus: 0.12, // +12% per level above 1
    maxLevel: 25,
    xpPerTickWorking: 2,
    xpToLevel: (level: number) => 60 * level * level,
    trainCost: (level: number) => Math.round(80 * Math.pow(1.35, level)),
    trainXp: (level: number) => 30 * level * level,
    energyDrainPerTick: 1,
    energyRestorePerTick: 4,
    coffeeCost: 25,
    coffeeDurationMs: 10 * 60_000,
    synergyMult: 1.25,
    chemistryBonus: 0.08,
    rivalryPenalty: 0.06,
    fireRefundRatio: 0, // firing returns nothing (but saves wages)
    renameCost: 10,
    promoteCostMult: 3, // promote = train cost * this, +1 level and rarity glow-up chance
  },

  workplaces: {
    /** desks per workplace by level (index = level) */
    desks: [0, 3, 5, 7, 10, 14],
    maxLevel: 5,
    /** output multiplier per kind (tier) index and per level */
    kindMult: [1, 1.15, 1.3, 1.5, 1.75],
    levelMult: 0.1, // +10% per level above 1
    unlockCost: [0, 2500, 15000, 60000, 250000],
    unlockLevel: [1, 3, 6, 10, 15],
    upgradeCost: (kind: number, level: number) => Math.round((400 + kind * 900) * Math.pow(2.1, level)),
    upkeepPerTick: (kind: number, level: number) => Math.round((1 + kind) * level * 0.5),
  },

  boost: {
    /** fraction of the workplace's per-tick output paid per tap */
    perTapRatio: 0.15,
    minPerTap: 1,
    comboWindowMs: 1500,
    maxCombo: 25,
    comboStep: 0.04, // +4% per combo step
    maxTapsPerSecond: 12,
    dailyCapTicks: 600, // max boost income per day = this many ticks of company income
  },

  pods: {
    types: {
      basic: { name: 'Basic Pod', emoji: '🥚', cost: 250, odds: { COMMON: 0.78, RARE: 0.17, EPIC: 0.04, LEGENDARY: 0.005, CURSED: 0.005 }, minLevel: 1 },
      shiny: { name: 'Shiny Pod', emoji: '🔮', cost: 1500, odds: { COMMON: 0.45, RARE: 0.38, EPIC: 0.13, LEGENDARY: 0.03, CURSED: 0.01 }, minLevel: 3 },
      mega: { name: 'Mega Pod', emoji: '💎', cost: 8000, odds: { COMMON: 0.1, RARE: 0.45, EPIC: 0.33, LEGENDARY: 0.1, CURSED: 0.02 }, minLevel: 8 },
    } as Record<string, { name: string; emoji: string; cost: number; odds: Record<string, number>; minLevel: number }>,
    /** guaranteed Epic-or-better after this many pulls without one */
    pityEpic: 10,
    /** guaranteed Legendary after this many pulls without one */
    pityLegendary: 60,
  },

  company: {
    xpPerBitEarned: 0.05,
    levelXp: (level: number) => Math.round(500 * Math.pow(level, 1.8)),
    maxLevel: 50,
  },

  contracts: {
    boardSize: 4,
    refreshMs: 30 * 60_000,
    minDurationMs: 2 * 60_000,
    maxDurationMs: 20 * 60_000,
    /** target = company income over the duration * this */
    targetRatio: 0.85,
    bonusRatio: 1.25,
    rewardRatio: 0.6, // reward = target * this
    bonusRewardRatio: 0.35,
  },

  events: {
    /** chance per company per tick of a random office event (before difficulty multiplier) */
    chancePerTick: 0.004,
    maxPending: 1,
  },

  streak: {
    wheel: [
      { label: '50 BT', bits: 50, weight: 30 },
      { label: '150 BT', bits: 150, weight: 25 },
      { label: '400 BT', bits: 400, weight: 15 },
      { label: 'Coffee for all', coffee: true, weight: 12 },
      { label: '1,000 BT', bits: 1000, weight: 8 },
      { label: 'Free Basic Pod', pod: 'basic', weight: 6 },
      { label: '2x for 10 min', mult: 2, minutes: 10, weight: 3 },
      { label: 'JACKPOT 5,000', bits: 5000, weight: 1 },
    ] as Array<{ label: string; weight: number; bits?: number; coffee?: boolean; pod?: string; mult?: number; minutes?: number }>,
    streakBonusPerDay: 0.1, // +10% per streak day, capped
    streakBonusCap: 1.0,
  },

  prestige: {
    minRunEarned: 200_000,
    /** prestige points = floor(sqrt(runEarned / divisor)) */
    divisor: 20_000,
    multPerPoint: 0.02, // +2% income per point, forever
  },

  decor: {
    maxEquipped: 8,
    maxPets: 3,
  },

  economy: {
    transferFeeBps: 100, // 1%
    salesTaxBps: 500, // 5%
    tradingFeeBps: 50, // 0.5%
    marketplaceFeeBps: 300, // 3%
    wealthTaxThreshold: 5_000_000,
    wealthTaxBpsPerDay: 20, // 0.2%/day above threshold
    /** NPC demand pool refill per tick, per active company */
    npcPoolRefillPerCompanyPerTick: 30,
    npcPoolMax: 20_000_000,
    /** owner multiplier on all NPC demand */
    demandMultiplier: 1.0,
    /** target inflation band (net bits created / supply per day) for the auto-balancer */
    inflationTargetLow: -0.01,
    inflationTargetHigh: 0.05,
  },

  bank: {
    savingsRateBpsPerDay: 30, // 0.3%/day on the savings pot
    savingsMaxBalance: 2_000_000,
    termOptions: [
      { hours: 1, rateBps: 40 },
      { hours: 6, rateBps: 300 },
      { hours: 24, rateBps: 1500 },
    ],
    interestPayoutMs: 60 * 60_000, // savings interest paid hourly
  },

  loans: {
    baseRateBps: 800, // 8% flat interest on principal
    creditRateAdjust: (credit: number) => Math.round((700 - credit) * 4), // bps
    installments: 6,
    installmentMs: 30 * 60_000,
    lateFeeBps: 300,
    defaultAfterMissed: 3,
    maxByCredit: (credit: number, level: number) => Math.round(1000 * level * Math.max(0.2, (credit - 300) / 300)),
    creditOnTime: 6,
    creditMissed: -25,
    creditDefault: -120,
    creditMin: 300,
    creditMax: 850,
  },

  insurance: {
    kinds: {
      fire: { name: 'Server on Fire cover', premium: 60, covers: ['server-fire', 'power-outage'] },
      audit: { name: 'Audit cover', premium: 50, covers: ['surprise-audit'] },
      market: { name: 'Market Crash cover', premium: 80, covers: ['market-crash'] },
    } as Record<string, { name: string; premium: number; covers: string[] }>,
    durationMs: 24 * 3600_000,
    payoutRatio: 0.8,
  },

  lotto: {
    ticketCost: 100,
    maxTicketsPerDay: 5,
    prizes: [
      { bits: 5000, chance: 0.002 },
      { bits: 1000, chance: 0.02 },
      { bits: 250, chance: 0.1 },
      { bits: 100, chance: 0.2 },
    ],
  },

  products: {
    tierPriceMult: [1, 2.2, 4.5, 9, 20],
    baseUnitPrice: 12,
    costRatio: 0.45, // input/base cost as fraction of price
    baseMsPerUnit: 20_000,
    tierTimeMult: [1, 1.6, 2.5, 4, 7],
    /** players can set price within [base * floor, base * ceiling] (also per-company priceLimitMult) */
    priceFloor: 0.25,
    priceCeiling: 4,
    wholesaleBuyRatio: 0.4, // NPC wholesaler buys finished goods at 40% of base price
    commodityBuyRatio: 0.6, // NPC wholesaler buys commodities at 60% of base
    commoditySellRatio: 1.5, // NPC wholesaler sells commodities at 150% of base
    supplyDealBonusBps: 300, // both sides get +3% of a player-to-player supply deal (from Treasury)
    spoilagePerTick: 0.004, // perishables lose 0.4% per tick
    warehouseCapacity: [0, 200, 500, 1200, 3000, 8000, 20000],
    warehouseUpgradeCost: [0, 0, 3000, 12000, 50000, 200000, 800000],
    storageCostPerTickPer100: 0.5,
    maxQueuePerWorkplace: 5,
    /** customers per tick at reputation 3 stars, before traffic multipliers */
    baseCustomersPerTick: 1.2,
    reviewChance: 0.15,
    elasticity: 1.6,
    autoBuyInputs: true,
  },

  commodities: {
    baseProducePerWorkerPerTick: 0.15,
  },

  marketing: {
    kinds: {
      billboard: { name: 'Billboard', emoji: '🪧', costPerMin: 40, trafficMult: 1.4 },
      social: { name: 'Social Blast', emoji: '📱', costPerMin: 60, trafficMult: 1.7 },
      influencer: { name: 'Influencer Shoutout', emoji: '🤳', costPerMin: 120, trafficMult: 2.2 },
      radio: { name: 'Radio Jingle', emoji: '📻', costPerMin: 30, trafficMult: 1.25 },
    } as Record<string, { name: string; emoji: string; costPerMin: number; trafficMult: number }>,
    maxMinutes: 120,
  },

  property: {
    districts: [
      { id: 'downtown', name: 'Downtown Pixelville', traffic: 1.6, basePrice: 40000 },
      { id: 'harbor', name: 'Byte Harbor', traffic: 1.3, basePrice: 25000 },
      { id: 'suburbs', name: 'Cozy Cache Suburbs', traffic: 1.1, basePrice: 12000 },
      { id: 'weird', name: 'The Weird Quarter', traffic: 1.45, basePrice: 30000 },
    ],
    plotsPerDistrict: 12,
    rentPerTickRatio: 0.0004, // rent = price * ratio per tick
    trafficBonusPerProperty: 0.12,
  },

  exchange: {
    defaultPriceMode: 'FUNDAMENTALS' as 'PLAYER' | 'FUNDAMENTALS' | 'OWNER',
    founderMinPct: 20,
    lockupMs: 30 * 60_000,
    maxOrderQty: 100_000,
    circuitBreakerPct: 25, // halt if price moves >25% from day open
    haltMs: 10 * 60_000,
    /** fundamentals mode: price moves this fraction of the gap to fair value per tick */
    anchorPull: 0.006,
    noisePct: 0.002,
    /** automated market maker quote spread */
    mmSpreadBps: 150,
    /** max shares the market maker trades per order as fraction of float */
    mmMaxPerOrderPct: 5,
    dividendIntervalMs: 15 * 60_000,
    defaultDividendPct: 20, // % of profit since last payout
    fundamentals: {
      incomeTicksValued: 20_000, // fair value counts this many ticks (~28h) of net income
      perWorker: 150,
      perContract: 400,
      perLevel: 800,
      creditWeight: 0.5, // multiplier from credit score: 0.75 .. 1.25
    },
    takeoverThresholdPct: 51,
    /** after an IPO the target blends from the IPO price to fundamentals over this long */
    honeymoonMs: 6 * 3600_000,
    proposalDurationMs: 30 * 60_000,
    bonds: { parValue: 100, couponBpsPerPeriod: 30, periodMs: 30 * 60_000, termPeriods: 48 },
    coins: { maxHoldingValue: 50_000, volatility: 0.04 },
    ipo: { defaultShares: 10_000, defaultPrice: 25, defaultFounderPct: 60 },
    maxPortfolioPctOneAsset: 100,
  },

  minigames: {
    payoutPerPoint: 3,
    maxPayoutPerPlay: 600,
    dailyCap: 3000,
    /** plausibility limits: max points per second for each game (anti-cheat) */
    maxPointsPerSecond: {
      'debug-rush': 3,
      'coffee-run': 2,
      'email-sorter': 3,
      'meme-maker': 1.5,
      'server-whack': 3,
      'invoice-match': 1.5,
      'stock-sprint': 1,
      'box-stack': 2,
      'pizza-rush': 1.5,
      'parking-panic': 1.5,
      'cable-untangle': 1.5,
      'quiz-show': 1,
    } as Record<string, number>,
    minDurationMs: 4000,
    maxDurationMs: 180_000,
  },

  research: {
    pointsPerTick: 0.02, // per THINKER worker
  },

  guilds: {
    createCost: 5000,
    maxMembers: 20,
    perkPerLevel: 0.01, // +1% income per guild level
    xpPerBitDeposited: 0.01,
    levelXp: (level: number) => 1000 * level * level,
  },

  wars: {
    defaultDurationMs: 60 * 60_000,
    defaultPrize: 10_000,
    defaultConsolation: 1500,
  },

  chat: {
    maxPerMinute: 10,
    slowModeMs: 0,
    historySize: 100,
  },

  global: {
    creditRainPerCompany: 500,
    doubleBitsMinutes: 60,
  },
};

export type Economy = typeof economy;
