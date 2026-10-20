/**
 * Digital Workforce Live schema (Postgres, schema "live"). Money and counts are
 * bigint numbers; times are unix milliseconds.
 */
import { pgSchema, text, integer, bigint, boolean, jsonb, real, primaryKey, index, uniqueIndex, serial } from 'drizzle-orm/pg-core';

export const live = pgSchema('live');

const ms = (name: string) => bigint(name, { mode: 'number' });
const big = (name: string) => bigint(name, { mode: 'number' });

// ---------------------------------------------------------------- core
export const settings = live.table('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});

export const accounts = live.table(
  'accounts',
  {
    id: text('id').primaryKey(),
    number: text('number').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull(), // OWNER | ADMIN | STAFF
    companyId: text('company_id'),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'), // active | disabled
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: ms('locked_until'),
    energy: real('energy').notNull().default(100),
    energyAt: ms('energy_at').notNull(),
    xp: big('xp').notNull().default(0),
    mutedUntil: ms('muted_until'),
    createdAt: ms('created_at').notNull(),
    lastSeen: ms('last_seen'),
  },
  (t) => [uniqueIndex('accounts_number_idx').on(t.number), index('accounts_company_idx').on(t.companyId)],
);

export const sessions = live.table('sessions', {
  id: text('id').primaryKey(), // sha256 of the cookie token
  accountId: text('account_id').notNull(),
  createdAt: ms('created_at').notNull(),
  expiresAt: ms('expires_at').notNull(),
  lastSeen: ms('last_seen').notNull(),
  ip: text('ip'),
});

export const companies = live.table('companies', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  emoji: text('emoji').notNull(),
  color: text('color').notNull(),
  slogan: text('slogan').notNull().default(''),
  industry: text('industry').notNull(), // starting facility
  status: text('status').notNull().default('active'), // active | suspended
  toolUses: integer('tool_uses').notNull().default(0),
  installs: jsonb('installs').$type<Record<string, number>>().notNull().default({}),
  prestige: integer('prestige').notNull().default(0),
  xp: big('xp').notNull().default(0),
  createdAt: ms('created_at').notNull(),
});

export const facilities = live.table(
  'facilities',
  {
    companyId: text('company_id').notNull(),
    type: text('type').notNull(),
    level: integer('level').notNull().default(1),
    batches: big('batches').notNull().default(0),
    createdAt: ms('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.type] })],
);

export const inventory = live.table(
  'inventory',
  {
    companyId: text('company_id').notNull(),
    item: text('item').notNull(),
    qty: big('qty').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.item] })],
);

// ---------------------------------------------------------------- money
export const wallets = live.table('wallets', {
  id: text('id').primaryKey(), // treasury | mint | escrow | co:<id> | union:<id>
  balance: big('balance').notNull().default(0),
});

export const ledger = live.table(
  'ledger',
  {
    id: serial('id').primaryKey(),
    txId: text('tx_id').notNull(),
    kind: text('kind').notNull(),
    fromWallet: text('from_wallet').notNull(),
    toWallet: text('to_wallet').notNull(),
    amount: big('amount').notNull(),
    memo: text('memo'),
    actorId: text('actor_id'),
    createdAt: ms('created_at').notNull(),
  },
  (t) => [index('ledger_from_idx').on(t.fromWallet, t.createdAt), index('ledger_to_idx').on(t.toWallet, t.createdAt)],
);

// ---------------------------------------------------------------- production log
export const workLog = live.table(
  'work_log',
  {
    id: serial('id').primaryKey(),
    companyId: text('company_id').notNull(),
    accountId: text('account_id').notNull(),
    facility: text('facility').notNull(),
    recipe: text('recipe').notNull(),
    batches: integer('batches').notNull(),
    output: jsonb('output').$type<Record<string, number>>().notNull(),
    createdAt: ms('created_at').notNull(),
  },
  (t) => [index('work_log_company_idx').on(t.companyId, t.createdAt)],
);

// ---------------------------------------------------------------- trading
export const orders = live.table(
  'orders',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id').notNull(),
    accountId: text('account_id').notNull(),
    item: text('item').notNull(),
    side: text('side').notNull(), // buy | sell
    price: integer('price').notNull(),
    qty: integer('qty').notNull(),
    filled: integer('filled').notNull().default(0),
    status: text('status').notNull(), // open | filled | cancelled
    createdAt: ms('created_at').notNull(),
  },
  (t) => [index('orders_book_idx').on(t.item, t.side, t.status, t.price)],
);

