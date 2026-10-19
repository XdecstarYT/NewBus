/**
 * Business unions: companies band together, each member business names a rep
 * (the account that votes and stands for office), and the members elect a
 * President, Vice President and Treasurer for fixed terms. Officers spend the
 * union treasury (filled by daily dues) on collective moves; any member can
 * call a vote of no confidence.
 */
import { and, asc, desc, eq, gt, inArray, like, sql } from 'drizzle-orm';
import { UNION_MOVES, UNION_OFFICES, type UnionMove, type UnionOffice } from '@dw/shared';
import { db, schema, atomic } from '../db';
import { clock, dayKey, DAY_MS, HOUR_MS, MINUTE_MS } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { cfg } from './settings';
import { SYS, walletId, balanceOf, post } from './ledger';
import { chargeCompany, companyWallet, payCompany } from './money';
import { findCompany, getCompany } from './companies';
import { getAccount } from './auth';
import { addModifier, registerMultiplier } from './multipliers';
import { addNews } from './news';
import { notify } from './notifications';
import { audit } from './audit';
import { toCompany } from '../lib/bus';
import { addLawWeight } from './strategy';

export type Union = typeof schema.unions.$inferSelect;
export const unionWallet = (id: string) => walletId('union', id, 'main');
const OFFICES = Object.keys(UNION_OFFICES) as UnionOffice[];
const officeCol = { president: 'presidentId', vp: 'vpId', treasurer: 'treasurerId' } as const;

export function getUnion(id: string): Union {
  const u = db.select().from(schema.unions).where(eq(schema.unions.id, id)).get();
  if (!u) throw notFound('No such union.');
  return u;
}

export function membershipOf(companyId: string) {
  return db.select().from(schema.unionMembers).where(eq(schema.unionMembers.companyId, companyId)).get() ?? null;
}

function membersOf(unionId: string) {
  return db.select().from(schema.unionMembers).where(eq(schema.unionMembers.unionId, unionId)).orderBy(asc(schema.unionMembers.joinedAt)).all();
}

function officesHeld(u: Union, companyId: string): UnionOffice[] {
  return OFFICES.filter((o) => u[officeCol[o]] === companyId);
}

function broadcast(unionId: string, msg: Record<string, unknown>) {
  for (const m of membersOf(unionId)) toCompany(m.companyId, msg);
}

function tell(unionId: string, title: string, body = '') {
  for (const m of membersOf(unionId)) notify(m.companyId, 'union', title, body);
}

/** The rep (or a company admin) speaks for a member business. */
function assertSpeaksFor(companyId: string, accountId: string) {
  const m = membershipOf(companyId);
  if (!m) throw badRequest('Your business is not in a union.');
  const acc = getAccount(accountId);
  if (m.repAccountId !== accountId && acc?.role !== 'COMPANY_ADMIN' && acc?.role !== 'OWNER') throw forbidden('Only your business\'s union rep can do that.', 'not_rep');
  return m;
}

function assertAccountOf(companyId: string, accountId: string) {
  const acc = getAccount(accountId);
  if (!acc || acc.companyId !== companyId || acc.status !== 'active') throw badRequest('The rep must be an active login of your business.');
}

// ------------------------------------------------------------ lifecycle
export function createUnion(companyId: string, accountId: string, input: { name: string; emoji: string; motto: string; dues: number }) {
  return atomic(() => {
    if (membershipOf(companyId)) throw conflict('Leave your current union first.');
    const name = input.name.trim();
    if (name.length < 3) throw badRequest('Union names need at least 3 letters.');
    if (db.select().from(schema.unions).where(sql`lower(${schema.unions.name}) = lower(${name})`).get()) throw conflict('That union name is taken.');
    const c = cfg().unions;
    chargeCompany({ companyId, amount: c.createCost, kind: 'union.create', memo: `Founded ${name}`, actorId: accountId });
    const id = newId('uni');
    const now = clock.now();
    db.insert(schema.unions)
      .values({ id, name, emoji: input.emoji || '✊', motto: input.motto.slice(0, 120), presidentId: companyId, vpId: null, treasurerId: null, dues: clampDues(input.dues), influence: 0, open: true, termEndsAt: now + c.termDays * DAY_MS, duesDay: dayKey(now), foundedBy: companyId, createdAt: now })
      .run();
    db.insert(schema.unionMembers).values({ companyId, unionId: id, repAccountId: accountId, joinedAt: now, duesOwed: 0 }).run();
    const co = getCompany(companyId);
    addNews('headline', `${input.emoji || '✊'} ${co.name} founds the union "${name}"`, input.motto || 'Businesses of the world, unite!', companyId);
    audit({ actorId: accountId, action: 'union.create', targetType: 'union', targetId: id, newValue: { name } });
    return { id };
  });
}

