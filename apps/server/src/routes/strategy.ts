import { z } from 'zod';
import { and, eq, ne } from 'drizzle-orm';
import { CASE_KINDS, EVIDENCE_KINDS, LAW_TEMPLATES, POLICIES, UNION_MOVES, UNION_OFFICES, MODULES } from '@dw/shared';
import { db, schema } from '../db';
import { h, parse, ctx, companyOf, requireModule } from './http';
import { registerGameRoutes } from './game';
import { registerOwnerRoutes } from './owner-extras';
import * as strat from '../services/strategy';
import * as unions from '../services/unions';
import * as justice from '../services/justice';

const id = z.string().max(80);
const office = z.enum(Object.keys(UNION_OFFICES) as [keyof typeof UNION_OFFICES, ...Array<keyof typeof UNION_OFFICES>]);
const caseKind = z.enum(Object.keys(CASE_KINDS) as [keyof typeof CASE_KINDS, ...Array<keyof typeof CASE_KINDS>]);
const evidenceKind = z.enum(Object.keys(EVIDENCE_KINDS) as [keyof typeof EVIDENCE_KINDS, ...Array<keyof typeof EVIDENCE_KINDS>]);
const side = z.enum(['for', 'against']);
const remedy = z
  .object({
    damages: z.number().int().min(0).max(10_000_000).optional(),
    fine: z.number().int().min(0).max(10_000_000).optional(),
    freezeHours: z.number().min(0).max(720).optional(),
    suspendModule: z.enum(MODULES as unknown as [string, ...string[]]).nullable().optional(),
    suspendHours: z.number().min(0).max(720).optional(),
  })
  .optional();
const evidence = z.object({ kind: evidenceKind, text: z.string().max(500).default('') });

const directory = (exclude: string | null) =>
  db
    .select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji })
    .from(schema.companies)
    .where(exclude ? and(eq(schema.companies.status, 'active'), ne(schema.companies.id, exclude)) : eq(schema.companies.status, 'active'))
    .all();