export const trades = live.table(
  'trades',
  {
    id: text('id').primaryKey(),
    item: text('item').notNull(),
    price: integer('price').notNull(),
    qty: integer('qty').notNull(),
    buyerId: text('buyer_id').notNull(),
    sellerId: text('seller_id').notNull(),
    tax: integer('tax').notNull(),
    venue: text('venue').notNull(), // market | shop | pos
    createdAt: ms('created_at').notNull(),
  },
  (t) => [index('trades_item_idx').on(t.item, t.createdAt), index('trades_buyer_idx').on(t.buyerId), index('trades_seller_idx').on(t.sellerId)],
);

export const listings = live.table(
  'listings',
  {
    companyId: text('company_id').notNull(),
    item: text('item').notNull(),
    price: integer('price').notNull(),
    active: boolean('active').notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.item] })],
);

export interface Line {
  item: string;
  qty: number;
  price: number;
}

export const checkouts = live.table(
  'checkouts',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(),
    sellerId: text('seller_id').notNull(),
    buyerId: text('buyer_id'),
    orderId: text('order_id'),
    lines: jsonb('lines').$type<Line[]>().notNull(),
    total: integer('total').notNull(),
    status: text('status').notNull(), // open | paid | cancelled
    createdBy: text('created_by'),
    createdAt: ms('created_at').notNull(),
    paidAt: ms('paid_at'),
    expiresAt: ms('expires_at').notNull(),
  },
  (t) => [uniqueIndex('checkouts_code_idx').on(t.code), index('checkouts_seller_idx').on(t.sellerId, t.createdAt)],
);

/** Shop orders paid at pickup: stock is reserved until the buyer pays at the counter. */
export const pickups = live.table(
  'pickups',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(),
    sellerId: text('seller_id').notNull(),
    buyerId: text('buyer_id').notNull(),
    lines: jsonb('lines').$type<Line[]>().notNull(),
    total: integer('total').notNull(),
    status: text('status').notNull(), // waiting | ready | collected | cancelled
    note: text('note').notNull().default(''),
    createdAt: ms('created_at').notNull(),
    doneAt: ms('done_at'),
  },
  (t) => [uniqueIndex('pickups_code_idx').on(t.code), index('pickups_seller_idx').on(t.sellerId, t.status), index('pickups_buyer_idx').on(t.buyerId)],
);

// ---------------------------------------------------------------- social
export const notifications = live.table(
  'notifications',
  {
    id: serial('id').primaryKey(),
    companyId: text('company_id'),
    accountId: text('account_id'),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    read: boolean('read').notNull().default(false),
    createdAt: ms('created_at').notNull(),
  },
  (t) => [index('notifications_company_idx').on(t.companyId, t.createdAt), index('notifications_account_idx').on(t.accountId, t.createdAt)],
);

export const news = live.table('news', {
  id: serial('id').primaryKey(),
  kind: text('kind').notNull(),
  headline: text('headline').notNull(),
  body: text('body').notNull().default(''),
  companyId: text('company_id'),
  createdAt: ms('created_at').notNull(),
});

export const chat = live.table(
  'chat',
  {
    id: serial('id').primaryKey(),
    channel: text('channel').notNull(),
    accountId: text('account_id').notNull(),
    companyId: text('company_id'),
    name: text('name').notNull(),
    text: text('text').notNull(),
    deleted: boolean('deleted').notNull().default(false),
    createdAt: ms('created_at').notNull(),
  },
  (t) => [index('chat_channel_idx').on(t.channel, t.createdAt)],
);

export const auditLog = live.table('audit_log', {
  id: serial('id').primaryKey(),
  actorId: text('actor_id'),
  action: text('action').notNull(),
  target: text('target'),
  data: jsonb('data'),
  createdAt: ms('created_at').notNull(),
});

export const rewardCodes = live.table('reward_codes', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  bits: integer('bits').notNull().default(0),
  items: jsonb('items').$type<Record<string, number>>().notNull().default({}),
  usesLeft: integer('uses_left').notNull(),
  createdBy: text('created_by'),
  createdAt: ms('created_at').notNull(),
});

