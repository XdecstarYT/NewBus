import request from 'supertest';
import type { Express } from 'express';
import { PERMISSION_PRESETS, type Permissions } from '@dw/shared';
import { seedAll } from '../src/db/seed';
import { createApp } from '../src/app';
import { createCompany } from '../src/services/companies';
import { reseedLive } from '../src/engine/rng';

let app: Express | null = null;

/** Fresh in-memory game (each test file runs in its own process). */
export function setupGame(): Express {
  if (app) return app;
  reseedLive(12345);
  seedAll({ quiet: true, demo: false });
  app = createApp();
  return app;
}

export interface Agent {
  get: (url: string) => request.Test;
  post: (url: string, body?: unknown) => request.Test;
  put: (url: string, body?: unknown) => request.Test;
  patch: (url: string, body?: unknown) => request.Test;
  del: (url: string, body?: unknown) => request.Test;
  viewAs: (companyId: string | null) => void;
}

export async function agent(appArg: Express): Promise<Agent> {
  const a = request.agent(appArg);
  const r = await a.get('/api/auth/me');
  const cookies = ([] as string[]).concat(r.headers['set-cookie'] ?? []);
  const csrf = /dw_csrf=([^;]+)/.exec(cookies.join(';'))?.[1] ?? '';
  let viewAs: string | null = null;
  const withHeaders = (t: request.Test) => {
    t.set('x-csrf-token', csrf);
    if (viewAs) t.set('x-view-as', viewAs);
    return t;
  };
  return {
    get: (url) => withHeaders(a.get(url)),
    post: (url, body) => withHeaders(a.post(url)).send(body ?? {}),
    put: (url, body) => withHeaders(a.put(url)).send(body ?? {}),
    patch: (url, body) => withHeaders(a.patch(url)).send(body ?? {}),
    del: (url, body) => withHeaders(a.delete(url)).send(body ?? {}),
    viewAs: (id) => {
      viewAs = id;
    },
  };
}

export async function login(appArg: Express, accountNumber: string, password: string) {
  const ag = await agent(appArg);
  const res = await ag.post('/api/auth/login', { accountNumber, password });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  return ag;
}

export function makeCompany(overrides: Partial<Parameters<typeof createCompany>[0]> & { permissions?: Permissions } = {}) {
  return createCompany(
    {
      name: overrides.name ?? 'Test Co',
      emoji: '🧪',
      color: '#123456',
      slogan: '',
      industryId: overrides.industryId ?? 'bakery',
      startingBits: overrides.startingBits ?? 5000,
      startingWorkers: overrides.startingWorkers ?? 2,
      startingWorkplace: 0,
      difficulty: overrides.difficulty ?? 'NORMAL',
      permissions: overrides.permissions ?? PERMISSION_PRESETS.full.perms,
      accountNumber: overrides.accountNumber,
      password: overrides.password ?? 'pass1234',
      mustChangePassword: overrides.mustChangePassword ?? false,
      adminName: 'CEO',
    },
    null,
  );
}
