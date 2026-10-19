/**
 * Long-term goals: achievements (+ titles), daily/weekly quests, seasons with a
 * free cosmetic battle pass and a Hall of Fame, and the worker collection book.
 *
 * Rewards are paid from the Treasury (never minted) and skipped when it is low.
 * Season leaderboards use the `s:<seasonId>:earned` stat twins.
 */
import { and, desc, eq, inArray, like, lt, sql } from 'drizzle-orm';
import { RARITIES, SPECIES } from '@dw/shared';
import { db, schema, atomic, sqlite } from '../db';
import { clock, dayKey, DAY_MS } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, conflict, notFound } from '../lib/errors';
import { cfg } from './settings';
import { SYS, balanceOf } from './ledger';
import { payCompany } from './money';
import { findCompany, getCompany } from './companies';
import { getStat, bump, setCurrentSeason, getCurrentSeasonId } from './stats';
import { ACHIEVEMENTS, ACHIEVEMENT_MAP, type AchievementDef } from '../catalog/achievements';
import { ITEM_MAP } from '../catalog/decor';
import { notify } from './notifications';
import { addNews } from './news';
import { audit } from './audit';
import { toCompany, toAll } from '../lib/bus';

// ------------------------------------------------------------ helpers
function treasuryPay(companyId: string, amount: number, kind: string, memo: string) {
  const amt = Math.min(Math.floor(amount), balanceOf(SYS.TREASURY));
  if (amt <= 0) return 0;
  return payCompany({ companyId, amount: amt, from: SYS.TREASURY, kind, memo, earn: false, partial: true });
}

function giveItem(companyId: string, key: string) {
  const def = ITEM_MAP.get(key);
  if (!def) return null;
  if (def.kind === 'cosmetic' && db.select().from(schema.items).where(and(eq(schema.items.companyId, companyId), eq(schema.items.itemKey, key))).get()) return def;
  db.insert(schema.items).values({ id: newId('itm'), companyId, itemKey: key, kind: def.kind, level: 1, equipped: false, workplaceId: null, listed: false, createdAt: clock.now() }).run();
  return def;
}

// ------------------------------------------------------------ collection book
/** Companies that existed before the book get their current workers filled in once. */
function backfillCollection(companyId: string) {
  if (getStat(companyId, 'colinit')) return;
  sqlite
    .prepare(`INSERT INTO stats (company_id, key, value) SELECT company_id, 'col:' || species || ':' || rarity, COUNT(*) FROM workers WHERE company_id = ? GROUP BY species, rarity ON CONFLICT(company_id, key) DO NOTHING`)
    .run(companyId);
  sqlite.prepare(`INSERT INTO stats (company_id, key, value) VALUES (?, 'colinit', 1) ON CONFLICT(company_id, key) DO NOTHING`).run(companyId);
}

export function collectionCount(companyId: string) {
  backfillCollection(companyId);
  return (sqlite.prepare(`SELECT COUNT(*) n FROM stats WHERE company_id = ? AND key LIKE 'col:%' AND value > 0`).get(companyId) as { n: number }).n;
}

export function collectionView(companyId: string) {
  backfillCollection(companyId);
  const rows = sqlite.prepare(`SELECT key, value FROM stats WHERE company_id = ? AND key LIKE 'col:%'`).all(companyId) as Array<{ key: string; value: number }>;
  const have = new Map(rows.map((r) => [r.key.slice(4), r.value]));
  const grid = SPECIES.map((sp) => ({ species: sp, cells: RARITIES.map((r) => ({ rarity: r, count: have.get(`${sp}:${r}`) ?? 0 })) }));
  return { grid, found: [...have.values()].filter((v) => v > 0).length, total: SPECIES.length * RARITIES.length };
}

