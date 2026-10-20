import { z } from 'zod';
import { CASE_KINDS, EVIDENCE_KINDS, UNION_OFFICES } from '@dw/shared/live';
import { beforeEach, parse, route } from '../http/router';
import { tx } from '../http/tx';
import { forbidden } from '../lib/errors';
import * as unions from '../services/unions';
import * as justice from '../services/justice';
import * as laws from '../services/laws';
import * as social from '../services/social';
import { redeem } from '../services/owner';
import { sweep } from '../services/sweep';

const id = z.string().min(1).max(80);
const office = z.enum(Object.keys(UNION_OFFICES) as [keyof typeof UNION_OFFICES]);
const caseKind = z.enum(Object.keys(CASE_KINDS) as [keyof typeof CASE_KINDS]);
const evKind = z.enum(Object.keys(EVIDENCE_KINDS) as [keyof typeof EVIDENCE_KINDS]);

// settle elections, hearings and bills as people use the game
beforeEach(async (c) => {
  await sweep(c.db);
});

// ------------------------------------------------------------ unions
route('GET', '/game/unions', 'company', async (c) => ({ unions: await unions.listUnions(c.db), mine: (await unions.membership(c.db, c.company.id))?.unionId ?? null }));
route('GET', '/game/unions/:id', 'company', async (c) => unions.unionView(c.db, c.params.id, c.account, c.company));
route('POST', '/game/unions', 'company', async (c) => {
  const v = parse(z.object({ name: z.string().min(3).max(40), emoji: z.string().max(8).default('✊'), motto: z.string().max(120).default(''), dues: z.number().int().min(0).max(5000).default(50) }), c.body);
  return tx(c, (db) => unions.createUnion(db, c.account, c.company, v));
});
route('POST', '/game/unions/:id/join', 'company', async (c) => tx(c, (db) => unions.joinUnion(db, c.account, c.company, c.params.id)));
route('POST', '/game/union/leave', 'company', async (c) => tx(c, (db) => unions.leaveUnion(db, c.account, c.company)));
route('POST', '/game/union/kick', 'company', async (c) => tx(c, (db) => unions.kick(db, c.account, c.company, parse(z.object({ companyId: id }), c.body).companyId)));
route('POST', '/game/union/rep', 'company', async (c) => tx(c, (db) => unions.setRep(db, c.account, c.company, parse(z.object({ accountId: id }), c.body).accountId)));
route('POST', '/game/union/donate', 'company', async (c) => tx(c, (db) => unions.donate(db, c.account, c.company, parse(z.object({ amount: z.number().int().min(1) }), c.body).amount)));
route('PATCH', '/game/union', 'company', async (c) => tx(c, (db) => unions.updateUnion(db, c.account, c.company, parse(z.object({ motto: z.string().max(120).optional(), dues: z.number().int().min(0).max(5000).optional(), open: z.boolean().optional() }), c.body))));
route('POST', '/game/union/grant', 'company', async (c) => {
  const v = parse(z.object({ to: id, amount: z.number().int().min(1) }), c.body);
  return tx(c, (db) => unions.grant(db, c.account, c.company, v.to, v.amount));
});
route('POST', '/game/union/elections', 'company', async (c) => tx(c, (db) => unions.callElection(db, c.account, c.company, parse(z.object({ office }), c.body).office)));
route('POST', '/game/union/elections/:id/nominate', 'company', async (c) => tx(c, (db) => unions.nominate(db, c.account, c.company, c.params.id, parse(z.object({ pitch: z.string().max(200).default('') }), c.body).pitch)));
route('POST', '/game/union/elections/:id/withdraw', 'company', async (c) => tx(c, (db) => unions.withdraw(db, c.account, c.company, c.params.id)));
route('POST', '/game/union/elections/:id/vote', 'company', async (c) => tx(c, (db) => unions.vote(db, c.account, c.company, c.params.id, parse(z.object({ choice: id }), c.body).choice)));
route('POST', '/game/union/recall', 'company', async (c) => tx(c, (db) => unions.callRecall(db, c.account, c.company, parse(z.object({ office }), c.body).office)));
route('POST', '/game/union/resign', 'company', async (c) => tx(c, (db) => unions.resign(db, c.account, c.company, parse(z.object({ office }), c.body).office)));

