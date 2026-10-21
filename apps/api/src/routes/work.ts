/** Office work, AI customers, contracts, daily quests and badges. */
import { z } from 'zod';
import { ITEM_IDS, WORK_CATEGORIES } from '@dw/shared/live';
import { parse, route } from '../http/router';
import { tx } from '../http/tx';
import { badRequest } from '../lib/errors';
import { clock } from '../lib/time';
import * as work from '../services/work';
import * as customers from '../services/customers';
import * as contracts from '../services/contracts';
import * as progress from '../services/progress';
import * as ownerai from '../services/ownerai';
import { aiAvailable, aiJson, aiStatus, AiError } from '../services/ai';
import { audit, getSettings } from '../services/core';
import * as zz from 'zod/v4';

const id = z.string().min(1).max(80);
const categories = Object.keys(WORK_CATEGORIES) as [keyof typeof WORK_CATEGORIES, ...Array<keyof typeof WORK_CATEGORIES>];

async function aiOn(db: Parameters<typeof getSettings>[0]) {
  return aiAvailable() && (await getSettings(db)).aiEnabled;
}
const aiFail = (e: unknown) => {
  if (e instanceof AiError) throw badRequest(e.message, 'ai_unavailable');
  throw e;
};

// ------------------------------------------------------------ office work (players)
route('GET', '/game/work-board', 'company', async (c) => work.board(c.db, c.account, c.company));
route('POST', '/game/jobs/:id/take', 'company', async (c) => tx(c, (db) => work.take(db, c.account, c.company, c.params.id)));
route('GET', '/game/submissions/:id', 'company', async (c) => work.workspace(c.db, c.account, c.params.id));
route('POST', '/game/submissions/:id', 'company', async (c) => {
  const v = parse(z.object({ answers: z.record(z.string(), z.union([z.string(), z.number()])) }), c.body);
  const r = await tx(c, (db) => work.submit(db, c.account, c.params.id, v.answers));
  if (r.status === 'grading' && r.grading === 'ai') return (await work.tryAiGrade(c.db, c.params.id)) ?? r;
  return r;
});

// ------------------------------------------------------------ AI customers
route('GET', '/game/customers', 'company', async (c) => customers.listCustomers(c.db, c.company));
route('POST', '/game/customers/:id/fill', 'company', async (c) => tx(c, (db) => customers.fill(db, c.account, c.company, c.params.id)));
route('POST', '/game/customers/:id/haggle', 'company', async (c) => {
  const v = parse(z.object({ pitch: z.string().min(1).max(300) }), c.body);
  return customers.haggle(c.db, c.company, c.params.id, v.pitch, await aiOn(c.db));
});

// ------------------------------------------------------------ contracts
route('GET', '/game/contracts', 'company', async (c) => contracts.list(c.db, c.company));
route('POST', '/game/contracts', 'company', async (c) => {
  const v = parse(
    z.object({
      item: z.enum(ITEM_IDS),
      qty: z.number().int().min(1).max(100_000),
      price: z.number().int().min(1).max(100_000_000),
      note: z.string().max(200).default(''),
      offeredTo: id.nullable().default(null),
      acceptHours: z.number().min(1).max(720).default(12),
      deliverHours: z.number().min(1).max(720).default(24),
    }),
    c.body,
  );
  return tx(c, (db) => contracts.create(db, c.account, c.company, v));
});
route('POST', '/game/contracts/:id/accept', 'company', async (c) => tx(c, (db) => contracts.accept(db, c.company, c.params.id)));
route('POST', '/game/contracts/:id/deliver', 'company', async (c) => tx(c, (db) => contracts.deliver(db, c.account, c.company, c.params.id)));
route('POST', '/game/contracts/:id/cancel', 'company', async (c) => tx(c, (db) => contracts.cancel(db, c.company, c.params.id)));