const clampDues = (n: number) => Math.max(0, Math.min(5000, Math.floor(n || 0)));

export function joinUnion(companyId: string, accountId: string, unionId: string) {
  return atomic(() => {
    if (membershipOf(companyId)) throw conflict('Your business is already in a union.');
    const u = getUnion(unionId);
    if (!u.open) throw forbidden('This union is not taking new members right now.');
    if (membersOf(unionId).length >= cfg().unions.maxMembers) throw conflict('That union is full.');
    db.insert(schema.unionMembers).values({ companyId, unionId, repAccountId: accountId, joinedAt: clock.now(), duesOwed: 0 }).run();
    const co = getCompany(companyId);
    tell(unionId, `✊ ${co.emoji} ${co.name} joined ${u.name}`, 'Strength in numbers!');
    broadcast(unionId, { type: 'union', id: unionId });
    return { ok: true };
  });
}

function removeMember(unionId: string, companyId: string, why: string) {
  const u = getUnion(unionId);
  db.delete(schema.unionMembers).where(eq(schema.unionMembers.companyId, companyId)).run();
  db.delete(schema.unionCandidates).where(and(eq(schema.unionCandidates.companyId, companyId), inArray(schema.unionCandidates.electionId, openElectionIds(unionId)))).run();
  const rest = membersOf(unionId);
  if (!rest.length) {
    const bal = balanceOf(unionWallet(unionId));
    if (bal > 0) post({ kind: 'union.disband', legs: [{ from: unionWallet(unionId), to: companyWallet(companyId), amount: bal }] });
    db.delete(schema.unionElections).where(eq(schema.unionElections.unionId, unionId)).run();
    db.delete(schema.unions).where(eq(schema.unions.id, unionId)).run();
    addNews('gossip', `${u.emoji} The union "${u.name}" has disbanded.`, 'The last member turned off the lights.');
    return;
  }
  const vacated = officesHeld(u, companyId);
  if (vacated.length) {
    const patch: Partial<Union> = {};
    for (const o of vacated) patch[officeCol[o]] = null;
    // the VP steps up if the President leaves
    if (vacated.includes('president') && u.vpId && u.vpId !== companyId) {
      patch.presidentId = u.vpId;
      patch.vpId = null;
      notify(u.vpId, 'union', `👑 You are now President of ${u.name}`, 'The President left, so the Vice President steps up.');
    }
    db.update(schema.unions).set(patch).where(eq(schema.unions.id, unionId)).run();
  }
  const co = findCompany(companyId);
  if (co) tell(unionId, `👋 ${co.emoji} ${co.name} left ${u.name}`, why);
  broadcast(unionId, { type: 'union', id: unionId });
}

export function leaveUnion(companyId: string, accountId: string) {
  return atomic(() => {
    const m = assertSpeaksFor(companyId, accountId);
    removeMember(m.unionId, companyId, 'They walked out.');
    return { ok: true };
  });
}

export function setRep(companyId: string, actorId: string, repAccountId: string) {
  const m = membershipOf(companyId);
  if (!m) throw badRequest('Your business is not in a union.');
  const actor = getAccount(actorId);
  if (actor?.role !== 'COMPANY_ADMIN' && actor?.role !== 'OWNER' && m.repAccountId !== actorId) throw forbidden('Only the company admin or current rep can change the rep.');
  assertAccountOf(companyId, repAccountId);
  db.update(schema.unionMembers).set({ repAccountId }).where(eq(schema.unionMembers.companyId, companyId)).run();
  return { ok: true };
}

