// Shared game constants used by both the server and the web client.

export const ROLES = ['OWNER', 'MODERATOR', 'COMPANY_ADMIN', 'STAFF'] as const;
export type Role = (typeof ROLES)[number];

export const ACCOUNT_STATUSES = ['active', 'suspended', 'archived'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const STAFF_TITLES = ['CFO', 'HR', 'Trader', 'Operations', 'Intern'] as const;
export type StaffTitle = (typeof STAFF_TITLES)[number];

/** Every module that can be toggled per company / per account and globally via feature flags. */
export const MODULES = [
  'office',
  'workforce',
  'pods',
  'contracts',
  'minigames',
  'bank',
  'loans',
  'transfers',
  'marketplace',
  'supplychain',
  'products',
  'inventory',
  'marketing',
  'property',
  'exchange',
  'leaderboard',
  'achievements',
  'research',
  'decor',
  'prestige',
  'events',
  'chat',
  'guilds',
  'wars',
  'news',
  'staff',
] as const;
export type Module = (typeof MODULES)[number];

export const MODULE_INFO: Record<Module, { label: string; emoji: string; path: string }> = {
  office: { label: 'Office', emoji: '🏢', path: '/office' },
  workforce: { label: 'Workforce', emoji: '🤖', path: '/workforce' },
  pods: { label: 'Recruit Pods', emoji: '🥚', path: '/pods' },
  contracts: { label: 'Contracts', emoji: '📜', path: '/contracts' },
  minigames: { label: 'Mini-Games', emoji: '🕹️', path: '/minigames' },
  bank: { label: 'Bank', emoji: '🏦', path: '/bank' },
  loans: { label: 'Loans', emoji: '💸', path: '/loans' },
  transfers: { label: 'Transfers', emoji: '🎁', path: '/bank' },
  marketplace: { label: 'Marketplace', emoji: '🛒', path: '/marketplace' },
  supplychain: { label: 'Supply Chain', emoji: '🚚', path: '/supply' },
  products: { label: 'Products', emoji: '📦', path: '/products' },
  inventory: { label: 'Inventory', emoji: '🏭', path: '/products' },
  marketing: { label: 'Marketing', emoji: '📣', path: '/products' },
  property: { label: 'Property', emoji: '🏘️', path: '/property' },
  exchange: { label: 'Bit Exchange', emoji: '📈', path: '/exchange' },
  leaderboard: { label: 'Leaderboard', emoji: '🏆', path: '/leaderboard' },
  achievements: { label: 'Achievements', emoji: '🎖️', path: '/achievements' },
  research: { label: 'Research', emoji: '🔬', path: '/research' },
  decor: { label: 'Decor & Pets', emoji: '🪴', path: '/shop' },
  prestige: { label: 'IPO Prestige', emoji: '🚀', path: '/prestige' },
  events: { label: 'Events', emoji: '🎲', path: '/office' },
  chat: { label: 'Chat', emoji: '💬', path: '/chat' },
  guilds: { label: 'Guilds', emoji: '🛡️', path: '/guilds' },
  wars: { label: 'Business Wars', emoji: '⚔️', path: '/wars' },
  news: { label: 'Daily Byte', emoji: '📰', path: '/news' },
  staff: { label: 'Staff', emoji: '🪪', path: '/company' },
};

export const RARITIES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'CURSED'] as const;
export type Rarity = (typeof RARITIES)[number];
export const RARITY_INFO: Record<Rarity, { label: string; color: string; glow: string }> = {
  COMMON: { label: 'Common', color: '#94a3b8', glow: '#cbd5e1' },
  RARE: { label: 'Rare', color: '#3b82f6', glow: '#93c5fd' },
  EPIC: { label: 'Epic', color: '#a855f7', glow: '#d8b4fe' },
  LEGENDARY: { label: 'Legendary', color: '#f59e0b', glow: '#fde68a' },
  CURSED: { label: 'Cursed Intern', color: '#16a34a', glow: '#86efac' },
};

export const WORKER_ROLES = ['MAKER', 'SELLER', 'THINKER', 'FIXER', 'MANAGER', 'WILDCARD'] as const;
export type WorkerRole = (typeof WORKER_ROLES)[number];

