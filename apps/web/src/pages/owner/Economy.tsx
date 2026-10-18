import { formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { LoadingJoke } from '../../components/ui';
import { BossByteFace } from '../../components/BossByte';
import { Stat } from './Overview';
import { Sparkline } from '../../components/Charts';

export function EconomyHealth() {
  const q = useApi<any>(['owner-economy'], '/owner/economy', { refetchInterval: 15_000 });
  const loans = useApi<any[]>(['owner-loans'], '/owner/loans');
  const forgive = useAction((id: string) => POST(`/owner/loans/${id}/forgive`), { invalidate: [['owner-loans']], success: 'Loan forgiven. 🕊️' });
  const balance = useAction(() => POST('/owner/economy/autobalance'), { invalidate: [['owner-economy']], success: (r: any) => (r.changed ? 'Auto-balancer nudged the dials.' : 'Nothing to change (or the auto-balancer flag is off).') });
  if (!q.data) return <LoadingJoke />;
  const h = q.data.health;
  const inflPct = h.inflation * 100;
  const inBand = h.inflation >= h.target.low && h.inflation <= h.target.high;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <BossByteFace mood={inBand ? 'happy' : 'wow'} size={56} />
        <div className="flex-1">
          <h1 className="h1">📊 Economy health</h1>
          {h.suggestions.map((s: string, i: number) => <p key={i} className="text-sm font-bold">Boss Byte says: {s}</p>)}
        </div>
        <button className="btn-ghost btn-sm" onClick={() => balance.mutate(undefined)}>⚖️ Run auto-balancer {q.data.autoBalancer ? '' : '(flag off)'}</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat emoji="🪙" label="Total supply" value={formatBits(h.supply)} />
        <Stat emoji="👛" label="Held by players" value={formatBits(h.playerHeld)} />
        <Stat emoji="🏦" label="Treasury" value={formatBits(h.treasury)} />
        <Stat emoji="🛒" label="NPC pool" value={formatBits(h.npcPool)} />
        <Stat emoji="🔥" label="Inflation (24h)" value={`${inflPct.toFixed(2)}%`} sub={`target ${(h.target.low * 100).toFixed(0)}%..${(h.target.high * 100).toFixed(0)}% ${inBand ? '✅' : '⚠️'}`} />
        <Stat emoji="➕" label="Created (24h)" value={formatBits(h.created)} sub={`destroyed ${formatBits(h.destroyed)}`} />
        <Stat emoji="⚖️" label="Gini coefficient" value={h.gini.toFixed(2)} sub="0 = equal, 1 = one company has it all" />
        <Stat emoji="🌀" label="Velocity (24h)" value={h.velocity.toFixed(2)} sub="ledger volume / player Bits" />
      </div>
      {q.data.history.length > 1 && (
        <div className="card">
          <h2 className="h3 mb-2">Money supply over time</h2>
          <Sparkline values={q.data.history.map((s: any) => s.data.supply)} height={80} />
        </div>
      )}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="card">
          <h2 className="h3 mb-2">🤑 Richest</h2>
          {h.richest.map((c: any) => <div key={c.id} className="flex text-sm py-0.5"><span className="flex-1">{c.emoji} {c.name}</span><b>{formatBits(c.bal)}</b></div>)}
        </div>
        <div className="card">
          <h2 className="h3 mb-2">🪫 Poorest</h2>
          {h.poorest.map((c: any) => <div key={c.id} className="flex text-sm py-0.5"><span className="flex-1">{c.emoji} {c.name}</span><b>{formatBits(c.bal)}</b></div>)}
        </div>
        <div className="card">
          <h2 className="h3 mb-2">🔀 Biggest flows (24h)</h2>
          {h.flows.map((f: any) => <div key={f.kind} className="flex text-xs py-0.5"><span className="flex-1 font-mono">{f.kind}</span><b>{formatBits(f.total)}</b></div>)}
        </div>
      </div>
      <div className="card !p-0 overflow-x-auto">
        <h2 className="h3 p-3">💸 Loans</h2>
        <table className="table-clean text-sm">
          <thead><tr><th>Borrower</th><th>Lender</th><th>Principal</th><th>Owed</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {(loans.data ?? []).map((l) => (
              <tr key={l.id}>
                <td>{l.borrower || '—'}</td><td>{l.lender}</td><td>{formatBits(l.principal)}</td><td>{formatBits(l.outstanding)}</td><td>{l.status}</td>
                <td>{(l.status === 'active' || l.status === 'defaulted') && <button className="btn-ghost btn-sm" onClick={() => forgive.mutate(l.id)}>🕊️ Forgive</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
