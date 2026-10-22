import { describe, it, expect, beforeAll } from 'vitest';
import { setup, loginAs, makeCompany, type Client } from './helpers';
import type { Db } from '../src/db';
import { ledgerCheck } from '../src/services/money';
import { addItem } from '../src/services/stock';
import { sweep } from '../src/services/sweep';
import { clock, HOUR, MINUTE } from '../src/lib/time';

let db: Db;
let owner: Client;
beforeAll(async () => {
  db = await setup();
  owner = await loginAs('01', 'Diddy');
  await owner.post('/auth/password', { current: 'Diddy', next: 'owner-pass-1' });
});
const bal = async (c: Client) => (await c.get('/game/home')).body.balance as number;
const balanced = async () => expect((await ledgerCheck(db)).sum).toBe(0);

describe('bank', () => {
  it('loan offer: money waits, borrower takes it, repays with interest, credit improves', async () => {
    const lender = await makeCompany(db, 'farm', { grant: 2000 });
    const borrower = await makeCompany(db, 'farm', { grant: 100 });
    const offer = await lender.client.post('/game/loans', { side: 'offer', amount: 1000, interestPct: 10, days: 2 });
    expect(offer.status).toBe(200);
    expect(await bal(lender.client)).toBe(1000);
    expect((await lender.client.post(`/game/loans/${offer.body.id}/accept`)).status).toBe(400);
    expect((await borrower.client.post(`/game/loans/${offer.body.id}/accept`)).body.owed).toBe(1100);
    expect(await bal(borrower.client)).toBe(1100);
    expect((await borrower.client.post(`/game/loans/${offer.body.id}/repay`, { amount: 600 })).body).toMatchObject({ paid: 600, left: 500, done: false });
    expect((await borrower.client.post(`/game/loans/${offer.body.id}/repay`)).body).toMatchObject({ paid: 500, done: true });
    expect(await bal(lender.client)).toBe(2100);
    expect((await borrower.client.get('/game/bank')).body.myCredit).toMatchObject({ score: 625, repaid: 1 });
    await balanced();
  });

  it('overdue loans are collected from what the borrower has; the rest is a default', async () => {
    const lender = await makeCompany(db, 'farm', { grant: 2000 });
    const borrower = await makeCompany(db, 'farm', { grant: 0 });
    const req = await borrower.client.post('/game/loans', { side: 'request', amount: 500, interestPct: 20, days: 1 });
    await lender.client.post(`/game/loans/${req.body.id}/accept`);
    await borrower.client.post('/game/send/bits', { to: lender.id, amount: 300, memo: 'spent it' });
    clock.advance(3 * HOUR); // 36 game hours
    await sweep(db, true);
    clock.reset();
    const l = (await lender.client.get('/game/bank')).body.loans.find((x: any) => x.id === req.body.id);
    expect(l).toMatchObject({ status: 'defaulted', repaid: 200 });
    expect((await borrower.client.get('/game/bank')).body.myCredit.score).toBe(480);
    await balanced();
  });
});

describe('auctions', () => {
  it('bids are held in escrow, outbid bidders get their money back, the winner gets the goods', async () => {
    const seller = await makeCompany(db, 'mine', { grant: 0 });
    const a = await makeCompany(db, 'farm', { grant: 1000 });
    const b = await makeCompany(db, 'farm', { grant: 1000 });
    await addItem(db, seller.id, 'steel', 20);
    const auc = await seller.client.post('/game/auctions', { item: 'steel', qty: 20, startPrice: 200, hours: 2 });
    expect(auc.status).toBe(200);
    expect((await a.client.post(`/game/auctions/${auc.body.id}/bid`, { amount: 150 })).status).toBe(400);
    await a.client.post(`/game/auctions/${auc.body.id}/bid`, { amount: 200 });
    expect(await bal(a.client)).toBe(800);
    expect((await b.client.post(`/game/auctions/${auc.body.id}/bid`, { amount: 205 })).status).toBe(400); // min +5%
    await b.client.post(`/game/auctions/${auc.body.id}/bid`, { amount: 300 });
    expect(await bal(a.client)).toBe(1000);
    expect((await seller.client.post(`/game/auctions/${auc.body.id}/cancel`)).status).toBe(409);
    clock.advance(20 * MINUTE); // 4 game hours
    await sweep(db, true);
    clock.reset();
    expect((await b.client.get('/game/home')).body.inventory.steel).toBe(20);
    expect(await bal(seller.client)).toBe(285); // 300 minus 5% tax
    await balanced();
  });
});

