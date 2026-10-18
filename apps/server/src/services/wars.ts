/**
 * Business Wars: friendly company-vs-company and guild-vs-guild contests scored
 * on real in-game stats over a time window. Created by the owner (or the
 * system scheduler) or as player challenges the other side must accept.
 *
 * Participants rows: sideId = company id (company wars) or guild id (guild
 * wars). Guild wars also keep one contributor row per member, sideId
 * "<guildId>|<companyId>", holding that member's baseline so joins/leaves
 * during the war can't skew the score.
 */
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { db, schema, atomic } from '../db';
import { clock } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { cfg } from './settings';
import { SYS, post, balanceOf } from './ledger';
import { payCompany } from './money';
import { findCompany, getCompany } from './companies';
import { getStat, bump, today } from './stats';
import { addNews } from './news';
import { notify } from './notifications';
import { audit } from './audit';
import { toCompany, toAll } from '../lib/bus';
import { flag } from './flags';
import { guildWallet, guildIdOf } from './guilds';

export const CONTESTS = {
  sprint: { name: 'Sales Sprint', emoji: '🏃', stat: 'sold', unit: 'units sold' },
  marketshare: { name: 'Market-Share Battle', emoji: '📊', stat: 'revenue', unit: 'BT of sales' },
  hackathon: { name: 'Hackathon', emoji: '💻', stat: 'contracts', unit: 'contracts done' },
  bakeoff: { name: 'Bake-Off', emoji: '🧁', stat: 'produced', unit: 'items produced' },
  race: { name: 'Earning Race', emoji: '💰', stat: 'earned', unit: 'BT earned' },
} as const;
export type Contest = keyof typeof CONTESTS;

type War = typeof schema.wars.$inferSelect;

function sideName(kind: string, id: string) {
  if (kind === 'guild') {
    const g = db.select().from(schema.guilds).where(eq(schema.guilds.id, id)).get();
    return g ? `${g.emoji} ${g.name}` : 'Disbanded guild';
  }
  const co = findCompany(id);
  return co ? `${co.emoji} ${co.name}` : 'Closed company';
}

function sides(warId: string) {
  return db.select().from(schema.warParticipants).where(eq(schema.warParticipants.warId, warId)).all();
}

function guildMemberIds(guildId: string) {
  return db.select({ id: schema.guildMembers.companyId }).from(schema.guildMembers).where(eq(schema.guildMembers.guildId, guildId)).all().map((r) => r.id);
}

/** Every company that should hear about this war. */
function audience(war: War): string[] {
  const rows = sides(war.id);
  if (war.kind === 'company') return rows.map((r) => r.sideId);
  return rows.filter((r) => r.sideId.includes('|')).map((r) => r.sideId.split('|')[1]);
}

export function createWar(input: { kind: 'company' | 'guild'; contest: Contest; sideIds: string[]; durationMin: number; prize?: number; consolation?: number; startInMin?: number; name?: string; createdBy?: string | null; pending?: boolean }, actorId: string | null) {
  return atomic(() => {
    const ids = [...new Set(input.sideIds)];
    if (ids.length < 2) throw badRequest('A war needs at least two sides.');
    for (const id of ids) {
      if (input.kind === 'company' && !findCompany(id)) throw notFound(`No company ${id}.`);
      if (input.kind === 'guild' && !db.select().from(schema.guilds).where(eq(schema.guilds.id, id)).get()) throw notFound(`No guild ${id}.`);
    }
    const c = cfg().wars;
    const contest = CONTESTS[input.contest];
    if (!contest) throw badRequest('Unknown contest type.');
    const now = clock.now();
    const startsAt = now + Math.max(0, input.startInMin ?? 0) * 60_000;
    const id = newId('war');
    const war = {
      id,
      name: input.name?.trim() || `${contest.emoji} ${contest.name}: ${ids.map((x) => sideName(input.kind, x).replace(/^\S+\s/, '')).slice(0, 3).join(' vs ')}${ids.length > 3 ? ' & more' : ''}`,
      kind: input.kind,
      metric: contest.stat,
      contest: input.contest,
      prize: input.prize ?? c.defaultPrize,
      consolation: input.consolation ?? c.defaultConsolation,
      startsAt,
      endsAt: startsAt + Math.max(5, input.durationMin) * 60_000,
      status: input.pending ? 'pending' : 'scheduled',
      winnerId: null,
      createdBy: input.createdBy ?? null,
      createdAt: now,
    };
    db.insert(schema.wars).values(war).run();
    for (const sid of ids) db.insert(schema.warParticipants).values({ warId: id, sideId: sid, baseline: 0, score: 0 }).run();
    if (!input.pending) {
      if (startsAt <= now) startWar(getWar(id));
      addNews('headline', `⚔️ Business War declared: ${war.name}!`, `${contest.name} - most ${contest.unit} wins ${war.prize} BT. May the best biz win!`);
    }
    if (actorId) audit({ actorId, action: 'war.create', targetType: 'war', targetId: id, newValue: { kind: input.kind, contest: input.contest, sides: ids, prize: war.prize } });
    return { id };
  });
}