// ------------------------------------------------------------ achievements
function progressOf(companyId: string, a: AchievementDef, co = getCompany(companyId), unlockedCount?: number) {
  switch (a.kind) {
    case 'stat':
      return getStat(companyId, a.stat!);
    case 'level':
      return co.level;
    case 'prestige':
      return co.prestigeCount;
    case 'collection':
      return collectionCount(companyId);
    case 'meta':
      return unlockedCount ?? (sqlite.prepare(`SELECT COUNT(*) n FROM achievements WHERE company_id = ?`).get(companyId) as { n: number }).n;
    default:
      return 0;
  }
}

/** Unlock everything the company has earned. Returns newly unlocked achievements. */
export function checkAchievements(companyId: string) {
  const co = findCompany(companyId);
  if (!co) return [];
  const have = new Set(db.select({ k: schema.achievements.key }).from(schema.achievements).where(eq(schema.achievements.companyId, companyId)).all().map((r) => r.k));
  const fresh: AchievementDef[] = [];
  const c = cfg().achievements;
  // two passes so "meta" achievements see the ones unlocked in the first pass
  for (let pass = 0; pass < 2; pass++) {
    for (const a of ACHIEVEMENTS) {
      if (have.has(a.key) || (pass === 0 && a.kind === 'meta')) continue;
      if (progressOf(companyId, a, co, have.size) < a.target) continue;
      db.insert(schema.achievements).values({ companyId, key: a.key, unlockedAt: clock.now() }).onConflictDoNothing().run();
      have.add(a.key);
      fresh.push(a);
    }
  }
  for (const a of fresh) {
    const reward = treasuryPay(companyId, c.rewardPerTier[Math.min(a.tier, c.rewardPerTier.length - 1)], 'reward.achievement', a.name);
    addPassXp(companyId, c.passXpPerTier * (a.tier + 1));
    notify(companyId, 'achievement', `${a.emoji} Achievement: ${a.name}!`, `${a.description}. New title: "${a.title}"${reward ? ` · +${reward} BT` : ''}`);
    toCompany(companyId, { type: 'achievement', key: a.key, name: a.name, emoji: a.emoji, title: a.title, reward });
    if (a.tier >= 5) addNews('achievement', `${co.emoji} ${co.name} unlocked "${a.name}" ${a.emoji}`, a.description, companyId);
  }
  return fresh;
}

export function achievementsView(companyId: string) {
  const co = getCompany(companyId);
  checkAchievements(companyId);
  const unlocked = new Map(db.select().from(schema.achievements).where(eq(schema.achievements.companyId, companyId)).all().map((r) => [r.key, r.unlockedAt]));
  const list = ACHIEVEMENTS.map((a) => {
    const at = unlocked.get(a.key) ?? null;
    const hidden = a.secret && !at;
    return {
      key: a.key,
      name: hidden ? '???' : a.name,
      emoji: hidden ? '❔' : a.emoji,
      description: hidden ? 'A secret achievement. Keep playing!' : a.description,
      title: hidden ? '???' : a.title,
      tier: a.tier,
      target: a.target,
      progress: at ? a.target : hidden ? 0 : Math.min(a.target, progressOf(companyId, a, co, unlocked.size)),
      unlockedAt: at,
      group: a.secret ? 'secret' : a.kind === 'stat' ? a.stat : a.kind,
    };
  });
  return { list, unlocked: unlocked.size, total: ACHIEVEMENTS.length, title: co.title, titles: titlesOf(companyId) };
}

// ------------------------------------------------------------ titles
function titlesOf(companyId: string) {
  const keys = db.select({ k: schema.achievements.key }).from(schema.achievements).where(eq(schema.achievements.companyId, companyId)).all().map((r) => r.k);
  const fromAch = keys.map((k) => ACHIEVEMENT_MAP.get(k)?.title).filter(Boolean) as string[];
  const extra = (getCompany(companyId).settings?.titles as string[] | undefined) ?? [];
  return [...new Set([...fromAch, ...extra])].sort();
}

function grantTitle(companyId: string, title: string) {
  const co = getCompany(companyId);
  const s = { ...(co.settings ?? {}) } as Record<string, unknown>;
  const list = new Set((s.titles as string[] | undefined) ?? []);
  list.add(title);
  s.titles = [...list];
  db.update(schema.companies).set({ settings: s }).where(eq(schema.companies.id, companyId)).run();
}