// ------------------------------------------------------------ quests, skills, badges
route('GET', '/game/quests', 'company', async (c) => ({ ...(await progress.questsView(c.db, c.account)), badges: await progress.achievements(c.db, c.company) }));
route('POST', '/game/quests/:id/claim', 'company', async (c) => tx(c, (db) => progress.claimQuest(db, c.account, c.company, c.params.id)));
route('GET', '/game/companies/:id/badges', 'user', async (c) => {
  const r = await progress.badgeCounts(c.db, [c.params.id]);
  return { earned: r[c.params.id] ?? 0 };
});

// ------------------------------------------------------------ Owner: office work
const field = z.object({
  key: z.string().regex(/^[a-z0-9-]{1,30}$/, 'keys are lowercase letters, numbers and dashes'),
  label: z.string().min(1).max(80),
  type: z.enum(['text', 'long', 'number', 'choice']),
  options: z.array(z.string().min(1).max(80)).max(12).optional(),
  placeholder: z.string().max(120).optional(),
});
const template = z.object({
  id: z.string().max(80).optional(),
  category: z.enum(categories),
  title: z.string().min(2).max(80),
  emoji: z.string().min(1).max(8),
  brief: z.string().min(5).max(2000),
  reference: z.string().max(8000).optional(),
  fields: z.array(field).min(1).max(10),
  grading: z.enum(['auto', 'ai', 'owner']),
  answers: z.record(z.string(), z.union([z.string().max(300), z.number()])).optional(),
  rubric: z.string().max(1000).optional(),
  reward: z.number().int().min(1).max(1_000_000),
  energy: z.number().int().min(0).max(100),
  minutes: z.number().int().min(1).max(24 * 60),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

route('GET', '/owner/work', 'owner', async (c) => ({
  templates: await work.allTemplates(c.db),
  categories: WORK_CATEGORIES,
  jobs: await work.jobsList(c.db),
  review: await work.reviewQueue(c.db),
  ai: aiStatus(),
  aiOn: await aiOn(c.db),
}));
route('POST', '/owner/work/templates', 'owner', async (c) => tx(c, (db) => work.saveTemplate(db, c.account.id, parse(template, c.body))));
route('POST', '/owner/work/templates/:id/archive', 'owner', async (c) => work.archiveTemplate(c.db, c.account.id, c.params.id));
route('POST', '/owner/work/ai-template', 'owner', async (c) => {
  const v = parse(z.object({ idea: z.string().min(3).max(1500), category: z.enum(categories).optional(), save: z.boolean().default(false) }), c.body);
  if (!(await aiOn(c.db))) throw badRequest('AI is off. Add your key as AIK in Netlify (and keep AI switched on in settings).', 'ai_unavailable');
  const draft = await work.aiDraftTemplate(v.idea, v.category).catch(aiFail);
  if (!v.save) return { draft };
  return { draft, ...(await tx(c, (db) => work.saveTemplate(db, c.account.id, draft, 'ai'))) };
});
route('POST', '/owner/work/jobs', 'owner', async (c) => {
  const v = parse(
    z.object({
      templateId: id,
      slots: z.number().int().min(1).max(50).default(3),
      reward: z.number().int().min(1).max(1_000_000).optional(),
      hours: z.number().min(1).max(720).default(24),
      clientName: z.string().max(40).optional(),
      clientEmoji: z.string().max(8).optional(),
      clientNote: z.string().max(300).optional(),
      targetCompanyId: id.nullable().optional(),
    }),
    c.body,
  );
  const r = await tx(c, (db) => work.postJob(db, 'owner', v));
  await audit(c.db, c.account.id, 'work.job.post', r.id, v);
  return r;
});
route('POST', '/owner/work/jobs/:id/close', 'owner', async (c) => tx(c, (db) => work.closeJob(db, c.params.id)));
route('POST', '/owner/work/submissions/:id/grade', 'owner', async (c) => {
  const v = parse(z.object({ score: z.number().int().min(0).max(100), feedback: z.string().max(2000).default('') }), c.body);
  return tx(c, (db) => work.ownerGrade(db, c.account.id, c.params.id, v.score, v.feedback));
});
route('POST', '/owner/work/submissions/:id/ai-grade', 'owner', async (c) => {
  const r = await c.db.transaction(async (t) => {
    const db = t as unknown as typeof c.db;
    const q = (await work.reviewQueue(db)).find((s) => s.id === c.params.id);
    if (!q) throw badRequest('Nothing to grade there.');
    return q;
  });
  const g = await work.aiGrade(r.task, r.answers ?? {}, 9000).catch(aiFail);
  return { suggestion: g };
});

// ------------------------------------------------------------ Owner requests (company side)
route('GET', '/game/requests', 'company', async (c) => ownerai.requestsFor(c.db, c.company.id));
route('POST', '/game/requests/:id/pay', 'company', async (c) => tx(c, (db) => ownerai.answerRequest(db, c.account, c.company, c.params.id, true)));
route('POST', '/game/requests/:id/decline', 'company', async (c) => tx(c, (db) => ownerai.answerRequest(db, c.account, c.company, c.params.id, false)));

// ------------------------------------------------------------ Owner: AI clients + AI actions
route('POST', '/owner/ai/client', 'owner', async (c) => {
  const v = parse(
    z.object({
      companyId: id.nullable().default(null),
      idea: z.string().max(1500).default(''),
      slots: z.number().int().min(1).max(50).default(1),
      reward: z.number().int().min(1).max(1_000_000).optional(),
      hours: z.number().min(1).max(720).default(24),
    }),
    c.body,
  );
  if (v.idea.trim() && !(await aiOn(c.db))) throw badRequest('Writing a new job needs the AI. Add AIK in Netlify, or leave the idea empty to send a client with a ready-made job.', 'ai_unavailable');
  const draft = await ownerai.draftClient(c.db, v).catch(aiFail);
  return tx(c, (db) => ownerai.sendClient(db, c.account, v, draft));
});
const action = z.object({
  kind: z.enum(ownerai.ACTION_KINDS),
  target: id,
  amount: z.number().int().min(0).max(100_000_000).default(0),
  item: z.string().max(40).default(''),
  qty: z.number().int().min(0).max(100_000).default(0),
  title: z.string().max(100).default(''),
  message: z.string().max(500).default(''),
  dueHours: z.number().min(1).max(720).default(24),
  templateId: z.string().max(80).default(''),
});
route('POST', '/owner/ai/plan', 'owner', async (c) => {
  const v = parse(z.object({ instruction: z.string().min(3).max(1500) }), c.body);
  if (!(await aiOn(c.db))) throw badRequest('AI is off. Add your key as AIK in Netlify (and keep AI switched on).', 'ai_unavailable');
  return ownerai.planActions(c.db, v.instruction).catch(aiFail);
});
route('POST', '/owner/ai/run', 'owner', async (c) => {
  const v = parse(z.object({ actions: z.array(action).min(1).max(20), aiWritten: z.boolean().default(true) }), c.body);
  return tx(c, (db) => ownerai.runActions(db, c.account, v.actions, v.aiWritten));
});
route('GET', '/owner/requests', 'owner', async (c) => ownerai.allRequests(c.db));
route('POST', '/owner/requests/:id/cancel', 'owner', async (c) => ownerai.cancelRequest(c.db, c.params.id));

// ------------------------------------------------------------ Owner: AI
route('GET', '/owner/ai', 'owner', async (c) => ({ ...aiStatus(), on: await aiOn(c.db), enabled: (await getSettings(c.db)).aiEnabled }));
route('POST', '/owner/ai/test', 'owner', async () => {
  const t0 = clock.now();
  const r = await aiJson(zz.object({ hello: zz.string() }), 'You are a cheerful game assistant.', 'Say hello to the game Owner in under 12 words.', { timeoutMs: 9000, maxTokens: 100 }).catch(aiFail);
  return { ok: true, reply: r.hello, ms: clock.now() - t0 };
});
route('POST', '/owner/ai/customers', 'owner', async (c) => {
  const n = await c.db.transaction((t) => customers.sweepCustomers(t as unknown as typeof c.db, clock.now(), true));
  return { added: n };
});
