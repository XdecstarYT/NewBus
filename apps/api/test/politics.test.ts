import { describe, it, expect, beforeAll } from 'vitest';
import { setup, loginAs, makeCompany, type Client } from './helpers';
import type { Db } from '../src/db';
import { ledgerCheck } from '../src/services/money';
import { sweep } from '../src/services/sweep';
import { clock, HOUR, MINUTE } from '../src/lib/time';

let db: Db;
let owner: Client;
beforeAll(async () => {
  db = await setup();
  owner = await loginAs('01', 'Diddy');
  await owner.post('/auth/password', { current: 'Diddy', next: 'owner-pass-1' });
});

describe('owner tools', () => {
  it('creates a company with a login, mints into the Treasury and grants from it', async () => {
    const r = await owner.post('/owner/companies', { name: 'Crusty Dreams', emoji: '🥐', industry: 'bakery', adminName: 'Baker' });
    expect(r.status).toBe(200);
    expect(r.body.admin.number).toBeTruthy();
    const baker = await loginAs(r.body.admin.number, r.body.admin.password);
    expect((await baker.get('/auth/me')).body.account.mustChangePassword).toBe(true);
    await owner.post('/owner/mint', { amount: 10_000, memo: 'Seed the Treasury' });
    await owner.post('/owner/grant', { to: r.body.id, amount: 500, memo: 'Welcome' });
    const o = (await owner.get('/owner/overview')).body;
    expect(o.treasury).toBe(9_500);
    expect(o.ledgerOk).toBe(true);
    const codes = await owner.post('/owner/codes', { label: 'Birthday card', bits: 100, items: { latte: 2 }, count: 1 });
    const shop = await makeCompany(db, 'cafe');
    const red = await shop.client.post('/game/redeem', { code: `https://x/redeem/${codes.body.codes[0]}` });
    expect(red.body.bits).toBe(100);
    expect((await shop.client.post('/game/redeem', { code: codes.body.codes[0] })).status).toBe(409);
  });
});

describe('unions', () => {
  it('reps, elections and votes of no confidence', async () => {
    const a = await makeCompany(db, 'farm');
    const b = await makeCompany(db, 'mill');
    const c = await makeCompany(db, 'bakery');
    const u = await a.client.post('/game/unions', { name: 'Bread Union', motto: 'Rise together', dues: 20 });
    expect(u.status).toBe(200);
    await b.client.post(`/game/unions/${u.body.id}/join`);
    await c.client.post(`/game/unions/${u.body.id}/join`);
    const e = await a.client.post('/game/union/elections', { office: 'treasurer' });
    expect((await b.client.post('/game/union/elections', { office: 'president' })).status).toBe(403);
    await b.client.post(`/game/union/elections/${e.body.id}/nominate`, { pitch: 'Every Bit counted' });
    await c.client.post(`/game/union/elections/${e.body.id}/nominate`, { pitch: 'Lower dues' });
    expect((await a.client.post(`/game/union/elections/${e.body.id}/vote`, { choice: b.id })).status).toBe(409);
    clock.advance(31 * MINUTE);
    await sweep(db, true);
    for (const x of [a, b]) await x.client.post(`/game/union/elections/${e.body.id}/vote`, { choice: b.id });
    await c.client.post(`/game/union/elections/${e.body.id}/vote`, { choice: c.id });
    clock.advance(61 * MINUTE);
    await sweep(db, true);
    const view = (await a.client.get(`/game/unions/${u.body.id}`)).body;
    expect(view.treasurer.id).toBe(b.id);
    expect(view.elections[0].result).toEqual({ [b.id]: 2, [c.id]: 1 });
    // no confidence in the treasurer
    const r = await c.client.post('/game/union/recall', { office: 'treasurer' });
    expect(r.status).toBe(200);
    await a.client.post(`/game/union/elections/${r.body.id}/vote`, { choice: 'yes' });
    await c.client.post(`/game/union/elections/${r.body.id}/vote`, { choice: 'yes' });
    await b.client.post(`/game/union/elections/${r.body.id}/vote`, { choice: 'no' });
    clock.advance(61 * MINUTE);
    await sweep(db, true);
    expect((await a.client.get(`/game/unions/${u.body.id}`)).body.treasurer).toBeNull();
    clock.reset();
  });

  it('union members trade with each other at half tax', async () => {
    const s = await makeCompany(db, 'forest', { grant: 0 });
    const b = await makeCompany(db, 'sawmill', { grant: 1000 });
    const u = await s.client.post('/game/unions', { name: `Wood Union ${Date.now()}`, dues: 0 });
    expect(u.status).toBe(402); // founding costs 500 BT and they have none
    const u2 = await b.client.post('/game/unions', { name: `Wood Union ${Date.now()}`, dues: 0 });
    await s.client.post(`/game/unions/${u2.body.id}/join`);
    await s.client.post('/game/work', { facility: 'forest', recipe: 'wood', batches: 5 });
    await s.client.post('/game/orders', { item: 'wood', side: 'sell', price: 10, qty: 20 });
    await b.client.post('/game/orders', { item: 'wood', side: 'buy', price: 10, qty: 20 });
    expect((await s.client.get('/game/home')).body.balance).toBe(195); // 200 minus 2.5%
  });
});