export function donate(companyId: string, accountId: string, amount: number) {
  const m = membershipOf(companyId);
  if (!m) throw badRequest('Your business is not in a union.');
  const amt = Math.floor(amount);
  if (amt < 1) throw badRequest('Donate at least 1 BT.');
  chargeCompany({ companyId, amount: amt, to: unionWallet(m.unionId), kind: 'union.donate', memo: 'Union donation', actorId: accountId });
  broadcast(m.unionId, { type: 'union', id: m.unionId });
  return { ok: true, treasury: balanceOf(unionWallet(m.unionId)) };
}

export function updateUnion(companyId: string, accountId: string, patch: { motto?: string; dues?: number; open?: boolean }) {
  const m = assertSpeaksFor(companyId, accountId);
  const u = getUnion(m.unionId);
  if (u.presidentId !== companyId) throw forbidden('Only the union President can change union settings.');
  db.update(schema.unions)
    .set({ ...(patch.motto != null ? { motto: patch.motto.slice(0, 120) } : {}), ...(patch.dues != null ? { dues: clampDues(patch.dues) } : {}), ...(patch.open != null ? { open: patch.open } : {}) })
    .where(eq(schema.unions.id, u.id))
    .run();
  broadcast(u.id, { type: 'union', id: u.id });
  return { ok: true };
}

export function kickMember(companyId: string, accountId: string, targetId: string) {
  return atomic(() => {
    const m = assertSpeaksFor(companyId, accountId);
    const u = getUnion(m.unionId);
    if (u.presidentId !== companyId) throw forbidden('Only the President can expel members.');
    if (targetId === companyId) throw badRequest('Use Leave instead.');
    const t = membershipOf(targetId);
    if (!t || t.unionId !== u.id) throw notFound('They are not in your union.');
    removeMember(u.id, targetId, 'Expelled by the President.');
    notify(targetId, 'union', `🚪 You were expelled from ${u.name}`);
    return { ok: true };
  });
}

// ------------------------------------------------------------ elections
function openElectionIds(unionId: string) {
  return db.select({ id: schema.unionElections.id }).from(schema.unionElections).where(and(eq(schema.unionElections.unionId, unionId), sql`${schema.unionElections.status} != 'closed'`)).all().map((r) => r.id);
}

function startElection(unionId: string, office: UnionOffice, calledBy: string | null) {
  const open = db.select().from(schema.unionElections).where(and(eq(schema.unionElections.unionId, unionId), eq(schema.unionElections.office, office), sql`${schema.unionElections.status} != 'closed'`)).get();
  if (open) return open;
  const c = cfg().unions;
  const now = clock.now();
  const row = { id: newId('uel'), unionId, office, targetId: null, targetOffice: null, status: 'nominating', votingAt: now + c.nominateMinutes * MINUTE_MS, closesAt: now + (c.nominateMinutes + c.voteMinutes) * MINUTE_MS, winnerId: null, result: null, calledBy, createdAt: now };
  db.insert(schema.unionElections).values(row).run();
  return row;
}

/** The President can call an early election; terms ending call them automatically. */
export function callElection(companyId: string, accountId: string, office: UnionOffice) {
  const m = assertSpeaksFor(companyId, accountId);
  const u = getUnion(m.unionId);
  if (!OFFICES.includes(office)) throw badRequest('Unknown office.');
  if (u.presidentId && u.presidentId !== companyId) throw forbidden('Only the President can call an early election (anyone can call a vote of no confidence).');
  const e = startElection(u.id, office, companyId);
  tell(u.id, `🗳️ ${u.name}: election for ${UNION_OFFICES[office].label}`, 'Nominations are open. Run for office in ✊ Unions!');
  broadcast(u.id, { type: 'union', id: u.id });
  return e;
}

