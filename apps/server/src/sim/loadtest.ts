/**
 * Load test: boots a real server (HTTP + WebSocket + ticker) on a temporary
 * database, creates N companies and drives N concurrent virtual players through
 * the API while they hold live WebSocket connections.
 *
 *   npm run loadtest                         # 200 players for 30 seconds
 *   npm run loadtest -- --users 500 --seconds 60
 */
export {};
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
const USERS = Number(args.users ?? 200);
const SECONDS = Number(args.seconds ?? 30);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-load-'));
process.env.DATABASE_PATH = path.join(dir, 'load.db');
process.env.NODE_ENV = 'test'; // relaxed login rate limits (every virtual user shares one IP)
process.env.LOG_LEVEL = 'error';
process.env.BACKUP_EVERY_HOURS = '0';

const http = await import('node:http');
const { WebSocket } = await import('ws');
const { PERMISSION_PRESETS } = await import('@dw/shared');
const { seedAll } = await import('../db/seed');
const { createApp } = await import('../app');
const { attachWebSocket, closeAll } = await import('../ws/hub');
const { startTicker, stopTicker } = await import('../services/tick');
const { createCompany } = await import('../services/companies');
const { listIndustries } = await import('../services/catalog');
const { verifyLedger } = await import('../services/ledger');

seedAll({ quiet: true, demo: false });
const inds = listIndustries();
const logins: Array<{ number: string; pw: string }> = [];
for (let i = 0; i < USERS; i++) {
  const r = createCompany(
    { name: `Load ${i}`, emoji: '🏋️', color: '#444444', slogan: '', industryId: inds[i % inds.length].id, startingBits: 5000, startingWorkers: 2, startingWorkplace: 0, difficulty: 'NORMAL', permissions: PERMISSION_PRESETS.full.perms, mustChangePassword: false, adminName: 'Load', password: 'loadpass1', accountNumber: String(1000 + i) } as any,
    null,
  );
  logins.push({ number: r.account.accountNumber, pw: 'loadpass1' });
}

const server = http.createServer(createApp());
attachWebSocket(server);
startTicker();
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const port = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;

const lat: Record<string, number[]> = {};
const errors: Record<string, number> = {};
let wsMessages = 0;
let requests = 0;

class Client {
  cookies = new Map<string, string>();
  csrf = '';
  async req(method: string, url: string, body?: unknown, label = url): Promise<any> {
    const t = performance.now();
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', 'x-csrf-token': this.csrf, cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const sc of res.headers.getSetCookie()) {
      const [kv] = sc.split(';');
      const [k, v] = kv.split('=');
      this.cookies.set(k, v);
      if (k === 'dw_csrf') this.csrf = v;
    }
    const ms = performance.now() - t;
    (lat[label] ??= []).push(ms);
    requests++;
    const expected = res.status === 401 && label === 'me';
    if (!expected && (res.status >= 500 || (res.status >= 400 && ![400, 409].includes(res.status)))) errors[`${label} ${res.status}`] = (errors[`${label} ${res.status}`] ?? 0) + 1;
    return res.json().catch(() => null);
  }
}

async function player(i: number, until: number) {
  const c = new Client();
  await c.req('GET', '/api/auth/me', undefined, 'me');
  await c.req('POST', '/api/auth/login', { accountNumber: logins[i].number, password: logins[i].pw }, 'login');
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie: [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; '), origin: base } });
  ws.on('message', () => wsMessages++);
  ws.on('error', () => (errors['ws error'] = (errors['ws error'] ?? 0) + 1));
  await new Promise<void>((r) => {
    ws.on('open', () => r());
    setTimeout(r, 3000);
  });
  const office = await c.req('GET', '/api/game/office', undefined, 'office');
  const wp = office?.workplaces?.[0]?.id;
  while (Date.now() < until) {
    const roll = Math.random();
    if (roll < 0.35 && wp) await c.req('POST', '/api/game/office/boost', { workplaceId: wp }, 'boost');
    else if (roll < 0.55) await c.req('GET', '/api/game/state', undefined, 'state');
    else if (roll < 0.65) await c.req('GET', '/api/game/office', undefined, 'office');
    else if (roll < 0.72) await c.req('GET', '/api/game/leaderboard?board=global', undefined, 'leaderboard');
    else if (roll < 0.78) await c.req('GET', '/api/game/exchange', undefined, 'exchange');
    else if (roll < 0.84) await c.req('GET', '/api/game/quests', undefined, 'quests');
    else if (roll < 0.9) await c.req('POST', '/api/chat/send', { channel: 'global', text: `hello from ${i}` }, 'chat');
    else if (roll < 0.95) await c.req('GET', '/api/game/arcade', undefined, 'arcade');
    else await c.req('GET', '/api/game/news', undefined, 'news');
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 700)); // think time
  }
  ws.close();
}

console.log(`🏋️  ${USERS} virtual players for ${SECONDS}s against ${base} ...`);
const t0 = Date.now();
const until = t0 + SECONDS * 1000;
await Promise.all(logins.map((_, i) => new Promise((r) => setTimeout(r, Math.random() * 3000)).then(() => player(i, until))));
const wall = (Date.now() - t0) / 1000;
stopTicker();
closeAll();
server.close();

const pct = (arr: number[], p: number) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};
const rows = Object.entries(lat)
  .sort((a, b) => b[1].length - a[1].length)
  .map(([k, v]) => `| ${k} | ${v.length} | ${pct(v, 50).toFixed(1)} | ${pct(v, 95).toFixed(1)} | ${pct(v, 99).toFixed(1)} |`);
const all = Object.values(lat).flat();
const ledger = verifyLedger();
const errCount = Object.values(errors).reduce((a, b) => a + b, 0);
const report = [
  `# Load test`,
  ``,
  `${USERS} players · ${wall.toFixed(0)}s · ${requests} requests (${(requests / wall).toFixed(0)} req/s) · ${wsMessages} live WebSocket messages received`,
  ``,
  `| Endpoint | Requests | p50 ms | p95 ms | p99 ms |`,
  `|---|---:|---:|---:|---:|`,
  ...rows,
  `| **all** | ${all.length} | ${pct(all, 50).toFixed(1)} | ${pct(all, 95).toFixed(1)} | ${pct(all, 99).toFixed(1)} |`,
  ``,
  `Errors: ${errCount ? JSON.stringify(errors) : 'none'} · Ledger sum: ${ledger.sum} (${ledger.mismatches.length} mismatches)`,
].join('\n');
console.log(report);
if (args.out) fs.writeFileSync(String(args.out), report + '\n');
fs.rmSync(dir, { recursive: true, force: true });
process.exit(errCount === 0 && ledger.sum === 0 ? 0 : 1);
