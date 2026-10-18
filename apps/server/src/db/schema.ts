/**
 * Drizzle schema. SQLite today, written to stay Postgres-ready:
 * text ids, integer money (never floats), JSON stored as text columns.
 */
import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

const ts = (name: string) => integer(name, { mode: 'number' }); // unix ms
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();
const bool = (name: string) => integer(name, { mode: 'boolean' });

// ---------------------------------------------------------------- identity
export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountNumber: text('account_number').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull(), // OWNER | MODERATOR | COMPANY_ADMIN | STAFF
    companyId: text('company_id'),
    displayName: text('display_name').notNull(),
    jobTitle: text('job_title'),
    status: text('status').notNull().default('active'),
    mustChangePassword: bool('must_change_password').notNull().default(false),
    createdBy: text('created_by'),
    createdAt: ts('created_at').notNull(),
    lastLogin: ts('last_login'),
    lastSeen: ts('last_seen'),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: ts('locked_until'),
    totpSecret: text('totp_secret'),
    totpEnabled: bool('totp_enabled').notNull().default(false),
    linkedGroup: text('linked_group'),
    moderatorTools: json<string[]>('moderator_tools'),
    settings: json<Record<string, unknown>>('settings'),
    tutorialDone: bool('tutorial_done').notNull().default(false),
  },
  (t) => [uniqueIndex('accounts_number_idx').on(t.accountNumber), index('accounts_company_idx').on(t.companyId)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(), // sha256 of the cookie token
    accountId: text('account_id').notNull(),
    createdAt: ts('created_at').notNull(),
    expiresAt: ts('expires_at').notNull(),
    lastSeen: ts('last_seen').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_account_idx').on(t.accountId)],
);

// ---------------------------------------------------------------- catalog
export const industries = sqliteTable('industries', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  data: json<Record<string, unknown>>('data').notNull(),
  enabled: bool('enabled').notNull().default(true),
  custom: bool('custom').notNull().default(false),
  updatedAt: ts('updated_at').notNull(),
});

export const products = sqliteTable(
  'products',
  {
    id: text('id').primaryKey(),
    industryId: text('industry_id').notNull(),
    name: text('name').notNull(),
    data: json<Record<string, unknown>>('data').notNull(),
    enabled: bool('enabled').notNull().default(true),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [index('products_industry_idx').on(t.industryId)],
);

/** Recipe lines: product -> input (commodity id or product id) quantities. */
export const recipes = sqliteTable(
  'recipes',
  {
    productId: text('product_id').notNull(),
    inputId: text('input_id').notNull(),
    qty: integer('qty').notNull(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.inputId] })],
);

// ---------------------------------------------------------------- companies
export const companies = sqliteTable(
  'companies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    emoji: text('emoji').notNull(),
    color: text('color').notNull(),
    slogan: text('slogan').notNull().default(''),
    industryId: text('industry_id').notNull(),
    difficulty: text('difficulty').notNull().default('NORMAL'),
    status: text('status').notNull().default('active'),
    level: integer('level').notNull().default(1),
    xp: integer('xp').notNull().default(0),
    fame: integer('fame').notNull().default(0),
    reputation: integer('reputation').notNull().default(300), // 0..500 = 0..5 stars x100
    creditScore: integer('credit_score').notNull().default(650),
    prestigePoints: integer('prestige_points').notNull().default(0),
    prestigeCount: integer('prestige_count').notNull().default(0),
    lifetimeEarned: integer('lifetime_earned').notNull().default(0),
    runEarned: integer('run_earned').notNull().default(0),
    streak: integer('streak').notNull().default(0),
    lastStreakClaim: ts('last_streak_claim'),
    pityEpic: integer('pity_epic').notNull().default(0),
    pityLegendary: integer('pity_legendary').notNull().default(0),
    warehouseLevel: integer('warehouse_level').notNull().default(1),
    research: json<Record<string, number>>('research'),
    settings: json<Record<string, unknown>>('settings'),
    guildId: text('guild_id'),
    lastTickAt: ts('last_tick_at').notNull(),
    lastActiveAt: ts('last_active_at').notNull(),
    lastSeenSummaryAt: ts('last_seen_summary_at'),
    incomePerTick: integer('income_per_tick').notNull().default(0),
    wagesPerTick: integer('wages_per_tick').notNull().default(0),
    ipoStatus: text('ipo_status').notNull().default('none'), // none | requested | listed | rejected
    ipoRequest: json<Record<string, unknown>>('ipo_request'),
    trophies: json<string[]>('trophies'),
    title: text('title'),
    theme: text('theme'),
    createdBy: text('created_by'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('companies_industry_idx').on(t.industryId)],
);

