import { z } from 'zod';
import { desc } from 'drizzle-orm';
import { CASE_KINDS, EVIDENCE_KINDS, FACILITY_IDS, FEATURES, LAW_KINDS } from '@dw/shared/live';
import { schema } from '../db';
import { parse, route } from '../http/router';
import { tx } from '../http/tx';
import * as owner from '../services/owner';
import * as accounts from '../services/accounts';
import * as justice from '../services/justice';
import * as laws from '../services/laws';
import * as unions from '../services/unions';
import { audit, patchSettings } from '../services/core';
import { sweep } from '../services/sweep';

const id = z.string().min(1).max(80);
const amount = z.number().int().min(1).max(100_000_000);
const memo = z.string().max(200).default('');
const feature = z.enum(Object.keys(FEATURES) as [keyof typeof FEATURES]);

route('GET', '/owner/overview', 'owner', async (c) => owner.overview(c.db));
route('GET', '/owner/companies', 'owner', async (c) => owner.companiesList(c.db));
route('GET', '/owner/companies/:id', 'owner', async (c) => owner.companyDetail(c.db, c.params.id));
route('POST', '/owner/companies', 'owner', async (c) => {
  const v = parse(
    z.object({
      name: z.string().min(2).max(40),
      emoji: z.string().min(1).max(8).default('🏢'),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#7c3aed'),
      slogan: z.string().max(120).default(''),
      industry: z.enum(FACILITY_IDS),
      adminName: z.string().min(1).max(40),
      number: z.string().max(10).optional(),
      password: z.string().min(4).max(100).optional(),
      grant: z.number().int().min(0).max(10_000_000).optional(),
    }),
    c.body,
  );
  return accounts.createCompany(c.db, c.account.id, v);
});
route('POST', '/owner/companies/:id/status', 'owner', async (c) => owner.setCompanyStatus(c.db, c.account, c.params.id, parse(z.object({ status: z.enum(['active', 'suspended']) }), c.body).status));
route('POST', '/owner/accounts/:id/reset', 'owner', async (c) => ({ password: await accounts.resetPassword(c.db, c.params.id, c.account.id) }));
route('POST', '/owner/accounts/:id/mute', 'owner', async (c) => owner.mute(c.db, c.account, c.params.id, parse(z.object({ hours: z.number().min(0).max(720) }), c.body).hours));

// money
route('POST', '/owner/mint', 'owner', async (c) => {
  const v = parse(z.object({ amount, to: id.nullable().default(null), memo }), c.body);
  return tx(c, (db) => owner.mint(db, c.account, v.amount, v.to, v.memo));
});
route('POST', '/owner/grant', 'owner', async (c) => {
  const v = parse(z.object({ to: id, amount, memo }), c.body);
  return tx(c, (db) => owner.grant(db, c.account, v.to, v.amount, v.memo));
});
route('POST', '/owner/fine', 'owner', async (c) => {
  const v = parse(z.object({ companyId: id, amount, memo }), c.body);
  return tx(c, (db) => owner.fine(db, c.account, v.companyId, v.amount, v.memo));
});
route('POST', '/owner/burn', 'owner', async (c) => tx(c, (db) => owner.burn(db, c.account, parse(z.object({ amount }), c.body).amount)));
route('GET', '/owner/ledger', 'owner', async (c) => owner.ledgerList(c.db, c.query.get('wallet') ?? undefined));
route('GET', '/owner/audit-log', 'owner', async (c) => c.db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.id)).limit(200));
route('PATCH', '/owner/settings', 'owner', async (c) => {
  const v = parse(
    z.object({
      salesTaxPct: z.number().min(0).max(50).optional(),
      startingGrant: z.number().int().min(0).max(10_000_000).optional(),
      unionCreateCost: z.number().int().min(0).max(1_000_000).optional(),
      unionTaxDiscount: z.boolean().optional(),
      courtFilingPct: z.number().min(0).max(50).optional(),
      appealHours: z.number().min(1).max(168).optional(),
      hearingMinutes: z.number().min(1).max(10_080).optional(),
      nominateMinutes: z.number().min(1).max(10_080).optional(),
      voteMinutes: z.number().min(1).max(10_080).optional(),
      unionTermDays: z.number().min(1).max(60).optional(),
      lawVoteHours: z.number().min(1).max(336).optional(),
      mintForWork: z.boolean().optional(),
      autoJobsPerDay: z.number().int().min(0).max(100).optional(),
      customersOpen: z.number().int().min(0).max(30).optional(),
      customerPayPct: z.number().int().min(50).max(500).optional(),
      questReward: z.number().int().min(0).max(100_000).optional(),
      aiEnabled: z.boolean().optional(),
      worldEvents: z.boolean().optional(),
      landPrice: z.number().int().min(1).max(1_000_000).optional(),
    }),
    c.body,
  );
  const s = await patchSettings(c.db, v);
  await audit(c.db, c.account.id, 'settings.update', null, v);
  return s;
});

