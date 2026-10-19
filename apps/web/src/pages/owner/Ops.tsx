import { useRef, useState } from 'react';
import { formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST, DEL } from '../../lib/api';
import { LoadingJoke, EmptyState, Tabs, useConfirm, timeAgo } from '../../components/ui';
import { Sparkline, BarList } from '../../components/Charts';
import { Stat } from './Overview';

/** Owner Panel "Backups": one-click + scheduled backups, download, restore, config export/import. */
export function Backups() {
  const confirm = useConfirm();
  const q = useApi<{ backups: Array<{ name: string; size: number; createdAt: number; reason: string }> }>(['owner-backups'], '/owner/backups');
  const inv = [['owner-backups']];
  const make = useAction(() => POST('/owner/backups'), { invalidate: inv, success: '💾 Backup saved!' });
  const restore = useAction((name: string) => POST(`/owner/backups/${name}/restore`, { confirm: true }), { invalidate: inv, success: '⏪ Restored! Reloading...', onSuccess: () => setTimeout(() => window.location.reload(), 800) });
  const del = useAction((name: string) => DEL(`/owner/backups/${name}`), { invalidate: inv, success: 'Deleted.' });
  const file = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const imp = useAction((data: unknown) => POST<{ settings: number; flags: number; templates: number }>('/owner/config/import', data), { onSuccess: (r) => setImportMsg(`Imported ${r.settings} settings, ${r.flags} flags, ${r.templates} templates.`) });
  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <h1 className="h1">💾 Backups</h1>
      <div className="card flex flex-col gap-2">
        <p className="text-sm">The whole game lives in one database file. Backups are also made automatically every few hours (set <code>BACKUP_EVERY_HOURS</code>) and the oldest are cleaned up (<code>BACKUP_KEEP</code>).</p>
        <button className="btn-primary self-start" disabled={make.isPending} onClick={() => make.mutate(undefined)} data-testid="backup-now">💾 Back up now</button>
      </div>
      <div className="card !p-0 overflow-x-auto">
        {!q.data ? <LoadingJoke /> : !q.data.backups.length ? <EmptyState emoji="🗄️" title="No backups yet" body="Click Back up now." /> : (
          <table className="table-clean text-sm">
            <thead><tr><th>Backup</th><th>Why</th><th>Size</th><th>When</th><th></th></tr></thead>
            <tbody>
              {q.data.backups.map((b) => (
                <tr key={b.name}>
                  <td className="font-mono text-xs">{b.name}</td>
                  <td>{b.reason}</td>
                  <td>{(b.size / 1024 / 1024).toFixed(1)} MB</td>
                  <td>{timeAgo(b.createdAt)}</td>
                  <td className="whitespace-nowrap">
                    <a className="btn-ghost btn-sm" href={`/api/owner/backups/${b.name}/download`}>⬇️</a>{' '}
                    <button className="btn-ghost btn-sm" onClick={async () => (await confirm({ title: 'Restore this backup?', body: 'The game goes back to this moment. Everything after it is lost (a safety backup is taken first).', danger: true, yes: 'Restore' })) && restore.mutate(b.name)}>⏪ Restore</button>{' '}
                    <button className="btn-bad btn-sm" onClick={async () => (await confirm({ title: 'Delete this backup?', danger: true })) && del.mutate(b.name)} aria-label="Delete backup">🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card flex flex-col gap-2">
        <div className="h3">⚙️ Game settings file</div>
        <p className="text-sm muted">Export your economy settings, feature flags and permission templates to a file, then import them into another game (or after a reset).</p>
        <div className="flex gap-2 flex-wrap">
          <a className="btn-primary" href="/api/owner/config/export">⬇️ Export settings</a>
          <button className="btn-ghost" onClick={() => file.current?.click()}>⬆️ Import settings</button>
          <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              imp.mutate(JSON.parse(await f.text()));
            } catch {
              setImportMsg('That file is not valid JSON.');
            }
            e.target.value = '';
          }} />
        </div>
        {importMsg && <p className="text-sm font-bold">{importMsg}</p>}
      </div>
    </div>
  );
}

/** Owner Panel "Anti-cheat": flags, shared IPs, big transfers, linked accounts, arcade outliers. */
export function AntiCheat() {
  const q = useApi<any>(['owner-anticheat'], '/owner/anticheat', { refetchInterval: 30_000 });
  const [showResolved, setShowResolved] = useState(false);
  const resolve = useAction((ids: string[]) => POST('/owner/anticheat/resolve', { ids }), { invalidate: [['owner-anticheat']], success: 'Marked as handled.' });
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  const flags = d.flags.filter((f: any) => showResolved || !f.resolved);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">🕵️ Anti-cheat</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat emoji="🚩" label="Open flags" value={d.open} />
        {Object.entries(d.byKind).slice(0, 3).map(([k, n]) => <Stat key={k} emoji="🔎" label={k} value={n as number} />)}
      </div>
      <div className="card !p-0 overflow-x-auto">
        <div className="flex items-center gap-2 p-3">
          <div className="h3 flex-1">🚩 Flags</div>
          <label className="text-sm flex items-center gap-1"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> show handled</label>
          {d.open > 0 && <button className="btn-ghost btn-sm" onClick={() => resolve.mutate(d.flags.filter((f: any) => !f.resolved).map((f: any) => f.id))}>✅ Mark all handled</button>}
        </div>
        {!flags.length ? <EmptyState emoji="😇" title="All clean" body="Nothing suspicious. Boss Byte is (cautiously) proud." /> : (
          <table className="table-clean text-sm">
            <thead><tr><th>When</th><th>Kind</th><th>Company</th><th>Detail</th><th>Sev</th><th></th></tr></thead>
            <tbody>
              {flags.map((f: any) => (
                <tr key={f.id} className={f.resolved ? 'opacity-40' : ''}>
                  <td className="whitespace-nowrap">{timeAgo(f.createdAt)}</td><td>{f.kind}</td><td>{f.company ?? '-'}</td><td>{f.detail}</td><td>{'⚠️'.repeat(Math.min(3, f.severity))}</td>
                  <td>{!f.resolved && <button className="btn-ghost btn-sm" onClick={() => resolve.mutate([f.id])}>✅</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <div className="h3 mb-2">🌐 Same IP, several accounts (7 days)</div>
          {!d.sharedIps.length ? <p className="text-sm muted">None. (Families on one Wi-Fi will show up here too - that's fine.)</p> : d.sharedIps.map((s: any) => <div key={s.ip} className="text-sm py-1"><span className="font-mono">{s.ip}</span>: badges {s.accounts}</div>)}
        </div>
        <div className="card">
          <div className="h3 mb-2">🔗 Linked account groups</div>
          {!d.linked.length ? <p className="text-sm muted">None set. Link accounts in Accounts to block transfers between them.</p> : d.linked.map((l: any) => <div key={l.grp} className="text-sm py-1"><b>{l.grp}</b>: {l.accounts}</div>)}
        </div>
        <div className="card">
          <div className="h3 mb-2">💸 Biggest gifts (24h)</div>
          {!d.bigTransfers.length ? <p className="text-sm muted">No gifts today.</p> : d.bigTransfers.map((t: any) => <div key={t.id} className="text-sm py-1">{formatBits(t.amount)} · {t.memo ?? ''} · {timeAgo(t.created_at)}</div>)}
        </div>
        <div className="card">
          <div className="h3 mb-2">🕹️ Arcade outliers (7 days)</div>
          {!d.minigame.length ? <p className="text-sm muted">No suspicious scores.</p> : d.minigame.map((m: any) => <div key={m.company_id} className="text-sm py-1">{m.name}: {m.flagged} flagged of {m.plays} plays (best {m.best})</div>)}
        </div>
      </div>
    </div>
  );
}

/** Owner Panel "Analytics": active players, feature usage, popular industries. */
export function Analytics() {
  const q = useApi<any>(['owner-analytics'], '/owner/analytics', { refetchInterval: 60_000 });
  const [metric, setMetric] = useState<'active' | 'earned' | 'minigames' | 'pods' | 'sold' | 'trades' | 'quests' | 'taps'>('active');
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  const t = d.totals;
  const vals = d.daily.map((x: any) => x[metric]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">📊 Analytics</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat emoji="🏢" label="Companies" value={t.companies} sub={`${t.active1d} active today`} />
        <Stat emoji="📅" label="Active 7 / 30 days" value={`${t.active7d} / ${t.active30d}`} />
        <Stat emoji="🔑" label="Logins (24h)" value={t.logins24h} />
        <Stat emoji="💰" label="Money supply" value={formatBits(t.moneySupply)} sub={`Treasury ${formatBits(t.treasury)}`} />
        <Stat emoji="🏆" label="Achievements unlocked" value={t.achievements.toLocaleString()} />
        <Stat emoji="🕹️" label="Mini-game plays" value={t.minigamePlays.toLocaleString()} />
      </div>
      <div className="card flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="h3 flex-1">Last 10 days</div>
          <Tabs tabs={(['active', 'earned', 'minigames', 'pods', 'sold', 'trades', 'quests', 'taps'] as const).map((k) => ({ id: k, label: k }))} value={metric} onChange={setMetric} />
        </div>
        <Sparkline values={vals} height={120} />
        <div className="grid grid-cols-10 text-[10px] muted text-center">{d.daily.map((x: any) => <div key={x.day}>{x.day.slice(5)}<br /><b>{x[metric].toLocaleString()}</b></div>)}</div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <div className="h3 mb-2">🏭 Popular industries</div>
          <BarList items={d.topIndustries.map((i: any) => ({ label: `${i.emoji} ${i.name}`, value: i.companies }))} />
        </div>
        <div className="card">
          <div className="h3 mb-2">🧩 Feature usage (companies that used it)</div>
          <BarList items={d.features.slice(0, 15).map((f: any) => ({ label: f.key, value: f.companies }))} />
        </div>
      </div>
    </div>
  );
}
