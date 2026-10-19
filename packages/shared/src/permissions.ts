import { z } from 'zod';
import { ASSET_TYPES, MINIGAME_IDS, MODULES, SALES_CHANNELS, type AssetType, type Module, type SalesChannel } from './constants';

/**
 * Permissions for one company (or one staff account inside a company).
 * `null` in a numeric limit means "unlimited".
 */
export interface Limits {
  maxWorkers: number | null;
  maxWorkplaces: number | null;
  maxWorkplaceTier: number | null;
  maxBalance: number | null;
  dailyEarnCap: number | null;
  dailySpendCap: number | null;
  maxTransferPerDay: number | null;
  transferRecipients: 'anyone' | 'same_company' | 'nobody';
  maxLoan: number | null;
  maxPortfolioValue: number | null;
  maxDailyTrades: number | null;
  tradableAssets: AssetType[];
  shortingAllowed: boolean;
  allowedMinigames: string[];
  canCreateStaff: boolean;
  maxStaff: number;
  staffGrantable: Module[];
  maxProductsListed: number | null;
  maxWarehouseLevel: number | null;
  allowedSalesChannels: SalesChannel[];
  /** players may set prices between basePrice / priceLimitMult and basePrice * priceLimitMult (also capped by global floors) */
  priceLimitMult: number;
  canSellToPlayers: boolean;
}

export interface Permissions {
  modules: Record<Module, boolean>;
  limits: Limits;
}

const nullableInt = z.number().int().min(0).nullable();

export const limitsSchema = z.object({
  maxWorkers: nullableInt,
  maxWorkplaces: nullableInt,
  maxWorkplaceTier: nullableInt,
  maxBalance: nullableInt,
  dailyEarnCap: nullableInt,
  dailySpendCap: nullableInt,
  maxTransferPerDay: nullableInt,
  transferRecipients: z.enum(['anyone', 'same_company', 'nobody']),
  maxLoan: nullableInt,
  maxPortfolioValue: nullableInt,
  maxDailyTrades: nullableInt,
  tradableAssets: z.array(z.enum(ASSET_TYPES)),
  shortingAllowed: z.boolean(),
  allowedMinigames: z.array(z.string()),
  canCreateStaff: z.boolean(),
  maxStaff: z.number().int().min(0).max(100),
  staffGrantable: z.array(z.enum(MODULES)),
  maxProductsListed: nullableInt,
  maxWarehouseLevel: nullableInt,
  allowedSalesChannels: z.array(z.enum(SALES_CHANNELS)),
  priceLimitMult: z.number().min(1).max(10),
  canSellToPlayers: z.boolean(),
});

export const permissionsSchema = z.object({
  modules: z.object(Object.fromEntries(MODULES.map((m) => [m, z.boolean()])) as Record<Module, z.ZodBoolean>),
  limits: limitsSchema,
});

/** Partial permissions used for edits; unknown keys rejected. */
export const permissionsPatchSchema = z.object({
  modules: z.object(Object.fromEntries(MODULES.map((m) => [m, z.boolean().optional()])) as Record<Module, z.ZodOptional<z.ZodBoolean>>).optional(),
  limits: limitsSchema.partial().optional(),
});
export type PermissionsPatch = z.infer<typeof permissionsPatchSchema>;

const allModules = (on: boolean): Record<Module, boolean> =>
  Object.fromEntries(MODULES.map((m) => [m, on])) as Record<Module, boolean>;

const pick = (mods: Module[]): Record<Module, boolean> => {
  const r = allModules(false);
  for (const m of mods) r[m] = true;
  return r;
};

export const DEFAULT_LIMITS: Limits = {
  maxWorkers: 40,
  maxWorkplaces: 5,
  maxWorkplaceTier: null,
  maxBalance: null,
  dailyEarnCap: null,
  dailySpendCap: null,
  maxTransferPerDay: 5000,
  transferRecipients: 'anyone',
  maxLoan: 20000,
  maxPortfolioValue: null,
  maxDailyTrades: 200,
  tradableAssets: ['STOCK', 'ETF', 'BOND', 'COMMODITY', 'COIN'],
  shortingAllowed: false,
  allowedMinigames: [...MINIGAME_IDS],
  canCreateStaff: true,
  maxStaff: 5,
  staffGrantable: [...MODULES],
  maxProductsListed: null,
  maxWarehouseLevel: null,
  allowedSalesChannels: [...SALES_CHANNELS],
  priceLimitMult: 4,
  canSellToPlayers: true,
};

