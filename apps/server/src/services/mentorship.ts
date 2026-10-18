/**
 * Mentorship (flag: mentorship): a veteran company mentors a newcomer. Each
 * time the mentee levels up both get a small Treasury reward; at the
 * graduation level both get a bigger one and the pairing ends.
 */
import { and, eq, inArray, or } from 'drizzle-orm';
import { db, schema, atomic } from '../db';
import { clock } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { cfg } from './settings';
import { SYS, balanceOf } from './ledger';
import { payCompany } from './money';
import { findCompany, getCompany } from './companies';
import { flag } from './flags';
import { notify } from './notifications';
import { addNews } from './news';
import { bump } from './stats';

type Mentorship = typeof schema.mentorships.$inferSelect;

function live(companyId: string) {
  return db
    .select()
    .from(schema.mentorships)
    .where(and(inArray(schema.mentorships.status, ['pending', 'active']), or(eq(schema.mentorships.mentorId, companyId), eq(schema.mentorships.menteeId, companyId))))
    .all();
}

function requireOn() {
  if (!flag('mentorship')) throw forbidden('Mentorship is switched off by the Owner.', 'flag_off');
}

/** A veteran offers to mentor a newcomer; the newcomer accepts. */
export function offer(mentorId: string, menteeId: string) {
  requireOn();
  const c = cfg().mentorship;
  const mentor = getCompany(mentorId);
  const mentee = findCompany(menteeId);
  if (!mentee) throw notFound('No such company.');
  if (mentorId === menteeId) throw badRequest('You can not mentor yourself (nice try).');
  if (mentor.level < c.minMentorLevel) throw forbidden(`Reach level ${c.minMentorLevel} to become a mentor.`);
  if (mentee.level > c.maxMenteeLevel) throw badRequest(`Mentees must be level ${c.maxMenteeLevel} or below.`);
  const mine = live(mentorId).filter((m) => m.mentorId === mentorId);
  if (mine.length >= c.maxMentees) throw conflict(`You can mentor up to ${c.maxMentees} companies at once.`);
  if (live(menteeId).some((m) => m.menteeId === menteeId)) throw conflict('That company already has a mentor (or a pending offer).');
  const id = newId('mnt');
  db.insert(schema.mentorships).values({ id, mentorId, menteeId, status: 'pending', startLevel: mentee.level, createdAt: clock.now(), endedAt: null }).run();
  notify(menteeId, 'mentor', `🎓 ${mentor.emoji} ${mentor.name} offers to mentor you!`, 'Accept on the Guilds & Friends page. You both earn rewards as you level up.');
  return { id };
}

export function respondOffer(menteeId: string, id: string, accept: boolean) {
  requireOn();
  const m = db.select().from(schema.mentorships).where(eq(schema.mentorships.id, id)).get();
  if (!m || m.menteeId !== menteeId || m.status !== 'pending') throw notFound('No such offer.');
  db.update(schema.mentorships).set({ status: accept ? 'active' : 'ended', endedAt: accept ? null : clock.now() }).where(eq(schema.mentorships.id, id)).run();
  if (accept) notify(m.mentorId, 'mentor', `🎓 ${getCompany(menteeId).name} accepted your mentorship!`, 'Help them grow - you both get rewards.');
  return { ok: true };
}

export function endMentorship(companyId: string, id: string) {
  const m = db.select().from(schema.mentorships).where(eq(schema.mentorships.id, id)).get();
  if (!m || (m.mentorId !== companyId && m.menteeId !== companyId) || !['pending', 'active'].includes(m.status)) throw notFound('No such mentorship.');
  db.update(schema.mentorships).set({ status: 'ended', endedAt: clock.now() }).where(eq(schema.mentorships.id, id)).run();
  return { ok: true };
}

function reward(companyId: string, amount: number, memo: string) {
  const amt = Math.min(amount, balanceOf(SYS.TREASURY));
  if (amt > 0) payCompany({ companyId, amount: amt, from: SYS.TREASURY, kind: 'mentor.reward', memo, earn: false, partial: true });
  return amt;
}

/** Level-up hook: pays both sides, graduates at the configured level. */
export function onMenteeLevelUp(companyId: string, level: number) {
  if (!flag('mentorship')) return;
  const m = db.select().from(schema.mentorships).where(and(eq(schema.mentorships.menteeId, companyId), eq(schema.mentorships.status, 'active'))).get();
  if (!m) return;
  const c = cfg().mentorship;
  atomic(() => {
    const mentee = getCompany(companyId);
    const mentor = findCompany(m.mentorId);
    if (!mentor) return;
    if (level >= c.graduateLevel) {
      reward(m.mentorId, c.graduationReward, `${mentee.name} graduated`);
      reward(companyId, c.graduationReward, 'Mentorship graduation');
      db.update(schema.mentorships).set({ status: 'graduated', endedAt: clock.now() }).where(eq(schema.mentorships.id, m.id)).run();
      bump(m.mentorId, 'graduates');
      notify(m.mentorId, 'mentor', `🎓 ${mentee.name} graduated!`, `+${c.graduationReward} BT for being an amazing mentor.`);
      notify(companyId, 'mentor', '🎓 You graduated!', `+${c.graduationReward} BT. Say thanks to ${mentor.name}!`);
      addNews('headline', `🎓 ${mentee.emoji} ${mentee.name} graduates from ${mentor.name}'s mentorship!`, 'Tears were shed. Mostly happy ones.');
    } else {
      const a = reward(m.mentorId, c.mentorRewardPerLevel * level, `${mentee.name} reached level ${level}`);
      reward(companyId, c.menteeRewardPerLevel * level, `Mentorship level ${level}`);
      if (a) notify(m.mentorId, 'mentor', `🎓 Your mentee ${mentee.name} hit level ${level}`, `+${a} BT mentor bonus.`);
    }
  });
}

export function mentorView(companyId: string) {
  const c = cfg().mentorship;
  const co = getCompany(companyId);
  const rows = db.select().from(schema.mentorships).where(or(eq(schema.mentorships.mentorId, companyId), eq(schema.mentorships.menteeId, companyId))).all();
  const dto = (m: Mentorship) => {
    const other = findCompany(m.mentorId === companyId ? m.menteeId : m.mentorId);
    return { ...m, role: m.mentorId === companyId ? 'mentor' : 'mentee', other: other ? { id: other.id, name: other.name, emoji: other.emoji, level: other.level } : null };
  };
  return {
    enabled: flag('mentorship'),
    config: c,
    canMentor: co.level >= c.minMentorLevel,
    canBeMentored: co.level <= c.maxMenteeLevel,
    current: rows.filter((m) => m.status === 'active' || m.status === 'pending').map(dto),
    past: rows.filter((m) => m.status === 'graduated').map(dto),
    newcomers:
      co.level >= c.minMentorLevel
        ? db
            .select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji, level: schema.companies.level })
            .from(schema.companies)
            .where(eq(schema.companies.status, 'active'))
            .all()
            .filter((x) => x.level <= c.maxMenteeLevel && x.id !== companyId && !live(x.id).some((m) => m.menteeId === x.id))
            .slice(0, 30)
        : [],
  };
}
