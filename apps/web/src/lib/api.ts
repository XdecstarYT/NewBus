/** Fetch wrapper: CSRF double-submit header, owner "view as" header, typed errors. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body: any,
  ) {
    super(message);
  }
}

let viewAs: string | null = null;
export function setViewAs(id: string | null) {
  viewAs = id;
}
export function getViewAs() {
  return viewAs;
}

function csrfToken(): string {
  return document.cookie.match(/(?:^|;\s*)dw_csrf=([^;]+)/)?.[1] ?? '';
}

async function ensureCsrf() {
  if (!csrfToken()) await fetch('/api/auth/me', { credentials: 'same-origin' }).catch(() => {});
}

export async function api<T = any>(method: string, url: string, body?: unknown, opts: { viewAs?: boolean } = {}): Promise<T> {
  if (method !== 'GET') await ensureCsrf();
  const headers: Record<string, string> = { 'x-csrf-token': csrfToken() };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const useViewAs = opts.viewAs ?? (url.startsWith('/game') || url.startsWith('/auth/me'));
  if (viewAs && useViewAs) headers['x-view-as'] = viewAs;
  const res = await fetch(`/api${url}`, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const d = typeof data === 'object' ? data : {};
    throw new ApiError(res.status, d.error ?? 'error', d.message ?? `Request failed (${res.status})`, d);
  }
  return data as T;
}

export const GET = <T = any>(url: string) => api<T>('GET', url);
export const POST = <T = any>(url: string, body?: unknown) => api<T>('POST', url, body ?? {});
export const PUT = <T = any>(url: string, body?: unknown) => api<T>('PUT', url, body ?? {});
export const PATCH = <T = any>(url: string, body?: unknown) => api<T>('PATCH', url, body ?? {});
export const DEL = <T = any>(url: string, body?: unknown) => api<T>('DELETE', url, body ?? {});

/** Random-ish idempotency key for money actions (double-clicks never pay twice). */
export function idemKey(prefix = 'k') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
