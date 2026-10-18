import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { formatBits } from '@dw/shared';
import { useApi } from '../../lib/hooks';
import { LoadingJoke, EmptyState, Tabs, timeAgo } from '../../components/ui';
import { useBase, useGameMe } from './GameLayout';

const MEDALS = ['🥇', '🥈', '🥉'];

function fmt(board: string, v: number) {
  if (board === 'stocks' || board === 'growth') return `${v >= 0 ? '+' : ''}${v}%`;
  if (board === 'guilds') return `Lv ${v}`;
  return formatBits(v);
}

/** Leaderboards: global, industry, guilds, investors, stocks, growth, generosity. */
export function Leaderboard() {
  const base = useBase();
  const [board, setBoard] = useState('global');
  const q = useApi<any>(['leaderboard', board], `/game/leaderboard?board=${board}`, { refetchInterval: 30_000 });
  const boards = q.data?.boards ?? [{ id: 'global', label: '🌍 Top earners' }];
  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <h1 className="h1">🏆 Leaderboards</h1>
      <div className="overflow-x-auto"><Tabs tabs={boards.map((b: any) => ({ id: b.id, label: b.label }))} value={board} onChange={setBoard} /></div>
      {q.data?.season && <p className="text-xs muted">Season standings: these reset when a new season starts.</p>}
      {!q.data ? <LoadingJoke /> : !q.data.rows.length ? <EmptyState emoji="🏁" title="Nobody here yet" body="Be the first on this board!" /> : (
        <div className="card !p-0 overflow-hidden">
          {q.data.rows.map((r: any) => {
            const isMe = q.data.me?.id === r.id;
            const inner = (
              <>
                <span className="w-10 text-center font-extrabold text-lg">{MEDALS[r.rank - 1] ?? r.rank}</span>
                <span className="text-2xl">{r.emoji}</span>
                <span className="flex-1 min-w-0"><b className="block truncate">{r.name}</b><span className="text-xs muted block truncate">{r.sub}</span></span>
                <span className="font-bold tabular-nums">{fmt(board, r.value)}</span>
              </>
            );
            return r.companyId ? (
              <Link key={r.id} to={`${base}/profiles/${r.companyId}`} className={`flex items-center gap-3 px-3 py-2 border-b border-ink/5 hover:bg-ink/5 ${isMe ? 'bg-accent/15' : ''}`}>{inner}</Link>
            ) : (
              <div key={r.id} className={`flex items-center gap-3 px-3 py-2 border-b border-ink/5 ${isMe ? 'bg-accent/15' : ''}`}>{inner}</div>
            );
          })}
        </div>
      )}
      {q.data?.me && !q.data.rows.some((r: any) => r.id === q.data.me.id) && (
        <div className="card flex items-center gap-3"><span className="font-bold">You: #{q.data.me.rank}</span><span className="flex-1">{q.data.me.name}</span><span>{fmt(board, q.data.me.value)}</span></div>
      )}
    </div>
  );
}

/** Public company profile page. */
export function PublicProfile() {
  const { id } = useParams();
  const me = useGameMe();
  const base = useBase();
  const q = useApi<any>(['profile', id], `/game/profiles/${id}`);
  if (q.error) return <EmptyState emoji="👻" title="No such company" body={q.error.message} />;
  if (!q.data) return <LoadingJoke />;
  const p = q.data;
  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4">
      <div className="card text-center" style={{ borderColor: p.color }}>
        <div className="text-7xl">{p.emoji}</div>
        <h1 className="h1" style={{ color: p.color }}>{p.name}</h1>
        {p.title && <div className="chip">🎖️ {p.title}</div>}
        <p className="muted">{p.industry?.emoji} {p.industry?.name} · Level {p.level}{p.globalRank ? ` · #${p.globalRank} worldwide` : ''}</p>
        {p.slogan && <p className="italic">"{p.slogan}"</p>}
        <div className="flex justify-center gap-2 mt-2 flex-wrap">
          <span className="chip">⭐ {p.stars.toFixed(1)} stars</span>
          <span className="chip">🤖 {p.workers} workers</span>
          <span className="chip">💰 {formatBits(p.lifetimeEarned)} earned</span>
          {p.prestigeCount > 0 && <span className="chip">🚀 Prestige ×{p.prestigeCount}</span>}
          {p.guild && <span className="chip">{p.guild.emoji} {p.guild.name} (Lv {p.guild.level})</span>}
          {p.stock && <Link className="chip" to={`${base}/exchange`}>📈 ${p.stock.symbol} {p.stock.price} BT ({p.stock.change24h >= 0 ? '+' : ''}{p.stock.change24h}%)</Link>}
        </div>
        <p className="text-xs muted mt-2">Founded {timeAgo(p.founded)}</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="card">
          <div className="h3 mb-1">🏆 Trophies</div>
          {!p.trophies.length ? <p className="text-sm muted">No trophies yet.</p> : <div className="flex flex-wrap gap-1">{p.trophies.map((t: string, i: number) => <span key={i} className="chip">{t}</span>)}</div>}
        </div>
        <div className="card">
          <div className="h3 mb-1">🎖️ Achievements ({p.achievementCount})</div>
          {!p.achievements.length ? <p className="text-sm muted">None yet.</p> : <div className="flex flex-wrap gap-1">{p.achievements.map((a: string) => <span key={a} className="chip">{a}</span>)}</div>}
        </div>
        <div className="card text-sm">
          <div className="h3 mb-1">📊 Stats</div>
          <div>⚔️ Wars won: {p.stats.wars}</div>
          <div>📄 Contracts: {p.stats.contracts}</div>
          <div>🛒 Items sold: {p.stats.sold}</div>
          <div>🎁 Bits gifted: {formatBits(p.stats.gifted)}</div>
        </div>
        <div className="card text-sm">
          <div className="h3 mb-1">👥 Team</div>
          {p.people.map((x: any) => <div key={x.id}>{x.displayName} <span className="muted">({x.role === 'COMPANY_ADMIN' ? 'CEO' : x.jobTitle ?? 'Staff'})</span></div>)}
          {me.access.modules.chat && p.id !== me.access.companyId && <Link className="btn-ghost btn-sm mt-2" to={`${base}/chat`}>💬 Say hi in chat</Link>}
        </div>
      </div>
    </div>
  );
}
