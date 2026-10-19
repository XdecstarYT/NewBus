/**
 * Economy simulation: hundreds of bot companies with different play styles run
 * for simulated days on an in-memory copy of the game. Prints a report on
 * money supply, inflation, inequality, Treasury/NPC pool health and the ledger.
 *
 *   npm run simulate                      # 500 bots, 3 days, 1-hour steps
 *   npm run simulate -- --bots 1000 --days 7 --step 30 --out report.md
 *   npm run simulate -- --no-autobalance     # see what happens without the auto-balancer
 */
export {};
process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split('--')
    .filter(Boolean)
    .map((a) => {
      const [k, v] = a.trim().split(/\s+/);
      return [k, v ?? 'true'];
    }),
);
const BOTS = Number(args.bots ?? 500);
const DAYS = Number(args.days ?? 3);
const STEP_MIN = Number(args.step ?? 60); // simulated minutes per step
const OUT = args.out as string | undefined;

const { PERMISSION_PRESETS } = await import('@dw/shared');
const { seedAll } = await import('../db/seed');
const D = await import('../db');
const { schema } = D;
const { eq } = await import('drizzle-orm');
const { clock, DAY_MS } = await import('../lib/time');
const { reseedLive } = await import('../engine/rng');
const { createCompany, getCompany } = await import('../services/companies');
const { runTick } = await import('../services/tick');
const { moneySupply, balanceOf, verifyLedger, SYS } = await import('../services/ledger');
const { gini } = await import('../services/economy-health');
const { boost, autoAssign, upgradeWorkplace } = await import('../services/office');
const { openPod } = await import('../services/pods');
const contracts = await import('../services/contracts');
const mg = await import('../services/minigames');
const research = await import('../services/research');
const goals = await import('../services/goals');
const { listIndustries } = await import('../services/catalog');
const { companyWallet } = await import('../services/money');
const { cfg } = await import('../services/settings');
const fs = await import('node:fs');

type Style = 'idle' | 'casual' | 'grinder' | 'gamer' | 'builder';
const STYLES: Array<{ style: Style; weight: number; online: number }> = [
  { style: 'idle', weight: 0.25, online: 0.05 }, // logs in rarely
  { style: 'casual', weight: 0.35, online: 0.25 },
  { style: 'grinder', weight: 0.15, online: 0.7 },
  { style: 'gamer', weight: 0.15, online: 0.45 },
  { style: 'builder', weight: 0.1, online: 0.5 },
];

reseedLive(424242);
const { setFlag } = await import('../services/flags');
const started = Date.now();
seedAll({ quiet: true, demo: false });
setFlag('autoBalancer', args['no-autobalance'] ? false : true);
let rnd = 99;
const rand = () => ((rnd = (Math.imul(rnd, 1103515245) + 12345) >>> 0) / 4294967296);
const industries = listIndustries();
const bots: Array<{ id: string; accountId: string; style: Style; online: number }> = [];
for (let i = 0; i < BOTS; i++) {
  let r = rand();
  const s = STYLES.find((x) => (r -= x.weight) < 0) ?? STYLES[0];
  const ind = industries[Math.floor(rand() * industries.length)];
  const res = createCompany(
    { name: `Bot ${i} ${ind.name}`.slice(0, 40), emoji: '🤖', color: '#888888', slogan: '', industryId: ind.id, startingBits: 1500, startingWorkers: 2, startingWorkplace: 0, difficulty: 'NORMAL', permissions: PERMISSION_PRESETS.full.perms, mustChangePassword: false, adminName: 'Bot', password: 'botbotbot' } as any,
    null,
  );
  bots.push({ id: res.company.id, accountId: res.account.id, style: s.style, online: s.online });
}
const setupMs = Date.now() - started;

const t0 = clock.now();
const steps = Math.round((DAYS * 24 * 60) / STEP_MIN);
const snapshots: Array<{ day: number; supply: number; treasury: number; npc: number; median: number; top1: number; gini: number }> = [];
const actions: Record<string, number> = {};
const act = (name: string, fn: () => unknown) => {
  try {
    fn();
    actions[name] = (actions[name] ?? 0) + 1;
  } catch {
    actions[`${name}:fail`] = (actions[`${name}:fail`] ?? 0) + 1;
  }
};
const snap = (day: number) => {
  const bals = bots.map((b) => balanceOf(companyWallet(b.id))).sort((a, b) => a - b);
  snapshots.push({ day, supply: moneySupply(), treasury: balanceOf(SYS.TREASURY), npc: balanceOf(SYS.NPC), median: bals[Math.floor(bals.length / 2)], top1: bals[Math.floor(bals.length * 0.99)], gini: gini(bals) });
};
snap(0);