export const rewardRedemptions = live.table(
  'reward_redemptions',
  {
    code: text('code').notNull(),
    companyId: text('company_id').notNull(),
    at: ms('at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.code, t.companyId] })],
);

// ---------------------------------------------------------------- unions
export const unions = live.table('unions', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  emoji: text('emoji').notNull(),
  motto: text('motto').notNull().default(''),
  presidentId: text('president_id'),
  vpId: text('vp_id'),
  treasurerId: text('treasurer_id'),
  dues: integer('dues').notNull().default(50),
  open: boolean('open').notNull().default(true),
  termEndsAt: ms('term_ends_at').notNull(),
  duesDay: text('dues_day'),
  createdAt: ms('created_at').notNull(),
});

export const unionMembers = live.table(
  'union_members',
  {
    companyId: text('company_id').primaryKey(),
    unionId: text('union_id').notNull(),
    repAccountId: text('rep_account_id').notNull(),
    joinedAt: ms('joined_at').notNull(),
    duesOwed: integer('dues_owed').notNull().default(0),
  },
  (t) => [index('union_members_union_idx').on(t.unionId)],
);

export const elections = live.table(
  'elections',
  {
    id: text('id').primaryKey(),
    unionId: text('union_id').notNull(),
    office: text('office').notNull(), // president | vp | treasurer | recall
    targetId: text('target_id'),
    targetOffice: text('target_office'),
    status: text('status').notNull(), // nominating | voting | closed
    votingAt: ms('voting_at').notNull(),
    closesAt: ms('closes_at').notNull(),
    winnerId: text('winner_id'),
    result: jsonb('result').$type<Record<string, number>>(),
    createdAt: ms('created_at').notNull(),
  },
  (t) => [index('elections_union_idx').on(t.unionId, t.status)],
);

export const candidates = live.table(
  'candidates',
  {
    electionId: text('election_id').notNull(),
    companyId: text('company_id').notNull(),
    pitch: text('pitch').notNull().default(''),
    at: ms('at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.electionId, t.companyId] })],
);

export const ballots = live.table(
  'ballots',
  {
    electionId: text('election_id').notNull(),
    voterId: text('voter_id').notNull(), // company id
    choice: text('choice').notNull(),
    at: ms('at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.electionId, t.voterId] })],
);

// ---------------------------------------------------------------- government
export const laws = live.table('laws', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  value: integer('value').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull(), // voting | passed | failed | vetoed
  yes: integer('yes').notNull().default(0),
  no: integer('no').notNull().default(0),
  createdAt: ms('created_at').notNull(),
  closesAt: ms('closes_at').notNull(),
  decidedAt: ms('decided_at'),
});

export const lawVotes = live.table(
  'law_votes',
  {
    lawId: text('law_id').notNull(),
    companyId: text('company_id').notNull(),
    vote: text('vote').notNull(), // yes | no
    at: ms('at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.lawId, t.companyId] })],
);

export const audits = live.table('audits', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  status: text('status').notNull(), // open | closed
  findings: jsonb('findings').$type<Record<string, unknown>>().notNull(),
  suggestedFine: integer('suggested_fine').notNull().default(0),
  fine: integer('fine').notNull().default(0),
  outcome: text('outcome'),
  note: text('note'),
  createdAt: ms('created_at').notNull(),
  closedAt: ms('closed_at'),
});

export interface Remedy {
  damages?: number;
  fine?: number;
  freezeHours?: number;
  suspend?: string | null;
  suspendHours?: number;
}

export const cases = live.table(
  'cases',
  {
    id: text('id').primaryKey(),
    number: integer('number').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    plaintiffId: text('plaintiff_id'), // null = the State
    defendantId: text('defendant_id').notNull(),
    claim: integer('claim').notNull().default(0),
    fee: integer('fee').notNull().default(0),
    status: text('status').notNull(), // filed | hearing | decided | appealed | closed | settled | dismissed
    hearingAt: ms('hearing_at').notNull(),
    verdict: text('verdict'),
    remedy: jsonb('remedy').$type<Remedy>(),
    reasoning: text('reasoning'),
    appealed: boolean('appealed').notNull().default(false),
    appealDeadline: ms('appeal_deadline'),
    settleOffer: integer('settle_offer'),
    settleFrom: text('settle_from'),
    createdAt: ms('created_at').notNull(),
    closedAt: ms('closed_at'),
  },
  (t) => [index('cases_def_idx').on(t.defendantId), index('cases_pl_idx').on(t.plaintiffId), index('cases_status_idx').on(t.status)],
);

export const evidence = live.table(
  'evidence',
  {
    id: text('id').primaryKey(),
    caseId: text('case_id').notNull(),
    side: text('side').notNull(),
    kind: text('kind').notNull(),
    text: text('text').notNull(),
    weight: integer('weight').notNull(),
    createdAt: ms('created_at').notNull(),
  },
  (t) => [index('evidence_case_idx').on(t.caseId)],
);

export const sanctions = live.table(
  'sanctions',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id').notNull(),
    kind: text('kind').notNull(), // freeze | suspend
    feature: text('feature'),
    reason: text('reason').notNull(),
    until: ms('until').notNull(),
    liftedAt: ms('lifted_at'),
    createdAt: ms('created_at').notNull(),
  },
  (t) => [index('sanctions_company_idx').on(t.companyId, t.until)],
);
