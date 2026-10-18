import { useState } from 'react';
import { useApi, useAction, useMe } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { LoadingJoke, EmptyState, Tabs, timeAgo } from '../../components/ui';
import { ChatPanel } from '../game/Chat';

type Tab = 'reports' | 'chat' | 'logs' | 'people' | 'audit';

/** Moderation center: reports queue, live chat with delete, chat logs, mutes/kicks, audit log. Tabs follow the granted tools. */
export function ModerationCenter() {
  const me = useMe();
  const tools = me.data?.access.moderatorTools ?? [];
  const isOwner = me.data?.account.role === 'OWNER';
  const has = (t: string) => isOwner || tools.includes(t);
  const tabs: { id: Tab; label: string }[] = [
    ...(has('reports') ? [{ id: 'reports' as Tab, label: '🚩 Reports' }, { id: 'chat' as Tab, label: '💬 Live chat' }, { id: 'logs' as Tab, label: '📜 Chat logs' }] : []),
    ...(has('mute') || has('kick') ? [{ id: 'people' as Tab, label: '🔇 Mutes & kicks' }] : []),
    ...(has('audit') ? [{ id: 'audit' as Tab, label: '📝 Audit log' }] : []),
  ];
  const [tab, setTab] = useState<Tab | null>(null);
  if (!me.data) return <LoadingJoke />;
  if (!tabs.length) return <EmptyState emoji="🛡️" title="No tools yet" body="The Owner has not granted you any moderation tools." />;
  const current = tab && tabs.some((t) => t.id === tab) ? tab : tabs[0].id;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">🛡️ Moderation center</h1>
      <Tabs tabs={tabs} value={current} onChange={setTab} />
      {current === 'reports' && <Reports />}
      {current === 'chat' && <ChatPanel accountId={me.data.account.id} readOnly={false} canModerate />}
      {current === 'logs' && <Logs />}
      {current === 'people' && <People canMute={has('mute')} canKick={has('kick')} />}
      {current === 'audit' && <ModAudit />}
    </div>
  );
}