export function setTitle(companyId: string, title: string | null) {
  if (title && !titlesOf(companyId).includes(title)) throw badRequest('You have not earned that title (yet!).');
  db.update(schema.companies).set({ title }).where(eq(schema.companies.id, companyId)).run();
  return { title };
}

// ------------------------------------------------------------ quests
interface QuestTemplate {
  key: string;
  stat: string;
  label: string;
  emoji: string;
  base: number; // target at level 1 for a daily quest
  reward: number; // Bits at level 1 for a daily quest
  needs?: string; // module needed for this quest to be offered
}

const QUESTS: QuestTemplate[] = [
  { key: 'earn', stat: 'earned', label: 'Earn {n} BT', emoji: '💰', base: 800, reward: 150 },
  { key: 'taps', stat: 'taps', label: 'Tap to boost {n} times', emoji: '👆', base: 40, reward: 80 },
  { key: 'coffee', stat: 'coffees', label: 'Buy {n} coffees', emoji: '☕', base: 3, reward: 80, needs: 'workforce' },
  { key: 'contracts', stat: 'contracts', label: 'Complete {n} contracts', emoji: '📜', base: 1, reward: 200, needs: 'contracts' },
  { key: 'pods', stat: 'pods', label: 'Open {n} Recruit Pods', emoji: '🥚', base: 1, reward: 150, needs: 'pods' },
  { key: 'minigames', stat: 'minigames', label: 'Play {n} mini-games', emoji: '🕹️', base: 3, reward: 120, needs: 'minigames' },
  { key: 'produce', stat: 'produced', label: 'Produce {n} items', emoji: '🏭', base: 15, reward: 150, needs: 'products' },
  { key: 'sell', stat: 'sold', label: 'Sell {n} items', emoji: '🛒', base: 15, reward: 150, needs: 'products' },
  { key: 'train', stat: 'trainings', label: 'Train workers {n} times', emoji: '🏋️', base: 2, reward: 120, needs: 'workforce' },
  { key: 'events', stat: 'events', label: 'Handle {n} office events', emoji: '🎲', base: 2, reward: 120, needs: 'events' },
  { key: 'research', stat: 'research', label: 'Buy {n} research levels', emoji: '🔬', base: 1, reward: 150, needs: 'research' },
  { key: 'trades', stat: 'trades', label: 'Make {n} trades on the Bit Exchange', emoji: '📈', base: 2, reward: 120, needs: 'exchange' },
  { key: 'gift', stat: 'gifted', label: 'Give away {n} BT', emoji: '🎁', base: 100, reward: 120, needs: 'transfers' },
];

function questPeriodEnd(period: 'daily' | 'weekly', now = clock.now()) {
  const startOfDay = Math.floor(now / DAY_MS) * DAY_MS;
  if (period === 'daily') return startOfDay + DAY_MS;
  const dow = new Date(now).getUTCDay(); // 0 = Sunday; weeks end Monday 00:00 UTC
  const daysLeft = ((8 - dow) % 7) || 7;
  return startOfDay + daysLeft * DAY_MS;
}

function hashPick<T>(list: T[], n: number, seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1597334677);
    const j = Math.abs(h) % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