describe('town', () => {
  it('everyone chips in; finishing the project switches on a boost that changes shift output', async () => {
    const r = await owner.post('/owner/town/projects', { blueprint: 'coop', scale: 0.25 });
    expect(r.status).toBe(200);
    const p = (await owner.get('/owner/town')).body.projects.find((x: any) => x.id === r.body.id);
    expect(p.needItems).toEqual({ tools: 4, planks: 15 });
    expect(p.needBits).toBe(200);
    const a = await makeCompany(db, 'farm', { grant: 1000 });
    const b = await makeCompany(db, 'forest', { grant: 1000 });
    await addItem(db, a.id, 'tools', 5);
    await addItem(db, b.id, 'planks', 20);
    expect((await a.client.post(`/game/projects/${r.body.id}/give`, { item: 'tools', qty: 5 })).body).toMatchObject({ qty: 4, done: false });
    expect((await a.client.get('/game/home')).body.inventory.tools).toBe(1);
    expect((await a.client.post(`/game/projects/${r.body.id}/give`, { bits: 500 })).body.bits).toBe(200);
    const last = await b.client.post(`/game/projects/${r.body.id}/give`, { item: 'planks', qty: 20 });
    expect(last.body).toMatchObject({ qty: 15, done: true });
    const today = (await a.client.get('/game/today')).body;
    expect(today.boosts.some((x: any) => x.kind === 'output' && x.facility === 'farm' && x.pct === 40)).toBe(true);
    // farm: 4 wheat a batch normally, +40% -> 5 (tools left in stock add +50% on top)
    const w = await a.client.post('/game/work', { facility: 'farm', recipe: 'wheat', batches: 1, useTools: false });
    expect(w.body.townBonusPct).toBe(40);
    expect(w.body.output.wheat).toBe(5);
    await balanced();
  });

  it('a tax-free world event means no sales tax; projects that miss the deadline hand everything back', async () => {
    expect((await owner.post('/owner/town/event', { event: 'taxfree' })).status).toBe(200);
    const buyer = await makeCompany(db, 'bakery', { grant: 5000 });
    const seller = await makeCompany(db, 'farm', { grant: 0 });
    await seller.client.post('/game/work', { facility: 'farm', recipe: 'wheat', batches: 3 });
    const c = await buyer.client.post('/game/contracts', { item: 'wheat', qty: 10, price: 200, offeredTo: seller.id });
    await seller.client.post(`/game/contracts/${c.body.id}/accept`);
    expect((await seller.client.post(`/game/contracts/${c.body.id}/deliver`)).body).toEqual({ paid: 200, tax: 0 });
    expect((await owner.post('/owner/town/event', { event: 'quiet' })).status).toBe(200);

    const r = await owner.post('/owner/town/projects', { blueprint: 'bridge', scale: 1, days: 1 });
    await buyer.client.post(`/game/projects/${r.body.id}/give`, { bits: 300 });
    expect(await bal(buyer.client)).toBe(4500);
    clock.advance(3 * HOUR);
    await sweep(db, true);
    clock.reset();
    expect(await bal(buyer.client)).toBe(4800);
    expect((await owner.get('/owner/town')).body.projects.find((x: any) => x.id === r.body.id).status).toBe('failed');
    await balanced();
  });

  it('the Owner can auction brand-new goods for the Treasury', async () => {
    const a = await makeCompany(db, 'farm', { grant: 1000 });
    const auc = await owner.post('/owner/auctions', { item: 'gadget', qty: 2, startPrice: 100, hours: 1 });
    await a.client.post(`/game/auctions/${auc.body.id}/bid`, { amount: 150 });
    clock.advance(10 * MINUTE);
    await sweep(db, true);
    clock.reset();
    expect((await a.client.get('/game/home')).body.inventory.gadget).toBe(2);
    await balanced();
  });
});
