import { Router } from 'express';
import { z } from 'zod';
import { transferSchema, potMoveSchema, idempotencyKeySchema } from '@dw/shared';
import { registerGameRoutes } from './game';
import { h, parse, ctx, companyOf, requireModule, requireRole } from './http';
import * as bank from '../services/bank';

export function registerBankRoutes() {
  registerGameRoutes((r) => {
    const b = Router();
    b.use(requireModule('bank'));
    b.get('/', h((req) => bank.bankView(companyOf(req))));
    b.get('/history', h((req) => bank.walletHistory(companyOf(req), { kind: req.query.kind ? String(req.query.kind) : undefined, limit: Number(req.query.limit ?? 100) })));
    b.post('/pots', h((req) => {
      const v = parse(potMoveSchema, req.body);
      return bank.movePot(companyOf(req), v.from, v.to, v.amount, ctx(req).account.id, v.idempotencyKey);
    }));
    b.post('/deposits', h((req) => {
      const v = parse(z.object({ amount: z.number().int().min(10).max(1e9), hours: z.number().int().min(1).max(168) }), req.body);
      return bank.openDeposit(companyOf(req), v.amount, v.hours, ctx(req).account.id);
    }));
    b.post('/insurance', h((req) => bank.buyInsurance(companyOf(req), parse(z.object({ kind: z.string().max(20) }), req.body).kind, ctx(req).account.id)));
    b.post('/lotto', h((req) => bank.buyLotto(companyOf(req), ctx(req).account.id)));
    // payroll for STAFF accounts (company admins only)
    b.get('/staff', requireRole('COMPANY_ADMIN', 'OWNER'), h((req) => bank.staffWallets(companyOf(req))));
    b.post('/staff/:id/pay', requireRole('COMPANY_ADMIN', 'OWNER'), h((req) => {
      const v = parse(z.object({ amount: z.number().int().min(1).max(1e9), memo: z.string().max(80).default(''), idempotencyKey: idempotencyKeySchema }), req.body);
      return bank.payStaff(companyOf(req), req.params.id, v.amount, v.memo, ctx(req).account.id, v.idempotencyKey);
    }));
    r.use('/bank', b);

    const t = Router();
    t.use(requireModule('transfers'));
    t.get('/recipients', h((req) => bank.recipients(companyOf(req))));
    t.post('/', h((req) => {
      const v = parse(transferSchema, req.body);
      return bank.transfer(companyOf(req), v.toCompanyId, v.amount, v.memo, ctx(req).account.id, v.idempotencyKey);
    }));
    r.use('/transfers', t);

    const l = Router();
    l.use(requireModule('loans'));
    l.get('/', h((req) => ({ offer: bank.loanOffer(companyOf(req)), ...bank.listLoans(companyOf(req)) })));
    l.post('/', h((req) => bank.takeLoan(companyOf(req), parse(z.object({ amount: z.number().int().min(10).max(1e9) }), req.body).amount, ctx(req).account.id)));
    l.post('/:id/repay', h((req) => {
      const v = parse(z.object({ amount: z.union([z.number().int().min(1), z.literal('all')]) }), req.body);
      return bank.repayLoan(companyOf(req), req.params.id, v.amount, ctx(req).account.id);
    }));
    l.post('/peer', h((req) => {
      const v = parse(z.object({ amount: z.number().int().min(10).max(1e9), rateBps: z.number().int().min(0).max(3000) }), req.body);
      return bank.offerPeerLoan(companyOf(req), v.amount, v.rateBps, ctx(req).account.id);
    }));
    l.post('/peer/:id/accept', h((req) => bank.acceptPeerLoan(companyOf(req), req.params.id, ctx(req).account.id)));
    l.post('/peer/:id/cancel', h((req) => bank.cancelPeerOffer(companyOf(req), req.params.id)));
    r.use('/loans', l);
  });
}