export function nominate(companyId: string, accountId: string, electionId: string, pitch: string) {
  const m = assertSpeaksFor(companyId, accountId);
  const e = db.select().from(schema.unionElections).where(eq(schema.unionElections.id, electionId)).get();
  if (!e || e.unionId !== m.unionId) throw notFound('No such election in your union.');
  if (e.office === 'recall') throw badRequest('Nobody runs in a vote of no confidence.');
  if (e.status !== 'nominating') throw conflict('Nominations have closed.');
  db.insert(schema.unionCandidates)
    .values({ electionId, companyId, pitch: pitch.slice(0, 200), at: clock.now() })
    .onConflictDoUpdate({ target: [schema.unionCandidates.electionId, schema.unionCandidates.companyId], set: { pitch: pitch.slice(0, 200) } })
    .run();
  broadcast(m.unionId, { type: 'union', id: m.unionId });
  return { ok: true };
}

export function withdraw(companyId: string, accountId: string, electionId: string) {
  const m = assertSpeaksFor(companyId, accountId);
  db.delete(schema.unionCandidates).where(and(eq(schema.unionCandidates.electionId, electionId), eq(schema.unionCandidates.companyId, companyId))).run();
  broadcast(m.unionId, { type: 'union', id: m.unionId });
  return { ok: true };
}

export function vote(companyId: string, accountId: string, electionId: string, choice: string) {
  return atomic(() => {
    const m = assertSpeaksFor(companyId, accountId);
    const e = db.select().from(schema.unionElections).where(eq(schema.unionElections.id, electionId)).get();
    if (!e || e.unionId !== m.unionId) throw notFound('No such election in your union.');
    if (e.status !== 'voting') throw conflict(e.status === 'nominating' ? 'Voting has not opened yet.' : 'Voting has closed.');
    if (e.office === 'recall') {
      if (choice !== 'yes' && choice !== 'no') throw badRequest('Vote yes or no.');
    } else if (!db.select().from(schema.unionCandidates).where(and(eq(schema.unionCandidates.electionId, electionId), eq(schema.unionCandidates.companyId, choice))).get()) {
      throw badRequest('That business is not on the ballot.');
    }
    db.insert(schema.unionVotes)
      .values({ electionId, voterId: companyId, choice, accountId, at: clock.now() })
      .onConflictDoUpdate({ target: [schema.unionVotes.electionId, schema.unionVotes.voterId], set: { choice, accountId, at: clock.now() } })
      .run();
    broadcast(m.unionId, { type: 'union', id: m.unionId });
    return { ok: true };
  });
}

/** Vote of no confidence against an office holder: straight to a yes/no vote. */
export function callRecall(companyId: string, accountId: string, office: UnionOffice) {
  return atomic(() => {
    const m = assertSpeaksFor(companyId, accountId);
    const u = getUnion(m.unionId);
    const holder = u[officeCol[office]];
    if (!holder) throw badRequest('Nobody holds that office.');
    if (holder === companyId) throw badRequest('You can just resign instead.');
    if (membersOf(u.id).length < 3) throw conflict('A union needs at least 3 members for a vote of no confidence.');
    if (db.select().from(schema.unionElections).where(and(eq(schema.unionElections.unionId, u.id), eq(schema.unionElections.office, 'recall'), sql`${schema.unionElections.status} != 'closed'`)).get()) throw conflict('A vote of no confidence is already running.');
    const c = cfg().unions;
    chargeCompany({ companyId, amount: c.recallCost, to: unionWallet(u.id), kind: 'union.recall', memo: 'Vote of no confidence', actorId: accountId });
    const now = clock.now();
    const row = { id: newId('uel'), unionId: u.id, office: 'recall', targetId: holder, targetOffice: office, status: 'voting', votingAt: now, closesAt: now + c.voteMinutes * MINUTE_MS, winnerId: null, result: null, calledBy: companyId, createdAt: now };
    db.insert(schema.unionElections).values(row).run();
    const target = findCompany(holder);
    tell(u.id, `⚠️ Vote of no confidence in ${u.name}`, `Should ${target?.name ?? '?'} stay as ${UNION_OFFICES[office].label}? Vote now.`);
    broadcast(u.id, { type: 'union', id: u.id });
    return row;
  });
}

