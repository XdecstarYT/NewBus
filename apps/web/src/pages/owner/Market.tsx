import { useState } from 'react';
import { PRICE_MODES, formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { LoadingJoke, Modal, EmptyState } from '../../components/ui';

/** Owner Panel "Market" tab: IPOs, halts, delisting, price modes, bonds, indexes, events, trades. */
export function MarketAdmin() {
  const q = useApi<any>(['owner-market'], '/owner/market', { refetchInterval: 10_000 });
  const trades = useApi<any[]>(['owner-trades'], '/owner/market/trades?limit=100');
  const companies = useApi<any[]>(['owner-companies', ''], '/owner/companies?');
  const [ipo, setIpo] = useState<any>(null);
  const [bond, setBond] = useState({ companyId: '', couponBps: 100, termPeriods: 24 });
  const [idx, setIdx] = useState({ symbol: '', name: '', categories: 'tech' });
  const inv = [['owner-market'], ['owner-trades']];
  const approve = useAction(() => POST(`/owner/market/ipo/${ipo.id}/approve`, ipo.form), { invalidate: inv, success: '🔔 Listed! The bell has been rung.', onSuccess: () => setIpo(null) });
  const reject = useAction((id: string) => POST(`/owner/market/ipo/${id}/reject`, { reason: 'Not yet - grow a bit more!' }), { invalidate: inv, success: 'IPO declined.' });
  const act = useAction((v: { url: string; body?: any }) => POST(v.url, v.body ?? {}), { invalidate: inv, success: 'Done.' });
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="h1 mr-auto">📈 Market</h1>
        <a className="btn-ghost btn-sm" href="/api/owner/market/trades?format=csv&limit=100000">⬇️ Trades CSV</a>
        <select className="input w-auto" defaultValue="" onChange={(e) => e.target.value && act.mutate({ url: '/owner/market/mode-all', body: { mode: e.target.value } })} aria-label="Price mode for all stocks">
          <option value="">Set price mode for ALL stocks...</option>
          {PRICE_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div className="card">
        <div className="h3 mb-2">🔔 IPO requests</div>
        {!d.ipoRequests.length ? <p className="text-sm muted">No pending requests.</p> : d.ipoRequests.map((r: any) => (
          <div key={r.id} className="card-flat flex items-center gap-2 flex-wrap mb-2 text-sm">
            <span className="text-2xl">{r.emoji}</span><b>{r.name}</b>
            <span>{r.request?.shares} shares @ {r.request?.price} BT (fair ≈ {r.suggestedPrice}), founder {r.request?.founderPct}%</span>
            <span className="italic muted">"{r.request?.pitch}"</span>
            <span className="ml-auto flex gap-1">
              <button className="btn-good btn-sm" onClick={() => setIpo({ id: r.id, name: r.name, form: { shares: r.request?.shares ?? 10000, price: r.request?.price ?? 25, founderPct: r.request?.founderPct ?? 60, priceMode: 'FUNDAMENTALS', dividendPct: 20, symbol: '' } })} data-testid="approve-ipo">Approve...</button>
              <button className="btn-ghost btn-sm" onClick={() => reject.mutate(r.id)}>Reject</button>
            </span>
          </div>
        ))}
      </div>
      {d.takeovers.length > 0 && (
        <div className="card">
          <div className="h3 mb-2">🦈 Takeovers awaiting approval</div>
          {d.takeovers.map((p: any) => (
            <div key={p.id} className="card-flat flex items-center gap-2 text-sm">
              Proposal {p.id} by {p.proposerId} (yes {p.yes} / no {p.no})
              <button className="btn-good btn-sm ml-auto" onClick={() => act.mutate({ url: `/owner/market/takeovers/${p.id}`, body: { approve: true } })}>Approve</button>
              <button className="btn-bad btn-sm" onClick={() => act.mutate({ url: `/owner/market/takeovers/${p.id}`, body: { approve: false } })}>Veto</button>
            </div>
          ))}
        </div>
      )}
      <div className="card !p-0 overflow-x-auto">
        <div className="h3 p-3">📋 All assets</div>
        <table className="table-clean text-sm">
          <thead><tr><th>Symbol</th><th>Type</th><th>Price</th><th>Mode</th><th>Shares</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {d.assets.map((a: any) => (
              <tr key={a.id} className={a.listed ? '' : 'opacity-40'}>
                <td><b>${a.symbol}</b> <span className="muted text-xs">{a.name}</span></td>
                <td>{a.type}</td><td>{a.price}</td>
                <td>
                  <select className="input !min-h-[30px] !py-0 w-32 text-xs" value={a.priceMode} onChange={(e) => act.mutate({ url: `/owner/market/assets/${a.id}/mode`, body: { mode: e.target.value } })} aria-label="Price mode">
                    {PRICE_MODES.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </td>
                <td>{a.sharesOutstanding.toLocaleString()}</td>
                <td>{!a.listed ? 'delisted' : a.halted ? `⏸️ ${a.haltReason ?? ''}` : '🟢'}</td>
                <td className="whitespace-nowrap">
                  {a.listed && <button className="btn-ghost btn-sm" onClick={() => act.mutate({ url: `/owner/market/assets/${a.id}/halt`, body: { halted: !a.halted, reason: 'Owner pause' } })}>{a.halted ? '▶️' : '⏸️'}</button>}{' '}
                  {a.listed && <button className="btn-ghost btn-sm" title="Set price (owner mode)" onClick={() => { const p = window.prompt(`New price for $${a.symbol}?`, String(a.price)); if (p) act.mutate({ url: `/owner/market/assets/${a.id}/price`, body: { price: Math.max(1, Math.floor(Number(p))) } }); }}>💲</button>}{' '}
                  {a.listed && a.type === 'STOCK' && <button className="btn-ghost btn-sm" title="Split" onClick={() => { const r = window.prompt('Split ratio (2-10)?', '2'); if (r) act.mutate({ url: `/owner/market/assets/${a.id}/split`, body: { ratio: Number(r) } }); }}>✂️</button>}{' '}
                  {a.listed && a.type === 'STOCK' && <button className="btn-ghost btn-sm" title="Dividend %" onClick={() => { const p = window.prompt('Dividend % of profit?', String(a.dividendPct)); if (p) act.mutate({ url: `/owner/market/assets/${a.id}/dividend`, body: { pct: Math.max(0, Math.min(100, Math.floor(Number(p)))) } }); }}>💸</button>}{' '}
                  {a.listed && a.type === 'STOCK' && <button className="btn-bad btn-sm" onClick={() => window.confirm(`Delist $${a.symbol}? The Treasury buys out all holders at ${a.price}.`) && act.mutate({ url: `/owner/market/assets/${a.id}/delist` })}>Delist</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        <div className="card flex flex-col gap-2">
          <div className="h3">📜 Issue company bonds</div>
          <select className="input" value={bond.companyId} onChange={(e) => setBond({ ...bond, companyId: e.target.value })}><option value="">Company...</option>{(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</select>
          <label className="label">Coupon (bps per period)<input type="number" className="input" value={bond.couponBps} onChange={(e) => setBond({ ...bond, couponBps: Number(e.target.value) })} /></label>
          <label className="label">Term (periods)<input type="number" className="input" value={bond.termPeriods} onChange={(e) => setBond({ ...bond, termPeriods: Number(e.target.value) })} /></label>
          <button className="btn-primary" disabled={!bond.companyId} onClick={() => act.mutate({ url: '/owner/market/bonds', body: bond })}>Issue</button>
        </div>
        <div className="card flex flex-col gap-2">
          <div className="h3">🧺 Create an index fund</div>
          <input className="input" placeholder="Symbol (e.g. PETS)" value={idx.symbol} onChange={(e) => setIdx({ ...idx, symbol: e.target.value.toUpperCase() })} />
          <input className="input" placeholder="Name" value={idx.name} onChange={(e) => setIdx({ ...idx, name: e.target.value })} />
          <input className="input" placeholder="Category ids, comma separated" value={idx.categories} onChange={(e) => setIdx({ ...idx, categories: e.target.value })} />
          <button className="btn-primary" disabled={!idx.symbol || !idx.name} onClick={() => act.mutate({ url: '/owner/market/indexes', body: { ...idx, categories: idx.categories.split(',').map((s) => s.trim()).filter(Boolean) } })}>Create</button>
        </div>
        <div className="card flex flex-col gap-2">
          <div className="h3">🎢 Market events</div>
          {Object.entries(d.events).map(([k, e]: any) => <button key={k} className="btn-ghost btn-sm justify-start" onClick={() => act.mutate({ url: `/owner/market/events/${k}` })}>{e.emoji} {e.label}</button>)}
        </div>
      </div>
      <div className="card !p-0 overflow-x-auto">
        <div className="h3 p-3">🧾 Latest trades</div>
        {!trades.data?.length ? <EmptyState title="No trades yet" /> : (
          <table className="table-clean text-xs">
            <thead><tr><th>When</th><th>Asset</th><th>Buyer</th><th>Seller</th><th>Qty</th><th>Price</th><th>Fee</th><th></th></tr></thead>
            <tbody>
              {trades.data.map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.createdAt).toLocaleTimeString()}</td><td>{d.assets.find((a: any) => a.id === t.assetId)?.symbol}</td><td className="font-mono">{t.buyerId.slice(0, 12)}</td><td className="font-mono">{t.sellerId.slice(0, 12)}</td><td>{t.qty}</td><td>{t.price}</td><td>{t.fee}</td>
                  <td><button className="btn-ghost btn-sm" onClick={() => act.mutate({ url: `/owner/market/flags/${t.id}` })}>🚩</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Modal open={!!ipo} onClose={() => setIpo(null)} title={`🔔 Approve IPO: ${ipo?.name}`}>
        {ipo && (
          <div className="flex flex-col gap-2">
            {(['shares', 'price', 'founderPct', 'dividendPct'] as const).map((k) => <label key={k} className="label">{k}<input type="number" className="input" value={ipo.form[k]} onChange={(e) => setIpo({ ...ipo, form: { ...ipo.form, [k]: Math.floor(Number(e.target.value)) } })} /></label>)}
            <label className="label">Ticker (blank = auto)<input className="input" value={ipo.form.symbol} maxLength={6} onChange={(e) => setIpo({ ...ipo, form: { ...ipo.form, symbol: e.target.value.toUpperCase() } })} /></label>
            <label className="label">Price mode<select className="input" value={ipo.form.priceMode} onChange={(e) => setIpo({ ...ipo, form: { ...ipo.form, priceMode: e.target.value } })}>{PRICE_MODES.map((m) => <option key={m}>{m}</option>)}</select></label>
            <p className="text-xs muted">Market cap at IPO: {formatBits(ipo.form.shares * ipo.form.price)}</p>
            <button className="btn-good" onClick={() => approve.mutate(undefined)} data-testid="confirm-ipo">Ring the bell 🔔</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