// ------------------------------------------------------------ town hall (laws)
route('GET', '/game/laws', 'user', async (c) => laws.lawsView(c.db, c.company?.id ?? null));
route('POST', '/game/laws/:id/vote', 'company', async (c) => tx(c, (db) => laws.vote(db, c.company, c.params.id, parse(z.object({ vote: z.enum(['yes', 'no']) }), c.body).vote)));

// ------------------------------------------------------------ courthouse
route('GET', '/game/court', 'company', async (c) => ({
  cases: await justice.docket(c.db, { companyId: c.company.id }),
  docket: await justice.docket(c.db, { open: true }),
  sanctions: await justice.sanctionsList(c.db, c.company.id),
  audits: (await justice.auditsList(c.db, c.company.id)).map((a) => ({ id: a.id, status: a.status, outcome: a.outcome, fine: a.fine, note: a.note, createdAt: a.createdAt, closedAt: a.closedAt })),
}));
route('GET', '/game/court/:id', 'company', async (c) => justice.caseView(c.db, c.params.id, c.company.id, false));
route('POST', '/game/court', 'company', async (c) => {
  const v = parse(z.object({ defendantId: id, kind: caseKind, title: z.string().min(3).max(120), claim: z.number().int().min(0).max(10_000_000) }), c.body);
  if (v.kind === 'tax') throw forbidden('Only the State can bring tax cases.');
  return tx(c, (db) => justice.fileCase(db, c.company, c.account.id, v));
});
route('POST', '/game/court/:id/evidence', 'company', async (c) => tx(c, (db) => justice.addEvidence(db, c.params.id, c.company.id, false, c.account.id, parse(z.object({ kind: evKind, text: z.string().max(500).default('') }), c.body))));
route('POST', '/game/court/:id/settle', 'company', async (c) => tx(c, (db) => justice.offerSettlement(db, c.params.id, c.company, parse(z.object({ amount: z.number().int().min(0) }), c.body).amount)));
route('POST', '/game/court/:id/accept', 'company', async (c) => tx(c, (db) => justice.acceptSettlement(db, c.params.id, c.company.id, false)));
route('POST', '/game/court/:id/withdraw', 'company', async (c) => tx(c, (db) => justice.withdrawCase(db, c.params.id, c.company.id, false)));
route('POST', '/game/court/:id/appeal', 'company', async (c) => tx(c, (db) => justice.appeal(db, c.params.id, c.account, c.company)));

// ------------------------------------------------------------ chat + leaderboard + reward cards
route('GET', '/chat/channels', 'user', async (c) => ({ channels: await social.channels(c.db, c.account, c.company), people: await social.people(c.db) }));
route('GET', '/chat/history', 'user', async (c) => social.history(c.db, c.account, c.company, c.query.get('channel') ?? 'global', Number(c.query.get('before') ?? 0) || undefined));
route('POST', '/chat/send', 'user', async (c) => {
  const v = parse(z.object({ channel: z.string().max(120), text: z.string().min(1).max(400) }), c.body);
  return tx(c, (db) => social.send(db, c.account, c.company, v.channel, v.text));
});
route('POST', '/chat/dm', 'user', async (c) => ({ channel: social.dmChannel(c.account.id, parse(z.object({ accountId: id }), c.body).accountId) }));
route('GET', '/game/leaderboard', 'user', async (c) => social.leaderboard(c.db));
route('POST', '/game/redeem', 'company', async (c) => tx(c, (db) => redeem(db, c.account, c.company, parse(z.object({ code: z.string().min(4).max(200) }), c.body).code)));
