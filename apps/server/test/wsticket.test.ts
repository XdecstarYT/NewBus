import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { setupGame, login } from './helpers';
import { attachWebSocket } from '../src/ws/hub';

let server: http.Server;
let port = 0;

function open(url: string, origin?: string) {
  return new Promise<string>((resolve) => {
    const ws = new WebSocket(url, origin ? { origin } : {});
    ws.on('message', (m) => {
      resolve(JSON.parse(String(m)).type);
      ws.close();
    });
    ws.on('unexpected-response', (_req, res) => resolve(`http ${res.statusCode}`));
    ws.on('error', () => resolve('error'));
  });
}

describe('live connection pass (pages hosted on Netlify)', () => {
  beforeAll(async () => {
    const app = setupGame();
    server = http.createServer(app);
    attachWebSocket(server);
    await new Promise<void>((r) => server.listen(0, r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => server.close());

  it('a one-time pass opens the live connection without a cookie, once', async () => {
    const a = await login(setupGame(), '01', 'Diddy');
    const { ticket } = (await a.get('/api/auth/ws-ticket')).body;
    expect(ticket).toMatch(/^[\w-]{20,}$/);
    expect(await open(`ws://localhost:${port}/ws?ticket=${ticket}`)).toBe('hello');
    expect(await open(`ws://localhost:${port}/ws?ticket=${ticket}`)).toBe('http 401');
    expect(await open(`ws://localhost:${port}/ws?ticket=nope`)).toBe('http 401');
  });

  it('needs a login to get a pass', async () => {
    const res = await (await import('supertest')).default(setupGame()).get('/api/auth/ws-ticket');
    expect(res.status).toBe(401);
  });
});
