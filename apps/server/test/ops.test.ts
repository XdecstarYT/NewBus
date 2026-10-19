import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import { setupGame, makeCompany, login } from './helpers';
import { env } from '../src/env';
import * as ops from '../src/services/ops';
import { cfg, setSetting } from '../src/services/settings';
import { flag, setFlag } from '../src/services/flags';
import { recordFlag } from '../src/services/anticheat';

let app: Express;

describe('owner ops: backups, config, anti-cheat, analytics', () => {
  beforeAll(() => {
    (env as any).backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-bk-'));
    app = setupGame();
  });

  it('creates, lists and prunes backups; rejects path tricks', async () => {
    const keep = env.backupKeep;
    (env as any).backupKeep = 2;
    for (let i = 0; i < 3; i++) await ops.createBackup(`t${i}`);
    const list = ops.listBackups();
    expect(list.length).toBe(2);
    expect(fs.statSync(ops.backupPath(list[0].name)).size).toBeGreaterThan(1000);
    expect(() => ops.backupPath('../../etc/passwd')).toThrow(/Bad backup name/);
    (env as any).backupKeep = keep;
  });

  it('config export/import round-trips settings and flags', () => {
    setSetting('chat.maxPerMinute', 7);
    setFlag('lotto', false);
    const exported = JSON.parse(JSON.stringify(ops.exportConfig()));
    setSetting('chat.maxPerMinute', 12);
    setFlag('lotto', true);
    const r = ops.importConfig(exported, 'owner');
    expect(r.settings).toBeGreaterThan(0);
    expect(cfg().chat.maxPerMinute).toBe(7);
    expect(flag('lotto')).toBe(false);
    expect(() => ops.importConfig({ hello: 1 }, 'owner')).toThrow(/not a Digital Workforce config/);
    setFlag('lotto', true);
  });

  it('anti-cheat dashboard groups open flags and resolves them', () => {
    const { company } = makeCompany({ name: 'Sus Co' });
    const f = recordFlag('minigame', company.id, 'test flag', 2);
    const v = ops.anticheatView();
    expect(v.byKind.minigame).toBeGreaterThanOrEqual(1);
    ops.resolveFlags([f.id], 'owner');
    expect(ops.anticheatView().flags.find((x) => x.id === f.id)!.resolved).toBe(true);
  });

  it('analytics + owner-only routes', async () => {
    const a = ops.analytics();
    expect(a.daily.length).toBe(10);
    expect(a.totals.companies).toBeGreaterThan(0);
    const o = await login(app, '01', 'Diddy');
    for (const u of ['/api/owner/backups', '/api/owner/anticheat', '/api/owner/analytics', '/api/owner/config/export']) expect((await o.get(u)).status, u).toBe(200);
    expect((await o.post('/api/owner/backups')).status).toBe(200);
    const { account } = makeCompany({ name: 'Nosy', accountNumber: '99920', password: 'nosy1234' });
    const p = await login(app, account.accountNumber, 'nosy1234');
    expect((await p.get('/api/owner/backups')).status).toBe(403);
  });
});
