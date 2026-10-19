/**
 * Mini-games: the client plays, the server judges. Each play is a session with
 * a server-side start time and seed. On finish the server checks that the
 * score is plausible for the elapsed time (points per second per game), then
 * pays score x rate (capped per play and per day) from the Treasury.
 * Quiz Show is graded fully on the server.
 */
import { and, desc, eq } from 'drizzle-orm';
import { MINIGAMES, MINIGAME_IDS } from '@dw/shared';
import { db, schema, atomic, sqlite } from '../db';
import { clock } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { cfg } from './settings';
import { SYS, balanceOf } from './ledger';
import { payCompany } from './money';
import { getCompany } from './companies';
import { getCompanyPermissions } from '../permissions';
import { multiplier } from './multipliers';
import { bump, today, bumpLifetime, getStat } from './stats';
import { recordFlag } from './anticheat';
import { addPassXp } from './goals';

// ------------------------------------------------------------ quiz bank (graded server-side)
export const QUIZ: Array<{ q: string; options: string[]; answer: number }> = [
  { q: 'What does a company sell shares of on the Bit Exchange?', options: ['Itself', 'Pizza', 'Its chairs', 'Weather'], answer: 0 },
  { q: 'If you buy low and sell high, you make a...', options: ['Loss', 'Profit', 'Sandwich', 'Mess'], answer: 1 },
  { q: 'What do Bits pay for in this game?', options: ['Real groceries', 'Nothing real at all', 'Rent', 'Taxes'], answer: 1 },
  { q: 'A "dividend" is...', options: ['A type of cake', 'Profit shared with shareholders', 'A math error', 'A worker quirk'], answer: 1 },
  { q: 'Which worker role is best at research?', options: ['MAKER', 'SELLER', 'THINKER', 'FIXER'], answer: 2 },
  { q: 'Interest on a loan means you pay back...', options: ['Less', 'The same', 'More', 'Nothing'], answer: 2 },
  { q: 'Inflation means prices tend to go...', options: ['Up', 'Down', 'Sideways', 'To the moon only on Tuesdays'], answer: 0 },
  { q: 'Diversifying your portfolio means...', options: ['Buying only one stock', 'Spreading your Bits across many', 'Hiding Bits under the bed', 'Selling everything'], answer: 1 },
  { q: 'What happens to perishable products over time?', options: ['They get tastier', 'They spoil', 'They multiply', 'They become stocks'], answer: 1 },
  { q: 'A "bull market" is when prices are mostly...', options: ['Falling', 'Rising', 'Mooing', 'Frozen'], answer: 1 },
  { q: 'What is revenue minus costs?', options: ['Profit', 'Debt', 'Interest', 'Vibes'], answer: 0 },
  { q: 'Who is the Owner of this game?', options: ['Boss Byte', 'The person who runs it', 'A duck', 'Nobody'], answer: 1 },
  { q: 'What does a warehouse do?', options: ['Stores stock', 'Bakes bread', 'Trades stocks', 'Writes news'], answer: 0 },
  { q: 'A higher credit score usually means...', options: ['Worse loans', 'Better loan rates', 'More workers', 'Free pizza'], answer: 1 },
  { q: 'Supply goes up, demand stays the same. Prices usually...', options: ['Go up', 'Go down', 'Disappear', 'Turn purple'], answer: 1 },
  { q: 'An IPO is when a company...', options: ['Hires its first worker', 'First sells shares to the public', 'Goes on holiday', 'Closes'], answer: 1 },
  { q: 'What do customer reviews affect most?', options: ['Reputation', 'The weather', 'Your password', 'Worker names'], answer: 0 },
  { q: 'Wages are paid to...', options: ['Workers', 'Customers', 'The moon', 'Shareholders'], answer: 0 },
  { q: 'A budget is...', options: ['A plan for spending', 'A type of bird', 'A stock ticker', 'A mini-game'], answer: 0 },
  { q: 'Which is NOT a real thing in this game?', options: ['Bits', 'Recruit Pods', 'Real money', 'Guilds'], answer: 2 },
  { q: 'Selling one product for 10 BT with 4 BT costs gives profit of...', options: ['14 BT', '6 BT', '40 BT', '4 BT'], answer: 1 },
  { q: '50% off 200 BT is...', options: ['100 BT', '150 BT', '50 BT', '250 BT'], answer: 0 },
  { q: 'Compound interest means you earn interest on...', options: ['Only your first deposit', 'Your deposit AND past interest', 'Nothing', "Other people's Bits"], answer: 1 },
  { q: 'A "bear market" is when prices are mostly...', options: ['Rising', 'Falling', 'Hibernating forever', 'Doubling'], answer: 1 },
  { q: 'What is a good reason to train a worker?', options: ['They level up and produce more', 'They get shorter', 'To make them cursed', 'No reason'], answer: 0 },
  { q: 'If 3 workers each make 5 BT per tick, the total is...', options: ['8 BT', '15 BT', '53 BT', '35 BT'], answer: 1 },
  { q: 'What does a marketing campaign bring in?', options: ['More customers', 'More taxes', 'Fewer workers', 'Rain'], answer: 0 },
  { q: 'An emergency fund is for...', options: ['Unexpected costs', 'Buying memes', 'Never using', 'Paying the Owner'], answer: 0 },
  { q: 'Boss Byte is...', options: ['A robot mascot', 'A real bank', 'A stock', 'A pizza topping'], answer: 0 },
  { q: '10% of 500 BT is...', options: ['5 BT', '50 BT', '500 BT', '10 BT'], answer: 1 },
];
const QUIZ_LEN = 8;

