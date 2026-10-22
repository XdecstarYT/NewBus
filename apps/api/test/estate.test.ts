import { describe, it, expect, beforeAll } from 'vitest';
import { landPrice } from '@dw/shared/live';
import { setup, makeCompany, type Client } from './helpers';
import type { Db } from '../src/db';
import { ledgerCheck } from '../src/services/money';
import { addItem } from '../src/services/stock';

let db: Db;
beforeAll(async () => {
  db = await setup();
});
const bal = async (c: Client) => (await c.get('/game/home')).body.balance as number;
const inv = async (c: Client) => (await c.get('/game/home')).body.inventory as Record<string, number>;

describe('real estate', () => {
  it('buy land, build brick by brick (items in, items back), sell the house to a friend', async () => {
    const a = await makeCompany(db, 'kiln', { grant: 5000 });
    const b = await makeCompany(db, 'farm', { grant: 5000 });
    const w = (await a.client.get('/game/world')).body;
    expect(w.plots).toHaveLength(100);
    const center = w.plots.find((p: any) => p.gx === 4 && p.gy === 4);
    const corner = w.plots.find((p: any) => p.gx === 0 && p.gy === 0);
    expect(center.land).toBeGreaterThan(corner.land);
    expect(corner.land).toBe(landPrice(0, 0, 400));

    expect((await a.client.post(`/game/plots/${corner.id}/buy`)).body.paid).toBe(corner.land);
    expect(await bal(a.client)).toBe(5000 - corner.land);
    expect((await b.client.post(`/game/plots/${corner.id}/buy`)).status).toBe(409);

    // the kiln makes bricks; glass comes from the market in real life, here we hand some over
    const fired = await a.client.post('/game/work', { facility: 'kiln', recipe: 'glass', batches: 1 });
    expect(fired.status).toBe(400); // a kiln needs ore
    await addItem(db, a.id, 'bricks', 10);
    await addItem(db, a.id, 'glass', 2);
    const floating = await a.client.post(`/game/plots/${corner.id}/build`, { ops: [{ op: 'add', x: 0, y: 3, z: 0, b: 1 }] });
    expect(floating.status).toBe(400);
    const built = await a.client.post(`/game/plots/${corner.id}/build`, {
      ops: [
        { op: 'add', x: 0, y: 0, z: 0, b: 1 },
        { op: 'add', x: 1, y: 0, z: 0, b: 1 },
        { op: 'add', x: 1, y: 1, z: 0, b: 5 },
        { op: 'add', x: 0, y: 1, z: 0, b: 1 },
      ],
    });
    expect(built.body).toMatchObject({ blocks: 4, used: { bricks: 3, glass: 1 } });
    expect((await inv(a.client)).bricks).toBe(7);
    expect((await a.client.post(`/game/plots/${corner.id}/build`, { ops: [{ op: 'remove', x: 0, y: 1, z: 0 }] })).body.used).toEqual({ bricks: -1 });
    expect((await inv(a.client)).bricks).toBe(8);
    // not enough glass: nothing happens at all
    const tooMuch = await a.client.post(`/game/plots/${corner.id}/build`, { ops: [0, 1, 2].map((x) => ({ op: 'add', x, y: 0, z: 2, b: 5 })) });
    expect(tooMuch.status).toBe(400);
    expect((await inv(a.client)).glass).toBe(1);
    expect((await b.client.post(`/game/plots/${corner.id}/build`, { ops: [{ op: 'add', x: 3, y: 0, z: 3, b: 1 }] })).status).toBe(403);

    // sell it
    const house = (await b.client.get('/game/world')).body.plots.find((p: any) => p.id === corner.id);
    expect(house.value).toBeGreaterThan(corner.land);
    await a.client.post(`/game/plots/${corner.id}/sale`, { price: 2000 });
    expect((await b.client.post(`/game/plots/${corner.id}/buy`)).body.paid).toBe(2000);
    expect(await bal(a.client)).toBe(5000 - corner.land + 1900);
    const after = (await b.client.get('/game/world')).body.plots.find((p: any) => p.id === corner.id);
    expect(after).toMatchObject({ mine: true, forSale: false });
    expect(after.blocks).toHaveLength(3);
    const lb = (await b.client.get('/game/leaderboard')).body;
    expect(lb.find((x: any) => x.id === b.id).property).toBe(after.value);
    expect((await ledgerCheck(db)).sum).toBe(0);
  });
});
