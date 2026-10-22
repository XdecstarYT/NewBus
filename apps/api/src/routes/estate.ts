/** Real estate and the 3D town. */
import { z } from 'zod';
import { HEIGHT, MAX_OPS, PLOT } from '@dw/shared/live';
import { parse, route } from '../http/router';
import { tx } from '../http/tx';
import * as estate from '../services/estate';

const coord = (max: number) => z.number().int().min(0).max(max - 1);

route('GET', '/game/world', 'user', async (c) => estate.world(c.db, c.company));
route('POST', '/game/plots/:id/buy', 'company', async (c) => tx(c, (db) => estate.buy(db, c.account, c.company, c.params.id)));
route('POST', '/game/plots/:id/sale', 'company', async (c) => {
  const v = parse(z.object({ price: z.number().int().min(1).max(100_000_000).nullable() }), c.body);
  return tx(c, (db) => estate.setSale(db, c.company, c.params.id, v.price));
});
route('POST', '/game/plots/:id/name', 'company', async (c) => tx(c, (db) => estate.rename(db, c.company, c.params.id, parse(z.object({ name: z.string().max(40) }), c.body).name)));
route('POST', '/game/plots/:id/build', 'company', async (c) => {
  const v = parse(
    z.object({ ops: z.array(z.object({ op: z.enum(['add', 'remove']), x: coord(PLOT), y: coord(HEIGHT), z: coord(PLOT), b: z.number().int().min(1).max(99).optional() })).min(1).max(MAX_OPS) }),
    c.body,
  );
  return tx(c, (db) => estate.build(db, c.account, c.company, c.params.id, v.ops));
});
route('POST', '/owner/plots/:id/reclaim', 'owner', async (c) => tx(c, (db) => estate.reclaim(db, c.account, c.params.id)));
