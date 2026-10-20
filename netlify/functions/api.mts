// Netlify Function: the whole game API. netlify.toml sends /api/* here.
// Classic (event -> response) format, so every sub-path like /api/auth/me reaches it.
import { handle } from '../../apps/api/src/handler';

interface NetlifyEvent {
  rawUrl: string;
  rawQuery?: string;
  path: string;
  httpMethod: string;
  headers: Record<string, string | undefined>;
  body: string | null;
  isBase64Encoded: boolean;
}

export const handler = async (event: NetlifyEvent) => {
  const headers = new Headers();
  for (const [k, v] of Object.entries(event.headers ?? {})) if (v != null) headers.set(k, v);
  const method = event.httpMethod || 'GET';
  const body = event.body == null || method === 'GET' || method === 'HEAD' ? undefined : event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost';
  // rawUrl keeps the address the player asked for (/api/...), even after the rewrite
  const url = event.rawUrl || `https://${host}${event.path}${event.rawQuery ? `?${event.rawQuery}` : ''}`;
  const ip = headers.get('x-nf-client-connection-ip') ?? headers.get('client-ip') ?? null;
  const res = await handle(new Request(url, { method, headers, body }), ip);
  const out: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    if (k !== 'set-cookie') out[k] = v;
  });
  return {
    statusCode: res.status,
    headers: out,
    multiValueHeaders: { 'set-cookie': res.headers.getSetCookie() },
    body: await res.text(),
  };
};