/** Permission rows: subject_type = 'company' | 'account'. */
export const permissions = sqliteTable(
  'permissions',
  {
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    data: json<Record<string, unknown>>('data').notNull(),
    updatedAt: ts('updated_at').notNull(),
    updatedBy: text('updated_by'),
  },
  (t) => [primaryKey({ columns: [t.subjectType, t.subjectId] })],
);

export const permissionTemplates = sqliteTable('permission_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  data: json<Record<string, unknown>>('data').notNull(),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
});

export const featureFlags = sqliteTable('feature_flags', {
  key: text('key').primaryKey(),
  enabled: bool('enabled').notNull(),
  updatedAt: ts('updated_at').notNull(),
});

/** Live owner-editable settings overriding config/economy.ts defaults. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: json<unknown>('value').notNull(),
  updatedAt: ts('updated_at').notNull(),
});

// ---------------------------------------------------------------- ledger
/** A wallet is a ledger account. owner_type: system | company | account | guild. */
export const wallets = sqliteTable(
  'wallets',
  {
    id: text('id').primaryKey(),
    ownerType: text('owner_type').notNull(),
    ownerId: text('owner_id').notNull(),
    pot: text('pot').notNull().default('main'),
    balance: integer('balance').notNull().default(0),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [uniqueIndex('wallets_owner_idx').on(t.ownerType, t.ownerId, t.pot)],
);

export const ledgerTx = sqliteTable(
  'ledger_tx',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    memo: text('memo'),
    idempotencyKey: text('idempotency_key'),
    actorId: text('actor_id'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [uniqueIndex('ledger_tx_idem_idx').on(t.idempotencyKey), index('ledger_tx_created_idx').on(t.createdAt)],
);

/** One row = amount moves from `from_wallet` (debited) to `to_wallet` (credited). Append-only. */
export const ledgerEntries = sqliteTable(
  'ledger_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    txId: text('tx_id').notNull(),
    fromWallet: text('from_wallet').notNull(),
    toWallet: text('to_wallet').notNull(),
    amount: integer('amount').notNull(),
    kind: text('kind').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    index('ledger_from_idx').on(t.fromWallet, t.createdAt),
    index('ledger_to_idx').on(t.toWallet, t.createdAt),
    index('ledger_tx_idx').on(t.txId),
    index('ledger_kind_idx').on(t.kind, t.createdAt),
  ],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    oldValue: json<unknown>('old_value'),
    newValue: json<unknown>('new_value'),
    ip: text('ip'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('audit_created_idx').on(t.createdAt), index('audit_target_idx').on(t.targetType, t.targetId)],
);

// ---------------------------------------------------------------- world
export const workplaces = sqliteTable(
  'workplaces',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id').notNull(),
    kind: integer('kind').notNull(), // index into industry.workplaces
    level: integer('level').notNull().default(1),
    name: text('name').notNull(),
    skin: text('skin'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('workplaces_company_idx').on(t.companyId)],
);

export const workers = sqliteTable(
  'workers',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id'),
    name: text('name').notNull(),
    species: text('species').notNull(),
    archetype: text('archetype').notNull(),
    role: text('role').notNull(),
    rarity: text('rarity').notNull(),
    quirk: text('quirk').notNull(),
    level: integer('level').notNull().default(1),
    xp: integer('xp').notNull().default(0),
    energy: integer('energy').notNull().default(100),
    mood: integer('mood').notNull().default(70),
    skills: json<{ speed: number; craft: number; charm: number }>('skills').notNull(),
    appearance: json<{ color: string; eyes: number; accessory: number }>('appearance').notNull(),
    workplaceId: text('workplace_id'),
    desk: integer('desk'),
    coffeeUntil: ts('coffee_until'),
    napUntil: ts('nap_until'),
    listed: bool('listed').notNull().default(false),
    industryId: text('industry_id').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('workers_company_idx').on(t.companyId)],
);