// moderation + reward cards + season
route('POST', '/owner/chat/:id/delete', 'owner', async (c) => owner.deleteMessage(c.db, c.account, Number(c.params.id)));
route('GET', '/owner/codes', 'owner', async (c) => owner.listCodes(c.db));
route('POST', '/owner/codes', 'owner', async (c) => {
  const v = parse(z.object({ label: z.string().max(80).default('Reward'), bits: z.number().int().min(0).max(1_000_000).default(0), items: z.record(z.number().int().min(1).max(10_000)).default({}), uses: z.number().int().min(1).max(10_000).default(1), count: z.number().int().min(1).max(100).default(1) }), c.body);
  return owner.createCodes(c.db, c.account, v);
});
route('POST', '/owner/season/reset', 'owner', async (c) => {
  parse(z.object({ confirm: z.literal('RESET') }), c.body);
  return tx(c, (db) => owner.seasonReset(db, c.account));
});
route('POST', '/owner/sweep', 'owner', async (c) => ({ ran: await sweep(c.db, true) }));

// justice
route('GET', '/owner/justice', 'owner', async (c) => ({
  audits: await justice.auditsList(c.db),
  docket: await justice.docket(c.db),
  sanctions: await justice.sanctionsList(c.db),
  laws: (await laws.lawsView(c.db, null)).laws,
  unions: await unions.listUnions(c.db),
  kinds: { cases: CASE_KINDS, evidence: EVIDENCE_KINDS, laws: LAW_KINDS, features: FEATURES },
}));
route('POST', '/owner/audits', 'owner', async (c) => tx(c, (db) => justice.openAudit(db, parse(z.object({ companyId: id }), c.body).companyId)));
route('POST', '/owner/audits/:id/close', 'owner', async (c) => {
  const v = parse(z.object({ outcome: z.enum(['clean', 'warning', 'fined', 'referred']), fine: z.number().int().min(0).max(10_000_000).optional(), note: z.string().max(300).optional(), freezeHours: z.number().min(0).max(720).optional() }), c.body);
  return tx(c, (db) => justice.closeAudit(db, c.account.id, c.params.id, v.outcome, v));
});
route('POST', '/owner/court', 'owner', async (c) => {
  const v = parse(z.object({ defendantId: id, kind: z.enum(Object.keys(CASE_KINDS) as [keyof typeof CASE_KINDS]), title: z.string().min(3).max(120), claim: z.number().int().min(0).max(10_000_000) }), c.body);
  return tx(c, (db) => justice.fileCase(db, null, c.account.id, v));
});
route('GET', '/owner/court/:id', 'owner', async (c) => justice.caseView(c.db, c.params.id, null, true));
route('POST', '/owner/court/:id/evidence', 'owner', async (c) => tx(c, (db) => justice.addEvidence(db, c.params.id, null, true, c.account.id, parse(z.object({ kind: z.enum(Object.keys(EVIDENCE_KINDS) as [keyof typeof EVIDENCE_KINDS]), text: z.string().max(500).default('') }), c.body))));
route('POST', '/owner/court/:id/decide', 'owner', async (c) => {
  const v = parse(
    z.object({
      verdict: z.enum(['plaintiff', 'defendant']),
      reasoning: z.string().max(500).default(''),
      remedy: z.object({ damages: z.number().int().min(0).optional(), fine: z.number().int().min(0).optional(), freezeHours: z.number().min(0).max(720).optional(), suspend: feature.nullable().optional(), suspendHours: z.number().min(0).max(720).optional() }).optional(),
    }),
    c.body,
  );
  return tx(c, (db) => justice.decide(db, c.params.id, v.verdict, v.remedy, v.reasoning));
});
route('POST', '/owner/court/:id/accept', 'owner', async (c) => tx(c, (db) => justice.acceptSettlement(db, c.params.id, null, true)));
route('POST', '/owner/court/:id/withdraw', 'owner', async (c) => tx(c, (db) => justice.withdrawCase(db, c.params.id, null, true)));
route('POST', '/owner/sanctions', 'owner', async (c) => {
  const v = parse(z.object({ companyId: id, kind: z.enum(['freeze', 'suspend']), feature: feature.nullable().default(null), hours: z.number().min(1).max(720), reason: z.string().min(2).max(200) }), c.body);
  return tx(c, (db) => justice.addSanction(db, v.companyId, v.kind, v.hours, v.reason, v.feature));
});
route('POST', '/owner/sanctions/:id/lift', 'owner', async (c) => tx(c, (db) => justice.liftSanction(db, c.params.id)));
route('POST', '/owner/laws', 'owner', async (c) => {
  const v = parse(z.object({ kind: z.enum(Object.keys(LAW_KINDS) as [keyof typeof LAW_KINDS]), value: z.number().int() }), c.body);
  return tx(c, (db) => laws.propose(db, v.kind, v.value));
});
route('POST', '/owner/laws/:id/decide', 'owner', async (c) => tx(c, (db) => laws.decide(db, c.params.id, parse(z.object({ decision: z.enum(['pass', 'veto', 'count']) }), c.body).decision)));
route('POST', '/owner/unions/:id/dissolve', 'owner', async (c) => tx(c, (db) => unions.dissolve(db, c.params.id)));