/** Strategy Room, Unions and the Courthouse for players; audits, the bench, sanctions and laws for the Owner. */
export function registerStrategyRoutes() {
  registerGameRoutes((r) => {
    r.get('/companies/directory', h((req) => directory(companyOf(req))));

    // ---- strategy room
    r.get('/strategy', requireModule('strategy'), h((req) => strat.strategyView(companyOf(req))));
    r.post('/strategy/run', requireModule('strategy'), h((req) => strat.runAction(companyOf(req), parse(z.object({ actionId: id }), req.body).actionId, ctx(req).account.id)));
    r.post('/strategy/policy', requireModule('strategy'), h((req) => {
      const v = parse(z.object({ key: z.enum(Object.keys(POLICIES) as ['pricing', 'labor', 'risk']), value: z.string().max(20) }), req.body);
      return strat.setPolicy(companyOf(req), v.key, v.value, ctx(req).account.id);
    }));
    r.post('/strategy/focus', requireModule('strategy'), h((req) => strat.setFocus(companyOf(req), parse(z.object({ district: id }), req.body).district)));
    r.post('/laws/:id/lobby', requireModule('strategy'), h((req) => {
      const v = parse(z.object({ side, influence: z.number().int().min(1).max(1_000_000) }), req.body);
      return strat.lobby(companyOf(req), req.params.id, v.side, v.influence);
    }));

    // ---- unions
    const U = requireModule('unions');
    r.get('/unions', U, h((req) => ({ unions: unions.listUnions(), mine: unions.myUnion(companyOf(req)) })));
    r.get('/unions/:id', U, h((req) => {
      const view = unions.unionView(req.params.id, companyOf(req), ctx(req).account.id);
      const logins = view.me ? db.select({ id: schema.accounts.id, name: schema.accounts.displayName }).from(schema.accounts).where(and(eq(schema.accounts.companyId, companyOf(req)), eq(schema.accounts.status, 'active'))).all() : [];
      return { ...view, logins };
    }));
    r.post('/unions', U, h((req) => unions.createUnion(companyOf(req), ctx(req).account.id, parse(z.object({ name: z.string().min(3).max(40), emoji: z.string().max(8).default('✊'), motto: z.string().max(120).default(''), dues: z.number().int().min(0).max(5000).default(100) }), req.body))));
    r.post('/unions/:id/join', U, h((req) => unions.joinUnion(companyOf(req), ctx(req).account.id, req.params.id)));
    r.post('/union/leave', U, h((req) => unions.leaveUnion(companyOf(req), ctx(req).account.id)));
    r.post('/union/rep', U, h((req) => unions.setRep(companyOf(req), ctx(req).account.id, parse(z.object({ accountId: id }), req.body).accountId)));
    r.post('/union/donate', U, h((req) => unions.donate(companyOf(req), ctx(req).account.id, parse(z.object({ amount: z.number().int().min(1) }), req.body).amount)));
    r.patch('/union', U, h((req) => unions.updateUnion(companyOf(req), ctx(req).account.id, parse(z.object({ motto: z.string().max(120).optional(), dues: z.number().int().min(0).max(5000).optional(), open: z.boolean().optional() }), req.body))));
    r.post('/union/kick', U, h((req) => unions.kickMember(companyOf(req), ctx(req).account.id, parse(z.object({ companyId: id }), req.body).companyId)));
    r.post('/union/elections', U, h((req) => unions.callElection(companyOf(req), ctx(req).account.id, parse(z.object({ office }), req.body).office)));
    r.post('/union/elections/:id/nominate', U, h((req) => unions.nominate(companyOf(req), ctx(req).account.id, req.params.id, parse(z.object({ pitch: z.string().max(200).default('') }), req.body).pitch)));
    r.post('/union/elections/:id/withdraw', U, h((req) => unions.withdraw(companyOf(req), ctx(req).account.id, req.params.id)));
    r.post('/union/elections/:id/vote', U, h((req) => unions.vote(companyOf(req), ctx(req).account.id, req.params.id, parse(z.object({ choice: id }), req.body).choice)));
    r.post('/union/recall', U, h((req) => unions.callRecall(companyOf(req), ctx(req).account.id, parse(z.object({ office }), req.body).office)));
    r.post('/union/resign', U, h((req) => unions.resign(companyOf(req), ctx(req).account.id, parse(z.object({ office }), req.body).office)));
    r.post('/union/move', U, h((req) => {
      const v = parse(z.object({ move: z.enum(Object.keys(UNION_MOVES) as [keyof typeof UNION_MOVES, ...Array<keyof typeof UNION_MOVES>]), targetId: id.optional(), amount: z.number().int().min(0).optional() }), req.body);
      return unions.unionMove(companyOf(req), ctx(req).account.id, v.move, v);
    }));
    r.post('/union/lobby', U, h((req) => {
      const v = parse(z.object({ lawId: id, side, amount: z.number().int().min(1) }), req.body);
      return unions.unionLobbyLaw(companyOf(req), ctx(req).account.id, v.lawId, v.side, v.amount);
    }));

    // ---- courthouse
    const C = requireModule('court');
    r.get('/court', C, h((req) => ({ ...justice.myLegal(companyOf(req)), docket: justice.docket({ open: true }) })));
    r.get('/court/cases/:id', C, h((req) => justice.caseView(req.params.id, companyOf(req), false)));
    r.post('/court/cases', C, h((req) => justice.fileCase(companyOf(req), parse(z.object({ defendantId: id, kind: caseKind, title: z.string().min(3).max(120), claim: z.number().int().min(0).max(10_000_000) }), req.body), ctx(req).account.id)));
    r.post('/court/cases/:id/evidence', C, h((req) => justice.addEvidence(req.params.id, companyOf(req), false, parse(evidence, req.body), ctx(req).account.id)));
    r.post('/court/cases/:id/settle', C, h((req) => justice.offerSettlement(req.params.id, companyOf(req), parse(z.object({ amount: z.number().int().min(0) }), req.body).amount)));
    r.post('/court/cases/:id/accept', C, h((req) => justice.acceptSettlement(req.params.id, companyOf(req), false)));
    r.post('/court/cases/:id/withdraw', C, h((req) => justice.withdrawCase(req.params.id, companyOf(req), false)));
    r.post('/court/cases/:id/appeal', C, h((req) => justice.appealCase(req.params.id, companyOf(req), ctx(req).account.id)));
  });

  registerOwnerRoutes((r) => {
    r.get('/justice', h(() => ({
      audits: justice.auditsList(),
      candidates: justice.auditCandidates(),
      docket: justice.docket(),
      sanctions: justice.sanctionsList(),
      laws: strat.lawsView(null),
      lawTemplates: LAW_TEMPLATES,
      unions: unions.listUnions(),
      districts: strat.districtsView(null),
      companies: directory(null),
    })));
    r.post('/audits', h((req) => {
      const v = parse(z.object({ companyId: id, depth: z.enum(['desk', 'field', 'forensic']).default('field') }), req.body);
      return justice.openAudit(v.companyId, v.depth, ctx(req).account.id);
    }));
    r.post('/audits/:id/close', h((req) => {
      const v = parse(z.object({ outcome: z.enum(['clean', 'warning', 'fined', 'referred']), fine: z.number().int().min(0).max(10_000_000).optional(), note: z.string().max(300).optional(), freezeHours: z.number().min(0).max(720).optional() }), req.body);
      return justice.closeAudit(req.params.id, v.outcome, v, ctx(req).account.id);
    }));
    r.post('/court/cases', h((req) => justice.fileCase(null, parse(z.object({ defendantId: id, kind: caseKind, title: z.string().min(3).max(120), claim: z.number().int().min(0).max(10_000_000) }), req.body), ctx(req).account.id)));
    r.get('/court/cases/:id', h((req) => justice.caseView(req.params.id, null, true)));
    r.post('/court/cases/:id/evidence', h((req) => justice.addEvidence(req.params.id, null, true, parse(evidence, req.body), ctx(req).account.id)));
    r.post('/court/cases/:id/decide', h((req) => {
      const v = parse(z.object({ verdict: z.enum(['plaintiff', 'defendant']), remedy, reasoning: z.string().max(500).default('') }), req.body);
      return justice.decideCase(req.params.id, v.verdict, v.remedy, v.reasoning, ctx(req).account.id);
    }));
    r.post('/court/cases/:id/accept', h((req) => justice.acceptSettlement(req.params.id, null, true)));
    r.post('/court/cases/:id/withdraw', h((req) => justice.withdrawCase(req.params.id, null, true)));
    r.post('/sanctions', h((req) => {
      const v = parse(z.object({ companyId: id, kind: z.enum(['freeze', 'suspend']), module: z.string().max(40).nullable().optional(), hours: z.number().min(1).max(720), reason: z.string().min(2).max(200) }), req.body);
      return justice.addSanction(v.companyId, v.kind, v.hours, v.reason, 'owner', ctx(req).account.id, v.module ?? null);
    }));
    r.post('/sanctions/:id/lift', h((req) => justice.liftSanction(req.params.id, ctx(req).account.id)));
    r.post('/laws', h((req) => {
      const v = parse(z.object({ templateKey: z.string().max(40), hoursOpen: z.number().min(1).max(168).default(24) }), req.body);
      return strat.proposeLaw(v.templateKey as any, v.hoursOpen, ctx(req).account.id);
    }));
    r.post('/laws/:id/decide', h((req) => strat.decideLaw(req.params.id, parse(z.object({ decision: z.enum(['pass', 'veto', 'count']) }), req.body).decision, ctx(req).account.id)));
    r.post('/unions/:id/dissolve', h((req) => unions.dissolveUnion(req.params.id, ctx(req).account.id)));
  });
}