export const relationships = sqliteTable(
  'relationships',
  {
    workerA: text('worker_a').notNull(),
    workerB: text('worker_b').notNull(),
    kind: text('kind').notNull(), // chemistry | rivalry | crush
  },
  (t) => [primaryKey({ columns: [t.workerA, t.workerB] })],
);

export const contracts = sqliteTable(
  'contracts',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id').notNull(),
    data: json<Record<string, unknown>>('data').notNull(),
    status: text('status').notNull(), // offered | active | success | failed | claimed
    target: integer('target').notNull(),
    bonusTarget: integer('bonus_target').notNull(),
    progress: integer('progress').notNull().default(0),
    reward: integer('reward').notNull(),
    bonusReward: integer('bonus_reward').notNull(),
    durationMs: integer('duration_ms').notNull(),
    startedAt: ts('started_at'),
    endsAt: ts('ends_at'),
    expiresAt: ts('expires_at').notNull(),
    counterpartyId: text('counterparty_id'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('contracts_company_idx').on(t.companyId, t.status)],
);

export const companyEvents = sqliteTable(
  'company_events',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id').notNull(),
    eventKey: text('event_key').notNull(),
    data: json<Record<string, unknown>>('data').notNull(),
    status: text('status').notNull(), // pending | resolved
    choice: integer('choice'),
    outcome: json<Record<string, unknown>>('outcome'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('events_company_idx').on(t.companyId, t.status)],
);

/** Temporary multipliers (company-scoped or global when company_id is null). */
export const modifiers = sqliteTable(
  'modifiers',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id'),
    kind: text('kind').notNull(), // income | traffic | mood | price:<assetSymbol> ...
    value: real('value').notNull(),
    source: text('source').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('modifiers_company_idx').on(t.companyId, t.expiresAt)],
);

/** Owned decorations, pets, equipment, cosmetics. */
export const items = sqliteTable(
  'items',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id'),
    itemKey: text('item_key').notNull(),
    kind: text('kind').notNull(), // decor | pet | equipment | cosmetic
    level: integer('level').notNull().default(1),
    equipped: bool('equipped').notNull().default(false),
    workplaceId: text('workplace_id'),
    listed: bool('listed').notNull().default(false),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('items_company_idx').on(t.companyId)],
);

// ---------------------------------------------------------------- finance
export const savings = sqliteTable(
  'savings',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id').notNull(),
    kind: text('kind').notNull(), // term
    amount: integer('amount').notNull(),
    rateBps: integer('rate_bps').notNull(),
    startsAt: ts('starts_at').notNull(),
    maturesAt: ts('matures_at').notNull(),
    status: text('status').notNull(), // active | paid
  },
  (t) => [index('savings_company_idx').on(t.companyId)],
);

export const loans = sqliteTable(
  'loans',
  {
    id: text('id').primaryKey(),
    borrowerId: text('borrower_id').notNull(),
    lenderType: text('lender_type').notNull(), // treasury | company
    lenderId: text('lender_id'),
    principal: integer('principal').notNull(),
    outstanding: integer('outstanding').notNull(),
    rateBps: integer('rate_bps').notNull(),
    installment: integer('installment').notNull(),
    installmentsLeft: integer('installments_left').notNull(),
    nextDueAt: ts('next_due_at').notNull(),
    missed: integer('missed').notNull().default(0),
    status: text('status').notNull(), // offered | active | repaid | defaulted | forgiven
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('loans_borrower_idx').on(t.borrowerId, t.status)],
);

export const insurancePolicies = sqliteTable('insurance_policies', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  kind: text('kind').notNull(),
  premium: integer('premium').notNull(),
  activeUntil: ts('active_until').notNull(),
  claims: integer('claims').notNull().default(0),
  createdAt: ts('created_at').notNull(),
});

export const invoices = sqliteTable('invoices', {
  id: text('id').primaryKey(),
  fromCompany: text('from_company').notNull(),
  toCompany: text('to_company').notNull(),
  amount: integer('amount').notNull(),
  memo: text('memo').notNull().default(''),
  status: text('status').notNull(), // pending | paid | rejected | cancelled
  escrow: bool('escrow').notNull().default(false),
  createdAt: ts('created_at').notNull(),
  resolvedAt: ts('resolved_at'),
});