export function getWar(id: string): War {
  const w = db.select().from(schema.wars).where(eq(schema.wars.id, id)).get();
  if (!w) throw notFound('No such war.');
  return w;
}

function startWar(war: War) {
  const stat = war.metric;
  for (const p of sides(war.id)) {
    if (war.kind === 'company') {
      db.update(schema.warParticipants).set({ baseline: getStat(p.sideId, stat), score: 0 }).where(and(eq(schema.warParticipants.warId, war.id), eq(schema.warParticipants.sideId, p.sideId))).run();
    } else if (!p.sideId.includes('|')) {
      for (const cid of guildMemberIds(p.sideId)) {
        db.insert(schema.warParticipants).values({ warId: war.id, sideId: `${p.sideId}|${cid}`, baseline: getStat(cid, stat), score: 0 }).onConflictDoNothing().run();
      }
    }
  }
  db.update(schema.wars).set({ status: 'active' }).where(eq(schema.wars.id, war.id)).run();
  for (const cid of audience({ ...war, status: 'active' })) {
    toCompany(cid, { type: 'war', event: 'start', id: war.id, name: war.name });
    notify(cid, 'war', `⚔️ ${war.name} has begun!`, `Ends in ${Math.round((war.endsAt - clock.now()) / 60_000)} min.`);
  }
}

/** Live scores for each main side (contributors summed for guilds). */
export function scoreboard(war: War) {
  const rows = sides(war.id);
  const main = rows.filter((r) => !r.sideId.includes('|'));
  return main
    .map((m) => {
      let score = 0;
      if (war.status === 'active' || war.status === 'finished') {
        if (war.kind === 'company') score = war.status === 'active' ? Math.max(0, getStat(m.sideId, war.metric) - m.baseline) : m.score;
        else if (war.status === 'active') score = rows.filter((r) => r.sideId.startsWith(`${m.sideId}|`)).reduce((s, r) => s + Math.max(0, getStat(r.sideId.split('|')[1], war.metric) - r.baseline), 0);
        else score = m.score;
      }
      return { sideId: m.sideId, name: sideName(war.kind, m.sideId), score };
    })
    .sort((a, b) => b.score - a.score);
}

function award(war: War, sideId: string, amount: number, kind: string, trophy?: string) {
  if (amount <= 0) return 0;
  const paid = Math.min(amount, balanceOf(SYS.TREASURY));
  if (paid <= 0) return 0;
  if (war.kind === 'guild') {
    if (!db.select().from(schema.guilds).where(eq(schema.guilds.id, sideId)).get()) return 0;
    post({ kind, memo: war.name, legs: [{ from: SYS.TREASURY, to: guildWallet(sideId), amount: paid }] });
    if (trophy) for (const cid of guildMemberIds(sideId)) addTrophy(cid, trophy);
  } else {
    if (!findCompany(sideId)) return 0;
    payCompany({ companyId: sideId, amount: paid, from: SYS.TREASURY, kind, memo: war.name, earn: false, partial: true });
    if (trophy) addTrophy(sideId, trophy);
  }
  return paid;
}

function addTrophy(companyId: string, trophy: string) {
  const co = findCompany(companyId);
  if (!co) return;
  const list = [...(co.trophies ?? []), trophy].slice(-50);
  db.update(schema.companies).set({ trophies: list }).where(eq(schema.companies.id, companyId)).run();
  bump(companyId, 'warsWon');
}

