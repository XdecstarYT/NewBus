/** Government: votes of no confidence, Mayor elections, union bills and demands. */
import { z } from 'zod';
import { LAW_KINDS } from '@dw/shared/live';
import { parse, route } from '../http/router';
import { tx } from '../http/tx';
import { forbidden } from '../lib/errors';
import { schema } from '../db';
import { eq } from 'drizzle-orm';
import * as gov from '../services/government';
import * as laws from '../services/laws';

const id = z.string().min(1).max(80);

route('GET', '/game/government', 'user', async (c) => gov.view(c.db, c.company));
route('POST', '/game/government/no-confidence', 'company', async (c) => tx(c, (db) => gov.callNoConfidence(db, c.account, c.company)));
route('POST', '/game/government/elections/:id/run', 'company', async (c) => tx(c, (db) => gov.nominate(db, c.account, c.company, c.params.id, parse(z.object({ pitch: z.string().max(200).default('') }), c.body).pitch)));
route('POST', '/game/government/elections/:id/withdraw', 'company', async (c) => tx(c, (db) => gov.withdraw(db, c.company, c.params.id)));
route('POST', '/game/government/elections/:id/vote', 'company', async (c) => tx(c, (db) => gov.vote(db, c.company, c.params.id, parse(z.object({ choice: id }), c.body).choice)));

// a union President puts a bill or a demand to the Town Hall
route('POST', '/game/laws', 'company', async (c) => {
  const v = parse(z.object({ kind: z.enum(Object.keys(LAW_KINDS) as [keyof typeof LAW_KINDS]), value: z.number().default(0), text: z.string().max(160).default('') }), c.body);
  return tx(c, async (db) => {
    const m = (await db.select().from(schema.unionMembers).where(eq(schema.unionMembers.companyId, c.company.id)))[0];
    const u = m ? (await db.select().from(schema.unions).where(eq(schema.unions.id, m.unionId)))[0] : null;
    if (!u || u.presidentId !== c.company.id) throw forbidden('Only a union President can put a bill to the Town Hall.');
    return laws.unionPropose(db, u.id, `${u.emoji} ${u.name}`, v.kind, v.value, v.text);
  });
});

// the government answers demands; only the creator can dismiss a Mayor
route('POST', '/owner/laws/:id/respond', 'owner', async (c) => tx(c, (db) => laws.respond(db, c.params.id, parse(z.object({ text: z.string().min(2).max(500) }), c.body).text)));
route('POST', '/owner/government/dismiss', 'owner', async (c) => tx(c, (db) => gov.dismiss(db, c.account)), { dev: true });
