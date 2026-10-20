/**
 * WebSocket hub. Authenticates the upgrade via the session cookie, validates
 * every client message with zod, enforces permissions per channel, and
 * forwards bus messages to subscribed sockets.
 */
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { wsClientMessageSchema } from '@dw/shared';
import { sessionFromToken, getAccount } from '../services/auth';
import { resolveAccess, type AccessContext } from '../permissions';
import { bus } from '../lib/bus';
import { log } from '../lib/log';
import { SESSION_COOKIE } from '../lib/cookies';
import { env } from '../env';

interface Client {
  ws: WebSocket;
  accountId: string;
  role: string;
  companyId: string | null;
  channels: Set<string>;
  alive: boolean;
  msgTimes: number[];
}

const clients = new Set<Client>();
let chatHandler: ((c: { accountId: string; channel: string; text: string }) => { ok: boolean; error?: string }) | null = null;

/** Chat service registers itself here (keeps the hub transport-only). */
export function setChatHandler(fn: typeof chatHandler) {
  chatHandler = fn;
}

// One-time passes for browsers whose pages live on another site (Netlify) and so
// can not send the session cookie to this server's WebSocket.
const tickets = new Map<string, { token: string; expires: number }>();
export function issueWsTicket(sessionToken: string) {
  const now = Date.now();
  for (const [k, v] of tickets) if (v.expires < now) tickets.delete(k);
  const ticket = randomBytes(24).toString('base64url');
  tickets.set(ticket, { token: sessionToken, expires: now + 60_000 });
  return ticket;
}
function redeemTicket(url: string | undefined) {
  const ticket = new URL(url ?? '/', 'http://x').searchParams.get('ticket');
  if (!ticket) return undefined;
  const t = tickets.get(ticket);
  tickets.delete(ticket);
  return t && t.expires >= Date.now() ? t.token : undefined;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Can this access context listen on a channel? Deny by default. */
export function canSubscribe(access: AccessContext, channel: string, guildId?: string | null): boolean {
  if (channel === 'global') return true;
  if (channel === 'market') return access.role === 'OWNER' || access.modules.exchange;
  if (channel === 'owner') return access.role === 'OWNER';
  if (channel.startsWith('company:')) return access.role === 'OWNER' || channel === `company:${access.companyId}`;
  if (channel.startsWith('account:')) return channel === `account:${access.accountId}`;
  if (channel === 'chat:global') return access.role === 'OWNER' || access.role === 'MODERATOR' || access.modules.chat;
  if (channel.startsWith('chat:company:')) return access.role === 'OWNER' || (access.modules.chat && channel === `chat:company:${access.companyId}`);
  if (channel.startsWith('chat:guild:')) return access.role === 'OWNER' || (access.modules.chat && access.modules.guilds && !!guildId && channel === `chat:guild:${guildId}`);
  if (channel.startsWith('chat:dm:')) return access.modules.chat && channel.split(':').slice(2).includes(access.accountId);
  return false;
}

let guildLookup: (companyId: string) => string | null = () => null;
export function setGuildLookup(fn: typeof guildLookup) {
  guildLookup = fn;
}

export function attachWebSocket(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (!req.url?.startsWith('/ws')) return socket.destroy();
    const origin = req.headers.origin;
    if (origin && !env.corsOrigins.includes(origin) && !isSameHost(origin, req.headers.host)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      return socket.destroy();
    }
    const found = sessionFromToken(redeemTicket(req.url) ?? parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    if (!found) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const client: Client = {
        ws,
        accountId: found.account.id,
        role: found.account.role,
        companyId: found.account.companyId,
        channels: new Set(['global', `account:${found.account.id}`]),
        alive: true,
        msgTimes: [],
      };
      if (found.account.companyId) client.channels.add(`company:${found.account.companyId}`);
      if (found.account.role === 'OWNER') client.channels.add('owner');
      clients.add(client);
      ws.on('pong', () => (client.alive = true));
      ws.on('close', () => clients.delete(client));
      ws.on('message', (raw) => handleMessage(client, raw.toString()));
      send(client, { type: 'hello', channels: [...client.channels] });
    });
  });

  // heartbeat
  const iv = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.ws.terminate();
        clients.delete(c);
        continue;
      }
      c.alive = false;
      try {
        c.ws.ping();
      } catch {}
    }
  }, 30_000);
  wss.on('close', () => clearInterval(iv));

  bus.subscribe((channel, msg) => broadcast(channel, msg));
  return wss;
}

function isSameHost(origin: string, host: string | undefined) {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function send(c: Client, msg: Record<string, unknown>) {
  if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
}

function handleMessage(c: Client, raw: string) {
  // per-socket rate limit: 20 messages / 5s
  const now = Date.now();
  c.msgTimes = c.msgTimes.filter((t) => now - t < 5000);
  c.msgTimes.push(now);
  if (c.msgTimes.length > 20) return send(c, { type: 'error', message: 'Slow down!' });
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return send(c, { type: 'error', message: 'Bad JSON' });
  }
  const parsed = wsClientMessageSchema.safeParse(data);
  if (!parsed.success) return send(c, { type: 'error', message: 'Invalid message' });
  const msg = parsed.data;
  // Permissions are re-resolved for every message so owner changes apply instantly.
  const access = currentAccess(c);
  if (!access) {
    send(c, { type: 'logout' });
    return c.ws.close();
  }
  switch (msg.type) {
    case 'ping':
      return send(c, { type: 'pong', t: now });
    case 'subscribe': {
      const guildId = access.companyId ? guildLookup(access.companyId) : null;
      if (!canSubscribe(access, msg.channel, guildId)) return send(c, { type: 'error', message: `Not allowed: ${msg.channel}` });
      c.channels.add(msg.channel);
      return send(c, { type: 'subscribed', channel: msg.channel });
    }
    case 'unsubscribe':
      c.channels.delete(msg.channel);
      return;
    case 'chat': {
      const guildId = access.companyId ? guildLookup(access.companyId) : null;
      if (!canSubscribe(access, `chat:${msg.channel}`, guildId)) return send(c, { type: 'error', message: 'Chat not allowed here.' });
      if (access.readOnly) return send(c, { type: 'error', message: 'Read-only mode.' });
      const res = chatHandler?.({ accountId: c.accountId, channel: msg.channel, text: msg.text });
      if (res && !res.ok) send(c, { type: 'error', message: res.error ?? 'Message not sent.' });
      return;
    }
  }
}

function currentAccess(c: Client): AccessContext | null {
  const acc = getAccount(c.accountId);
  if (!acc || acc.status !== 'active') return null;
  return resolveAccess(acc);
}

export function broadcast(channel: string, msg: Record<string, unknown>) {
  const payload = JSON.stringify({ ...msg, channel });
  for (const c of clients) {
    if (!c.channels.has(channel)) continue;
    // drop subscriptions the socket is no longer allowed to receive (live permission changes)
    if (channel.startsWith('chat:') || channel === 'market') {
      const access = currentAccess(c);
      if (!access || !canSubscribe(access, channel, access.companyId ? guildLookup(access.companyId) : null)) {
        c.channels.delete(channel);
        continue;
      }
    }
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(payload);
  }
}

export function connectedCount() {
  return clients.size;
}

export function onlineCompanyIds(): Set<string> {
  return new Set([...clients].map((c) => c.companyId).filter(Boolean) as string[]);
}

export function closeAll() {
  for (const c of clients) {
    try {
      c.ws.close(1001, 'Server shutting down');
    } catch {}
  }
  clients.clear();
  log.info('ws closed');
}