// ---------------------------------------------------------------- products & sales
export const companyProducts = sqliteTable(
  'company_products',
  {
    companyId: text('company_id').notNull(),
    productId: text('product_id').notNull(),
    price: integer('price').notNull(),
    onSale: bool('on_sale').notNull().default(true),
    autoRestock: integer('auto_restock').notNull().default(0),
    sold: integer('sold').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.productId] })],
);

export const productionJobs = sqliteTable(
  'production_jobs',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id').notNull(),
    workplaceId: text('workplace_id').notNull(),
    productId: text('product_id').notNull(),
    qty: integer('qty').notNull(),
    done: integer('done').notNull().default(0),
    quality: integer('quality').notNull().default(0),
    msPerUnit: integer('ms_per_unit').notNull(),
    progressMs: integer('progress_ms').notNull().default(0),
    status: text('status').notNull(), // queued | running | done
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('jobs_company_idx').on(t.companyId, t.status)],
);

/** item_type: product | commodity. Quantity never negative (CHECK enforced in service + test). */
export const inventory = sqliteTable(
  'inventory',
  {
    companyId: text('company_id').notNull(),
    itemType: text('item_type').notNull(),
    itemId: text('item_id').notNull(),
    qty: integer('qty').notNull().default(0),
    quality: integer('quality').notNull().default(50),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.itemType, t.itemId] })],
);

export const warehouses = sqliteTable('warehouses', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  level: integer('level').notNull().default(1),
  createdAt: ts('created_at').notNull(),
});

/** Recent NPC customer visits (pruned). */
export const customers = sqliteTable(
  'customers',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id').notNull(),
    type: text('type').notNull(),
    name: text('name').notNull(),
    productId: text('product_id'),
    bought: bool('bought').notNull(),
    satisfaction: integer('satisfaction').notNull(),
    spent: integer('spent').notNull().default(0),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('customers_company_idx').on(t.companyId, t.createdAt)],
);

export const salesOrders = sqliteTable(
  'sales_orders',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id').notNull(),
    productId: text('product_id').notNull(),
    qty: integer('qty').notNull(),
    unitPrice: integer('unit_price').notNull(),
    total: integer('total').notNull(),
    channel: text('channel').notNull(),
    customerType: text('customer_type'),
    buyerCompanyId: text('buyer_company_id'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('sales_company_idx').on(t.companyId, t.createdAt), index('sales_product_idx').on(t.productId, t.createdAt)],
);

export const reviews = sqliteTable(
  'reviews',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id').notNull(),
    productId: text('product_id').notNull(),
    stars: integer('stars').notNull(),
    text: text('text').notNull(),
    customerType: text('customer_type').notNull(),
    customerName: text('customer_name').notNull(),
    reply: text('reply'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('reviews_company_idx').on(t.companyId, t.createdAt)],
);

export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  kind: text('kind').notNull(),
  budget: integer('budget').notNull(),
  trafficMult: real('traffic_mult').notNull(),
  revenueDuring: integer('revenue_during').notNull().default(0),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  status: text('status').notNull(),
});

export const properties = sqliteTable('properties', {
  id: text('id').primaryKey(),
  district: text('district').notNull(),
  plot: integer('plot').notNull(),
  kind: text('kind').notNull(), // shopfront | warehouse | office
  ownerCompanyId: text('owner_company_id'),
  price: integer('price').notNull(),
  rentPrice: integer('rent_price').notNull(),
  rentedTo: text('rented_to'),
  traffic: integer('traffic').notNull(),
  createdAt: ts('created_at').notNull(),
});

export const vehicles = sqliteTable('vehicles', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  kind: text('kind').notNull(),
  capacity: integer('capacity').notNull(),
  createdAt: ts('created_at').notNull(),
});

/** Price history for marketplace items and supply goods (one row per sale). */
export const priceTicks = sqliteTable(
  'price_ticks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    market: text('market').notNull(), // supply | auction
    itemKey: text('item_key').notNull(),
    price: integer('price').notNull(),
    qty: integer('qty').notNull().default(1),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('price_ticks_item_idx').on(t.market, t.itemKey, t.createdAt)],
);

