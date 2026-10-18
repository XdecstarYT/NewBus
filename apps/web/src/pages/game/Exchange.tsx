import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { onWs, subscribe } from '../../lib/ws';
import { useStore } from '../../lib/store';
import { sfx } from '../../lib/sound';
import { LoadingJoke, Tabs, Modal, EmptyState, Bits, Toggle, timeLeft, useNow } from '../../components/ui';
import { CandleChart, Sparkline } from '../../components/Charts';
import { BossByteFace } from '../../components/BossByte';
import { useGameMe } from './GameLayout';

const TYPE_TABS = [
  { id: 'STOCK', label: '🏢 Stocks' },
  { id: 'ETF', label: '🧺 Index funds' },
  { id: 'BOND', label: '📜 Bonds' },
  { id: 'COMMODITY', label: '🌾 Commodities' },
  { id: 'COIN', label: '🦆 Meme coins' },
] as const;

function Change({ v }: { v: number }) {
  return <span className={`font-bold tabular-nums ${v > 0 ? 'text-good' : v < 0 ? 'text-bad' : 'muted'}`}>{v > 0 ? '▲' : v < 0 ? '▼' : '•'} {Math.abs(v).toFixed(1)}%</span>;
}

/** Scrolling ticker tape with Boss Byte commentary (live over WebSocket). */
export function TickerTape() {
  const [items, setItems] = useState<any[]>([]);
  const [comment, setComment] = useState('Boss Byte is warming up the trading floor...');
  useEffect(() => {
    subscribe('market');
    return onWs('ticker', (m) => {
      setItems(m.items);
      setComment(m.comment);
    });
  }, []);
  const doubled = [...items, ...items];
  return (
    <div className="card !p-0 overflow-hidden" aria-label="Market ticker">
      <div className="flex items-center gap-2 px-3 py-1 border-b-2 border-ink/10 text-sm font-bold">
        <BossByteFace size={24} mood="wow" /> <span className="truncate">{comment}</span>
      </div>
      <div className="whitespace-nowrap overflow-hidden py-1">
        <div className="inline-block animate-ticker">
          {doubled.map((t, i) => (
            <span key={i} className="mx-3 text-sm font-mono">
              ${t.symbol} <b>{t.price}</b> <Change v={t.change} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Exchange() {
  const q = useApi<any>(['exchange'], '/game/exchange', { refetchInterval: 10_000 });
  const heat = useApi<any[]>(['heatmap'], '/game/exchange/heatmap', { refetchInterval: 20_000 });
  const qc = useQueryClient();
  const [type, setType] = useState<(typeof TYPE_TABS)[number]['id']>('STOCK');
  const [selected, setSelected] = useState<string | null>(null);
  const [watchOnly, setWatchOnly] = useState(false);
  useEffect(() => onWs('trade', () => qc.invalidateQueries({ queryKey: ['exchange'] })), [qc]);
  if (q.isLoading || !q.data) return <LoadingJoke jokes={['Buying low...', 'Selling high...', 'Napping in between...', 'Consulting the market goldfish...']} />;
  const list = q.data.assets.filter((a: any) => a.type === type && (!watchOnly || a.watched));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="h1 mr-auto">📈 Bit Exchange</h1>
        <span className="text-xs muted">Fictional fun-money only. Fee {q.data.fees.tradingBps / 100}% per trade.</span>
      </div>
      <TickerTape />
      {type === 'STOCK' && heat.data && heat.data.length > 0 && <Heatmap items={heat.data} onPick={(sym) => setSelected(q.data.assets.find((a: any) => a.symbol === sym)?.id ?? null)} />}
      <div className="flex items-center gap-2 flex-wrap">
        <Tabs value={type} onChange={setType} tabs={TYPE_TABS as any} />
        <label className="text-sm font-bold flex items-center gap-1 ml-auto"><input type="checkbox" checked={watchOnly} onChange={(e) => setWatchOnly(e.target.checked)} /> ⭐ Watchlist only</label>
      </div>
      {!list.length ? (
        <EmptyState emoji="🦗" title={type === 'STOCK' ? 'No listed companies yet' : 'Nothing here'} body={type === 'STOCK' ? 'When the Owner approves an IPO, its stock appears here. Maybe yours could be first?' : 'Check back later.'} />
      ) : (
        <div className="card !p-0 overflow-x-auto">
          <table className="table-clean text-sm">
            <thead><tr><th>Asset</th><th className="text-right">Price</th><th>24h</th><th>7d</th><th className="text-right">Mkt cap</th><th className="text-right">Vol 24h</th></tr></thead>
            <tbody>
              {list.map((a: any) => (
                <tr key={a.id} className="hover:bg-accent/5 cursor-pointer" onClick={() => setSelected(a.id)} data-testid={`asset-${a.symbol}`}>
                  <td>
                    <span className="font-display font-extrabold">${a.symbol}</span> <span className="muted">{a.company?.emoji} {a.name}</span>
                    {a.watched && ' ⭐'} {a.halted && <span className="chip !bg-warn/30">⏸️ halted</span>}
                  </td>
                  <td className="text-right font-bold tabular-nums">{a.price}</td>
                  <td><Change v={a.change24h} /></td>
                  <td><Change v={a.change7d} /></td>
                  <td className="text-right tabular-nums">{formatBits(a.marketCap, false)}</td>
                  <td className="text-right tabular-nums">{a.volume24h}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!selected} onClose={() => setSelected(null)} title="" wide>
        {selected && <AssetDetail id={selected} />}
      </Modal>
    </div>
  );
}

function Heatmap({ items, onPick }: { items: any[]; onPick: (s: string) => void }) {
  const total = items.reduce((s, i) => s + Math.max(1, i.cap), 0);
  return (
    <div className="card !p-2 flex flex-wrap gap-1" aria-label="Market heat map">
      {items.sort((a, b) => b.cap - a.cap).map((i) => {
        const w = Math.max(8, (i.cap / total) * 100);
        const intensity = Math.min(1, Math.abs(i.change) / 15);
        const bg = i.change >= 0 ? `rgba(22,163,74,${0.25 + intensity * 0.7})` : `rgba(220,38,38,${0.25 + intensity * 0.7})`;
        return (
          <button key={i.symbol} onClick={() => onPick(i.symbol)} className="rounded-xl border-2 border-ink text-xs font-bold p-2 text-left min-w-[70px]" style={{ flexBasis: `${w}%`, flexGrow: 1, background: bg }}>
            ${i.symbol}<br />{i.change > 0 ? '+' : ''}{i.change.toFixed(1)}%
          </button>
        );
      })}
    </div>
  );
}

function AssetDetail({ id }: { id: string }) {
  const me = useGameMe();
  const ro = me.access.readOnly;
  const q = useApi<any>(['asset', id], `/game/exchange/assets/${id}`, { refetchInterval: 8000 });
  const book = useApi<any>(['book', id], `/game/exchange/assets/${id}/book`, { refetchInterval: 5000 });
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [type, setType] = useState<'market' | 'limit'>('market');
  const [qty, setQty] = useState(10);
  const [limit, setLimit] = useState<number>(0);
  const [alert, setAlert] = useState({ above: '', below: '' });
  const [proposal, setProposal] = useState<{ kind: string; pct: number; amount: number } | null>(null);
  useNow(1000);
  const inv = [['asset', id], ['book', id], ['exchange'], ['portfolio'], ['state']];
  const order = useAction(() => POST('/game/exchange/orders', { assetId: id, side, type, qty, limitPrice: type === 'limit' ? limit : null }), {
    invalidate: inv,
    onSuccess: (r) => {
      const filled = r.order.filled;
      if (filled > 0) {
        sfx.coin();
        useStore.getState().toast(`${side === 'buy' ? 'Bought' : 'Sold'} ${filled} @ avg ${Math.round(r.fills.reduce((s: number, f: any) => s + f.price * f.qty, 0) / filled)} BT`, 'good');
        if (side === 'buy' && qty >= 100) useStore.getState().say('Big buyer energy! Diamond hands activated. 💎🙌', 'wow');
      } else useStore.getState().toast('Order placed on the book. Waiting for a match...', 'info');
    },
  });
  const drip = useAction((on: boolean) => POST(`/game/exchange/assets/${id}/drip`, { on }), { invalidate: inv, success: 'DRIP updated.' });
  const watch = useAction((on: boolean) => POST(`/game/exchange/assets/${id}/watch`, { on, alertAbove: alert.above ? Number(alert.above) : null, alertBelow: alert.below ? Number(alert.below) : null }), { invalidate: inv, success: 'Watchlist updated ⭐' });
  const vote = useAction((v: { pid: string; yes: boolean }) => POST(`/game/exchange/proposals/${v.pid}/vote`, { yes: v.yes }), { invalidate: inv, success: 'Vote cast! 🗳️' });
  const propose = useAction(() => POST(`/game/exchange/assets/${id}/proposals`, { kind: proposal!.kind, data: proposal!.kind === 'dividend' ? { pct: proposal!.pct } : proposal!.kind === 'buyback' ? { amount: proposal!.amount } : proposal!.kind === 'workplace' ? { kind: 1 } : {} }), { invalidate: inv, success: 'Proposal posted to the board!', onSuccess: () => setProposal(null) });
  const d = q.data;
  useEffect(() => {
    if (d && !limit) setLimit(d.price);
  }, [d, limit]);
  const maxDepth = useMemo(() => Math.max(1, ...(book.data?.book.bids ?? []).map((b: any) => b.qty), ...(book.data?.book.asks ?? []).map((b: any) => b.qty)), [book.data]);
  if (!d) return <LoadingJoke />;
  const ownStock = d.company?.id === me.access.companyId;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-4xl">{d.company?.emoji ?? (d.type === 'COIN' ? '🦆' : d.type === 'BOND' ? '📜' : d.type === 'ETF' ? '🧺' : '🌾')}</span>
        <div className="mr-auto">
          <div className="h2">${d.symbol} <span className="text-base muted">{d.name}</span></div>
          <div className="text-sm">{d.company ? `${d.company.industry} · ` : ''}{d.type} · {d.priceMode.toLowerCase()} pricing{d.dividendPct ? ` · ${d.dividendPct}% dividend` : ''}</div>
        </div>
        <div className="text-right">
          <div className="font-display font-extrabold text-3xl">{d.price} BT</div>
          <Change v={d.change24h} />
        </div>
      </div>
      {d.halted && <div className="card-flat !bg-warn/20 font-bold text-sm">⏸️ Trading halted: {d.haltReason}</div>}
      {d.lockupUntil && d.lockupUntil > Date.now() && <div className="card-flat text-sm">🔒 Founder lock-up ends in {timeLeft(d.lockupUntil)}</div>}
      <div className="card !p-2"><CandleChart candles={d.candles} /></div>
      <div className="grid md:grid-cols-3 gap-3">
        <div className="card !p-3 md:col-span-2">
          <div className="h3 mb-1">📖 Order book</div>
          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div>
              <div className="font-bold text-good mb-1">Bids</div>
              {book.data?.book.mm.bid && <div className="flex justify-between bg-good/10 px-1 rounded">🏦 desk {book.data.book.mm.bid}<span>{book.data.book.mm.bidSize}</span></div>}
              {(book.data?.book.bids ?? []).map((b: any) => (
                <div key={b.price} className="relative flex justify-between px-1"><div className="absolute inset-y-0 right-0 bg-good/20 rounded" style={{ width: `${(b.qty / maxDepth) * 100}%` }} /><span className="relative">{b.price}</span><span className="relative">{b.qty}</span></div>
              ))}
            </div>
            <div>
              <div className="font-bold text-bad mb-1">Asks</div>
              {book.data?.book.mm.ask && <div className="flex justify-between bg-bad/10 px-1 rounded">🏦 desk {book.data.book.mm.ask}<span>{book.data.book.mm.askSize}</span></div>}
              {(book.data?.book.asks ?? []).map((a: any) => (
                <div key={a.price} className="relative flex justify-between px-1"><div className="absolute inset-y-0 left-0 bg-bad/20 rounded" style={{ width: `${(a.qty / maxDepth) * 100}%` }} /><span className="relative">{a.price}</span><span className="relative">{a.qty}</span></div>
              ))}
            </div>
          </div>
          <div className="text-xs mt-2 muted">Recent: {(book.data?.trades ?? []).slice(0, 8).map((t: any) => `${t.qty}@${t.price}`).join(' · ') || 'no trades yet'}</div>
        </div>
        {!ro && (
          <div className="card !p-3 flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-1">
              <button className={`btn-sm ${side === 'buy' ? 'btn-good' : 'btn-ghost'}`} onClick={() => setSide('buy')}>Buy</button>
              <button className={`btn-sm ${side === 'sell' ? 'btn-bad' : 'btn-ghost'}`} onClick={() => setSide('sell')}>Sell</button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <button className={`btn-sm ${type === 'market' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setType('market')}>Market</button>
              <button className={`btn-sm ${type === 'limit' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setType('limit')}>Limit</button>
            </div>
            <label className="label">Quantity<input type="number" className="input" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value))))} data-testid="order-qty" /></label>
            {type === 'limit' && <label className="label">Limit price<input type="number" className="input" min={1} value={limit} onChange={(e) => setLimit(Math.max(1, Math.floor(Number(e.target.value))))} /></label>}
            <div className="text-xs muted">≈ {formatBits(qty * (type === 'limit' ? limit : d.price))} + fee</div>
            <button className={side === 'buy' ? 'btn-good' : 'btn-bad'} disabled={order.isPending || d.halted} onClick={() => order.mutate(undefined)} data-testid="place-order">
              {side === 'buy' ? '🚀 Buy' : '💸 Sell'} ${d.symbol}
            </button>
            {d.position && <div className="text-xs">You hold <b>{d.position.qty}</b> (cost <Bits n={d.position.costBasis} />)</div>}
            {d.position && d.type === 'STOCK' && <Toggle checked={d.position.drip} onChange={(v) => drip.mutate(v)} label="🔁 DRIP auto-reinvest" />}
          </div>
        )}
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <div className="card !p-3">
          <div className="h3 mb-1">👥 Top holders</div>
          {d.topHolders.map((h: any, i: number) => <div key={i} className="flex text-sm"><span className="flex-1 truncate">{h.holder}</span><span>{h.qty} ({h.pct}%)</span></div>)}
          {d.type === 'STOCK' && <div className="text-xs muted mt-1">{d.sharesOutstanding.toLocaleString()} shares · IPO float left {d.primaryRemaining}</div>}
        </div>
        <div className="card !p-3 flex flex-col gap-2">
          <div className="h3">⭐ Watch & alerts</div>
          <div className="flex gap-2">
            <input className="input !min-h-[36px]" placeholder="Alert above" value={alert.above} onChange={(e) => setAlert({ ...alert, above: e.target.value.replace(/\D/g, '') })} />
            <input className="input !min-h-[36px]" placeholder="Alert below" value={alert.below} onChange={(e) => setAlert({ ...alert, below: e.target.value.replace(/\D/g, '') })} />
          </div>
          {!ro && <div className="flex gap-2"><button className="btn-ghost btn-sm" onClick={() => watch.mutate(true)}>{d.watch ? 'Update' : 'Watch'}</button>{d.watch && <button className="btn-ghost btn-sm" onClick={() => watch.mutate(false)}>Unwatch</button>}</div>}
        </div>
      </div>
      {d.type === 'STOCK' && (
        <div className="card !p-3">
          <div className="flex items-center mb-2">
            <div className="h3 mr-auto">🗳️ Board votes</div>
            {!ro && (d.position || ownStock) && <button className="btn-ghost btn-sm" onClick={() => setProposal({ kind: 'dividend', pct: 30, amount: 1000 })}>➕ Propose</button>}
          </div>
          {!d.proposals.length ? <p className="text-sm muted">No proposals. The board is suspiciously quiet.</p> : d.proposals.map((p: any) => (
            <div key={p.id} className="card-flat text-sm mb-1 flex items-center gap-2 flex-wrap">
              <b>{p.kind}</b> {p.kind === 'dividend' && `→ ${p.data.pct}%`}{p.kind === 'buyback' && `→ ${p.data.amount} BT`}
              <span>👍 {p.yes} · 👎 {p.no}</span><span className="chip">{p.status === 'open' ? `⏳ ${timeLeft(p.endsAt)}` : p.status}</span>
              {p.status === 'open' && !ro && d.position && (
                <span className="ml-auto flex gap-1">
                  <button className={`btn-sm ${p.myVote === true ? 'btn-good' : 'btn-ghost'}`} onClick={() => vote.mutate({ pid: p.id, yes: true })}>Yes</button>
                  <button className={`btn-sm ${p.myVote === false ? 'btn-bad' : 'btn-ghost'}`} onClick={() => vote.mutate({ pid: p.id, yes: false })}>No</button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {d.dividends.length > 0 && (
        <div className="card !p-3">
          <div className="h3 mb-1">💸 Your dividends</div>
          <Sparkline values={d.dividends.map((x: any) => x.amount).reverse()} height={40} />
        </div>
      )}
      <Modal open={!!proposal} onClose={() => setProposal(null)} title="🗳️ New board proposal">
        {proposal && (
          <div className="flex flex-col gap-2">
            <select className="input" value={proposal.kind} onChange={(e) => setProposal({ ...proposal, kind: e.target.value })}>
              <option value="dividend">💸 Change the dividend</option>
              <option value="buyback">🔁 Share buyback</option>
              <option value="workplace">🏗️ Open a new workplace</option>
              <option value="takeover">🦈 Takeover (needs 51%)</option>
            </select>
            {proposal.kind === 'dividend' && <label className="label">Dividend % of profit<input type="number" className="input" min={0} max={100} value={proposal.pct} onChange={(e) => setProposal({ ...proposal, pct: Number(e.target.value) })} /></label>}
            {proposal.kind === 'buyback' && <label className="label">Bits to spend<input type="number" className="input" min={1} value={proposal.amount} onChange={(e) => setProposal({ ...proposal, amount: Number(e.target.value) })} /></label>}
            <button className="btn-primary" onClick={() => propose.mutate(undefined)}>Submit to shareholders</button>
          </div>
        )}
      </Modal>
    </div>
  );
}

export function Portfolio() {
  const me = useGameMe();
  const q = useApi<any>(['portfolio'], '/game/exchange/portfolio', { refetchInterval: 15_000 });
  const cancel = useAction((id: string) => POST(`/game/exchange/orders/${id}/cancel`), { invalidate: [['portfolio'], ['state']], success: 'Order cancelled, Bits refunded.' });
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">💼 Portfolio</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card !p-3"><div className="text-xs font-bold muted">💰 Cash</div><div className="font-display font-extrabold text-xl"><Bits n={d.totals.cash} /></div></div>
        <div className="card !p-3"><div className="text-xs font-bold muted">📈 Invested</div><div className="font-display font-extrabold text-xl"><Bits n={d.totals.invested} /></div></div>
        <div className="card !p-3"><div className="text-xs font-bold muted">🧮 Profit / loss</div><div className={`font-display font-extrabold text-xl ${d.totals.pnl >= 0 ? 'text-good' : 'text-bad'}`}>{d.totals.pnl >= 0 ? '+' : ''}{formatBits(d.totals.pnl)}</div></div>
        <div className="card !p-3"><div className="text-xs font-bold muted">🥗 Diversification</div><div className="font-display font-extrabold text-xl">{Math.round(d.totals.diversification * 100)}%</div></div>
      </div>
      {d.netWorthHistory.length > 1 && <div className="card"><div className="h3 mb-1">🏦 Net worth over time</div><Sparkline values={d.netWorthHistory.map((x: any) => x.v)} height={70} /></div>}
      {!d.positions.length ? <EmptyState emoji="💼" title="No investments yet" body="Visit the Bit Exchange and buy a little piece of a friend's company. What could go wrong?" /> : (
        <div className="card !p-0 overflow-x-auto">
          <table className="table-clean text-sm">
            <thead><tr><th>Asset</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Value</th><th className="text-right">Cost</th><th className="text-right">P/L</th><th>DRIP</th></tr></thead>
            <tbody>
              {d.positions.map((p: any) => (
                <tr key={p.assetId}>
                  <td><b>${p.symbol}</b> <span className="muted">{p.name}</span> {p.own && <span className="chip">yours</span>}</td>
                  <td className="text-right">{p.qty}</td><td className="text-right">{p.price}</td><td className="text-right">{formatBits(p.value)}</td><td className="text-right">{formatBits(p.costBasis)}</td>
                  <td className={`text-right font-bold ${p.pnl >= 0 ? 'text-good' : 'text-bad'}`}>{p.pnl >= 0 ? '+' : ''}{formatBits(p.pnl)} ({p.pnlPct}%)</td>
                  <td>{p.drip ? '🔁' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {d.orders.length > 0 && (
        <div className="card">
          <div className="h3 mb-1">📋 Open orders</div>
          {d.orders.map((o: any) => (
            <div key={o.id} className="flex items-center gap-2 text-sm py-1">
              <span className={o.side === 'buy' ? 'text-good font-bold' : 'text-bad font-bold'}>{o.side.toUpperCase()}</span> {o.qty - o.filled} ${o.symbol} @ {o.limitPrice}
              {!me.access.readOnly && <button className="btn-ghost btn-sm ml-auto" onClick={() => cancel.mutate(o.id)}>Cancel</button>}
            </div>
          ))}
        </div>
      )}
      <div className="card">
        <div className="h3 mb-1">💸 Dividend history</div>
        {!d.dividends.length ? <p className="text-sm muted">No dividends yet. Hold dividend-paying stocks to collect them!</p> : d.dividends.map((x: any) => (
          <div key={x.id} className="text-sm flex gap-2"><b>${x.symbol}</b> +{formatBits(x.amount)} {x.reinvestedQty ? `(🔁 ${x.reinvestedQty} shares)` : ''}<span className="ml-auto text-xs muted">{new Date(x.createdAt).toLocaleString()}</span></div>
        ))}
      </div>
      <motion.div className="hidden" />
    </div>
  );
}
