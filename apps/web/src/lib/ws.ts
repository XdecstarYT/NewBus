/** Auto-reconnecting WebSocket client with typed listeners. */
type Handler = (msg: any) => void;
const handlers = new Map<string, Set<Handler>>();
const channels = new Set<string>();
let socket: WebSocket | null = null;
let retry = 0;
let wanted = false;
let timer: number | undefined;

// Set at build time when the pages are hosted apart from the game server (Netlify).
const DIRECT_WS: string = import.meta.env.VITE_WS_URL ?? '';
let opening = false;

export async function connectWs() {
  wanted = true;
  if (opening || (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING))) return;
  let url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  if (DIRECT_WS) {
    opening = true;
    try {
      const r = await fetch('/api/auth/ws-ticket', { credentials: 'same-origin' });
      const { ticket } = await r.json();
      url = `${DIRECT_WS}?ticket=${encodeURIComponent(ticket)}`;
    } catch {
      opening = false;
      if (wanted) timer = window.setTimeout(connectWs, 5000);
      return;
    }
    opening = false;
    if (!wanted) return;
  }
  socket = new WebSocket(url);
  socket.onopen = () => {
    retry = 0;
    emit({ type: 'ws_open' });
    for (const c of channels) socket?.send(JSON.stringify({ type: 'subscribe', channel: c }));
  };
  socket.onmessage = (ev) => {
    try {
      emit(JSON.parse(ev.data));
    } catch {}
  };
  socket.onclose = () => {
    emit({ type: 'ws_close' });
    socket = null;
    if (!wanted) return;
    retry = Math.min(retry + 1, 6);
    timer = window.setTimeout(connectWs, 500 * 2 ** retry);
  };
}

export function disconnectWs() {
  wanted = false;
  if (timer) clearTimeout(timer);
  socket?.close();
  socket = null;
}

function emit(msg: any) {
  for (const h of handlers.get(msg.type) ?? []) h(msg);
  for (const h of handlers.get('*') ?? []) h(msg);
}

export function onWs(type: string, h: Handler): () => void {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type)!.add(h);
  return () => handlers.get(type)?.delete(h);
}

export function wsSend(msg: Record<string, unknown>) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

export function subscribe(channel: string) {
  channels.add(channel);
  wsSend({ type: 'subscribe', channel });
}
export function unsubscribe(channel: string) {
  channels.delete(channel);
  wsSend({ type: 'unsubscribe', channel });
}