function Reports() {
  const [status, setStatus] = useState<'open' | 'resolved' | 'dismissed'>('open');
  const q = useApi<any[]>(['mod-reports', status], `/mod/reports?status=${status}`, { refetchInterval: 20_000 });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const inv = [['mod-reports']];
  const resolve = useAction((v: { id: string; status: string }) => POST(`/mod/reports/${v.id}`, { status: v.status, notes: notes[v.id] ?? '' }), { invalidate: inv, success: 'Report updated.' });
  const del = useAction((id: string) => POST(`/mod/messages/${id}/delete`), { invalidate: inv, success: 'Message removed.' });
  const mute = useAction((v: { accountId: string; minutes: number }) => POST('/mod/mute', { ...v, reason: 'From report' }), { success: 'Muted. 🔇' });
  return (
    <div className="flex flex-col gap-3">
      <Tabs tabs={[{ id: 'open', label: 'Open' }, { id: 'resolved', label: 'Resolved' }, { id: 'dismissed', label: 'Dismissed' }]} value={status} onChange={setStatus} />
      {!q.data ? <LoadingJoke /> : !q.data.length ? <EmptyState emoji="🛡️" title="All quiet on the moderation front" body="No reports here. Boss Byte is suspicious of how peaceful it is." /> : q.data.map((r) => (
        <div key={r.id} className="card flex flex-col gap-2 text-sm">
          <div className="flex gap-2 flex-wrap"><b>{r.targetType}</b><span className="muted">reported by {r.reporter} · {timeAgo(r.createdAt)}</span></div>
          <div>Reason: <i>{r.reason}</i></div>
          {r.message && <div className="card-flat"><b>{r.message.senderName}</b> in {r.message.channel}: "{r.message.text}" {r.message.deleted && <span className="chip">deleted</span>}</div>}
          {r.notes && <div className="text-xs">Notes: {r.notes}</div>}
          {status === 'open' && (
            <>
              <input className="input" placeholder="Appeal / moderator notes" value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
              <div className="flex gap-1 flex-wrap">
                {r.message && !r.message.deleted && <button className="btn-bad btn-sm" onClick={() => del.mutate(r.message.id)}>🗑️ Delete message</button>}
                {r.message && <button className="btn-ghost btn-sm" onClick={() => mute.mutate({ accountId: r.message.accountId, minutes: 60 })}>🔇 Mute sender 1h</button>}
                <button className="btn-good btn-sm" onClick={() => resolve.mutate({ id: r.id, status: 'resolved' })}>✅ Resolve</button>
                <button className="btn-ghost btn-sm" onClick={() => resolve.mutate({ id: r.id, status: 'dismissed' })}>Dismiss</button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function Logs() {
  const [channel, setChannel] = useState('');
  const q = useApi<any[]>(['mod-logs', channel], `/mod/logs?limit=300${channel ? `&channel=${encodeURIComponent(channel)}` : ''}`);
  return (
    <div className="flex flex-col gap-2">
      <input className="input" placeholder="Filter by channel (global, company:<id>, guild:<id>, dm:...)" value={channel} onChange={(e) => setChannel(e.target.value.trim())} />
      <div className="card !p-0 overflow-x-auto">
        <table className="table-clean text-xs">
          <thead><tr><th>When</th><th>Channel</th><th>Sender</th><th>Text</th></tr></thead>
          <tbody>
            {(q.data ?? []).map((m) => (
              <tr key={m.id} className={m.deleted ? 'opacity-40 line-through' : ''}><td>{new Date(m.createdAt).toLocaleString()}</td><td className="font-mono">{m.channel.slice(0, 24)}</td><td>{m.senderName}</td><td>{m.text}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function People({ canMute, canKick }: { canMute: boolean; canKick: boolean }) {
  const [search, setSearch] = useState('');
  const [minutes, setMinutes] = useState(60);
  const accounts = useApi<any[]>(['mod-accounts', search], `/mod/accounts?q=${encodeURIComponent(search)}`, { enabled: canMute });
  const mutes = useApi<any[]>(['mod-mutes'], '/mod/mutes', { enabled: canMute });
  const inv = [['mod-mutes']];
  const mute = useAction((id: string) => POST('/mod/mute', { accountId: id, minutes, reason: 'Moderator action' }), { invalidate: inv, success: 'Muted. 🔇' });
  const unmute = useAction((id: string) => POST('/mod/unmute', { accountId: id }), { invalidate: inv, success: 'Unmuted.' });
  const kick = useAction((id: string) => POST('/mod/kick', { accountId: id }), { success: 'Kicked (logged out everywhere). 👢' });
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="card flex flex-col gap-2">
        <div className="h3">Find a player</div>
        <input className="input" placeholder="Name or badge number" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="label">Mute minutes<input type="number" className="input" value={minutes} min={1} onChange={(e) => setMinutes(Math.max(1, Math.floor(Number(e.target.value))))} /></label>
        {(accounts.data ?? []).filter((a) => a.role !== 'OWNER').map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1">{a.displayName} <span className="muted">#{a.accountNumber} · {a.role}</span></span>
            {canMute && <button className="btn-ghost btn-sm" onClick={() => mute.mutate(a.id)}>🔇</button>}
            {canKick && <button className="btn-bad btn-sm" onClick={() => kick.mutate(a.id)}>👢</button>}
          </div>
        ))}
      </div>
      <div className="card flex flex-col gap-2">
        <div className="h3">Active mutes</div>
        {!mutes.data?.length ? <p className="text-sm muted">Nobody is muted.</p> : mutes.data.map((m) => (
          <div key={m.accountId} className="flex items-center gap-2 text-sm">
            <span className="flex-1">{m.name} #{m.number} · until {new Date(m.until).toLocaleTimeString()} {m.reason && <i>({m.reason})</i>}</span>
            <button className="btn-ghost btn-sm" onClick={() => unmute.mutate(m.accountId)}>Unmute</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModAudit() {
  const q = useApi<any[]>(['mod-audit'], '/mod/audit?limit=300');
  if (!q.data) return <LoadingJoke />;
  return (
    <div className="card !p-0 overflow-x-auto">
      <table className="table-clean text-xs">
        <thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Target</th></tr></thead>
        <tbody>{q.data.map((a) => <tr key={a.id}><td>{new Date(a.createdAt).toLocaleString()}</td><td>{a.action}</td><td className="font-mono">{String(a.actorId ?? 'system').slice(0, 14)}</td><td className="font-mono">{a.targetType}:{String(a.targetId ?? '').slice(0, 16)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