export function resign(companyId: string, accountId: string, office: UnionOffice) {
  const m = assertSpeaksFor(companyId, accountId);
  const u = getUnion(m.unionId);
  if (u[officeCol[office]] !== companyId) throw badRequest('You do not hold that office.');
  db.update(schema.unions).set({ [officeCol[office]]: null }).where(eq(schema.unions.id, u.id)).run();
  startElection(u.id, office, null);
  tell(u.id, `📭 ${u.name}: the ${UNION_OFFICES[office].label} resigned`, 'An election has been called.');
  return { ok: true };
}

function closeElection(e: typeof schema.unionElections.$inferSelect) {
  const u = db.select().from(schema.unions).where(eq(schema.unions.id, e.unionId)).get();
  if (!u) return;
  const votes = db.select().from(schema.unionVotes).where(eq(schema.unionVotes.electionId, e.id)).all();
  const tally: Record<string, number> = {};
  for (const v of votes) tally[v.choice] = (tally[v.choice] ?? 0) + 1;
  let winnerId: string | null = null;
  if (e.office === 'recall') {
    const members = membersOf(u.id).length;
    const removed = (tally.yes ?? 0) > (tally.no ?? 0) && (tally.yes ?? 0) * 3 >= members;
    const office = e.targetOffice as UnionOffice;
    const target = findCompany(e.targetId ?? '');
    if (removed && u[officeCol[office]] === e.targetId) {
      db.update(schema.unions).set({ [officeCol[office]]: null }).where(eq(schema.unions.id, u.id)).run();
      startElection(u.id, office, null);
      addNews('gossip', `${u.emoji} ${target?.name ?? '?'} ousted as ${UNION_OFFICES[office].label} of ${u.name}!`, `No confidence: ${tally.yes ?? 0} to ${tally.no ?? 0}.`, e.targetId);
      tell(u.id, `🗳️ ${target?.name ?? '?'} was voted out`, 'An election for the empty office has started.');
    } else tell(u.id, `🗳️ ${target?.name ?? '?'} survives the vote of no confidence`, `${tally.yes ?? 0} yes, ${tally.no ?? 0} no.`);
    winnerId = removed ? 'yes' : 'no';
  } else {
    const cands = db.select().from(schema.unionCandidates).where(eq(schema.unionCandidates.electionId, e.id)).orderBy(asc(schema.unionCandidates.at)).all();
    const stillMembers = new Set(membersOf(u.id).map((m) => m.companyId));
    const valid = cands.filter((c) => stillMembers.has(c.companyId));
    if (valid.length) {
      winnerId = valid.reduce((best, c) => ((tally[c.companyId] ?? 0) > (tally[best.companyId] ?? 0) ? c : best), valid[0]).companyId;
      const office = e.office as UnionOffice;
      const patch: Partial<Union> = { [officeCol[office]]: winnerId };
      // one office per business
      for (const o of OFFICES) if (o !== office && u[officeCol[o]] === winnerId) patch[officeCol[o]] = null;
      db.update(schema.unions).set(patch).where(eq(schema.unions.id, u.id)).run();
      const w = findCompany(winnerId);
      addNews('headline', `${UNION_OFFICES[office].emoji} ${w?.emoji} ${w?.name} elected ${UNION_OFFICES[office].label} of ${u.emoji} ${u.name}`, `${tally[winnerId] ?? 0} of ${votes.length} votes.`, winnerId);
      notify(winnerId, 'union', `${UNION_OFFICES[office].emoji} You won! ${UNION_OFFICES[office].label} of ${u.name}`, 'Use your powers wisely.');
    } else tell(u.id, `🗳️ Nobody ran for ${UNION_OFFICES[e.office as UnionOffice].label} in ${u.name}`, 'The office stays as it is.');
  }
  db.update(schema.unionElections).set({ status: 'closed', winnerId, result: tally }).where(eq(schema.unionElections.id, e.id)).run();
  broadcast(u.id, { type: 'union', id: u.id });
}