/** Supply-chain listings for commodities between players. */
export const supplyListings = sqliteTable('supply_listings', {
  id: text('id').primaryKey(),
  sellerId: text('seller_id').notNull(),
  itemType: text('item_type').notNull(),
  itemId: text('item_id').notNull(),
  qty: integer('qty').notNull(),
  unitPrice: integer('unit_price').notNull(),
  status: text('status').notNull(),
  /** set for private escrow deals offered to one company */
  targetId: text('target_id'),
  quality: integer('quality').notNull().default(50),
  createdAt: ts('created_at').notNull(),
});

/** Marketplace / auction house for workers, decor, pets, items. Listed things are escrowed (flagged listed). */
export const marketListings = sqliteTable(
  'market_listings',
  {
    id: text('id').primaryKey(),
    sellerId: text('seller_id').notNull(),
    itemType: text('item_type').notNull(), // worker | item
    itemRef: text('item_ref').notNull(),
    title: text('title').notNull(),
    buyNowPrice: integer('buy_now_price'),
    startPrice: integer('start_price').notNull(),
    highBid: integer('high_bid'),
    highBidder: text('high_bidder'),
    endsAt: ts('ends_at').notNull(),
    status: text('status').notNull(), // open | sold | expired | cancelled
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('market_status_idx').on(t.status, t.endsAt)],
);

// ---------------------------------------------------------------- exchange
export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  symbol: text('symbol').notNull().unique(),
  name: text('name').notNull(),
  type: text('type').notNull(), // STOCK | ETF | BOND | COMMODITY | COIN
  companyId: text('company_id'),
  priceMode: text('price_mode').notNull(),
  price: integer('price').notNull(), // last price, integer Bits
  fairValue: real('fair_value').notNull(),
  sharesOutstanding: integer('shares_outstanding').notNull().default(0),
  primaryRemaining: integer('primary_remaining').notNull().default(0),
  founderPct: integer('founder_pct').notNull().default(0),
  dividendPct: integer('dividend_pct').notNull().default(0),
  dayOpen: integer('day_open').notNull(),
  dayKey: text('day_key').notNull(),
  halted: bool('halted').notNull().default(false),
  haltReason: text('halt_reason'),
  haltUntil: ts('halt_until'),
  lockupUntil: ts('lockup_until'),
  listed: bool('listed').notNull().default(true),
  data: json<Record<string, unknown>>('data'),
  createdAt: ts('created_at').notNull(),
});

export const orders = sqliteTable(
  'orders',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id').notNull(),
    holderId: text('holder_id').notNull(), // company id
    side: text('side').notNull(), // buy | sell
    type: text('type').notNull(), // market | limit
    qty: integer('qty').notNull(),
    filled: integer('filled').notNull().default(0),
    limitPrice: integer('limit_price'),
    reserved: integer('reserved').notNull().default(0), // bits escrowed for open buy limit orders
    status: text('status').notNull(), // open | filled | cancelled | rejected
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('orders_book_idx').on(t.assetId, t.status, t.side)],
);

export const trades = sqliteTable(
  'trades',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id').notNull(),
    buyerId: text('buyer_id').notNull(),
    sellerId: text('seller_id').notNull(),
    qty: integer('qty').notNull(),
    price: integer('price').notNull(),
    fee: integer('fee').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('trades_asset_idx').on(t.assetId, t.createdAt), index('trades_buyer_idx').on(t.buyerId), index('trades_seller_idx').on(t.sellerId)],
);

export const holdings = sqliteTable(
  'holdings',
  {
    holderId: text('holder_id').notNull(), // company id or 'treasury'
    assetId: text('asset_id').notNull(),
    qty: integer('qty').notNull(),
    costBasis: integer('cost_basis').notNull(),
    drip: bool('drip').notNull().default(false),
    acquiredAt: ts('acquired_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.holderId, t.assetId] })],
);

export const dividends = sqliteTable('dividends', {
  id: text('id').primaryKey(),
  assetId: text('asset_id').notNull(),
  holderId: text('holder_id'),
  amount: integer('amount').notNull(),
  reinvestedQty: integer('reinvested_qty').notNull().default(0),
  createdAt: ts('created_at').notNull(),
});

export const indexes = sqliteTable('indexes', {
  id: text('id').primaryKey(),
  symbol: text('symbol').notNull().unique(),
  name: text('name').notNull(),
  rule: json<{ kind: 'top'; n: number } | { kind: 'category'; category: string }>('rule').notNull(),
  value: real('value').notNull(),
  createdAt: ts('created_at').notNull(),
});

export const priceHistory = sqliteTable(
  'price_history',
  {
    assetId: text('asset_id').notNull(),
    bucket: ts('bucket').notNull(),
    o: integer('o').notNull(),
    h: integer('h').notNull(),
    l: integer('l').notNull(),
    c: integer('c').notNull(),
    v: integer('v').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.bucket] })],
);