export const DIFFICULTIES = ['CHILL', 'NORMAL', 'CHAOS'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const ASSET_TYPES = ['STOCK', 'ETF', 'BOND', 'COMMODITY', 'COIN'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const PRICE_MODES = ['PLAYER', 'FUNDAMENTALS', 'OWNER'] as const;
export type PriceMode = (typeof PRICE_MODES)[number];

export const SALES_CHANNELS = ['shopfront', 'online', 'wholesale', 'players', 'popup'] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];

export const PRODUCT_TIERS = ['Basic', 'Good', 'Premium', 'Luxury', 'Legendary'] as const;
export type ProductTier = (typeof PRODUCT_TIERS)[number];

export const MINIGAMES = [
  { id: 'debug-rush', name: 'Debug Rush', emoji: '🐛', blurb: 'Squash the bugs before they ship!' },
  { id: 'coffee-run', name: 'Coffee Run', emoji: '☕', blurb: 'Stop the pour at the perfect moment.' },
  { id: 'email-sorter', name: 'Email Sorter', emoji: '📧', blurb: 'Keep the good mail, bin the spam.' },
  { id: 'meme-maker', name: 'Meme Maker', emoji: '🐸', blurb: 'Match the meme pairs.' },
  { id: 'server-whack', name: 'Server Whack', emoji: '🔨', blurb: 'Reboot the servers that pop up.' },
  { id: 'invoice-match', name: 'Invoice Match', emoji: '🧾', blurb: 'Remember which invoices go together.' },
  { id: 'stock-sprint', name: 'Stock Sprint', emoji: '📊', blurb: 'Up or down? Trust your gut (fictionally).' },
  { id: 'box-stack', name: 'Box Stack', emoji: '📦', blurb: 'Stack boxes as high as you dare.' },
  { id: 'pizza-rush', name: 'Pizza Rush', emoji: '🍕', blurb: 'Build the order before the customer cries.' },
  { id: 'parking-panic', name: 'Parking Panic', emoji: '🚗', blurb: 'Let the cars through without a crunch.' },
  { id: 'cable-untangle', name: 'Cable Untangle', emoji: '🔌', blurb: 'Plug every cable into its matching port.' },
  { id: 'quiz-show', name: 'Quiz Show', emoji: '🎤', blurb: 'Boss Byte asks. You answer. Glory awaits.' },
] as const;
export type MinigameId = (typeof MINIGAMES)[number]['id'];
export const MINIGAME_IDS = MINIGAMES.map((m) => m.id) as MinigameId[];

/** Feature flags = global module switches + a few extra global systems. */
export const EXTRA_FLAGS = [
  'lotto',
  'autoBalancer',
  'reviewBombs',
  'shorting',
  'mentorship',
  'tradeFairs',
  'peerLending',
  'insurance',
  'maintenance',
  'chatKillSwitch',
  'realPackages',
] as const;
export type ExtraFlag = (typeof EXTRA_FLAGS)[number];
export type FeatureFlag = Module | ExtraFlag;
export const ALL_FLAGS: FeatureFlag[] = [...MODULES, ...EXTRA_FLAGS];
/** Flags that are OFF by default. Everything else defaults ON. */
export const FLAGS_DEFAULT_OFF: FeatureFlag[] = ['autoBalancer', 'shorting', 'maintenance', 'chatKillSwitch', 'reviewBombs'];

export const SPECIES = ['bot', 'blob', 'critter', 'ghost', 'slime', 'cactus', 'toaster', 'octo'] as const;
export type Species = (typeof SPECIES)[number];

export const CUSTOMER_TYPES = [
  { id: 'bargain', name: 'Bargain Hunter', emoji: '🧐', budget: 0.8, priceSensitivity: 1.8, qualityCare: 0.5 },
  { id: 'trend', name: 'Trend Chaser', emoji: '🤳', budget: 1.1, priceSensitivity: 0.9, qualityCare: 0.8 },
  { id: 'bigspender', name: 'Big Spender', emoji: '🤑', budget: 2.0, priceSensitivity: 0.4, qualityCare: 1.2 },
  { id: 'grumpy', name: 'Grumpy Regular', emoji: '😤', budget: 1.0, priceSensitivity: 1.2, qualityCare: 1.4 },
  { id: 'influencer', name: 'Influencer', emoji: '💅', budget: 1.3, priceSensitivity: 0.8, qualityCare: 1.0 },
  { id: 'tourist', name: 'Tourist', emoji: '📸', budget: 1.4, priceSensitivity: 0.7, qualityCare: 0.6 },
  { id: 'critic', name: 'Critic', emoji: '🧑‍⚖️', budget: 1.2, priceSensitivity: 1.0, qualityCare: 2.0 },
] as const;
export type CustomerTypeId = (typeof CUSTOMER_TYPES)[number]['id'];

export const WALLET_POTS = ['main', 'payroll', 'savings', 'investing'] as const;
export type WalletPot = (typeof WALLET_POTS)[number];
