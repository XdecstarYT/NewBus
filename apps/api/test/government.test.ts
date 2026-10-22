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
const later = async (ms: number) => {
  clock.advance(ms);
  await sweep(db, true);
};

describe('government', () => {
  it('a union votes the Owner out, a player is elected Mayor and gets the Owner panel (with limits), the creator can step back in', async () => {
    const a = await makeCompany(db, 'farm', { grant: 3000, name: 'Alpha Farms' });
    const b = await makeCompany(db, 'mine', { grant: 3000, name: 'Beta Mines' });
    const c = await makeCompany(db, 'forest', { grant: 3000, name: 'Gamma Woods' });
    const u = await a.client.post('/game/unions', { name: 'Workers United', emoji: '✊', motto: 'Power to the players', dues: 0 });
    expect(u.status).toBe(200);
    await b.client.post(`/game/unions/${u.body.id}/join`);
    expect((await b.client.post('/game/government/no-confidence')).status).toBe(403); // not the President
    expect((await a.client.post('/game/government/no-confidence')).status).toBe(402); // union treasury is empty
    await a.client.post('/game/union/donate', { amount: 800 });
    const call = await a.client.post('/game/government/no-confidence');
    expect(call.status).toBe(200);
    expect((await a.client.post('/game/government/no-confidence')).status).toBe(409);
    for (const [cl, v] of [[a, 'yes'], [b, 'yes'], [c, 'no']] as const) expect((await cl.client.post(`/game/government/elections/${call.body.id}/vote`, { choice: v })).status).toBe(200);
    await later(HOUR + MINUTE); // 12 game hours of voting
    let g = (await c.client.get('/game/government')).body;
    expect(g.past[0]).toMatchObject({ office: 'noconfidence', winnerId: 'yes' });
    expect(g.current).toMatchObject({ office: 'mayor', status: 'nominating' });

    expect((await b.client.post(`/game/government/elections/${g.current.id}/run`, { pitch: 'Lower taxes for all!' })).status).toBe(200);
    await later(31 * MINUTE);
    g = (await c.client.get('/game/government')).body;
    expect(g.current.status).toBe('voting');
    await a.client.post(`/game/government/elections/${g.current.id}/vote`, { choice: b.id });
    await c.client.post(`/game/government/elections/${g.current.id}/vote`, { choice: b.id });
    await later(HOUR + MINUTE);
    g = (await c.client.get('/game/government')).body;
    expect(g.mayor.companyId).toBe(b.id);

    // the Mayor has the Owner's powers...
    expect((await b.client.get('/auth/me')).body.governing).toBe(true);
    expect((await a.client.get('/auth/me')).body.governing).toBe(false);
    expect((await b.client.get('/owner/overview')).status).toBe(200);
    expect((await b.client.post('/owner/mint', { amount: 1000, memo: 'Mayor fund' })).status).toBe(200);
    expect((await b.client.post('/owner/grant', { to: c.id, amount: 100, memo: 'Peace offering' })).status).toBe(200);
    // ...in public...
    const log = (await a.client.get('/game/government')).body.log.map((l: any) => l.action);
    expect(log).toEqual(expect.arrayContaining(['mayor POST /owner/grant', 'mayor POST /owner/mint']));
    // ...except the creator's own controls
    expect((await b.client.post('/owner/season/reset', { confirm: 'RESET' })).status).toBe(403);
    expect((await b.client.post(`/owner/unions/${u.body.id}/dissolve`)).status).toBe(403);
    expect((await b.client.post('/owner/government/dismiss')).status).toBe(403);
    expect((await a.client.get('/owner/overview')).status).toBe(403);

    // account 01 is always in charge and can dismiss the Mayor
    expect((await owner.post('/owner/government/dismiss')).status).toBe(200);
    expect((await b.client.get('/owner/overview')).status).toBe(403);
    clock.reset();
    expect((await ledgerCheck(db)).sum).toBe(0);
  });

  it('unions push for change: bills and demands; two thirds yes can not be vetoed', async () => {
    const a = await makeCompany(db, 'farm', { grant: 3000 });
    const b = await makeCompany(db, 'farm', { grant: 3000 });
    const u = await a.client.post('/game/unions', { name: 'Tax Cutters', emoji: '✂️', motto: '', dues: 0 });
    await b.client.post(`/game/unions/${u.body.id}/join`);
    await a.client.post('/game/union/donate', { amount: 500 });
    expect((await b.client.post('/game/laws', { kind: 'tax', value: 2 })).status).toBe(403);
    const bill = await a.client.post('/game/laws', { kind: 'tax', value: 2 });
    expect(bill.status).toBe(200);
    expect((await a.client.post('/game/laws', { kind: 'tax', value: 1 })).status).toBe(409); // one at a time
    await a.client.post(`/game/laws/${bill.body.id}/vote`, { vote: 'yes' });
    await b.client.post(`/game/laws/${bill.body.id}/vote`, { vote: 'yes' });
    expect((await owner.post(`/owner/laws/${bill.body.id}/decide`, { decision: 'veto' })).status).toBe(409);
    expect((await owner.post(`/owner/laws/${bill.body.id}/decide`, { decision: 'count' })).body.status).toBe('passed');
    expect((await a.client.get('/game/laws')).body.salesTaxPct).toBe(2);

    const demand = await a.client.post('/game/laws', { kind: 'demand', text: 'Build a park in the town square' });
    expect(demand.status).toBe(200);
    const view = (await b.client.get('/game/laws')).body.laws.find((l: any) => l.id === demand.body.id);
    expect(view).toMatchObject({ title: 'Demand: Build a park in the town square', union: { name: 'Tax Cutters' } });
    expect((await owner.post(`/owner/laws/${demand.body.id}/respond`, { text: 'Great idea, the park project starts tomorrow!' })).status).toBe(200);
    expect((await b.client.get('/game/laws')).body.laws.find((l: any) => l.id === demand.body.id).response).toMatch(/park project/);
    expect((await ledgerCheck(db)).sum).toBe(0);
  });
});
