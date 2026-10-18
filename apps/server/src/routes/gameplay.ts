import { Router } from 'express';
import { z } from 'zod';
import { registerGameRoutes } from './game';
import { h, parse, ctx, companyOf, requireModule } from './http';
import { podCatalog, openPod } from '../services/pods';
import * as contracts from '../services/contracts';
import { pendingEvent, resolveEvent, recentEvents } from '../services/events';
import { streakStatus, spinWheel, prestigePreview, doPrestige, shopView, buyItem, equipItem } from '../services/progression';

export function registerGameplayRoutes() {
  registerGameRoutes((r) => {
    const pods = Router();
    pods.use(requireModule('pods'));
    pods.get('/', h((req) => podCatalog(companyOf(req))));
    pods.post(
      '/open',
      h((req) => {
        const { type } = parse(z.object({ type: z.string().min(1).max(20) }), req.body);
        return openPod(companyOf(req), type, ctx(req).account.id);
      }),
    );
    r.use('/pods', pods);

    const ct = Router();
    ct.use(requireModule('contracts'));
    ct.get('/', h((req) => contracts.board(companyOf(req))));
    ct.post('/:id/accept', h((req) => contracts.accept(companyOf(req), req.params.id)));
    ct.post('/:id/claim', h((req) => contracts.claim(companyOf(req), req.params.id, ctx(req).account.id)));
    ct.post('/:id/abandon', h((req) => contracts.abandon(companyOf(req), req.params.id)));
    r.use('/contracts', ct);

    const ev = Router();
    ev.use(requireModule('events'));
    ev.get('/', h((req) => ({ pending: pendingEvent(companyOf(req)), recent: recentEvents(companyOf(req)) })));
    ev.post(
      '/:id/resolve',
      h((req) => {
        const { choice } = parse(z.object({ choice: z.number().int().min(0).max(5) }), req.body);
        return resolveEvent(companyOf(req), req.params.id, choice, ctx(req).account.id);
      }),
    );
    r.use('/events', ev);

    // The daily streak wheel is part of the core office loop.
    const st = Router();
    st.use(requireModule('office'));
    st.get('/', h((req) => streakStatus(companyOf(req))));
    st.post('/spin', h((req) => spinWheel(companyOf(req), ctx(req).account.id)));
    r.use('/streak', st);

    const pr = Router();
    pr.use(requireModule('prestige'));
    pr.get('/', h((req) => prestigePreview(companyOf(req))));
    pr.post('/', h((req) => doPrestige(companyOf(req), ctx(req).account.id)));
    r.use('/prestige', pr);

    const shop = Router();
    shop.use(requireModule('decor'));
    shop.get('/', h((req) => shopView(companyOf(req))));
    shop.post(
      '/buy',
      h((req) => {
        const { key } = parse(z.object({ key: z.string().min(1).max(60) }), req.body);
        return buyItem(companyOf(req), key, ctx(req).account.id);
      }),
    );
    shop.post(
      '/equip',
      h((req) => {
        const { itemId, on } = parse(z.object({ itemId: z.string().min(1).max(64), on: z.boolean() }), req.body);
        return equipItem(companyOf(req), itemId, on);
      }),
    );
    r.use('/shop', shop);
  });
}