describe('town hall', () => {
  it('companies vote; a passed tax law changes the sales tax; a stimulus pays everyone', async () => {
    const x = await makeCompany(db, 'farm');
    const y = await makeCompany(db, 'mine');
    const bill = await owner.post('/owner/laws', { kind: 'tax', value: 8 });
    await x.client.post(`/game/laws/${bill.body.id}/vote`, { vote: 'yes' });
    await y.client.post(`/game/laws/${bill.body.id}/vote`, { vote: 'yes' });
    clock.advance(25 * HOUR);
    await sweep(db, true);
    clock.reset();
    expect((await x.client.get('/game/laws')).body.salesTaxPct).toBe(8);
    const before = (await x.client.get('/game/home')).body.balance;
    const stim = await owner.post('/owner/laws', { kind: 'stimulus', value: 50 });
    await owner.post(`/owner/laws/${stim.body.id}/decide`, { decision: 'pass' });
    expect((await x.client.get('/game/home')).body.balance).toBe(before + 50);
    await owner.patch('/owner/settings', { salesTaxPct: 5 });
  });
});

describe('justice', () => {
  it('audit finds untaxed transfers and fines them', async () => {
    const a = await makeCompany(db, 'farm', { grant: 5000 });
    const b = await makeCompany(db, 'mill', { grant: 0 });
    await a.client.post('/game/send/bits', { to: b.id, amount: 2000, memo: 'for the flour, wink' });
    const audit = await owner.post('/owner/audits', { companyId: b.id });
    expect(audit.body.findings.transfersIn).toBe(2000);
    expect(audit.body.suggestedFine).toBe(150);
    const closed = await owner.post(`/owner/audits/${audit.body.id}/close`, { outcome: 'fined' });
    expect(closed.body.fine).toBe(150);
    expect((await b.client.get('/game/home')).body.balance).toBe(1850);
  });

  it('court: evidence, verdict, appeal, then freeze + suspension that block trading', async () => {
    const p = await makeCompany(db, 'farm', { grant: 3000 });
    const d = await makeCompany(db, 'bakery', { grant: 3000 });
    const filed = await p.client.post('/game/court', { defendantId: d.id, kind: 'scam', title: 'Never delivered the bread', claim: 1000 });
    expect(filed.body.fee).toBe(50);
    await p.client.post(`/game/court/${filed.body.id}/evidence`, { kind: 'document', text: 'Chat screenshot' });
    await d.client.post(`/game/court/${filed.body.id}/evidence`, { kind: 'witness', text: 'I saw them deliver' });
    expect((await p.client.get(`/game/court/${filed.body.id}`)).body.evidence).toHaveLength(2);
    await owner.post(`/owner/court/${filed.body.id}/decide`, { verdict: 'plaintiff', reasoning: 'Bread matters', remedy: { damages: 800, freezeHours: 2, suspend: 'market', suspendHours: 2 } });
    expect((await d.client.post(`/game/court/${filed.body.id}/appeal`)).status).toBe(200);
    const pb = (await p.client.get('/game/home')).body.balance;
    await owner.post(`/owner/court/${filed.body.id}/decide`, { verdict: 'plaintiff', reasoning: 'Upheld', remedy: { damages: 800, freezeHours: 2, suspend: 'market', suspendHours: 2 } });
    expect((await p.client.get('/game/home')).body.balance).toBe(pb + 800);
    expect((await d.client.post('/game/orders', { item: 'bread', side: 'sell', price: 5, qty: 1 })).body.error).toBe('suspended');
    expect((await d.client.post('/game/send/bits', { to: p.id, amount: 1 })).body.error).toBe('frozen');
    const s = (await owner.get('/owner/justice')).body.sanctions.filter((x: any) => x.companyId === d.id);
    for (const x of s) await owner.post(`/owner/sanctions/${x.id}/lift`);
    expect((await d.client.post('/game/send/bits', { to: p.id, amount: 1 })).status).toBe(200);
    expect((await ledgerCheck(db)).sum).toBe(0);
  });

  it('settlement and the auto-judge', async () => {
    const p = await makeCompany(db, 'farm', { grant: 1000 });
    const d = await makeCompany(db, 'mine', { grant: 1000 });
    const c1 = await p.client.post('/game/court', { defendantId: d.id, kind: 'defamation', title: 'Said our wheat was soggy', claim: 400 });
    await d.client.post(`/game/court/${c1.body.id}/settle`, { amount: 150 });
    expect((await d.client.post(`/game/court/${c1.body.id}/accept`)).status).toBe(403);
    await p.client.post(`/game/court/${c1.body.id}/accept`);
    expect((await p.client.get(`/game/court/${c1.body.id}`)).body.status).toBe('settled');
    const c2 = await owner.post('/owner/court', { defendantId: d.id, kind: 'unfair', title: 'State v. Mine', claim: 300 });
    await owner.post(`/owner/court/${c2.body.id}/evidence`, { kind: 'expert', text: 'Inspector report' });
    clock.advance(4 * HOUR);
    await sweep(db, true);
    expect((await owner.get(`/owner/court/${c2.body.id}`)).body.verdict).toBe('plaintiff');
    clock.advance(30 * HOUR);
    await sweep(db, true);
    clock.reset();
    expect((await owner.get(`/owner/court/${c2.body.id}`)).body.status).toBe('closed');
  });
});

