/**
 * Local play without any setup: the API on http://localhost:8888 with a PGlite
 * database in ./data (or your Supabase database when DATABASE_URL is set).
 * `npm run dev` at the repo root starts this and the web app together.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handle } from './handler';
import { databaseUrl, useDb, type Db } from './db';
import * as schema from './db/schema';

const PORT = Number(process.env.API_PORT ?? 8888);

if (!databaseUrl()) {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const dir = process.env.PGLITE_DIR ?? path.resolve(import.meta.dirname, '../../../data/pglite');
  if (dir !== 'memory') fs.mkdirSync(dir, { recursive: true });
  useDb(drizzle(dir === 'memory' ? new PGlite() : new PGlite(dir), { schema }) as unknown as Db);
  console.log(`🗄️  Local database: ${dir} (set DATABASE_URL to use Supabase instead)`);
}

// Serve the built web app too (like Netlify does), so `npm run build && npm start` is one address.
const DIST = path.resolve(import.meta.dirname, '../../web/dist');
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
function serveStatic(url: string, res: http.ServerResponse) {
  if (!fs.existsSync(DIST)) return false;
  let file = path.join(DIST, decodeURIComponent(url.split('?')[0]));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
  return true;
}

http
  .createServer(async (req, res) => {
    if (!req.url?.startsWith('/api') && serveStatic(req.url ?? '/', res)) return;
    const chunks: Buffer[] = [];
    for await (const ch of req) chunks.push(ch as Buffer);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, { method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body });
    const out = await handle(request, req.socket.remoteAddress ?? null);
    const h: Record<string, string | string[]> = {};
    out.headers.forEach((v, k) => {
      if (k !== 'set-cookie') h[k] = v;
    });
    const cookies = out.headers.getSetCookie();
    if (cookies.length) h['set-cookie'] = cookies;
    res.writeHead(out.status, h);
    res.end(Buffer.from(await out.arrayBuffer()));
  })
  .listen(PORT, () => console.log(`🤖 Digital Workforce API on http://localhost:${PORT} (owner login 01 / ${process.env.OWNER_PASSWORD || 'Diddy'})`));
