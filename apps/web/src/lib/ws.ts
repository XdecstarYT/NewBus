/** Auto-reconnecting WebSocket client with typed listeners. */
type Handler = (msg: any) => void;
const handlers = new Map<string, Set<Handler>>();
const channels = new Set<string>();
let socket: WebSocket | null = null;
let retry = 0;
let wanted = false;
let timer: number | undefined;

export function connectWs() {
  wanted = true;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
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