export const proposals = sqliteTable('proposals', {
  id: text('id').primaryKey(),
  assetId: text('asset_id').notNull(),
  kind: text('kind').notNull(), // dividend | buyback | workplace | takeover
  data: json<Record<string, unknown>>('data').notNull(),
  proposerId: text('proposer_id').notNull(),
  yes: integer('yes').notNull().default(0),
  no: integer('no').notNull().default(0),
  status: text('status').notNull(),
  endsAt: ts('ends_at').notNull(),
  createdAt: ts('created_at').notNull(),
});

export const votes = sqliteTable(
  'votes',
  {
    proposalId: text('proposal_id').notNull(),
    holderId: text('holder_id').notNull(),
    weight: integer('weight').notNull(),
    choice: bool('choice').notNull(),
  },
  (t) => [primaryKey({ columns: [t.proposalId, t.holderId] })],
);

export const watchlist = sqliteTable(
  'watchlist',
  {
    companyId: text('company_id').notNull(),
    assetId: text('asset_id').notNull(),
    alertAbove: integer('alert_above'),
    alertBelow: integer('alert_below'),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.assetId] })],
);

// ---------------------------------------------------------------- social
export const guilds = sqliteTable('guilds', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  emoji: text('emoji').notNull(),
  motto: text('motto').notNull().default(''),
  leaderId: text('leader_id').notNull(),
  level: integer('level').notNull().default(1),
  xp: integer('xp').notNull().default(0),
  open: bool('open').notNull().default(true),
  questDay: text('quest_day'),
  questDone: bool('quest_done').notNull().default(false),
  createdAt: ts('created_at').notNull(),
});

export const guildMembers = sqliteTable(
  'guild_members',
  {
    guildId: text('guild_id').notNull(),
    companyId: text('company_id').notNull(),
    role: text('role').notNull(), // leader | officer | member
    joinedAt: ts('joined_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.companyId] })],
);

export const wars = sqliteTable('wars', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(), // company | guild
  metric: text('metric').notNull(), // earned | sales | contracts
  prize: integer('prize').notNull(),
  consolation: integer('consolation').notNull(),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  status: text('status').notNull(), // pending | scheduled | active | finished | declined
  winnerId: text('winner_id'),
  contest: text('contest').notNull().default('sprint'), // sprint | marketshare | hackathon | bakeoff | race
  createdBy: text('created_by'), // company id for player challenges, null = owner/system
  createdAt: ts('created_at').notNull(),
});

export const warParticipants = sqliteTable(
  'war_participants',
  {
    warId: text('war_id').notNull(),
    sideId: text('side_id').notNull(), // company id or guild id
    baseline: integer('baseline').notNull().default(0),
    score: integer('score').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.warId, t.sideId] })],
);

export const tradeFairs = sqliteTable('trade_fairs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  theme: text('theme').notNull(), // category id or 'any'
  boothFee: integer('booth_fee').notNull(),
  prizePool: integer('prize_pool').notNull(),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  status: text('status').notNull(), // open | finished
  results: json<Array<{ place: number; companyId: string; name: string; score: number; prize: number }>>('results'),
  createdAt: ts('created_at').notNull(),
});

export const fairBooths = sqliteTable(
  'fair_booths',
  {
    fairId: text('fair_id').notNull(),
    companyId: text('company_id').notNull(),
    productId: text('product_id').notNull(),
    qty: integer('qty').notNull(),
    quality: real('quality').notNull(),
    score: real('score').notNull().default(0),
    earned: integer('earned').notNull().default(0),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.fairId, t.companyId] })],
);