/** Advance election phases, start term elections, collect daily dues. */
export function unionsTick(now: number) {
  for (const e of db.select().from(schema.unionElections).where(and(eq(schema.unionElections.status, 'nominating'), sql`${schema.unionElections.votingAt} <= ${now}`)).all()) {
    db.update(schema.unionElections).set({ status: 'voting' }).where(eq(schema.unionElections.id, e.id)).run();
    tell(e.unionId, `🗳️ Voting is open: ${UNION_OFFICES[e.office as UnionOffice]?.label ?? 'election'}`, 'Your rep casts one vote for your business.');
  }
  for (const e of db.select().from(schema.unionElections).where(and(eq(schema.unionElections.status, 'voting'), sql`${schema.unionElections.closesAt} <= ${now}`)).all()) closeElection(e);
  const c = cfg().unions;
  for (const u of db.select().from(schema.unions).where(sql`${schema.unions.termEndsAt} <= ${now}`).all()) {
    db.update(schema.unions).set({ termEndsAt: now + c.termDays * DAY_MS }).where(eq(schema.unions.id, u.id)).run();
    for (const o of OFFICES) startElection(u.id, o, null);
    tell(u.id, `🗳️ ${u.name}: the term is over!`, 'Elections for President, Vice President and Treasurer have started.');
  }
  const today = dayKey(now);
  for (const u of db.select().from(schema.unions).where(sql`coalesce(${schema.unions.duesDay}, '') != ${today}`).all()) {
    db.update(schema.unions).set({ duesDay: today }).where(eq(schema.unions.id, u.id)).run();
    if (u.dues <= 0) continue;
    for (const m of membersOf(u.id)) {
      try {
        chargeCompany({ companyId: m.companyId, amount: u.dues, to: unionWallet(u.id), kind: 'union.dues', memo: `${u.name} dues`, spend: false });
        if (m.duesOwed) db.update(schema.unionMembers).set({ duesOwed: 0 }).where(eq(schema.unionMembers.companyId, m.companyId)).run();
      } catch {
        const owed = m.duesOwed + 1;
        if (owed >= 3) {
          removeMember(u.id, m.companyId, 'Expelled for not paying dues.');
          notify(m.companyId, 'union', `🚪 Expelled from ${u.name}`, 'Three days of unpaid dues.');
        } else {
          db.update(schema.unionMembers).set({ duesOwed: owed }).where(eq(schema.unionMembers.companyId, m.companyId)).run();
          notify(m.companyId, 'union', `💸 Could not pay ${u.name} dues`, `Strike ${owed} of 3. Top up your balance!`);
        }
      }
    }
  }
}

