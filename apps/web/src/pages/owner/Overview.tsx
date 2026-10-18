import { Link } from 'react-router';
import { formatBits } from '@dw/shared';
import { useApi } from '../../lib/hooks';
import { LoadingJoke } from '../../components/ui';
import { BossByteFace } from '../../components/BossByte';

export function Stat({ label, value, emoji, sub }: { label: string; value: React.ReactNode; emoji: string; sub?: React.ReactNode }) {
  return (
    <div className="card !p-3">
      <div className="text-xs font-bold muted flex items-center gap-1"><span aria-hidden>{emoji}</span>{label}</div>
      <div className="font-display font-extrabold text-2xl tabular-nums">{value}</div>
      {sub && <div className="text-xs muted">{sub}</div>}
    </div>
  );
}

export function Overview() {
  const o = useApi<any>(['owner-overview'], '/owner/overview', { refetchInterval: 10_000 });
  if (o.isLoading || !o.data) return <LoadingJoke />;
  const d = o.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <BossByteFace mood="happy" size={64} className="animate-bob" />
        <div>
          <h1 className="h1">Good to see you, Owner!</h1>
          <p className="muted text-sm">{d.tip}</p>
        </div>
        <Link to="/owner/builder" className="btn-primary ml-auto">➕ Build a company</Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat emoji="🪙" label="Total supply" value={formatBits(d.supply)} sub="Bits ever minted minus burned" />
        <Stat emoji="🏦" label="Treasury" value={formatBits(d.treasury)} />
        <Stat emoji="🛒" label="NPC demand pool" value={formatBits(d.npcPool)} />
        <Stat emoji="👛" label="Held by players" value={formatBits(d.playerHeld)} />
        <Stat emoji="🏢" label="Companies" value={d.companies} sub={`${d.activeCompanies} active today`} />
        <Stat emoji="🟢" label="Online now" value={d.online} sub="connected sockets" />
        <Stat emoji="📒" label="Ledger entries (24h)" value={d.ledger24h.toLocaleString()} />
        <Stat emoji="📈" label="Exchange" value={`${d.listed} listed`} sub={`${d.trades24h} trades in 24h`} />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="h3 mb-2">🏭 Companies by industry category</h2>
          {d.byCategory.length === 0 ? <p className="muted text-sm">No companies yet.</p> : d.byCategory.map((c: any) => (
            <div key={c.category} className="flex items-center gap-2 text-sm py-0.5">
              <span className="flex-1 truncate">{c.category}</span>
              <div className="h-3 bg-accent rounded-full border border-ink" style={{ width: `${Math.max(8, (c.n / Math.max(...d.byCategory.map((x: any) => x.n))) * 160)}px` }} />
              <b className="w-6 text-right">{c.n}</b>
            </div>
          ))}
        </div>
        <div className="card">
          <h2 className="h3 mb-2">🏆 Richest companies</h2>
          {d.richest.map((c: any, i: number) => (
            <Link key={c.id} to={`/owner/companies/${c.id}`} className="flex items-center gap-2 text-sm py-1 hover:underline">
              <span className="w-5 font-bold">{i + 1}.</span><span>{c.emoji}</span><span className="flex-1">{c.name}</span><b>{formatBits(c.balance)}</b>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