const stepsPerDay = Math.round((24 * 60) / STEP_MIN);
for (let s = 1; s <= steps; s++) {
  const now = t0 + s * STEP_MIN * 60_000;
  clock.set(now);
  for (const b of bots) {
    if (rand() > b.online) continue;
    D.db.update(schema.companies).set({ lastActiveAt: now }).where(eq(schema.companies.id, b.id)).run();
    const wps = D.db.select().from(schema.workplaces).where(eq(schema.workplaces.companyId, b.id)).all();
    // everyone taps a little while online
    const taps = b.style === 'grinder' ? 20 : b.style === 'idle' ? 2 : 8;
    for (let k = 0; k < taps && wps[0]; k++) {
      clock.set(now + k * 400);
      act('tap', () => boost(b.id, wps[0].id));
    }
    clock.set(now);
    const co = getCompany(b.id);
    const bal = balanceOf(companyWallet(b.id));
    const pod = cfg().pods.types.basic;
    if (b.style !== 'idle' && bal > pod.cost * 3 && rand() < 0.3) act('pod', () => openPod(b.id, 'basic', b.accountId));
    act('assign', () => autoAssign(b.id));
    if (rand() < 0.4) {
      const bd = contracts.board(b.id);
      for (const m of bd.mine.filter((x) => x.status === 'success')) act('contract.claim', () => contracts.claim(b.id, m.id, b.accountId));
      if (bd.offered[0]) act('contract.accept', () => contracts.accept(b.id, bd.offered[0].id));
    }
    if ((b.style === 'gamer' || b.style === 'grinder') && rand() < 0.5) {
      const game = mg.arcadeView(b.id).games[Math.floor(rand() * 11)].id;
      const ses: any = mg.startGame(b.id, game);
      clock.set(now + 30_000);
      act('minigame', () => mg.finishGame(b.id, b.accountId, ses.sessionId, { score: Math.floor(10 + rand() * 30) }));
      clock.set(now);
    }
    if (b.style === 'builder' || b.style === 'grinder') {
      if (wps[0] && bal > 5000 && rand() < 0.2) act('upgrade', () => upgradeWorkplace(b.id, wps[0].id, b.accountId));
      const rv = research.researchView(b.id);
      const node = rv.branches.flatMap((x) => x.nodes).find((n) => n.unlocked && n.cost != null && n.cost <= rv.points);
      if (node) act('research', () => research.buyResearch(b.id, node.key));
    }
    if (rand() < 0.3) for (const q of goals.questsView(b.id).filter((x) => x.done && x.status === 'active')) act('quest', () => goals.claimQuest(b.id, q.id));
    void co;
  }
  runTick(now);
  if (s % stepsPerDay === 0) snap(s / stepsPerDay);
}
clock.set(null);