/** Make sure today's and this week's quests exist (expired ones are closed). */
export function ensureQuests(companyId: string, modules?: Record<string, boolean>) {
  const now = clock.now();
  db.update(schema.quests).set({ status: 'expired' }).where(and(eq(schema.quests.companyId, companyId), eq(schema.quests.status, 'active'), lt(schema.quests.expiresAt, now))).run();
  const co = getCompany(companyId);
  const c = cfg().quests;
  const pool = QUESTS.filter((q) => !q.needs || !modules || modules[q.needs]);
  const levelF = 1 + (co.level - 1) * 0.25;
  for (const period of ['daily', 'weekly'] as const) {
    const ends = questPeriodEnd(period, now);
    const existing = db.select().from(schema.quests).where(and(eq(schema.quests.companyId, companyId), eq(schema.quests.period, period), eq(schema.quests.expiresAt, ends))).all();
    if (existing.length) continue;
    const count = period === 'daily' ? c.dailyCount : c.weeklyCount;
    const mult = period === 'daily' ? 1 : 5;
    const picks = hashPick(pool, count, `${companyId}:${period}:${ends}`);
    for (const t of picks) {
      db.insert(schema.quests)
        .values({
          id: newId('qst'),
          companyId,
          key: t.key,
          period,
          stat: t.stat,
          baseline: getStat(companyId, t.stat),
          target: Math.max(1, Math.round(t.base * levelF * mult)),
          reward: Math.round(t.reward * levelF * (period === 'daily' ? c.dailyRewardMult : c.weeklyRewardMult)),
          passXp: period === 'daily' ? c.passXpDaily : c.passXpWeekly,
          status: 'active',
          expiresAt: ends,
          createdAt: now,
        })
        .run();
    }
  }
}

export function questsView(companyId: string, modules?: Record<string, boolean>) {
  ensureQuests(companyId, modules);
  const rows = db.select().from(schema.quests).where(and(eq(schema.quests.companyId, companyId), inArray(schema.quests.status, ['active', 'claimed']), sql`${schema.quests.expiresAt} > ${clock.now()}`)).all();
  const map = new Map(QUESTS.map((q) => [q.key, q]));
  return rows.map((q) => {
    const t = map.get(q.key);
    const progress = Math.min(q.target, getStat(companyId, q.stat) - q.baseline);
    return { id: q.id, period: q.period, emoji: t?.emoji ?? '🗺️', label: (t?.label ?? q.key).replace('{n}', q.target.toLocaleString()), progress, target: q.target, reward: q.reward, passXp: q.passXp, status: q.status, done: progress >= q.target, expiresAt: q.expiresAt };
  });
}

export function claimQuest(companyId: string, questId: string) {
  return atomic(() => {
    const q = db.select().from(schema.quests).where(and(eq(schema.quests.id, questId), eq(schema.quests.companyId, companyId))).get();
    if (!q) throw notFound('No such quest.');
    if (q.status !== 'active') throw conflict('Already claimed!');
    if (q.expiresAt <= clock.now()) throw badRequest('That quest expired.');
    if (getStat(companyId, q.stat) - q.baseline < q.target) throw badRequest('Not finished yet - keep going!');
    db.update(schema.quests).set({ status: 'claimed' }).where(eq(schema.quests.id, q.id)).run();
    const paid = treasuryPay(companyId, q.reward, 'reward.quest', `${q.period} quest`);
    addPassXp(companyId, q.passXp);
    bump(companyId, 'quests');
    return { paid, passXp: q.passXp };
  });
}

// ------------------------------------------------------------ seasons + battle pass
export function activeSeason() {
  return db.select().from(schema.seasons).where(eq(schema.seasons.status, 'active')).get() ?? null;
}

/** Called at boot: point stat twins at the active season. */
export function loadSeason() {
  setCurrentSeason(activeSeason()?.id ?? null);
}

const TITLE_REWARDS = ['Season Rookie', 'Pass Holder', 'Grinder', 'Dedicated', 'Season Veteran', 'Season Legend'];
const COSMETICS = ['pass-season-banner', 'pass-byte-plush', 'pass-rainbow-carpet', 'pass-confetti-cannon', 'pass-disco-floor', 'pass-rocket-desk', 'pass-neon-crown'];
const DECOR = ['office-plant', 'rubber-duck', 'lava-lamp', 'motivational-poster', 'bean-bag', 'neon-sign', 'aquarium-tank', 'disco-ball', 'arcade-cabinet'];

