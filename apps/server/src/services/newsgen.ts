/**
 * The Daily Byte: auto-generated headlines about real activity - overtakes on
 * the leaderboard, market reports and record highs, funny classified ads and
 * Boss Byte's weekly column.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { clock } from '../lib/time';
import { cfg } from './settings';
import { addNews } from './news';
import { changeOver } from '../exchange/assets';
import { moneySupply } from './ledger';

let lastOrder: string[] | null = null;

/** "Taco Truck Fleet overtakes Pizza Empire!" */
export function overtakeCheck() {
  const top = db.select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji, v: schema.companies.lifetimeEarned }).from(schema.companies).where(eq(schema.companies.status, 'active')).orderBy(desc(schema.companies.lifetimeEarned)).limit(10).all();
  const order = top.map((t) => t.id);
  if (lastOrder) {
    for (let i = 0; i < Math.min(3, order.length); i++) {
      const prevIdx = lastOrder.indexOf(order[i]);
      if (prevIdx > i && lastOrder[i] && lastOrder[i] !== order[i]) {
        const passed = top.find((t) => t.id === lastOrder![i]);
        const me = top[i];
        if (passed) {
          addNews('headline', `${me.emoji} ${me.name} overtakes ${passed.emoji} ${passed.name}!`, i === 0 ? `A new #1 on the leaderboard! ${me.name} is now the richest company in town.` : `Now #${i + 1} on the leaderboard. Rivals are "totally not worried".`, me.id);
          break;
        }
      }
    }
  }
  lastOrder = order;
}

function lastNewsAt(kind: string, prefix?: string) {
  const q = db.select({ at: schema.news.createdAt }).from(schema.news);
  const row = (prefix ? q.where(and(eq(schema.news.kind, kind), sql`${schema.news.headline} LIKE ${prefix + '%'}`)) : q.where(eq(schema.news.kind, kind))).orderBy(desc(schema.news.createdAt)).get();
  return row?.at ?? 0;
}

/** Hourly market report + record-high watch on BIT500. */
export function marketReport(force = false) {
  const now = clock.now();
  if (!force && now - lastNewsAt('market', '📊') < cfg().news.reportEveryMs) return;
  const stocks = db.select().from(schema.assets).where(and(eq(schema.assets.type, 'STOCK'), eq(schema.assets.listed, true))).all();
  if (!stocks.length) return;
  const moves = stocks.map((s) => ({ s, ch: changeOver(s.id, 3600_000) })).sort((a, b) => b.ch - a.ch);
  const up = moves[0];
  const down = moves[moves.length - 1];
  const idx = db.select().from(schema.assets).where(eq(schema.assets.symbol, 'BIT500')).get();
  const idxCh = idx ? changeOver(idx.id, 3600_000) : 0;
  const mood = idxCh > 1 ? 'Bulls are dancing 🐂💃' : idxCh < -1 ? 'Bears are hibernating in the trading pit 🐻' : 'Traders mostly ate snacks 🍿';
  addNews(
    'market',
    `📊 Market report: BIT500 ${idxCh >= 0 ? '+' : ''}${idxCh}% this hour`,
    `${mood}. Top gainer: $${up.s.symbol} (${up.ch >= 0 ? '+' : ''}${up.ch}%). ${down.s.id !== up.s.id ? `Biggest faller: $${down.s.symbol} (${down.ch}%).` : ''} Money supply: ${moneySupply().toLocaleString()} BT.`,
  );
}

let bestIdx = 0;
export function recordHighCheck() {
  const idx = db.select().from(schema.assets).where(eq(schema.assets.symbol, 'BIT500')).get();
  if (!idx) return;
  if (!bestIdx) {
    const row = db.select({ h: sql<number>`MAX(${schema.priceHistory.h})` }).from(schema.priceHistory).where(eq(schema.priceHistory.assetId, idx.id)).get();
    bestIdx = Math.max(row?.h ?? 0, idx.price);
    return;
  }
  if (idx.price > bestIdx * 1.01) {
    bestIdx = idx.price;
    if (clock.now() - lastNewsAt('market', '🚀') > 3600_000) addNews('market', `🚀 Stock market hits a record high! BIT500 at ${idx.price}`, 'Boss Byte has ordered a commemorative cake. It is shaped like a candlestick chart.');
  }
}

const CLASSIFIEDS = [
  ['🦆 LOST: one rubber duck', 'Answers to "Quackers". Last seen debugging production. Reward: gratitude.'],
  ['🪑 FOR SALE: ergonomic chair', 'Slightly haunted. Spins on its own at 3am. Otherwise great lumbar support.'],
  ['🍕 WANTED: pizza taster', 'Must love cheese. Must hate pineapple. Or love it. We are flexible.'],
  ['🤖 SEEKING: robot friend', 'Toaster bot, 3, looking for someone to make bread with. No forks please.'],
  ['📎 FREE: 4,000 paperclips', 'Our intern got carried away. Please take them. PLEASE.'],
  ['🐙 FOR HIRE: octopus accountant', 'Eight arms, eight spreadsheets. References available from Sea Corp.'],
  ['☕ MISSING: office coffee', 'If you took the last cup without making more, we know. We always know.'],
  ['🌵 ADOPT: desk cactus', 'Low maintenance. High judgement. Will not hug back.'],
  ['🎸 BAND MEMBERS WANTED', '"The Spreadsheets" need a drummer. Must know at least one chord. Any chord.'],
  ['🧦 FOUND: single sock', 'Polka-dotted. Found in the server room. How? Nobody knows.'],
  ['👻 ROOM FOR RENT', 'Cozy cubicle, friendly ghost included. Ghost does not pay rent.'],
  ['🎈 PARTY PLANNER AVAILABLE', 'Specialising in "Congrats on the Quarterly Report" bashes.'],
];

export function classified(force = false) {
  if (!force && clock.now() - lastNewsAt('classified') < cfg().news.classifiedEveryMs) return;
  const [h, b] = CLASSIFIEDS[Math.floor(Math.random() * CLASSIFIEDS.length)];
  addNews('classified', h, b);
}

const COLUMNS = [
  ['Why your workers nap (and why you should let them)', 'Studies by me, Boss Byte, show that rested workers produce 37% more "good vibes". The other 63% is snacks.'],
  ['Diversify, darling!', 'Putting all your Bits into one meme coin is like putting all your eggs into one duck. The duck will not appreciate it.'],
  ['The art of the coffee break', 'A well-timed coffee is worth two promotions. Do not quote me on that. Actually, do.'],
  ['On the subject of loans', 'Borrow like a squirrel: only what you can bury and dig back up before winter.'],
  ['Guilds: friendship, but with spreadsheets', 'Join a guild! Shared treasury, shared quests, shared terrible puns.'],
  ['Reviews are feelings, too', 'Reply to your one-star reviews with kindness. Then go cry in the supply closet. That is what I do.'],
];

export function bossColumn(force = false) {
  if (!force && clock.now() - lastNewsAt('column') < cfg().news.columnEveryMs) return;
  const [h, b] = COLUMNS[Math.floor(Math.random() * COLUMNS.length)];
  addNews('column', `🤖 Boss Byte's Column: ${h}`, b);
}

/** Global hook (every ~2 minutes). */
export function newsTick() {
  overtakeCheck();
  recordHighCheck();
  marketReport();
  classified();
  bossColumn();
}