function finishWar(war: War) {
  atomic(() => {
    const board = scoreboard(war);
    for (const b of board) db.update(schema.warParticipants).set({ score: b.score }).where(and(eq(schema.warParticipants.warId, war.id), eq(schema.warParticipants.sideId, b.sideId))).run();
    const top = board[0];
    const hasWinner = top && top.score > 0 && (board.length < 2 || top.score > board[1].score);
    db.update(schema.wars).set({ status: 'finished', winnerId: hasWinner ? top.sideId : null }).where(eq(schema.wars.id, war.id)).run();
    const contest = CONTESTS[war.contest as Contest] ?? CONTESTS.race;
    if (hasWinner) award(war, top.sideId, war.prize, 'war.prize', `${contest.emoji} ${war.name}`);
    for (const b of board) if (!hasWinner || b.sideId !== top.sideId) award(war, b.sideId, war.consolation, 'war.consolation');
    for (const cid of audience(war)) {
      toCompany(cid, { type: 'war', event: 'end', id: war.id, winner: hasWinner ? top.name : null });
      bump(cid, 'wars');
    }
    addNews(
      'headline',
      hasWinner ? `🏆 ${top.name} wins "${war.name}"!` : `🤝 "${war.name}" ends in a draw!`,
      hasWinner ? `Final score: ${board.map((b) => `${b.name} ${b.score}`).join(' · ')}. Everyone else takes home a consolation prize.` : 'Nobody pulled ahead. Boss Byte declares everyone a winner of participation stickers.',
    );
  });
}

/** Global hook: start scheduled wars, push live scores, finish expired ones. */
export function warTick(now: number) {
  if (!flag('wars')) return;
  for (const w of db.select().from(schema.wars).where(inArray(schema.wars.status, ['scheduled', 'active'])).all()) {
    if (w.status === 'scheduled' && w.startsAt <= now) startWar(w);
    else if (w.status === 'active' && w.endsAt <= now) finishWar(w);
    else if (w.status === 'active') {
      const board = scoreboard(w);
      for (const cid of audience(w)) toCompany(cid, { type: 'war', event: 'score', id: w.id, board });
    }
  }
  // stale challenges expire after 30 minutes
  db.update(schema.wars).set({ status: 'declined' }).where(and(eq(schema.wars.status, 'pending'), sql`${schema.wars.createdAt} < ${now - 30 * 60_000}`)).run();
}

/** System scheduler: a guild Grand Prix every few hours when 2+ guilds exist. */
export function autoScheduleWar() {
  if (!flag('wars') || !flag('guilds')) return;
  const active = db.select().from(schema.wars).where(and(inArray(schema.wars.status, ['scheduled', 'active']), eq(schema.wars.kind, 'guild'), sql`${schema.wars.createdBy} IS NULL`)).get();
  if (active) return;
  const guilds = db.select().from(schema.guilds).orderBy(desc(schema.guilds.level)).limit(8).all();
  if (guilds.length < 2) return;
  const keys = Object.keys(CONTESTS) as Contest[];
  const contest = keys[Math.floor(Math.random() * keys.length)];
  createWar({ kind: 'guild', contest, sideIds: guilds.map((g) => g.id), durationMin: Math.round(cfg().wars.defaultDurationMs / 60_000), startInMin: 10, name: `🏁 Guild Grand Prix: ${CONTESTS[contest].name}` }, null);
}

// ------------------------------------------------------------ player challenges
export function challenge(companyId: string, input: { kind: 'company' | 'guild'; targetId: string; contest: Contest; durationMin: number }, actorId: string) {
  const c = cfg().wars;
  if (!c.challengeDurationsMin.includes(input.durationMin)) throw badRequest('Pick one of the allowed durations.');
  if (today(companyId, 'challenges') >= c.challengesPerDay) throw forbidden(`You can send ${c.challengesPerDay} challenges per day.`, 'challenge_cap');
  let mySide = companyId;
  if (input.kind === 'guild') {
    const g = guildIdOf(companyId);
    if (!g) throw badRequest('Join a guild first.');
    const lead = db.select().from(schema.guilds).where(eq(schema.guilds.id, g)).get();
    if (lead?.leaderId !== companyId) throw forbidden('Only the guild leader can declare a guild war.');
    mySide = g;
  }
  if (mySide === input.targetId) throw badRequest('You can not challenge yourself. (Boss Byte checked.)');
  // no duplicate live war between the same pair
  const open = db
    .select({ id: schema.wars.id })
    .from(schema.wars)
    .innerJoin(schema.warParticipants, eq(schema.warParticipants.warId, schema.wars.id))
    .where(and(inArray(schema.wars.status, ['pending', 'scheduled', 'active']), eq(schema.warParticipants.sideId, input.targetId), eq(schema.wars.createdBy, mySide)))
    .get();
  if (open) throw conflict('You already have a war going with them.');
  const r = createWar({ kind: input.kind, contest: input.contest, sideIds: [mySide, input.targetId], durationMin: input.durationMin, prize: c.challengePrize, consolation: c.challengeConsolation, createdBy: mySide, pending: true }, actorId);
  bump(companyId, 'challenges');
  const target = input.kind === 'guild' ? db.select().from(schema.guilds).where(eq(schema.guilds.id, input.targetId)).get()?.leaderId : input.targetId;
  if (target) {
    notify(target, 'war', `⚔️ ${sideName(input.kind, mySide)} challenges you!`, `${CONTESTS[input.contest].name} for ${input.durationMin} min. Accept it on the Business Wars page.`);
    toCompany(target, { type: 'war', event: 'challenge', id: r.id });
  }
  return r;
}