export const mentorships = sqliteTable('mentorships', {
  id: text('id').primaryKey(),
  mentorId: text('mentor_id').notNull(),
  menteeId: text('mentee_id').notNull(),
  status: text('status').notNull(), // pending | active | graduated | ended
  startLevel: integer('start_level').notNull(),
  createdAt: ts('created_at').notNull(),
  endedAt: ts('ended_at'),
});

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    channel: text('channel').notNull(), // global | company:<id> | guild:<id> | dm:<a>:<b>
    accountId: text('account_id').notNull(),
    companyId: text('company_id'),
    senderName: text('sender_name').notNull(),
    text: text('text').notNull(),
    deleted: bool('deleted').notNull().default(false),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('chat_channel_idx').on(t.channel, t.createdAt)],
);

export const mutes = sqliteTable('mutes', {
  accountId: text('account_id').primaryKey(),
  until: ts('until').notNull(),
  reason: text('reason'),
  byId: text('by_id'),
});

export const blocks = sqliteTable(
  'blocks',
  {
    accountId: text('account_id').notNull(),
    blockedId: text('blocked_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.blockedId] })],
);

export const reports = sqliteTable('reports', {
  id: text('id').primaryKey(),
  reporterId: text('reporter_id').notNull(),
  targetType: text('target_type').notNull(), // message | company | account
  targetId: text('target_id').notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull(), // open | resolved | dismissed
  notes: text('notes'),
  createdAt: ts('created_at').notNull(),
});

export const news = sqliteTable(
  'news',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(), // headline | market | classified | column | achievement
    headline: text('headline').notNull(),
    body: text('body').notNull().default(''),
    companyId: text('company_id'),
    reactions: json<Record<string, number>>('reactions'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('news_created_idx').on(t.createdAt)],
);

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id'),
    accountId: text('account_id'),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    reward: integer('reward'),
    claimed: bool('claimed').notNull().default(false),
    read: bool('read').notNull().default(false),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('notif_company_idx').on(t.companyId, t.createdAt)],
);

// ---------------------------------------------------------------- progression
export const achievements = sqliteTable(
  'achievements',
  {
    companyId: text('company_id').notNull(),
    key: text('key').notNull(),
    unlockedAt: ts('unlocked_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.key] })],
);

export const quests = sqliteTable(
  'quests',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id').notNull(),
    key: text('key').notNull(),
    period: text('period').notNull(), // daily | weekly | season
    stat: text('stat').notNull(),
    baseline: integer('baseline').notNull(),
    target: integer('target').notNull(),
    reward: integer('reward').notNull(),
    passXp: integer('pass_xp').notNull().default(0),
    status: text('status').notNull(), // active | claimed | expired
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('quests_company_idx').on(t.companyId, t.status)],
);

export const seasons = sqliteTable('seasons', {
  id: text('id').primaryKey(),
  number: integer('number').notNull(),
  name: text('name').notNull(),
  theme: text('theme').notNull(),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  status: text('status').notNull(), // active | finished
  winners: json<Array<{ place: number; companyId: string; name: string; score: number }>>('winners'),
});

/** Monotonic counters per company (and per season via key prefix) used by quests, achievements, leaderboards. */
export const stats = sqliteTable(
  'stats',
  {
    companyId: text('company_id').notNull(),
    key: text('key').notNull(),
    value: integer('value').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.key] }), index('stats_key_idx').on(t.key, t.value)],
);

export const minigameSessions = sqliteTable(
  'minigame_sessions',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id').notNull(),
    game: text('game').notNull(),
    seed: integer('seed').notNull(),
    startedAt: ts('started_at').notNull(),
    finishedAt: ts('finished_at'),
    score: integer('score'),
    payout: integer('payout'),
    flagged: bool('flagged').notNull().default(false),
  },
  (t) => [index('mg_company_idx').on(t.companyId, t.startedAt)],
);

/** Daily snapshots used by analytics, economy health and net-worth charts. */
export const snapshots = sqliteTable(
  'snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    scope: text('scope').notNull(), // economy | company:<id>
    data: json<Record<string, number>>('data').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('snapshots_scope_idx').on(t.scope, t.createdAt)],
);

/** Suspicious activity log for the anti-cheat dashboard. */
export const flags = sqliteTable(
  'flags',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    companyId: text('company_id'),
    accountId: text('account_id'),
    detail: text('detail').notNull(),
    severity: integer('severity').notNull().default(1),
    resolved: bool('resolved').notNull().default(false),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('flags_created_idx').on(t.createdAt)],
);