const ledger = verifyLedger();
const byStyle = Object.fromEntries(
  STYLES.map((s) => {
    const list = bots.filter((b) => b.style === s.style).map((b) => balanceOf(companyWallet(b.id)) + getCompany(b.id).lifetimeEarned * 0);
    const levels = bots.filter((b) => b.style === s.style).map((b) => getCompany(b.id).level);
    return [s.style, { bots: list.length, avgBalance: Math.round(list.reduce((a, x) => a + x, 0) / Math.max(1, list.length)), avgLevel: Math.round((levels.reduce((a, x) => a + x, 0) / Math.max(1, levels.length)) * 10) / 10 }];
  }),
);
const first = snapshots[0];
const last = snapshots[snapshots.length - 1];
const dailyInflation = DAYS ? (Math.pow(last.supply / Math.max(1, first.supply), 1 / DAYS) - 1) * 100 : 0;
const c = cfg().economy;
const warnings: string[] = [];
if (ledger.sum !== 0 || ledger.mismatches.length) warnings.push(`LEDGER BROKEN: sum ${ledger.sum}, ${ledger.mismatches.length} mismatches`);
if (last.treasury < first.treasury * 0.2) warnings.push('Treasury is running low - rewards may start being skipped. Raise sinks or lower rewards.');
if (last.npc <= 0) warnings.push('NPC customer pool ran dry - sales stall. Raise npcPoolRefillPerCompanyPerTick.');
// judge the steady state (the last simulated day); day 1 is every company starting up at once
const prev = snapshots[Math.max(0, snapshots.length - 2)];
const steady = prev.supply ? (last.supply - prev.supply) / prev.supply : 0;
if (steady > c.inflationTargetHigh) warnings.push(`Money supply still grew ${(steady * 100).toFixed(2)}% on the last day - above the target (${(c.inflationTargetHigh * 100).toFixed(1)}%).`);
if (steady < c.inflationTargetLow) warnings.push(`Money supply shrank ${(steady * 100).toFixed(2)}% on the last day - below the target (${(c.inflationTargetLow * 100).toFixed(1)}%).`);
if (last.gini > 0.7) warnings.push(`Inequality is high (Gini ${last.gini.toFixed(2)}).`);
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const flows = (where: string) =>
  (D.sqlite.prepare(`SELECT kind, SUM(amount) total FROM ledger_entries WHERE ${where} AND kind != 'seed.fund' GROUP BY kind ORDER BY total DESC LIMIT 8`).all() as Array<{ kind: string; total: number }>)
    .map((r) => `${r.kind} ${fmt(r.total)}`)
    .join(' · ');
const lines = [
  `# Economy simulation`,
  ``,
  `${BOTS} bots · ${DAYS} simulated days · ${STEP_MIN}-minute steps · auto-balancer ${args['no-autobalance'] ? 'off' : 'ON'} · setup ${(setupMs / 1000).toFixed(1)}s · run ${((Date.now() - started - setupMs) / 1000).toFixed(1)}s`,
  ``,
  `| Day | Money supply | Treasury | NPC pool | Median balance | Top 1% balance | Gini |`,
  `|---:|---:|---:|---:|---:|---:|---:|`,
  ...snapshots.map((s) => `| ${s.day} | ${fmt(s.supply)} | ${fmt(s.treasury)} | ${fmt(s.npc)} | ${fmt(s.median)} | ${fmt(s.top1)} | ${s.gini.toFixed(2)} |`),
  ``,
  `**Last day's money growth (steady state):** ${(steady * 100).toFixed(2)}%`,
  `**Average over the whole run:** ${dailyInflation.toFixed(2)}% per day (day 1 includes every company starting up at once)`,
  `**Target band:** ${(c.inflationTargetLow * 100).toFixed(1)}% to ${(c.inflationTargetHigh * 100).toFixed(1)}% per day`,
  `**Final tuning:** production tax ${Math.round(cfg().economy.incomeTaxRate * 100)}% above ${cfg().economy.incomeTaxFreePerTick} BT/tick, wageRatio ${cfg().workers.wageRatio}, NPC refill ${cfg().economy.npcPoolRefillPerCompanyPerTick}/company/tick.`,
  `**Ledger:** sum of all wallets = ${ledger.sum}, ${ledger.mismatches.length} mismatches.`,
  ``,
  `| Play style | Bots | Avg balance | Avg level |`,
  `|---|---:|---:|---:|`,
  ...Object.entries(byStyle).map(([k, v]: any) => `| ${k} | ${v.bots} | ${fmt(v.avgBalance)} | ${v.avgLevel} |`),
  ``,
  `**Bits created (faucets):** ${flows(`from_wallet = '${SYS.MINT}'`)}`,
  ``,
  `**Bits removed to the Treasury (sinks):** ${flows(`to_wallet = '${SYS.TREASURY}'`)}`,
  ``,
  `**Paid out by the Treasury:** ${flows(`from_wallet = '${SYS.TREASURY}'`)}`,
  ``,
  `Actions: ${Object.entries(actions).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${fmt(v)}`).join(' · ')}`,
  ``,
  warnings.length ? `## ⚠️ Warnings\n${warnings.map((w) => `- ${w}`).join('\n')}` : `## ✅ No warnings`,
];
const report = lines.join('\n');
console.log(report);
if (OUT) fs.writeFileSync(OUT, report + '\n');
void DAY_MS;
process.exit(ledger.sum === 0 && !ledger.mismatches.length ? 0 : 1);
