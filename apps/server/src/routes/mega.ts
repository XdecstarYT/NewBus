import { Router } from 'express';
import { z } from 'zod';
import { MINIGAME_IDS } from '@dw/shared';
import { h, parse, ctx, companyOf, requireModule } from './http';
import { registerGameRoutes } from './game';
import { registerOwnerRoutes } from './owner-extras';
import * as mg from '../services/minigames';
import * as research from '../services/research';
import * as goals from '../services/goals';
import * as chaos from '../services/chaos';

/** The Big Byte Update: arcade, research, achievements, quests, seasons + pass, collection, chaos controls. */
export function registerMegaRoutes() {
  registerGameRoutes((r) => {
    const a = Router();
    a.use(requireModule('minigames'));
    a.get('/', h((req) => mg.arcadeView(companyOf(req))));
    a.post('/:game/start', h((req) => mg.startGame(companyOf(req), req.params.game)));
    a.post('/finish', h((req) => {
      const v = parse(z.object({ sessionId: z.string().max(64), score: z.number().int().min(0).max(1_000_000), answers: z.array(z.number().int().min(0).max(9)).max(20).optional() }), req.body);
      return mg.finishGame(companyOf(req), ctx(req).account.id, v.sessionId, v);
    }));
    a.get('/:game/leaders', h((req) => (MINIGAME_IDS.includes(req.params.game as any) ? mg.arcadeLeaders(req.params.game) : [])));
    r.use('/arcade', a);

    r.get('/research', requireModule('research'), h((req) => research.researchView(companyOf(req))));
    r.post('/research/buy', requireModule('research'), h((req) => research.buyResearch(companyOf(req), parse(z.object({ key: z.string().max(60) }), req.body).key)));

    r.get('/achievements', requireModule('achievements'), h((req) => goals.achievementsView(companyOf(req))));
    r.post('/title', h((req) => goals.setTitle(companyOf(req), parse(z.object({ title: z.string().max(80).nullable() }), req.body).title)));

    r.get('/quests', h((req) => goals.questsView(companyOf(req), ctx(req).access.modules)));
    r.post('/quests/:id/claim', h((req) => goals.claimQuest(companyOf(req), req.params.id)));
    r.get('/season', h((req) => goals.seasonView(companyOf(req))));
    r.post('/season/claim', h((req) => goals.claimPassTier(companyOf(req), parse(z.object({ tier: z.number().int().min(1).max(100) }), req.body).tier)));
    r.get('/collection', h((req) => goals.collectionView(companyOf(req))));
  });

  registerOwnerRoutes((r) => {
    r.get('/chaos', h(() => chaos.chaosView()));
    r.post('/chaos/rain', h((req) => chaos.creditRain(parse(z.object({ amount: z.number().int() }), req.body).amount, ctx(req).account.id)));
    r.post('/chaos/double', h((req) => {
      const v = parse(z.object({ minutes: z.number().int(), mult: z.number().default(2) }), req.body);
      return chaos.doubleBits(v.minutes, v.mult, ctx(req).account.id);
    }));
    r.post('/chaos/legendary', h((req) => chaos.spawnLegendary(parse(z.object({ companyId: z.string().max(64) }), req.body).companyId, ctx(req).account.id)));
    r.post('/chaos/market', h((req) => chaos.marketShock(parse(z.object({ key: z.string().max(40) }), req.body).key, ctx(req).account.id)));
    r.post('/chaos/broadcast', h((req) => {
      const v = parse(z.object({ text: z.string().min(1).max(280), news: z.boolean().default(false) }), req.body);
      return chaos.broadcast(v.text, ctx(req).account.id, v.news);
    }));
    r.post('/chaos/event', h((req) => {
      const v = parse(z.object({ target: z.string().max(64), eventId: z.string().max(60).nullable().default(null) }), req.body);
      return chaos.chaosEvent(v.target, v.eventId, ctx(req).account.id);
    }));
    r.get('/seasons', h(() => goals.listSeasons()));
    r.post('/seasons/start', h((req) => goals.startSeason(parse(z.object({ name: z.string().max(60).default(''), theme: z.string().max(40).default('classic'), days: z.number().int().min(1).max(180) }), req.body), ctx(req).account.id)));
    r.post('/seasons/end', h((req) => goals.endSeason(ctx(req).account.id)));
  });
}