/** 30 cosmetic-only tiers: titles, exclusive cosmetics, decor; tier 30 = Golden CEO Statue. */
export function passTiers() {
  const n = cfg().seasons.passTiers;
  const out: Array<{ tier: number; kind: 'title' | 'item'; value: string; label: string; emoji: string }> = [];
  let ti = 0;
  let ci = 0;
  let di = 0;
  for (let t = 1; t <= n; t++) {
    if (t === n) {
      const it = ITEM_MAP.get('pass-gold-statue')!;
      out.push({ tier: t, kind: 'item', value: it.key, label: it.name, emoji: it.emoji });
    } else if (t % 5 === 0) {
      const title = TITLE_REWARDS[ti++ % TITLE_REWARDS.length];
      out.push({ tier: t, kind: 'title', value: title, label: `Title: "${title}"`, emoji: '🏷️' });
    } else if (t % 3 === 0) {
      const it = ITEM_MAP.get(COSMETICS[ci++ % COSMETICS.length])!;
      out.push({ tier: t, kind: 'item', value: it.key, label: it.name, emoji: it.emoji });
    } else {
      const it = ITEM_MAP.get(DECOR[di++ % DECOR.length])!;
      out.push({ tier: t, kind: 'item', value: it.key, label: it.name, emoji: it.emoji });
    }
  }
  return out;
}

function passRow(seasonId: string, companyId: string) {
  let row = db.select().from(schema.seasonPass).where(and(eq(schema.seasonPass.seasonId, seasonId), eq(schema.seasonPass.companyId, companyId))).get();
  if (!row) {
    row = { seasonId, companyId, xp: 0, claimed: [] };
    db.insert(schema.seasonPass).values(row).onConflictDoNothing().run();
  }
  return row;
}

export function addPassXp(companyId: string, xp: number) {
  const s = activeSeason();
  if (!s || xp <= 0) return;
  passRow(s.id, companyId);
  db.update(schema.seasonPass).set({ xp: sql`${schema.seasonPass.xp} + ${Math.floor(xp)}` }).where(and(eq(schema.seasonPass.seasonId, s.id), eq(schema.seasonPass.companyId, companyId))).run();
}

export function seasonView(companyId: string) {
  const s = activeSeason();
  const c = cfg().seasons;
  const hall = db.select().from(schema.seasons).where(eq(schema.seasons.status, 'finished')).orderBy(desc(schema.seasons.number)).limit(20).all();
  if (!s) return { season: null, hallOfFame: hall };
  const row = passRow(s.id, companyId);
  const tier = Math.min(c.passTiers, Math.floor(row.xp / c.passXpPerTier));
  const standings = (sqlite.prepare(`SELECT company_id, value FROM stats WHERE key = ? ORDER BY value DESC LIMIT 10`).all(`s:${s.id}:earned`) as Array<{ company_id: string; value: number }>).map((r, i) => ({ place: i + 1, companyId: r.company_id, name: findCompany(r.company_id)?.name ?? '?', emoji: findCompany(r.company_id)?.emoji ?? '❓', score: r.value }));
  return {
    season: s,
    pass: { xp: row.xp, tier, xpPerTier: c.passXpPerTier, maxTier: c.passTiers, claimed: row.claimed, tiers: passTiers() },
    standings,
    myScore: getStat(companyId, `s:${s.id}:earned`),
    prizes: c.prizes,
    hallOfFame: hall,
  };
}

export function claimPassTier(companyId: string, tier: number) {
  return atomic(() => {
    const s = activeSeason();
    if (!s) throw badRequest('No season is running right now.');
    const c = cfg().seasons;
    const row = passRow(s.id, companyId);
    if (tier < 1 || tier > c.passTiers) throw badRequest('No such tier.');
    if (Math.floor(row.xp / c.passXpPerTier) < tier) throw badRequest('Earn more pass XP to reach that tier.');
    if (row.claimed.includes(tier)) throw conflict('Already claimed!');
    const reward = passTiers()[tier - 1];
    if (reward.kind === 'title') grantTitle(companyId, reward.value);
    else giveItem(companyId, reward.value);
    db.update(schema.seasonPass).set({ claimed: [...row.claimed, tier] }).where(and(eq(schema.seasonPass.seasonId, s.id), eq(schema.seasonPass.companyId, companyId))).run();
    return { reward };
  });
}

