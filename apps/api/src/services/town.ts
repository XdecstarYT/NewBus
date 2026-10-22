/**
 * The town: a world event every game day, projects everyone builds together, and
 * the temporary boosts both of them switch on for the whole game.
 */
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { GAME_DAY, GAME_EPOCH, ITEMS, PROJECT_BLUEPRINTS, WORLD_EVENTS, gameDay, gameDayKey, isItem, type Boost, type BoostKind, type ItemId, type WorldEvent } from '@dw/shared/live';
import { schema, type Db } from '../db';
import type { Account, Company } from '../http/router';
import { clock } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, conflict, notFound } from '../lib/errors';
import { addNews, assertAllowed, audit, getSettings, getValue, hint, setValue, topics } from './core';
import { pay, W } from './money';
import { addItem, takeItem } from './stock';

// ------------------------------------------------------------ boosts
export async function activeBoosts(db: Db, now = clock.now()): Promise<Boost[]> {
  return ((await getValue<Boost[]>(db, 'boosts')) ?? []).filter((b) => b.until > now);
}

async function addBoosts(db: Db, list: Boost[]) {
  const keep = await activeBoosts(db);
  await setValue(db, 'boosts', [...keep, ...list]);
  await hint(db, topics.all, { t: 'town' });
}

const sum = (list: Boost[], kind: BoostKind, match: (b: Boost) => boolean = () => true) => list.filter((b) => b.kind === kind && match(b)).reduce((s, b) => s + b.pct, 0);

/** Extra output % for shifts at this facility (never below −50%). */
export async function outputBonusPct(db: Db, facility: string) {
  return Math.max(-50, sum(await activeBoosts(db), 'output', (b) => !b.facility || b.facility === facility));
}
export async function taxFree(db: Db) {
  return (await activeBoosts(db)).some((b) => b.kind === 'taxfree');
}
/** Extra % AI customers pay for this item. */
export async function customerBonusPct(db: Db, item: string) {
  return sum(await activeBoosts(db), 'customers', (b) => !b.item || b.item === item);
}
/** Items customers especially want right now (from events and projects). */
export async function wantedItems(db: Db) {
  return (await activeBoosts(db)).filter((b) => b.kind === 'customers' && b.item).map((b) => b.item as ItemId);
}
export async function regenBonus(db: Db) {
  return sum(await activeBoosts(db), 'regen');
}
export async function questMultiplier(db: Db) {
  return 1 + sum(await activeBoosts(db), 'quests') / 100;
}

// ------------------------------------------------------------ world events
interface EventState {
  id: string;
  day: string;
  at: number;
}

function rollEvent(): WorldEvent {
  const total = WORLD_EVENTS.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total;
  for (const e of WORLD_EVENTS) if ((r -= e.weight) < 0) return e;
  return WORLD_EVENTS[0];
}

/** Start an event now (lasts until the end of this game day). */
export async function startEvent(db: Db, e: WorldEvent, now = clock.now()) {
  const dayEnd = GAME_EPOCH + gameDay(now) * GAME_DAY;
  // drop boosts of the previous event, keep project boosts
  const keep = (await activeBoosts(db, now)).filter((b) => b.source !== 'event');
  const fresh = e.boosts.map((b) => ({ ...b, id: newId('bst', 8), until: dayEnd, label: e.title, emoji: e.emoji, source: 'event' as const }));
  await setValue(db, 'boosts', [...keep, ...fresh]);
  await setValue(db, 'event', { id: e.id, day: gameDayKey(now), at: now } satisfies EventState);
  if (e.id !== 'quiet') await addNews(db, 'event', `${e.emoji} Day ${gameDay(now)}: ${e.title}`, e.blurb);
  await hint(db, topics.all, { t: 'town' });
}

/** Called by the sweep: a new event when a new game day starts. */
export async function sweepEvents(db: Db, now: number) {
  const cur = await getValue<EventState>(db, 'event');
  if (cur?.day === gameDayKey(now)) return;
  if (process.env.DW_WORLD_EVENTS === 'off' || !(await getSettings(db)).worldEvents) return;
  await startEvent(db, rollEvent(), now);
}

export async function today(db: Db) {
  const now = clock.now();
  const cur = await getValue<EventState>(db, 'event');
  const event = cur?.day === gameDayKey(now) ? WORLD_EVENTS.find((e) => e.id === cur.id) ?? null : null;
  return { event, boosts: await activeBoosts(db, now), day: gameDay(now) };
}

