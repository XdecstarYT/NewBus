import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Express } from 'express';
import { PERMISSION_PRESETS, applyPermissionsPatch } from '@dw/shared';
import { setupGame, makeCompany, login } from './helpers';
import { db, schema } from '../src/db';
import { clock } from '../src/lib/time';
import { cfg } from '../src/services/settings';
import { setFlag } from '../src/services/flags';
import { bump } from '../src/services/stats';
import { balanceOf, verifyLedger } from '../src/services/ledger';
import { companyWallet } from '../src/services/money';
import { addStock } from '../src/services/inventory';
import { productsFor } from '../src/services/catalog';
import * as chat from '../src/services/chat';
import * as guilds from '../src/services/guilds';
import * as wars from '../src/services/wars';
import * as fairs from '../src/services/fairs';
import * as mentor from '../src/services/mentorship';
import { leaderboard, profile } from '../src/services/leaderboards';
import { setPermissionsFor as setPermissions } from '../src/services/owner';

let app: Express;

describe('social: chat, guilds, wars, fairs, mentorship, leaderboards', () => {
  beforeAll(() => {
    app = setupGame();
  });

  it('chat filters words, rate limits, honours mutes, blocks and the kill switch', () => {
    const a = makeCompany({ name: 'Chatty A', accountNumber: '99950' });
    const b = makeCompany({ name: 'Chatty B', accountNumber: '99949' });
    const m = chat.sendMessage(a.account.id, 'global', 'this is dumb lol');
    expect(m.text).toContain('🙊');
    expect(chat.history(b.account.id, 'global').some((x) => x.id === m.id)).toBe(true);
    // company channel is private
    expect(chat.canUseChannel(b.account.id, `company:${a.company.id}`)).toBe(false);
    // DM + block
    const dm = chat.dmChannel(a.account.id, b.account.id);
    chat.sendMessage(a.account.id, dm, 'hi there');
    chat.block(b.account.id, a.account.id, true);
    expect(() => chat.sendMessage(a.account.id, dm, 'hello?')).toThrow(/not accepting/);
    // mute
    chat.mute(b.account.id, 5, 'test', 'owner');
    expect(() => chat.sendMessage(b.account.id, 'global', 'yo')).toThrow(/muted/);
    chat.unmute(b.account.id, 'owner');
    // rate limit
    expect(() => {
      for (let i = 0; i < cfg().chat.maxPerMinute + 2; i++) chat.sendMessage(b.account.id, 'global', `msg ${i}`);
    }).toThrow(/chatty/i);
    // kill switch
    setFlag('chatKillSwitch', true);
    expect(() => chat.sendMessage(a.account.id, 'global', 'anyone?')).toThrow(/switched off/);
    setFlag('chatKillSwitch', false);
  });

  it('chat permission is enforced live through the API', async () => {
    const { company, account } = makeCompany({ name: 'Muzzled', accountNumber: '99948', password: 'mpass123' });
    const player = await login(app, account.accountNumber, 'mpass123');
    expect((await player.post('/api/chat/send', { channel: 'global', text: 'hello world' })).status).toBe(200);
    setPermissions(company.id, applyPermissionsPatch(PERMISSION_PRESETS.full.perms, { modules: { chat: false } }), 'owner');
    expect((await player.post('/api/chat/send', { channel: 'global', text: 'still here?' })).status).toBe(403);
    expect((await player.get('/api/chat/history?channel=global')).status).toBe(403);
  });

  it('guilds: create, join, deposit levels up, perk applies, quest pays the treasury', () => {
    const lead = makeCompany({ name: 'Guild Lead', startingBits: 50_000 });
    const mem = makeCompany({ name: 'Guild Member', startingBits: 50_000 });
    const g = guilds.createGuild(lead.company.id, { name: 'The Bakers', emoji: '🥐', motto: 'Rise together' }, 'test');
    guilds.joinGuild(mem.company.id, g.id);
    expect(guilds.guildIdOf(mem.company.id)).toBe(g.id);
    expect(() => guilds.createGuild(mem.company.id, { name: 'Other', emoji: '', motto: '' }, 'test')).toThrow(/Leave/);
    guilds.deposit(mem.company.id, 20_000, 'test');
    const view = guilds.guildView(lead.company.id);
    expect(view.guild!.treasury).toBe(20_000);
    // quest
    const target = view.guild!.quest.target;
    bump(lead.company.id, 'earned', target);
    guilds.guildQuestTick();
    expect(guilds.guildView(lead.company.id).guild!.quest.done).toBe(true);
    expect(guilds.guildView(lead.company.id).guild!.treasury).toBeGreaterThan(20_000);
    // payout cap
    expect(() => guilds.payout(lead.company.id, mem.company.id, cfg().guilds.maxPayoutPerDay + 1, 'test')).toThrow(/capped/);
    guilds.payout(lead.company.id, mem.company.id, 100, 'test');
    // leader leaves -> member inherits
    guilds.leaveGuild(lead.company.id);
    expect(guilds.getGuild(g.id).leaderId).toBe(mem.company.id);
    expect(verifyLedger().sum).toBe(0);
  });

  it('wars: challenge, accept, score on real stats, winner paid + trophy', () => {
    const a = makeCompany({ name: 'Warrior A' });
    const b = makeCompany({ name: 'Warrior B' });
    const w = wars.challenge(a.company.id, { kind: 'company', targetId: b.company.id, contest: 'sprint', durationMin: 15 }, 'test');
    expect(() => wars.respond(a.company.id, w.id, true)).toThrow(/not addressed/);
    wars.respond(b.company.id, w.id, true);
    bump(a.company.id, 'sold', 30);
    bump(b.company.id, 'sold', 10);
    const before = balanceOf(companyWallet(a.company.id));
    clock.set(clock.now() + 16 * 60_000);
    wars.warTick(clock.now());
    clock.set(null);
    const war = wars.getWar(w.id);
    expect(war.status).toBe('finished');
    expect(war.winnerId).toBe(a.company.id);
    expect(balanceOf(companyWallet(a.company.id))).toBe(before + cfg().wars.challengePrize);
    expect(profile(a.company.id).trophies.length).toBe(1);
  });

  it('trade fairs: booth takes stock, closing pays sales and prizes', () => {
    setFlag('tradeFairs', true);
    const a = makeCompany({ name: 'Fair A' });
    const p = productsFor('bakery')[0];
    addStock(a.company.id, 'product', p.id, 10, 80);
    const fair = fairs.startFair({ durationMin: 10 });
    fairs.joinFair(a.company.id, p.id, 10, 'test');
    const before = balanceOf(companyWallet(a.company.id));
    fairs.closeFair(fairs.openFair()!);
    const done = db.select().from(schema.tradeFairs).where(eq(schema.tradeFairs.id, fair.id)).get()!;
    expect(done.status).toBe('finished');
    expect(done.results![0].companyId).toBe(a.company.id);
    expect(balanceOf(companyWallet(a.company.id))).toBeGreaterThan(before);
  });

  it('mentorship pays on mentee level-ups', () => {
    setFlag('mentorship', true);
    const vet = makeCompany({ name: 'Veteran' });
    const rookie = makeCompany({ name: 'Rookie' });
    db.update(schema.companies).set({ level: 12 }).where(eq(schema.companies.id, vet.company.id)).run();
    const o = mentor.offer(vet.company.id, rookie.company.id);
    mentor.respondOffer(rookie.company.id, o.id, true);
    const before = balanceOf(companyWallet(vet.company.id));
    mentor.onMenteeLevelUp(rookie.company.id, 3);
    expect(balanceOf(companyWallet(vet.company.id))).toBe(before + cfg().mentorship.mentorRewardPerLevel * 3);
    mentor.onMenteeLevelUp(rookie.company.id, cfg().mentorship.graduateLevel);
    expect(db.select().from(schema.mentorships).where(eq(schema.mentorships.id, o.id)).get()!.status).toBe('graduated');
  });

  it('leaderboards rank companies and the API answers', async () => {
    const lb = leaderboard('global', { limit: 5 });
    expect(lb.rows.length).toBeGreaterThan(0);
    expect(lb.rows[0].rank).toBe(1);
    const { account } = makeCompany({ name: 'Board Watcher', accountNumber: '99947', password: 'bpass123' });
    const player = await login(app, account.accountNumber, 'bpass123');
    for (const b of ['global', 'industry', 'guilds', 'investors', 'stocks', 'growth', 'generous']) {
      const r = await player.get(`/api/game/leaderboard?board=${b}`);
      expect(r.status).toBe(200);
    }
    expect((await player.get('/api/game/wars')).status).toBe(200);
    expect((await player.get('/api/game/guilds')).status).toBe(200);
    expect((await player.get('/api/game/fairs')).status).toBe(200);
    // players can't use moderation
    expect((await player.get('/api/mod/reports')).status).toBe(403);
  });
});