const STARTER_MODULES: Module[] = ['office', 'workforce', 'pods', 'contracts', 'minigames', 'bank', 'leaderboard', 'achievements', 'events', 'news', 'decor'];
const STANDARD_MODULES: Module[] = [
  ...STARTER_MODULES,
  'loans',
  'transfers',
  'marketplace',
  'supplychain',
  'products',
  'inventory',
  'marketing',
  'research',
  'prestige',
  'chat',
  'guilds',
  'wars',
  'staff',
  'strategy',
  'unions',
  'court',
];

export const PERMISSION_PRESETS: Record<'starter' | 'standard' | 'full' | 'readonly', { label: string; emoji: string; blurb: string; perms: Permissions }> = {
  starter: {
    label: 'Starter',
    emoji: '🐣',
    blurb: 'The basics: office, workers, pods, contracts and mini-games.',
    perms: {
      modules: pick(STARTER_MODULES),
      limits: { ...DEFAULT_LIMITS, maxWorkers: 15, maxWorkplaces: 2, maxWorkplaceTier: 2, canCreateStaff: false, maxStaff: 0, maxLoan: 0, maxTransferPerDay: 0, transferRecipients: 'nobody' },
    },
  },
  standard: {
    label: 'Standard',
    emoji: '🏢',
    blurb: 'Everything except the stock market and property.',
    perms: { modules: pick(STANDARD_MODULES), limits: { ...DEFAULT_LIMITS } },
  },
  full: {
    label: 'Full Access',
    emoji: '🚀',
    blurb: 'All modules on. Go wild (within reason).',
    perms: { modules: allModules(true), limits: { ...DEFAULT_LIMITS, maxWorkers: 80, maxWorkplaces: 8 } },
  },
  readonly: {
    label: 'Read-Only',
    emoji: '👀',
    blurb: 'Can look around the office and read the news. That is it.',
    perms: {
      modules: pick(['office', 'leaderboard', 'news', 'achievements']),
      limits: { ...DEFAULT_LIMITS, dailySpendCap: 0, maxTransferPerDay: 0, transferRecipients: 'nobody', maxDailyTrades: 0, canCreateStaff: false, maxStaff: 0, maxLoan: 0 },
    },
  },
};
export type PresetId = keyof typeof PERMISSION_PRESETS;

export function clonePermissions(p: Permissions): Permissions {
  return JSON.parse(JSON.stringify(p));
}

/** Apply a patch to a permission set, returning a new object. */
export function applyPermissionsPatch(base: Permissions, patch: PermissionsPatch): Permissions {
  const out = clonePermissions(base);
  if (patch.modules) for (const [k, v] of Object.entries(patch.modules)) if (typeof v === 'boolean') out.modules[k as Module] = v;
  if (patch.limits) Object.assign(out.limits, patch.limits);
  return out;
}

/** Strategy-layer modules arrived later: companies saved before then get them if they can already trade. */
const LATE_MODULES: Module[] = ['strategy', 'unions', 'court'];
function newModuleDefaults(saved: Partial<Record<Module, boolean>> | undefined) {
  if (!saved) return {};
  return Object.fromEntries(LATE_MODULES.filter((m) => !(m in saved)).map((m) => [m, !!saved.marketplace]));
}

/** Fill any missing fields (old rows / new modules) with defaults. */
export function normalizePermissions(p: Partial<Permissions> | null | undefined): Permissions {
  const base = PERMISSION_PRESETS.standard.perms;
  return {
    modules: { ...allModules(false), ...newModuleDefaults(p?.modules), ...(p?.modules ?? base.modules) },
    limits: { ...DEFAULT_LIMITS, ...(p?.limits ?? {}) },
  };
}

/** Staff accounts only carry module toggles; their limits come from the company. */
export interface StaffPermissions {
  modules: Partial<Record<Module, boolean>>;
}

/**
 * Effective module set for a staff member: must be enabled for the company,
 * grantable by the company's admin, and switched on for the staff account.
 */
export function effectiveStaffModules(company: Permissions, staff: StaffPermissions): Record<Module, boolean> {
  const out = allModules(false);
  for (const m of MODULES) {
    out[m] = !!company.modules[m] && company.limits.staffGrantable.includes(m) && !!staff.modules[m];
  }
  return out;
}

/** Returns the list of modules in `requested` that the admin is NOT allowed to hand down. */
export function ungrantableModules(company: Permissions, requested: Partial<Record<Module, boolean>>): Module[] {
  return (Object.entries(requested) as [Module, boolean][])
    .filter(([m, on]) => on && (!company.modules[m] || !company.limits.staffGrantable.includes(m)))
    .map(([m]) => m);
}