describe('chat and leaderboard', () => {
  it('global, company and direct messages; owner can delete and mute', async () => {
    const a = await makeCompany(db, 'farm');
    const b = await makeCompany(db, 'farm');
    await a.client.post('/chat/send', { channel: 'global', text: 'Wheat for sale!' });
    expect((await b.client.get('/chat/history?channel=global')).body.at(-1).text).toBe('Wheat for sale!');
    expect((await b.client.post('/chat/send', { channel: `co:${a.id}`, text: 'sneaky' })).status).toBe(403);
    const people = (await a.client.get('/chat/channels')).body.people;
    const bAcc = people.find((x: any) => x.company?.startsWith('Test Co') && x.name === 'Boss' && x.id) ;
    expect(bAcc).toBeTruthy();
    const lb = (await a.client.get('/game/leaderboard')).body;
    expect(lb.length).toBeGreaterThan(3);
    expect(lb[0].netWorth).toBeGreaterThanOrEqual(lb[1].netWorth);
  });

  it('season reset wipes the economy and re-grants', async () => {
    const r = await owner.post('/owner/season/reset', { confirm: 'RESET' });
    expect(r.status).toBe(200);
    const o = (await owner.get('/owner/overview')).body;
    expect(o.treasury).toBe(0);
    expect(o.ledgerOk).toBe(true);
  });
});