// ------------------------------------------------------------ town projects
export async function createProject(db: Db, actor: Account, o: { blueprint: string; scale: number; days: number }) {
  const bp = PROJECT_BLUEPRINTS.find((b) => b.id === o.blueprint);
  if (!bp) throw notFound('No such blueprint.');
  const scale = Math.max(0.25, Math.min(10, o.scale));
  const needItems = Object.fromEntries(Object.entries(bp.items).map(([k, v]) => [k, Math.max(1, Math.round((v ?? 0) * scale))]));
  const now = clock.now();
  const id = newId('prj', 10);
  await db.insert(schema.projects).values({
    id,
    blueprint: bp.id,
    title: bp.title,
    emoji: bp.emoji,
    blurb: bp.blurb,
    needBits: Math.round(bp.bits * scale),
    needItems,
    haveBits: 0,
    haveItems: Object.fromEntries(Object.keys(needItems).map((k) => [k, 0])),
    boost: { ...bp.boost, rewardDays: bp.days },
    days: bp.days,
    status: 'open',
    createdAt: now,
    deadline: now + Math.max(1, Math.min(30, o.days)) * GAME_DAY,
  });
  await audit(db, actor.id, 'town.project.create', id, o);
  await addNews(db, 'project', `${bp.emoji} New town project: ${bp.title}`, `${bp.blurb} Everyone can chip in under 🏙️ Town.`);
  return { id };
}

export async function projectsView(db: Db, companyId: string | null) {
  const rows = await db.select().from(schema.projects).orderBy(desc(schema.projects.createdAt)).limit(20);
  const contribs = await db.select().from(schema.projectContribs);
  const cos = await db.select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji }).from(schema.companies);
  return rows.map((p) => {
    const mine = contribs.filter((c) => c.projectId === p.id).sort((a, b) => b.points - a.points);
    return {
      ...p,
      top: mine.slice(0, 5).map((c) => ({ ...c, company: cos.find((x) => x.id === c.companyId) ?? null })),
      myPoints: companyId ? (mine.find((c) => c.companyId === companyId)?.points ?? 0) : 0,
    };
  });
}

/** Chip in Bits or goods (anything beyond what is still needed is not taken). */
export async function contribute(db: Db, account: Account, company: Company, projectId: string, o: { bits?: number; item?: string; qty?: number }) {
  await assertAllowed(db, company.id, 'transfers');
  const p = (await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).for('update'))[0];
  if (!p || p.status !== 'open' || p.deadline <= clock.now()) throw conflict('That project is not taking contributions.');
  let bits = 0;
  let qty = 0;
  const haveItems = { ...p.haveItems };
  if (o.bits) {
    bits = Math.min(Math.floor(o.bits), p.needBits - p.haveBits);
    if (bits <= 0) throw badRequest('This project has all the Bits it needs.');
    await pay(db, W.company(company.id), W.town, bits, 'town.contribute', `${p.emoji} ${p.title}`, account.id);
  }
  if (o.item) {
    if (!isItem(o.item) || p.needItems[o.item] === undefined) throw badRequest('This project does not need that.');
    qty = Math.min(Math.floor(o.qty ?? 0), p.needItems[o.item] - (haveItems[o.item] ?? 0));
    if (qty <= 0) throw badRequest(`This project has all the ${ITEMS[o.item].name} it needs.`);
    await takeItem(db, company.id, o.item, qty);
    haveItems[o.item] = (haveItems[o.item] ?? 0) + qty;
  }
  if (!bits && !qty) throw badRequest('Give some Bits or goods.');
  const points = bits + (o.item ? qty * ITEMS[o.item as ItemId].basePrice : 0);
  const prev = (await db.select().from(schema.projectContribs).where(and(eq(schema.projectContribs.projectId, p.id), eq(schema.projectContribs.companyId, company.id))))[0];
  const items = { ...(prev?.items ?? {}) };
  if (o.item && qty) items[o.item] = (items[o.item] ?? 0) + qty;
  await db
    .insert(schema.projectContribs)
    .values({ projectId: p.id, companyId: company.id, bits: (prev?.bits ?? 0) + bits, items, points: (prev?.points ?? 0) + points })
    .onConflictDoUpdate({ target: [schema.projectContribs.projectId, schema.projectContribs.companyId], set: { bits: (prev?.bits ?? 0) + bits, items, points: (prev?.points ?? 0) + points } });
  const haveBits = p.haveBits + bits;
  await db.update(schema.projects).set({ haveBits, haveItems }).where(eq(schema.projects.id, p.id));
  // a little prestige for helping the town
  await db.update(schema.companies).set({ prestige: sql`${schema.companies.prestige} + ${Math.max(1, Math.round(points / 40))}` }).where(eq(schema.companies.id, company.id));
  const done = haveBits >= p.needBits && Object.entries(p.needItems).every(([k, v]) => (haveItems[k] ?? 0) >= v);
  if (done) await finishProject(db, p.id);
  await hint(db, topics.all, { t: 'town' });
  return { bits, qty, points, done };
}

