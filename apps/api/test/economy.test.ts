import { describe, it, expect, beforeAll } from 'vitest';
import { setup, client, loginAs, makeCompany } from './helpers';
import type { Db } from '../src/db';
import { ledgerCheck } from '../src/services/money';
import { clock, HOUR } from '../src/lib/time';

let db: Db;
beforeAll(async () => {
  db = await setup();
});

describe('logins', () => {
  it('owner logs in as 01 / Diddy (and "1" works too) and must pick a new password', async () => {
    const c = client();
    const r = await c.post('/auth/login', { number: '1', password: 'Diddy' });
    expect(r.status).toBe(200);
    expect(r.body.account.role).toBe('OWNER');
    expect(r.body.account.mustChangePassword).toBe(true);
    expect((await c.get('/game/news')).body.error).toBe('must_change_password');
    expect((await c.post('/auth/password', { current: 'Diddy', next: 'Diddy' })).status).toBe(400);
    const wrong = await client().post('/auth/login', { number: '01', password: 'nope' });
    expect(wrong.status).toBe(401);
  });

  it('refuses requests without the CSRF header', async () => {
    const res = await (await import('../src/handler')).handle(new Request('http://test/api/auth/login', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(403);
  });
});

describe('player economy', () => {
  it('work a shift: Energy in, items out; no energy, no work', async () => {
    const farm = await makeCompany(db, 'farm');
    const r = await farm.client.post('/game/work', { facility: 'farm', recipe: 'wheat', batches: 4 });
    expect(r.status).toBe(200);
    expect(r.body.output.wheat).toBe(16);
    const home = (await farm.client.get('/game/home')).body;
    expect(home.inventory.wheat).toBe(16);
    expect(home.energy.now).toBe(80);
    expect((await farm.client.post('/game/work', { facility: 'farm', recipe: 'wheat', batches: 50 })).body.error).toBe('no_energy');
    expect((await farm.client.post('/game/work', { facility: 'mill', recipe: 'flour', batches: 1 })).status).toBe(400);
    // eat bread from the starting pantry
    const ate = await farm.client.post('/game/eat', { item: 'bread', qty: 1 });
    expect(ate.body.energy).toBe(95);
  });

  it('energy refills over time but never makes anything by itself', async () => {
    const mine = await makeCompany(db, 'mine');
    await mine.client.post('/game/work', { facility: 'mine', recipe: 'ore', batches: 16 });
    const before = (await mine.client.get('/game/home')).body;
    clock.advance(10 * HOUR);
    const after = (await mine.client.get('/game/home')).body;
    expect(after.energy.now).toBe(100);
    expect(after.inventory).toEqual(before.inventory);
    expect(after.balance).toBe(before.balance);
    clock.reset();
  });

  it('market: buy order meets sell order, escrow settles, seller pays tax', async () => {
    const seller = await makeCompany(db, 'forest', { grant: 0 });
    const buyer = await makeCompany(db, 'sawmill', { grant: 1000 });
    await seller.client.post('/game/work', { facility: 'forest', recipe: 'wood', batches: 5 }); // 20 wood
    const sell = await seller.client.post('/game/orders', { item: 'wood', side: 'sell', price: 10, qty: 15 });
    expect(sell.body.filled).toBe(0);
    const buy = await buyer.client.post('/game/orders', { item: 'wood', side: 'buy', price: 12, qty: 10 });
    expect(buy.body.filled).toBe(10);
    expect(buy.body.fills[0].price).toBe(10);
    const b = (await buyer.client.get('/game/home')).body;
    expect(b.inventory.wood).toBe(10);
    expect(b.balance).toBe(1000 - 100); // paid the ask, refund of the 2 BT difference
    const s = (await seller.client.get('/game/home')).body;
    expect(s.balance).toBe(95); // 100 minus 5% tax
    expect(s.inventory.wood).toBe(5); // 15 locked in the order, 10 sold, 5 left in the order
    const mine = (await seller.client.get('/game/market')).body.mine;
    expect(mine[0].filled).toBe(10);
    await seller.client.post(`/game/orders/${mine[0].id}/cancel`);
    expect((await seller.client.get('/game/home')).body.inventory.wood).toBe(10);
    expect((await ledgerCheck(db)).sum).toBe(0);
  });

  it('shop, pickup at the counter and the POS register', async () => {
    const bakery = await makeCompany(db, 'bakery', { grant: 0 });
    const shopper = await makeCompany(db, 'farm', { grant: 500 });
    await bakery.client.post('/game/shop/listing', { item: 'bread', price: 20 });
    // buy now
    const bought = await shopper.client.post(`/game/shops/${bakery.id}/buy`, { lines: [{ item: 'bread', qty: 2 }] });
    expect(bought.status).toBe(200);
    expect((await shopper.client.get('/game/home')).body.inventory.bread).toBe(8);
    // pickup: stock held, paid at the counter with the code
    const order = await shopper.client.post(`/game/shops/${bakery.id}/pickup`, { lines: [{ item: 'bread', qty: 1 }], note: 'warm please' });
    expect(order.body.status).toBe('waiting');
    const found = await bakery.client.get(`/game/pickups/find/${order.body.code.toLowerCase()}`);
    expect(found.body.id).toBe(order.body.id);
    const chk = await bakery.client.post(`/game/pickups/${order.body.id}/pay`);
    const paid = await shopper.client.post(`/game/pay/${chk.body.code}`);
    expect(paid.status).toBe(200);
    expect((await shopper.client.get('/game/pickups')).body[0].status).toBe('collected');
    // register sale with a typed price
    const reg = await bakery.client.post('/game/pos', { lines: [{ item: 'bread', qty: 1, price: 25 }] });
    expect((await shopper.client.get(`/game/pay/${reg.body.code}`)).body.total).toBe(25);
    await shopper.client.post(`/game/pay/${reg.body.code}`);
    expect((await shopper.client.post(`/game/pay/${reg.body.code}`)).status).toBe(409);
    const s = (await shopper.client.get('/game/home')).body;
    expect(s.balance).toBe(500 - 40 - 20 - 25);
    expect(s.inventory.bread).toBe(10);
    expect((await bakery.client.get('/game/home')).body.balance).toBe(38 + 19 + 24); // minus 5% tax each sale
    expect((await ledgerCheck(db)).sum).toBe(0);
  });

  it('build and upgrade need Bits plus planks and steel; tools boost output', async () => {
    const co = await makeCompany(db, 'forest', { grant: 5000 });
    expect((await co.client.post('/game/build', { facility: 'mine' })).body.error).toBe('not_enough_items');
    const supplier = await makeCompany(db, 'workshop', { grant: 0 });
    // give the materials (transfer between companies)
    const { addItem } = await import('../src/services/stock');
    await addItem(db, supplier.id, 'planks', 30);
    await addItem(db, supplier.id, 'steel', 10);
    await addItem(db, supplier.id, 'tools', 2);
    await supplier.client.post('/game/send/items', { to: co.id, item: 'planks', qty: 30 });
    await supplier.client.post('/game/send/items', { to: co.id, item: 'steel', qty: 10 });
    await supplier.client.post('/game/send/items', { to: co.id, item: 'tools', qty: 2 });
    expect((await co.client.post('/game/build', { facility: 'mine' })).status).toBe(200);
    const w = await co.client.post('/game/work', { facility: 'mine', recipe: 'ore', batches: 2 });
    expect(w.body.output.ore).toBe(9); // 3 x 2 batches x 1.5 with tools
    const up = await co.client.post('/game/upgrade', { facility: 'forest' });
    expect(up.body.level).toBe(2);
    const home = (await co.client.get('/game/home')).body;
    expect(home.balance).toBe(5000 - 600 - 500);
  });

  it('staff logins: admin adds a friend who then plays with their own Energy', async () => {
    const co = await makeCompany(db, 'farm');
    const added = await co.client.post('/game/team', { name: 'Sam' });
    expect(added.body.number).toBeTruthy();
    const sam = await loginAs(added.body.number, added.body.password);
    expect((await sam.get('/game/home')).body.error).toBe('must_change_password');
    await sam.post('/auth/password', { current: added.body.password, next: 'samsam1' });
    await sam.post('/game/work', { facility: 'farm', recipe: 'milk', batches: 20 });
    expect((await co.client.get('/game/home')).body.energy.now).toBe(100); // admin's Energy untouched
    expect((await co.client.get('/game/home')).body.inventory.milk).toBe(60);
  });
});