function quizFor(seed: number) {
  const idx = QUIZ.map((_, i) => i);
  let h = seed >>> 0;
  for (let i = idx.length - 1; i > 0; i--) {
    h = (Math.imul(h ^ (h >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
    const j = h % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, QUIZ_LEN);
}

// ------------------------------------------------------------ sessions
function allowed(companyId: string, game: string) {
  const perms = getCompanyPermissions(companyId);
  if (!MINIGAME_IDS.includes(game as any)) throw notFound('No such mini-game.');
  if (!perms.limits.allowedMinigames.includes(game)) throw forbidden('The Owner has switched this mini-game off for your company.', 'minigame_locked');
}

export function arcadeView(companyId: string) {
  const perms = getCompanyPermissions(companyId);
  const c = cfg().minigames;
  const co = getCompany(companyId);
  return {
    games: MINIGAMES.map((g) => ({ ...g, allowed: perms.limits.allowedMinigames.includes(g.id), best: getStat(companyId, `best:${g.id}`), plays: getStat(companyId, `plays:${g.id}`) })),
    earnedToday: today(companyId, 'minigameEarned'),
    dailyCap: c.dailyCap,
    maxPerPlay: c.maxPayoutPerPlay,
    payoutPerPoint: Math.round(c.payoutPerPoint * multiplier('minigame', co) * 100) / 100,
  };
}

export function startGame(companyId: string, game: string) {
  allowed(companyId, game);
  const id = newId('mgs');
  const seed = Math.floor(Math.random() * 2 ** 31);
  db.insert(schema.minigameSessions).values({ id, companyId, game, seed, startedAt: clock.now(), finishedAt: null, score: null, payout: null, flagged: false }).run();
  const out: Record<string, unknown> = { sessionId: id, seed, game };
  if (game === 'quiz-show') out.questions = quizFor(seed).map((i) => ({ q: QUIZ[i].q, options: QUIZ[i].options }));
  return out;
}

export function finishGame(companyId: string, accountId: string, sessionId: string, input: { score: number; answers?: number[] }) {
  return atomic(() => {
    const s = db.select().from(schema.minigameSessions).where(and(eq(schema.minigameSessions.id, sessionId), eq(schema.minigameSessions.companyId, companyId))).get();
    if (!s) throw notFound('No such game session.');
    if (s.finishedAt) throw conflict('This game was already scored.');
    const c = cfg().minigames;
    const now = clock.now();
    const elapsed = now - s.startedAt;
    let score = Math.max(0, Math.floor(input.score));
    if (s.game === 'quiz-show') {
      const qs = quizFor(s.seed);
      score = qs.reduce((n, qi, i) => n + (input.answers?.[i] === QUIZ[qi].answer ? 3 : 0), 0);
    }
    const maxPts = (c.maxPointsPerSecond[s.game] ?? 1) * (elapsed / 1000) + 5;
    let flagged = false;
    let reason: string | null = null;
    if (elapsed < c.minDurationMs) [flagged, reason] = [true, 'too fast'];
    else if (elapsed > c.maxDurationMs + 30_000) reason = 'Game timed out (too long). No Bits this time.';
    else if (score > maxPts) [flagged, reason] = [true, 'implausible score'];
    let payout = 0;
    if (!reason) {
      const co = getCompany(companyId);
      const raw = Math.floor(score * c.payoutPerPoint * multiplier('minigame', co, now));
      const room = Math.max(0, c.dailyCap - today(companyId, 'minigameEarned'));
      const want = Math.min(raw, c.maxPayoutPerPlay, room, balanceOf(SYS.TREASURY));
      if (want > 0) payout = payCompany({ companyId, amount: want, from: SYS.TREASURY, kind: 'reward.minigame', memo: s.game, actorId: accountId, earn: true, partial: true });
      bump(companyId, 'minigameEarned', payout);
    }
    if (flagged) recordFlag('minigame', companyId, `${s.game}: score ${score} in ${Math.round(elapsed / 1000)}s (${reason})`, 2, accountId);
    db.update(schema.minigameSessions).set({ finishedAt: now, score, payout, flagged }).where(eq(schema.minigameSessions.id, s.id)).run();
    bump(companyId, 'minigames');
    bumpLifetime(companyId, `plays:${s.game}`);
    const best = getStat(companyId, `best:${s.game}`);
    const newBest = !flagged && score > best;
    if (newBest) sqlite.prepare(`INSERT INTO stats (company_id, key, value) VALUES (?, ?, ?) ON CONFLICT(company_id, key) DO UPDATE SET value = excluded.value`).run(companyId, `best:${s.game}`, score);
    if (!flagged) addPassXp(companyId, 10);
    const capped = !reason && payout < Math.min(Math.floor(score * c.payoutPerPoint), c.maxPayoutPerPlay);
    return {
      score,
      payout,
      newBest,
      best: Math.max(best, newBest ? score : 0),
      note: flagged ? "Boss Byte's cheat-o-meter beeped. No Bits for that one!" : reason ?? (capped ? 'Daily arcade cap reached - come back tomorrow for more Bits!' : null),
      answers: s.game === 'quiz-show' ? quizFor(s.seed).map((i) => QUIZ[i].answer) : undefined,
    };
  });
}

export function recentScores(companyId: string) {
  return db.select().from(schema.minigameSessions).where(eq(schema.minigameSessions.companyId, companyId)).orderBy(desc(schema.minigameSessions.startedAt)).limit(20).all();
}

/** Global arcade high-score table for one game. */
export function arcadeLeaders(game: string) {
  return (sqlite.prepare(`SELECT s.company_id, s.value, c.name, c.emoji FROM stats s JOIN companies c ON c.id = s.company_id WHERE s.key = ? ORDER BY s.value DESC LIMIT 10`).all(`best:${game}`) as Array<{ company_id: string; value: number; name: string; emoji: string }>).map((r, i) => ({ rank: i + 1, companyId: r.company_id, name: r.name, emoji: r.emoji, score: r.value }));
}