export function respond(companyId: string, warId: string, accept: boolean) {
  return atomic(() => {
    const w = getWar(warId);
    if (w.status !== 'pending') throw badRequest('That challenge is no longer open.');
    const ps = sides(warId).map((p) => p.sideId);
    const target = ps.find((s) => s !== w.createdBy);
    const allowed = w.kind === 'company' ? target === companyId : db.select().from(schema.guilds).where(eq(schema.guilds.id, target ?? '')).get()?.leaderId === companyId;
    if (!allowed) throw forbidden('This challenge is not addressed to you.');
    if (!accept) {
      db.update(schema.wars).set({ status: 'declined' }).where(eq(schema.wars.id, warId)).run();
      return { ok: true };
    }
    const dur = w.endsAt - w.startsAt;
    const now = clock.now();
    db.update(schema.wars).set({ status: 'scheduled', startsAt: now, endsAt: now + dur }).where(eq(schema.wars.id, warId)).run();
    startWar(getWar(warId));
    toAll({ type: 'news_ping' });
    addNews('headline', `⚔️ Challenge accepted: ${w.name}!`, 'The rivalry is ON. Popcorn sales up 400%.');
    return { ok: true };
  });
}

export function cancelWar(warId: string, actorId: string) {
  const w = getWar(warId);
  if (w.status === 'finished') throw badRequest('That war is already over.');
  db.update(schema.wars).set({ status: 'declined' }).where(eq(schema.wars.id, warId)).run();
  audit({ actorId, action: 'war.cancel', targetType: 'war', targetId: warId });
  return { ok: true };
}

export function endWarNow(warId: string, actorId: string) {
  const w = getWar(warId);
  if (w.status !== 'active') throw badRequest('Only active wars can be ended early.');
  finishWar(w);
  audit({ actorId, action: 'war.end_now', targetType: 'war', targetId: warId });
  return { ok: true };
}

// ------------------------------------------------------------ views
function warDto(w: War) {
  return { ...w, contestInfo: CONTESTS[w.contest as Contest] ?? CONTESTS.race, board: scoreboard(w) };
}

export function warsView(companyId: string) {
  const g = guildIdOf(companyId);
  const mine = [companyId, ...(g ? [g] : [])];
  const myWarIds = db
    .select({ id: schema.warParticipants.warId })
    .from(schema.warParticipants)
    .where(or(inArray(schema.warParticipants.sideId, mine), like(schema.warParticipants.sideId, `%|${companyId}`)))
    .all()
    .map((r) => r.id);
  const live = db.select().from(schema.wars).where(inArray(schema.wars.status, ['scheduled', 'active'])).orderBy(desc(schema.wars.createdAt)).limit(30).all();
  const pending = myWarIds.length ? db.select().from(schema.wars).where(and(eq(schema.wars.status, 'pending'), inArray(schema.wars.id, myWarIds))).all() : [];
  const recent = db.select().from(schema.wars).where(eq(schema.wars.status, 'finished')).orderBy(desc(schema.wars.endsAt)).limit(15).all();
  const co = getCompany(companyId);
  const isLeader = g ? db.select().from(schema.guilds).where(eq(schema.guilds.id, g)).get()?.leaderId === companyId : false;
  return {
    contests: CONTESTS,
    durations: cfg().wars.challengeDurationsMin,
    challengesLeft: Math.max(0, cfg().wars.challengesPerDay - today(companyId, 'challenges')),
    challengePrize: cfg().wars.challengePrize,
    live: live.map((w) => ({ ...warDto(w), mine: myWarIds.includes(w.id) })),
    pending: pending.map((w) => ({ ...warDto(w), incoming: w.createdBy !== companyId && w.createdBy !== g })),
    recent: recent.map((w) => ({ ...warDto(w), mine: myWarIds.includes(w.id) })),
    trophies: co.trophies ?? [],
    guildId: g,
    isGuildLeader: isLeader,
  };
}

export function allWars(limit = 100) {
  return db.select().from(schema.wars).orderBy(desc(schema.wars.createdAt)).limit(limit).all().map(warDto);
}
