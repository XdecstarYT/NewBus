/** Town & Finance: world events, town projects, boosts, loans and auctions. */
import { z } from 'zod';
import { FACILITY_IDS, ITEM_IDS, LOAN_LIMITS, PROJECT_BLUEPRINTS, WORLD_EVENTS } from '@dw/shared/live';
import { parse, route } from '../http/router';
import { tx } from '../http/tx';
import { notFound } from '../lib/errors';
import * as town from '../services/town';
import * as bank from '../services/bank';
import * as auctions from '../services/auctions';
import { audit } from '../services/core';

const id = z.string().min(1).max(80);
const item = z.enum(ITEM_IDS);

// ------------------------------------------------------------ town
route('GET', '/game/today', 'user', async (c) => town.today(c.db));
route('GET', '/game/town', 'user', async (c) => ({ ...(await town.today(c.db)), projects: await town.projectsView(c.db, c.company?.id ?? null) }));
route('POST', '/game/projects/:id/give', 'company', async (c) => {
  const v = parse(z.object({ bits: z.number().int().min(1).max(100_000_000).optional(), item: item.optional(), qty: z.number().int().min(1).max(100_000).optional() }), c.body);
  return tx(c, (db) => town.contribute(db, c.account, c.company, c.params.id, v));
});

// ------------------------------------------------------------ bank
route('GET', '/game/bank', 'company', async (c) => bank.view(c.db, c.company));
route('POST', '/game/loans', 'company', async (c) => {
  const v = parse(
    z.object({
      side: z.enum(['offer', 'request']),
      amount: z.number().int().min(1).max(LOAN_LIMITS.maxAmount),
      interestPct: z.number().int().min(0).max(LOAN_LIMITS.maxInterestPct),
      days: z.number().int().min(LOAN_LIMITS.minDays).max(LOAN_LIMITS.maxDays),
      note: z.string().max(200).default(''),
      offeredTo: id.nullable().default(null),
    }),
    c.body,
  );
  return tx(c, (db) => bank.create(db, c.account, c.company, v));
});
route('POST', '/game/loans/:id/accept', 'company', async (c) => tx(c, (db) => bank.accept(db, c.account, c.company, c.params.id)));
route('POST', '/game/loans/:id/repay', 'company', async (c) => {
  const v = parse(z.object({ amount: z.number().int().min(1).max(100_000_000).optional() }), c.body);
  return tx(c, (db) => bank.repay(db, c.account, c.company, c.params.id, v.amount));
});
route('POST', '/game/loans/:id/cancel', 'company', async (c) => tx(c, (db) => bank.cancel(db, c.company, c.params.id)));

// ------------------------------------------------------------ auctions
const newAuction = z.object({ item, qty: z.number().int().min(1).max(100_000), startPrice: z.number().int().min(1).max(100_000_000), hours: z.number().min(1).max(72).default(6), note: z.string().max(200).default('') });
route('GET', '/game/auctions', 'user', async (c) => auctions.list(c.db, c.company?.id ?? null));
route('POST', '/game/auctions', 'company', async (c) => tx(c, (db) => auctions.create(db, c.account, c.company, parse(newAuction, c.body))));
route('POST', '/game/auctions/:id/bid', 'company', async (c) => tx(c, (db) => auctions.bid(db, c.account, c.company, c.params.id, parse(z.object({ amount: z.number().int().min(1).max(100_000_000) }), c.body).amount)));
route('POST', '/game/auctions/:id/cancel', 'company', async (c) => tx(c, (db) => auctions.cancel(db, c.account, c.company, c.params.id)));

// ------------------------------------------------------------ Owner: town
route('GET', '/owner/town', 'owner', async (c) => ({ ...(await town.today(c.db)), projects: await town.projectsView(c.db, null), blueprints: PROJECT_BLUEPRINTS, events: WORLD_EVENTS }));
route('POST', '/owner/town/projects', 'owner', async (c) => {
  const v = parse(z.object({ blueprint: z.string().max(40), scale: z.number().min(0.25).max(10).default(1), days: z.number().int().min(1).max(30).default(3) }), c.body);
  return tx(c, (db) => town.createProject(db, c.account, v));
});
route('POST', '/owner/town/projects/:id/cancel', 'owner', async (c) => tx(c, (db) => town.cancelProject(db, c.account, c.params.id)));
route('POST', '/owner/town/event', 'owner', async (c) => {
  const v = parse(z.object({ event: z.string().max(40) }), c.body);
  const e = WORLD_EVENTS.find((x) => x.id === v.event);
  if (!e) throw notFound('No such event.');
  await tx(c, async (db) => {
    await town.startEvent(db, e);
    await audit(db, c.account.id, 'town.event', e.id);
  });
  return { ok: true };
});
route('POST', '/owner/town/boosts', 'owner', async (c) => {
  const v = parse(
    z.object({
      kind: z.enum(['output', 'regen', 'taxfree', 'customers', 'quests']),
      facility: z.enum(['', ...FACILITY_IDS]).default(''),
      item: z.enum(['', ...ITEM_IDS]).default(''),
      pct: z.number().int().min(-50).max(500).default(20),
      days: z.number().min(0.25).max(30).default(1),
      label: z.string().min(2).max(80),
    }),
    c.body,
  );
  return tx(c, (db) => town.ownerBoost(db, c.account, v));
});
route('POST', '/owner/town/boosts/:id/clear', 'owner', async (c) => town.clearBoost(c.db, c.params.id));
route('POST', '/owner/auctions', 'owner', async (c) => tx(c, (db) => auctions.create(db, c.account, null, parse(newAuction, c.body))));
route('POST', '/owner/auctions/:id/cancel', 'owner', async (c) => tx(c, (db) => auctions.cancel(db, c.account, null, c.params.id)));
