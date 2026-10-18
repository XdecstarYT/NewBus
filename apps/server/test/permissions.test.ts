import { describe, it, expect, beforeAll } from 'vitest';
import type { Express } from 'express';
import { PERMISSION_PRESETS, ungrantableModules, effectiveStaffModules, applyPermissionsPatch } from '@dw/shared';
import { setupGame, login, makeCompany } from './helpers';

let app: Express;
describe('permissions & owner flow (integration)', () => {
  beforeAll(() => {
    app = setupGame();
  });

  it('owner builds a company and gets a one-time Welcome Badge', async () => {
    const owner = await login(app, '01', 'Diddy');
    const perms = JSON.parse(JSON.stringify(PERMISSION_PRESETS.starter.perms));
    const r = await owner.post('/api/owner/companies', {
      name: 'Badge Bakery', emoji: '🥐', color: '#f59e0b', slogan: 'yum', industryId: 'bakery',
      startingBits: 2000, startingWorkers: 2, startingWorkplace: 0, difficulty: 'NORMAL', permissions: perms, mustChangePassword: false,
    });
    expect(r.status).toBe(200);
    expect(r.body.account.accountNumber).toMatch(/^\d{2,}$/);
    expect(typeof r.body.tempPassword).toBe('string');
    const player = await login(app, r.body.account.accountNumber, r.body.tempPassword);
    const me = await player.get('/api/auth/me');
    expect(me.body.access.modules.office).toBe(true);
    expect(me.body.access.modules.exchange).toBe(false);
    const office = await player.get('/api/game/office');
    expect(office.status).toBe(200);
    expect(office.body.workplaces.length).toBe(1);
  });

  it('a restricted module returns 403 with a funny lock message', async () => {
    const { account } = makeCompany({ name: 'Locked Co', accountNumber: '99964', password: 'lockpass', permissions: PERMISSION_PRESETS.readonly.perms });
    const a = await login(app, account.accountNumber, 'lockpass');
    const r = await a.get('/api/game/pods');
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('module_locked');
    expect(r.body.message).toMatch(/Boss Byte/);
  });

  it('permission changes apply instantly without re-login', async () => {
    const { company, account } = makeCompany({ name: 'Live Co', accountNumber: '99963', password: 'livepass', permissions: PERMISSION_PRESETS.readonly.perms });
    const player = await login(app, account.accountNumber, 'livepass');
    expect((await player.get('/api/game/pods')).status).toBe(403);
    const owner = await login(app, '01', 'Diddy');
    const res = await owner.patch(`/api/owner/companies/${company.id}/permissions`, { patch: { modules: { pods: true } } });
    expect(res.status).toBe(200);
    expect((await player.get('/api/game/pods')).status).toBe(200);
    // and it is in the audit log with old/new values
    const audit = await owner.get(`/api/owner/audit?targetId=${company.id}&action=permissions`);
    expect(audit.body[0].oldValue['modules.pods']).toBe(false);
    expect(audit.body[0].newValue['modules.pods']).toBe(true);
  });

  it('owner "view as company" sees the same modules but cannot write', async () => {
    const { company } = makeCompany({ name: 'Viewed Co', permissions: PERMISSION_PRESETS.starter.perms });
    const owner = await login(app, '01', 'Diddy');
    owner.viewAs(company.id);
    const me = await owner.get('/api/auth/me');
    expect(me.body.access.viewAs).toBe(true);
    expect(me.body.access.readOnly).toBe(true);
    expect(me.body.access.modules.exchange).toBe(false);
    expect((await owner.get('/api/game/office')).status).toBe(200);
    const w = await owner.post('/api/game/pods/open', { type: 'basic' });
    expect(w.status).toBe(403);
    expect(w.body.error).toBe('read_only');
    owner.viewAs(null);
  });

  it('company admin can never grant more than they have', async () => {
    const perms = JSON.parse(JSON.stringify(PERMISSION_PRESETS.standard.perms));
    perms.limits.staffGrantable = ['office', 'workforce', 'exchange'];
    const { account } = makeCompany({ name: 'Granty', accountNumber: '99962', password: 'grantpass', permissions: perms });
    const admin = await login(app, account.accountNumber, 'grantpass');
    // exchange is not enabled for the company (standard preset) -> refused
    const bad = await admin.post('/api/game/staff', { displayName: 'Trader Tom', jobTitle: 'Trader', modules: { exchange: true } });
    expect(bad.status).toBe(403);
    expect(bad.body.error).toBe('over_grant');
    // pods is enabled but not grantable -> refused
    const bad2 = await admin.post('/api/game/staff', { displayName: 'Intern Ivy', jobTitle: 'Intern', modules: { pods: true } });
    expect(bad2.status).toBe(403);
    const ok = await admin.post('/api/game/staff', { displayName: 'Ops Olly', jobTitle: 'Operations', modules: { office: true } });
    expect(ok.status).toBe(200);
    const staff = await login(app, ok.body.account.accountNumber, ok.body.tempPassword);
    const me = await staff.get('/api/auth/me');
    expect(me.body.access.modules.office).toBe(true);
    expect(me.body.access.modules.workforce).toBe(false);
    expect((await staff.get('/api/game/workforce')).status).toBe(403);
  });

  it('pure helpers: ungrantable + effective staff modules', () => {
    const p = applyPermissionsPatch(PERMISSION_PRESETS.full.perms, { modules: { chat: false }, limits: { staffGrantable: ['office', 'chat'] } });
    expect(ungrantableModules(p, { chat: true, office: true })).toEqual(['chat']);
    expect(ungrantableModules(p, { pods: true })).toEqual(['pods']);
    const eff = effectiveStaffModules(p, { modules: { office: true, chat: true, pods: true } });
    expect(eff.office).toBe(true);
    expect(eff.chat).toBe(false);
    expect(eff.pods).toBe(false);
  });

  it('global feature flags override company toggles', async () => {
    const { account } = makeCompany({ name: 'Flaggy', accountNumber: '99961', password: 'flagpass' });
    const p = await login(app, account.accountNumber, 'flagpass');
    expect((await p.get('/api/game/contracts')).status).toBe(200);
    const owner = await login(app, '01', 'Diddy');
    await owner.put('/api/owner/flags', { flag: 'contracts', enabled: false });
    expect((await p.get('/api/game/contracts')).status).toBe(403);
    await owner.put('/api/owner/flags', { flag: 'contracts', enabled: true });
    expect((await p.get('/api/game/contracts')).status).toBe(200);
  });

  it('maintenance mode makes the game read-only for players', async () => {
    const { account } = makeCompany({ name: 'Maint', accountNumber: '99960', password: 'maintpass' });
    const p = await login(app, account.accountNumber, 'maintpass');
    const owner = await login(app, '01', 'Diddy');
    await owner.put('/api/owner/flags', { flag: 'maintenance', enabled: true });
    const r = await p.post('/api/game/pods/open', { type: 'basic' });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('read_only');
    await owner.put('/api/owner/flags', { flag: 'maintenance', enabled: false });
  });
});
