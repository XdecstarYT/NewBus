/**
 * Leaderboards (global, per industry, guilds, richest investor, best stock,
 * fastest growing, most generous) and public company profiles.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema, sqlite } from '../db';
import { dayKey } from '../lib/time';
import { getIndustry, findIndustry } from './catalog';
import { getCompany, findCompany } from './companies';
import { getCurrentSeasonId, getStat } from './stats';
import { listGuilds } from './guilds';
import { holdingsValue } from '../exchange/corporate';
import { changeOver } from '../exchange/assets';
import { notFound } from '../lib/errors';

export const BOARDS = [
  { id: 'global', label: '🌍 Top earners', unit: 'BT' },
  { id: 'industry', label: '🏭 My industry', unit: 'BT' },
  { id: 'guilds', label: '🛡️ Guilds', unit: 'level' },
  { id: 'investors', label: '💼 Richest investors', unit: 'BT invested' },
  { id: 'stocks', label: '📈 Best stocks (24h)', unit: '%' },
  { id: 'growth', label: '🚀 Fastest growing', unit: '% today' },
  { id: 'generous', label: '🎁 Most generous', unit: 'BT given' },
] as const;
export type BoardId = (typeof BOARDS)[number]['id'];

interface Row {
  rank: number;
  id: string;
  name: string;
  emoji: string;
  sub: string;
  value: number;
  companyId?: string;
}

function activeCompanies() {
  return db.select().from(schema.companies).where(eq(schema.companies.status, 'active')).all();
}

function seasonEarned(): Map<string, number> | null {
  const s = getCurrentSeasonId();
  if (!s) return null;
  const rows = sqlite.prepare(`SELECT company_id, value FROM stats WHERE key = ?`).all(`s:${s}:earned`) as Array<{ company_id: string; value: number }>;
  return new Map(rows.map((r) => [r.company_id, r.value]));
}

function statMap(key: string): Map<string, number> {
  const rows = sqlite.prepare(`SELECT company_id, value FROM stats WHERE key = ?`).all(key) as Array<{ company_id: string; value: number }>;
  return new Map(rows.map((r) => [r.company_id, r.value]));
}

function rank<T extends Omit<Row, 'rank'>>(rows: T[], limit: number): Row[] {
  return rows
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

function coRow(c: typeof schema.companies.$inferSelect, value: number, sub?: string) {
  return { id: c.id, companyId: c.id, name: c.name, emoji: c.emoji, sub: sub ?? `${getIndustry(c.industryId).name} · Lv ${c.level}`, value };
}

export function leaderboard(board: BoardId, opts: { companyId?: string; industryId?: string; limit?: number } = {}): { board: BoardId; season: boolean; rows: Row[]; me: Row | null } {
  const limit = Math.min(opts.limit ?? 50, 200);
  let all: Row[] = [];
  const season = seasonEarned();
  const earned = (c: typeof schema.companies.$inferSelect) => (season ? season.get(c.id) ?? 0 : c.lifetimeEarned);
  switch (board) {
    case 'global':
      all = rank(activeCompanies().map((c) => coRow(c, earned(c))), 100_000);
      break;
    case 'industry': {
      const ind = opts.industryId ?? (opts.companyId ? getCompany(opts.companyId).industryId : undefined);
      all = rank(activeCompanies().filter((c) => !ind || c.industryId === ind).map((c) => coRow(c, earned(c), `Lv ${c.level}`)), 100_000);
      break;
    }
    case 'guilds':
      all = rank(listGuilds().map((g) => ({ id: g.id, name: g.name, emoji: g.emoji, sub: `${g.members} members · ${g.earned.toLocaleString()} BT earned`, value: g.level * 1_000_000_000 + g.earned })), 100_000).map((r) => ({
        ...r,
        value: Math.floor(r.value / 1_000_000_000),
      }));
      break;
    case 'investors':
      all = rank(activeCompanies().map((c) => coRow(c, holdingsValue(c.id))).filter((r) => r.value > 0), 100_000);
      break;
    case 'stocks': {
      const stocks = db.select().from(schema.assets).where(and(eq(schema.assets.type, 'STOCK'), eq(schema.assets.listed, true))).all();
      all = rank(stocks.map((s) => ({ id: s.id, companyId: s.companyId ?? undefined, name: `$${s.symbol}`, emoji: s.companyId ? findCompany(s.companyId)?.emoji ?? '📈' : '📈', sub: `${s.name} · ${s.price} BT`, value: changeOver(s.id, 24 * 3600_000) })), 100_000);
      break;
    }
    case 'growth': {
      const todayMap = statMap(`d:${dayKey()}:earned`);
      all = rank(activeCompanies().map((c) => {
        const t = todayMap.get(c.id) ?? 0;
        return coRow(c, Math.round((t / Math.max(1000, c.lifetimeEarned - t)) * 1000) / 10);
      }), 100_000);
      break;
    }
    case 'generous': {
      const gifted = statMap('gifted');
      all = rank(activeCompanies().map((c) => coRow(c, gifted.get(c.id) ?? 0)).filter((r) => r.value > 0), 100_000);
      break;
    }
  }
  let me: Row | null = null;
  if (opts.companyId) {
    const guildId = board === 'guilds' ? findCompany(opts.companyId)?.guildId : null;
    me = all.find((r) => r.id === opts.companyId || (guildId && r.id === guildId) || (board === 'stocks' && r.companyId === opts.companyId)) ?? null;
  }
  return { board, season: !!season && (board === 'global' || board === 'industry'), rows: all.slice(0, limit), me };
}

export function profile(companyId: string) {
  const c = findCompany(companyId);
  if (!c) throw notFound('No such company.');
  const ind = findIndustry(c.industryId);
  const guild = c.guildId ? db.select().from(schema.guilds).where(eq(schema.guilds.id, c.guildId)).get() : null;
  const stock = db.select().from(schema.assets).where(and(eq(schema.assets.companyId, c.id), eq(schema.assets.type, 'STOCK'), eq(schema.assets.listed, true))).get();
  const achievements = db.select().from(schema.achievements).where(eq(schema.achievements.companyId, c.id)).orderBy(desc(schema.achievements.unlockedAt)).limit(12).all();
  const achievementCount = (sqlite.prepare(`SELECT COUNT(*) n FROM achievements WHERE company_id = ?`).get(c.id) as { n: number }).n;
  const workers = (sqlite.prepare(`SELECT COUNT(*) n FROM workers WHERE company_id = ?`).get(c.id) as { n: number }).n;
  const people = db
    .select({ id: schema.accounts.id, displayName: schema.accounts.displayName, role: schema.accounts.role, jobTitle: schema.accounts.jobTitle })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.companyId, c.id), inArray(schema.accounts.status, ['active'])))
    .all();
  const globalRank = leaderboard('global', { companyId: c.id, limit: 1 }).me?.rank ?? null;
  return {
    id: c.id,
    name: c.name,
    emoji: c.emoji,
    color: c.color,
    slogan: c.slogan,
    title: c.title,
    industry: ind ? { id: ind.id, name: ind.name, emoji: ind.emoji, category: ind.category } : null,
    level: c.level,
    stars: Math.round(c.reputation / 10) / 10,
    fame: c.fame,
    prestigeCount: c.prestigeCount,
    lifetimeEarned: c.lifetimeEarned,
    trophies: c.trophies ?? [],
    guild: guild ? { id: guild.id, name: guild.name, emoji: guild.emoji, level: guild.level } : null,
    stock: stock ? { symbol: stock.symbol, price: stock.price, change24h: changeOver(stock.id, 24 * 3600_000) } : null,
    achievements: achievements.map((a) => a.key),
    achievementCount,
    workers,
    people,
    stats: { wars: getStat(c.id, 'warsWon'), contracts: getStat(c.id, 'contracts'), sold: getStat(c.id, 'sold'), gifted: getStat(c.id, 'gifted') },
    globalRank,
    founded: c.createdAt,
  };
}

/** Lightweight list of companies for pickers (DM, challenge, mentor). */
export function directory() {
  return db
    .select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji, level: schema.companies.level, industryId: schema.companies.industryId, guildId: schema.companies.guildId })
    .from(schema.companies)
    .where(eq(schema.companies.status, 'active'))
    .orderBy(schema.companies.name)
    .all()
    .map((c) => ({ ...c, industry: findIndustry(c.industryId)?.name ?? '' }));
}

export { sql };
