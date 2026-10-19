import { useMemo, useState } from 'react';
import { RARITY_INFO } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { LoadingJoke, ProgressBar, Tabs, timeAgo } from '../../components/ui';
import { WorkerAvatar } from '../../components/WorkerAvatar';
import { useGameMe } from './GameLayout';

const TIER_RING = ['ring-amber-700/40', 'ring-slate-400', 'ring-yellow-400', 'ring-sky-400', 'ring-purple-500', 'ring-pink-500', 'ring-red-500', 'ring-fuchsia-500'];

/** Trophy room: 250+ achievements, titles to wear, and the worker collection book. */
export function Achievements() {
  const [tab, setTab] = useState<'trophies' | 'titles' | 'collection'>('trophies');
  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <h1 className="h1">🏆 Trophy Room</h1>
      <Tabs tabs={[{ id: 'trophies', label: '🏆 Achievements' }, { id: 'titles', label: '🏷️ Titles' }, { id: 'collection', label: '📚 Collection book' }]} value={tab} onChange={setTab} />
      {tab === 'trophies' && <Trophies />}
      {tab === 'titles' && <Titles />}
      {tab === 'collection' && <Collection />}
    </div>
  );
}

function Trophies() {
  const q = useApi<any>(['achievements'], '/game/achievements');
  const [filter, setFilter] = useState<'all' | 'done' | 'todo'>('all');
  const groups = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const a of q.data?.list ?? []) {
      if (filter === 'done' && !a.unlockedAt) continue;
      if (filter === 'todo' && a.unlockedAt) continue;
      m.set(a.group, [...(m.get(a.group) ?? []), a]);
    }
    return [...m.entries()];
  }, [q.data, filter]);
  if (!q.data) return <LoadingJoke />;
  return (
    <div className="flex flex-col gap-3">
      <div className="card flex items-center gap-3 flex-wrap">
        <div className="text-3xl font-extrabold">{q.data.unlocked} / {q.data.total}</div>
        <div className="flex-1 min-w-[200px]"><ProgressBar value={q.data.unlocked} max={q.data.total} label="Achievements unlocked" /></div>
        <select className="input w-auto" value={filter} onChange={(e) => setFilter(e.target.value as any)} aria-label="Filter">
          <option value="all">All</option>
          <option value="done">Unlocked</option>
          <option value="todo">Still to get</option>
        </select>
      </div>
      {groups.map(([group, list]) => (
        <div key={group} className="card !p-3">
          <div className="h3 mb-2 capitalize">{list[0].emoji} {group.replace(/([A-Z])/g, ' $1')}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {list.map((a: any) => (
              <div key={a.key} title={`${a.description}${a.unlockedAt ? ` · unlocked ${timeAgo(a.unlockedAt)}` : ''}`} className={`rounded-2xl p-2 text-center ring-4 ${TIER_RING[Math.min(a.tier, 7)]} ${a.unlockedAt ? 'bg-accent/10' : 'bg-ink/5 grayscale opacity-70'}`}>
                <div className="text-2xl">{a.emoji}</div>
                <div className="text-[11px] font-bold leading-tight">{a.name}</div>
                <div className="text-[10px] muted leading-tight">{a.description}</div>
                {!a.unlockedAt && <div className="h-1.5 rounded-full bg-ink/10 mt-1 overflow-hidden"><div className="h-full bg-accent" style={{ width: `${Math.min(100, (a.progress / a.target) * 100)}%` }} /></div>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Titles() {
  const me = useGameMe();
  const q = useApi<any>(['achievements'], '/game/achievements');
  const set = useAction((title: string | null) => POST('/game/title', { title }), { invalidate: [['achievements'], ['profile', me.access.companyId]], success: (r: any) => (r.title ? `You are now "${r.title}"!` : 'Title removed.') });
  if (!q.data) return <LoadingJoke />;
  return (
    <div className="card flex flex-col gap-3">
      <p className="text-sm">Current title: <b>{q.data.title ?? 'none'}</b>. Titles show on your public profile. Earn more from achievements, the season pass and season prizes.</p>
      {!q.data.titles.length ? <p className="text-sm muted">No titles yet. Unlock an achievement!</p> : (
        <div className="flex flex-wrap gap-2">
          {q.data.titles.map((t: string) => (
            <button key={t} className={`chip !py-2 !px-3 ${q.data.title === t ? '!bg-accent !text-white' : ''}`} disabled={me.access.readOnly} onClick={() => set.mutate(t)}>🏷️ {t}</button>
          ))}
          {q.data.title && <button className="chip !py-2" onClick={() => set.mutate(null)}>✖ Remove</button>}
        </div>
      )}
    </div>
  );
}

function Collection() {
  const q = useApi<any>(['collection'], '/game/collection');
  if (!q.data) return <LoadingJoke />;
  const rarities = q.data.grid[0]?.cells.map((c: any) => c.rarity) ?? [];
  return (
    <div className="card flex flex-col gap-3 overflow-x-auto">
      <div className="flex items-center gap-3"><b className="text-xl">{q.data.found} / {q.data.total}</b><div className="flex-1"><ProgressBar value={q.data.found} max={q.data.total} label="Species x rarity combos hired" /></div></div>
      <table className="text-center text-sm">
        <thead>
          <tr><th className="text-left">Species</th>{rarities.map((r: string) => <th key={r} className="px-1" style={{ color: (RARITY_INFO as any)[r]?.color }}>{(RARITY_INFO as any)[r]?.label ?? r}</th>)}</tr>
        </thead>
        <tbody>
          {q.data.grid.map((row: any) => (
            <tr key={row.species}>
              <td className="text-left font-bold capitalize py-1">{row.species}</td>
              {row.cells.map((c: any) => (
                <td key={c.rarity} className="p-1">
                  <div className={`mx-auto w-14 h-14 rounded-xl flex items-center justify-center ${c.count ? '' : 'opacity-25 grayscale'}`} style={{ background: c.count ? `${(RARITY_INFO as any)[c.rarity]?.color}22` : undefined }} title={c.count ? `Hired ${c.count}` : 'Not found yet'}>
                    {c.count ? <WorkerAvatar species={row.species} color={(RARITY_INFO as any)[c.rarity]?.color ?? "#a78bfa"} mood={80} rarity={c.rarity} size={48} /> : <span className="text-2xl">❔</span>}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs muted">Open Recruit Pods to fill the book. Collection milestones unlock achievements!</p>
    </div>
  );
}