export function startSeason(input: { name: string; theme: string; days: number }, actorId: string) {
  if (activeSeason()) throw conflict('A season is already running. End it first.');
  const last = db.select().from(schema.seasons).orderBy(desc(schema.seasons.number)).get();
  const now = clock.now();
  const row = { id: newId('ssn'), number: (last?.number ?? 0) + 1, name: input.name.trim() || `Season ${(last?.number ?? 0) + 1}`, theme: input.theme || 'classic', startsAt: now, endsAt: now + Math.max(1, input.days) * DAY_MS, status: 'active', winners: null };
  db.insert(schema.seasons).values(row).run();
  setCurrentSeason(row.id);
  addNews('headline', `🏁 ${row.name} has begun!`, 'Leaderboards reset, a fresh battle pass is out, and glory awaits. Go go go!');
  toAll({ type: 'boss', text: `🏁 ${row.name} starts NOW! Fresh leaderboards and a brand-new season pass!`, mood: 'wow' });
  audit({ actorId, action: 'season.start', targetType: 'season', targetId: row.id, newValue: input });
  return row;
}

/** End the season: pay top-10 prizes, give the top 3 a title, archive to the Hall of Fame. */
export function endSeason(actorId: string | null) {
  const s = activeSeason();
  if (!s) throw badRequest('No season is running.');
  return atomic(() => {
    const c = cfg().seasons;
    const top = sqlite.prepare(`SELECT company_id, value FROM stats WHERE key = ? AND value > 0 ORDER BY value DESC LIMIT ?`).all(`s:${s.id}:earned`, c.prizes.length) as Array<{ company_id: string; value: number }>;
    const winners = top.map((r, i) => {
      const co = findCompany(r.company_id);
      const prize = co ? treasuryPay(r.company_id, c.prizes[i], 'reward.season', `${s.name} #${i + 1}`) : 0;
      if (co && i < 3) grantTitle(r.company_id, `${['🥇', '🥈', '🥉'][i]} ${s.name} ${['Champion', 'Runner-up', 'Bronze'][i]}`);
      if (co) notify(r.company_id, 'season', `🏆 ${s.name}: you finished #${i + 1}!`, prize ? `Prize: ${prize} BT` : '');
      return { place: i + 1, companyId: r.company_id, name: co ? `${co.emoji} ${co.name}` : '?', score: r.value };
    });
    db.update(schema.seasons).set({ status: 'finished', winners, endsAt: Math.min(s.endsAt, clock.now()) }).where(eq(schema.seasons.id, s.id)).run();
    setCurrentSeason(null);
    addNews('headline', `🏆 ${s.name} is over! ${winners[0]?.name ?? 'Nobody'} takes the crown`, winners.slice(0, 3).map((w) => `#${w.place} ${w.name}`).join(' · ') || 'A quiet season.');
    if (actorId) audit({ actorId, action: 'season.end', targetType: 'season', targetId: s.id, newValue: { winners } });
    return { winners };
  });
}

/** Global hook: end seasons whose time is up; sweep achievements for active companies. */
export function goalsTick(now: number) {
  const s = activeSeason();
  if (s && s.endsAt <= now) endSeason(null);
}

export function achievementSweep(now: number) {
  const active = db.select({ id: schema.companies.id }).from(schema.companies).where(and(eq(schema.companies.status, 'active'), sql`${schema.companies.lastActiveAt} > ${now - 2 * 3600_000}`)).all();
  for (const c of active) checkAchievements(c.id);
}

export function listSeasons() {
  return { active: activeSeason(), currentStatsSeason: getCurrentSeasonId(), all: db.select().from(schema.seasons).orderBy(desc(schema.seasons.number)).limit(50).all() };
}

export { like, dayKey };