async function finishProject(db: Db, id: string) {
  const p = (await db.select().from(schema.projects).where(eq(schema.projects.id, id)))[0];
  const now = clock.now();
  await db.update(schema.projects).set({ status: 'done', doneAt: now }).where(eq(schema.projects.id, id));
  const b = p.boost as unknown as Omit<Boost, 'id' | 'until' | 'label' | 'emoji' | 'source'>;
  await addBoosts(db, [{ kind: b.kind, facility: b.facility ?? '', item: b.item ?? '', pct: b.pct, id: newId('bst', 8), until: now + p.days * GAME_DAY, label: p.title, emoji: p.emoji, source: 'project' }]);
  // the goods were used up; the Bits went into the town budget (the Treasury)
  const budget = p.haveBits;
  if (budget) await pay(db, W.town, W.treasury, budget, 'town.build', `${p.emoji} ${p.title} built`);
  const top = (await db.select().from(schema.projectContribs).where(eq(schema.projectContribs.projectId, id)).orderBy(desc(schema.projectContribs.points)).limit(1))[0];
  const hero = top ? (await db.select().from(schema.companies).where(eq(schema.companies.id, top.companyId)))[0] : null;
  await addNews(db, 'project', `${p.emoji} ${p.title} is finished!`, `${p.blurb} Lasts ${p.days} game day${p.days === 1 ? '' : 's'}.${hero ? ` Biggest helper: ${hero.emoji} ${hero.name}.` : ''}`);
}

/** Refund everyone when a project misses its deadline. */
async function failProject(db: Db, id: string) {
  const p = (await db.select().from(schema.projects).where(eq(schema.projects.id, id)))[0];
  for (const c of await db.select().from(schema.projectContribs).where(eq(schema.projectContribs.projectId, id))) {
    if (c.bits) await pay(db, W.town, W.company(c.companyId), c.bits, 'town.refund', `${p.emoji} ${p.title} was not finished`);
    for (const [item, n] of Object.entries(c.items)) if (n) await addItem(db, c.companyId, item, n);
  }
  await db.update(schema.projects).set({ status: 'failed', doneAt: clock.now() }).where(eq(schema.projects.id, id));
  await addNews(db, 'project', `${p.emoji} ${p.title} ran out of time`, 'Everything people gave was handed back.');
}

export async function cancelProject(db: Db, actor: Account, id: string) {
  const p = (await db.select().from(schema.projects).where(eq(schema.projects.id, id)).for('update'))[0];
  if (!p || p.status !== 'open') throw conflict('Only open projects can be cancelled.');
  await failProject(db, id);
  await audit(db, actor.id, 'town.project.cancel', id);
  return { ok: true };
}

export async function sweepTown(db: Db, now: number) {
  await sweepEvents(db, now);
  for (const p of await db.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.status, 'open'), lt(schema.projects.deadline, now)))) await failProject(db, p.id);
}

/** Owner: switch on any boost by hand (e.g. a surprise holiday). */
export async function ownerBoost(db: Db, actor: Account, b: { kind: BoostKind; facility?: string; item?: string; pct: number; days: number; label: string }) {
  await addBoosts(db, [{ kind: b.kind, facility: (b.facility ?? '') as Boost['facility'], item: (b.item ?? '') as Boost['item'], pct: b.pct, id: newId('bst', 8), until: clock.now() + b.days * GAME_DAY, label: b.label, emoji: '👑', source: 'owner' }]);
  await audit(db, actor.id, 'town.boost', null, b);
  await addNews(db, 'owner', `👑 ${b.label}`, '');
  return { ok: true };
}

export async function clearBoost(db: Db, id: string) {
  await setValue(db, 'boosts', (await activeBoosts(db)).filter((b) => b.id !== id));
  await hint(db, topics.all, { t: 'town' });
  return { ok: true };
}