// ------------------------------------------------------------ collective moves
export function unionMove(companyId: string, accountId: string, move: UnionMove, opts: { targetId?: string; amount?: number; lawId?: string; side?: 'for' | 'against' }) {
  return atomic(() => {
    const m = assertSpeaksFor(companyId, accountId);
    const u = getUnion(m.unionId);
    const def = UNION_MOVES[move];
    if (!def) throw badRequest('Unknown move.');
    const held = officesHeld(u, companyId);
    const allowed = held.includes(def.office as UnionOffice) || held.includes('president');
    if (!allowed) throw forbidden(`Only the ${UNION_OFFICES[def.office as UnionOffice].label}${def.office !== 'president' ? ' or President' : ''} can do that.`);
    const wallet = unionWallet(u.id);
    const now = clock.now();
    const source = `union:${u.id}:${move}`;
    if (def.cost > 0) {
      const last = db.select({ at: schema.modifiers.createdAt }).from(schema.modifiers).where(and(like(schema.modifiers.source, `${source}%`), gt(schema.modifiers.createdAt, now - cfg().unions.moveCooldownHours * HOUR_MS))).get();
      if (last) throw conflict(`${def.label} is on cooldown for ${Math.ceil((last.at + cfg().unions.moveCooldownHours * HOUR_MS - now) / MINUTE_MS)} more min.`);
      if (balanceOf(wallet) < def.cost) throw badRequest(`The union treasury needs ${def.cost} BT for that.`);
      post({ kind: `union.${move}`, memo: def.label, actorId: accountId, legs: [{ from: wallet, to: SYS.TREASURY, amount: def.cost }] });
    }
    const members = membersOf(u.id);
    if (move === 'bargain') for (const x of members) addModifier(x.companyId, 'wages', 0.94, 360, source);
    else if (move === 'rally') for (const x of members) addModifier(x.companyId, 'mood', 6, 240, source);
    else if (move === 'coop') for (const x of members) addModifier(x.companyId, 'traffic', 1.05, 240, source);
    else if (move === 'strike') {
      const t = opts.targetId ? findCompany(opts.targetId) : null;
      if (!t) throw badRequest('Pick a company to strike against.');
      if (membershipOf(t.id)?.unionId === u.id) throw badRequest('You can not strike against your own member.');
      addModifier(t.id, 'traffic', 0.88, 180, `${source}:${t.id}`);
      addNews('headline', `🪧 ${u.emoji} ${u.name} pickets ${t.emoji} ${t.name}!`, 'Customers are crossing the street to avoid the noise.', t.id);
      notify(t.id, 'union', `🪧 ${u.name} is striking against you`, '-12% customers for 3 hours. Maybe make friends?');
    } else if (move === 'grant') {
      const to = opts.targetId ? membershipOf(opts.targetId) : null;
      if (!to || to.unionId !== u.id) throw badRequest('Grants go to members of your union.');
      const amt = Math.floor(opts.amount ?? 0);
      if (amt < 1 || amt > balanceOf(wallet)) throw badRequest('Not enough Bits in the treasury.');
      payCompany({ companyId: to.companyId, amount: amt, from: wallet, kind: 'union.grant', memo: `${u.name} grant`, earn: false, actorId: accountId });
      notify(to.companyId, 'union', `🎁 ${u.name} sent you a grant`, `${amt} BT from the union treasury.`);
    } else if (move === 'lobby') {
      const amt = Math.floor(opts.amount ?? 0);
      if (amt < 100 || amt > balanceOf(wallet)) throw badRequest('Spend at least 100 BT of treasury Bits.');
      post({ kind: 'union.lobby', memo: 'Union lobbying', actorId: accountId, legs: [{ from: wallet, to: SYS.TREASURY, amount: amt }] });
      db.update(schema.unions).set({ influence: u.influence + Math.floor(amt / 100) }).where(eq(schema.unions.id, u.id)).run();
    }
    audit({ actorId: accountId, action: `union.${move}`, targetType: 'union', targetId: u.id, newValue: opts });
    if (move !== 'strike' && move !== 'grant') tell(u.id, `${def.emoji} ${u.name}: ${def.label}!`, def.blurb);
    broadcast(u.id, { type: 'union', id: u.id });
    return { ok: true };
  });
}

/** The President throws union influence behind (or against) a bill. */
export function unionLobbyLaw(companyId: string, accountId: string, lawId: string, side: 'for' | 'against', amount: number) {
  return atomic(() => {
    const m = assertSpeaksFor(companyId, accountId);
    const u = getUnion(m.unionId);
    if (u.presidentId !== companyId) throw forbidden('Only the union President can spend union influence.');
    const amt = Math.floor(amount);
    if (amt < 1 || amt > u.influence) throw badRequest(`The union has ${u.influence} influence.`);
    const law = db.select().from(schema.laws).where(eq(schema.laws.id, lawId)).get();
    if (!law || law.status !== 'lobbying') throw conflict('That bill is not open for lobbying.');
    db.update(schema.unions).set({ influence: u.influence - amt }).where(eq(schema.unions.id, u.id)).run();
    addLawWeight(lawId, side, amt);
    return { ok: true };
  });
}

// ------------------------------------------------------------ perks + views
const cloutMemo = new Map<string, { at: number; v: number }>();
registerMultiplier('income', (co, now) => {
  const hit = cloutMemo.get(co.id);
  if (hit && now - hit.at < MINUTE_MS) return hit.v;
  const m = membershipOf(co.id);
  const n = m ? membersOf(m.unionId).length : 0;
  const v = 1 + Math.min(0.05, 0.01 * Math.floor(n / cfg().unions.cloutEvery));
  if (cloutMemo.size > 5000) cloutMemo.clear();
  cloutMemo.set(co.id, { at: now, v });
  return v;
});

const brief = (id: string | null) => {
  if (!id) return null;
  const c = findCompany(id);
  return c ? { id: c.id, name: c.name, emoji: c.emoji, color: c.color } : { id, name: '(gone)', emoji: '❓', color: '#888' };
};

