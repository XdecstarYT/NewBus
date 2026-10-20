import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { POST } from '../../lib/api';
import { useApi, useAction } from '../../lib/hooks';
import { onHint } from '../../lib/live';
import { formatBits } from '../../lib/game';
import { EmptyState, LoadingJoke, Tabs, timeAgo } from '../../components/ui';
import { useMe2 } from '../Layout';

export function Chat() {
  const me = useMe2();
  const qc = useQueryClient();
  const ch = useApi<any>(['chat', 'channels'], '/chat/channels');
  const [channel, setChannel] = useState('global');
  const [text, setText] = useState('');
  const [dmTo, setDmTo] = useState('');
  const hist = useApi<any[]>(['chat', channel], `/chat/history?channel=${encodeURIComponent(channel)}`, { refetchInterval: 15_000 });
  const send = useAction(() => POST('/chat/send', { channel, text }), { invalidate: [['chat', channel]], onSuccess: () => setText('') });
  const del = useAction((id: number) => POST(`/owner/chat/${id}/delete`), { invalidate: [['chat', channel]] });
  const dm = useAction(() => POST<any>('/chat/dm', { accountId: dmTo }), { onSuccess: (r) => (setChannel(r.channel), setDmTo('')) });
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [hist.data?.length]);
  useEffect(() => onHint((_t, h) => h.t === 'chat' && qc.invalidateQueries({ queryKey: ['chat', 'channels'] })), [qc]);
  const channels = ch.data?.channels ?? [{ id: 'global', label: '🌍 Everyone' }];
  if (!channels.some((c: any) => c.id === channel) && channel.startsWith('dm:')) channels.push({ id: channel, label: '✉️ New message' });
  return (
    <div className="flex flex-col gap-3 h-[calc(100vh-9rem)]">
      <h1 className="h1">💬 Chat</h1>
      <Tabs tabs={channels.map((c: any) => ({ id: c.id, label: c.label }))} value={channel} onChange={setChannel} />
      <div className="card flex-1 overflow-y-auto flex flex-col gap-1 min-h-0" aria-live="polite">
        {!hist.data ? <LoadingJoke /> : !hist.data.length ? <EmptyState emoji="🦗" title="Quiet in here" body="Say hi!" /> : hist.data.map((m) => (
          <div key={m.id} className={`text-sm ${m.accountId === me.account.id ? 'text-right' : ''}`}>
            <span className="text-xs muted">{m.name} · {timeAgo(m.createdAt)}</span>
            {me.account.role === 'OWNER' && <button className="text-xs ml-1 underline" onClick={() => del.mutate(m.id)}>delete</button>}
            <div className={`inline-block rounded-2xl px-3 py-1 ml-1 ${m.accountId === me.account.id ? 'bg-accent text-white' : 'bg-ink/5'}`}>{m.text}</div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), text.trim() && send.mutate(undefined))}>
        <input className="input flex-1" maxLength={400} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message..." aria-label="Message" data-testid="chat-input" />
        <button className="btn-primary" disabled={!text.trim() || send.isPending}>Send</button>
      </form>
      <div className="flex gap-2 text-sm">
        <select className="input flex-1" value={dmTo} onChange={(e) => setDmTo(e.target.value)} aria-label="Message someone privately">
          <option value="">✉️ Private message to...</option>
          {(ch.data?.people ?? []).filter((p: any) => p.id !== me.account.id).map((p: any) => <option key={p.id} value={p.id}>{p.emoji ?? '👑'} {p.name}{p.company ? ` (${p.company})` : ''}</option>)}
        </select>
        <button className="btn-ghost" disabled={!dmTo} onClick={() => dm.mutate(undefined)}>Open</button>
      </div>
    </div>
  );
}

export function News() {
  const q = useApi<any[]>(['news'], '/game/news', { refetchInterval: 60_000 });
  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-3">
      <h1 className="h1">📰 The Daily Byte</h1>
      <p className="text-sm muted">Everything here happened because a real player did it.</p>
      {!q.data ? <LoadingJoke /> : !q.data.length ? <EmptyState emoji="🗞️" title="No news yet" body="Go make some!" /> : q.data.map((n) => (
        <div key={n.id} className="card !py-2">
          <div className="font-bold">{n.headline}</div>
          {n.body && <div className="text-sm">{n.body}</div>}
          <div className="text-xs muted">{timeAgo(n.createdAt)}</div>
        </div>
      ))}
    </div>
  );
}

export function Leaderboard() {
  const q = useApi<any[]>(['leaderboard'], '/game/leaderboard', { refetchInterval: 60_000 });
  const [by, setBy] = useState<'netWorth' | 'prestige' | 'xp'>('netWorth');
  if (!q.data) return <LoadingJoke />;
  const rows = [...q.data].sort((a, b) => b[by] - a[by]);
  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-3">
      <h1 className="h1">🏆 Leaderboard</h1>
      <Tabs tabs={[{ id: 'netWorth', label: '💰 Net worth' }, { id: 'prestige', label: '✨ Prestige' }, { id: 'xp', label: '⚒️ Hardest workers' }]} value={by} onChange={setBy} />
      <div className="card flex flex-col gap-1">
        {rows.map((r, i) => (
          <div key={r.id} className="flex items-center gap-2 text-sm py-1 border-b border-ink/5 last:border-0">
            <span className="w-8 font-extrabold text-center">{i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span>
            <span className="text-xl">{r.emoji}</span>
            <span className="flex-1 font-bold">{r.name}</span>
            <span className="font-extrabold">{by === 'netWorth' ? formatBits(r.netWorth) : by === 'prestige' ? `✨ ${r.prestige}` : `${r.xp} XP`}</span>
          </div>
        ))}
      </div>
      <p className="text-xs muted">Net worth = Bits + warehouse stock valued at the last market price.</p>
    </div>
  );
}