export function listUnions() {
  return db
    .select()
    .from(schema.unions)
    .orderBy(desc(schema.unions.createdAt))
    .all()
    .map((u) => ({ id: u.id, name: u.name, emoji: u.emoji, motto: u.motto, open: u.open, dues: u.dues, members: membersOf(u.id).length, president: brief(u.presidentId), treasury: balanceOf(unionWallet(u.id)), influence: u.influence }));
}

export function unionView(unionId: string, viewerCompanyId: string | null, viewerAccountId: string | null) {
  const u = getUnion(unionId);
  const now = clock.now();
  const members = membersOf(u.id).map((m) => ({ ...brief(m.companyId)!, rep: getAccount(m.repAccountId)?.displayName ?? '?', repAccountId: m.repAccountId, joinedAt: m.joinedAt, duesOwed: m.duesOwed, offices: officesHeld(u, m.companyId) }));
  const elections = db.select().from(schema.unionElections).where(eq(schema.unionElections.unionId, u.id)).orderBy(desc(schema.unionElections.createdAt)).limit(12).all();
  const mine = viewerCompanyId ? membershipOf(viewerCompanyId) : null;
  const isMember = mine?.unionId === u.id;
  const cooldowns: Record<string, number> = {};
  for (const move of Object.keys(UNION_MOVES)) {
    const last = db.select({ at: schema.modifiers.createdAt }).from(schema.modifiers).where(and(like(schema.modifiers.source, `union:${u.id}:${move}%`), gt(schema.modifiers.createdAt, now - cfg().unions.moveCooldownHours * HOUR_MS))).get();
    if (last) cooldowns[move] = last.at + cfg().unions.moveCooldownHours * HOUR_MS;
  }
  return {
    ...u,
    president: brief(u.presidentId),
    vp: brief(u.vpId),
    treasurer: brief(u.treasurerId),
    treasury: balanceOf(unionWallet(u.id)),
    members,
    clout: Math.min(5, Math.floor(members.length / cfg().unions.cloutEvery)),
    elections: elections.map((e) => {
      const cands = db.select().from(schema.unionCandidates).where(eq(schema.unionCandidates.electionId, e.id)).all();
      const votes = db.select().from(schema.unionVotes).where(eq(schema.unionVotes.electionId, e.id)).all();
      const myVote = isMember ? votes.find((v) => v.voterId === viewerCompanyId)?.choice ?? null : null;
      // running tallies stay secret until the vote closes
      return { ...e, target: brief(e.targetId), winner: e.office === 'recall' ? null : brief(e.winnerId), candidates: cands.map((c) => ({ ...brief(c.companyId)!, pitch: c.pitch })), votesCast: votes.length, myVote, result: e.status === 'closed' ? e.result : null };
    }),
    me: isMember ? { companyId: viewerCompanyId, offices: officesHeld(u, viewerCompanyId!), isRep: mine!.repAccountId === viewerAccountId, repAccountId: mine!.repAccountId } : null,
    cooldowns,
  };
}

export function myUnion(companyId: string) {
  return membershipOf(companyId)?.unionId ?? null;
}

/** Owner tools: dissolve a union (treasury goes to the State). */
export function dissolveUnion(unionId: string, actorId: string) {
  return atomic(() => {
    const u = getUnion(unionId);
    const bal = balanceOf(unionWallet(u.id));
    if (bal > 0) post({ kind: 'union.dissolve', legs: [{ from: unionWallet(u.id), to: SYS.TREASURY, amount: bal }] });
    tell(u.id, `🏛️ ${u.name} was dissolved by the Owner`);
    db.delete(schema.unionMembers).where(eq(schema.unionMembers.unionId, u.id)).run();
    db.delete(schema.unionElections).where(eq(schema.unionElections.unionId, u.id)).run();
    db.delete(schema.unions).where(eq(schema.unions.id, u.id)).run();
    audit({ actorId, action: 'union.dissolve', targetType: 'union', targetId: u.id, oldValue: { name: u.name, treasury: bal } });
    return { ok: true };
  });
}
