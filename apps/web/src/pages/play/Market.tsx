import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { ITEMS, type ItemId } from '@dw/shared/live';
import { POST } from '../../lib/api';
import { useApi, useAction } from '../../lib/hooks';
import { formatBits, item, itemLabel } from '../../lib/game';
import { sfx } from '../../lib/sound';
import { EmptyState, LoadingJoke, timeAgo } from '../../components/ui';

/** Player market: an order book per item. Everything here is a real player's order. */
export function Market() {
  const { item: sel } = useParams();
  const navigate = useNavigate();
  const q = useApi<any>(['market'], '/game/market', { refetchInterval: 30_000 });
  if (!q.data) return <LoadingJoke />;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">📈 Market</h1>
      <p className="muted text-sm">Post a buy or sell order. When a buyer's price meets a seller's, they trade at the price that was waiting. Sellers pay the sales tax out of the proceeds.</p>
      <div className="grid lg:grid-cols-[280px_1fr] gap-4">
        <div className="card !p-2 flex flex-col gap-1 max-h-[70vh] overflow-y-auto">
          {q.data.items.map((r: any) => (
            <button key={r.item} className={`flex items-center gap-2 text-sm p-2 rounded-xl text-left ${sel === r.item ? 'bg-accent text-white' : 'hover:bg-accent/10'}`} onClick={() => navigate(`/market/${r.item}`)} data-testid={`mkt-${r.item}`}>
              <span className="text-xl">{ITEMS[r.item as ItemId].emoji}</span>
              <span className="flex-1">{ITEMS[r.item as ItemId].name}</span>
              <span className="text-xs text-right">
                {r.last ? <b>{r.last} BT</b> : <span className="opacity-60">no trades</span>}
                <br />
                <span className="opacity-80">{r.bid ?? '–'} / {r.ask ?? '–'}</span>
              </span>
            </button>
          ))}
        </div>
        {sel ? <Book item={sel} /> : <EmptyState emoji="👈" title="Pick an item" body="See who is buying and selling, and post your own order." />}
      </div>
      <MyOrders orders={q.data.mine} />
    </div>
  );
}

function Book({ item: id }: { item: string }) {
  const q = useApi<any>(['market', id], `/game/market/${id}`, { refetchInterval: 20_000 });
  const home = useApi<any>(['home'], '/game/home');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [price, setPrice] = useState<number>(0);
  const [qty, setQty] = useState(10);
  const place = useAction(() => POST<any>('/game/orders', { item: id, side, price, qty }), {
    invalidate: [['market'], ['home'], ['me']],
    success: (r) => (r.filled ? `Traded ${r.filled} right away${r.left ? `, ${r.left} waiting in the book` : ''}!` : 'Order posted. It waits until someone takes it.'),
    onSuccess: (r) => (r.filled ? sfx.bigCoin() : sfx.click()),
  });
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  const def = item(id);
  const p = price || d.asks[0]?.price || d.bids[0]?.price || def.basePrice;
  const have = home.data?.inventory?.[id] ?? 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="card flex flex-col gap-2">
        <div className="flex items-center gap-2"><span className="text-4xl">{def.emoji}</span><div><h2 className="h2">{def.name}</h2><div className="text-xs muted">{def.blurb} You have {have}.</div></div></div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Side title="Buyers (bids)" rows={d.bids} color="text-emerald-700" />
          <Side title="Sellers (asks)" rows={d.asks} color="text-rose-700" />
        </div>
      </div>
      <form className="card flex flex-col gap-2" onSubmit={(e) => (e.preventDefault(), place.mutate(undefined))}>
        <div className="flex gap-2">
          <button type="button" className={side === 'buy' ? 'btn-good flex-1' : 'btn-ghost flex-1'} onClick={() => setSide('buy')} aria-pressed={side === 'buy'}>Buy</button>
          <button type="button" className={side === 'sell' ? 'btn-bad flex-1' : 'btn-ghost flex-1'} onClick={() => setSide('sell')} aria-pressed={side === 'sell'}>Sell</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="label">Price each (BT)<input type="number" className="input" min={1} value={p} onChange={(e) => setPrice(Math.max(1, Math.floor(Number(e.target.value) || 1)))} /></label>
          <label className="label">Quantity<input type="number" className="input" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))} /></label>
        </div>
        <div className="text-sm">{side === 'buy' ? `You lock ${formatBits(p * qty)} until it fills (any difference comes back).` : `You lock ${qty} ${def.emoji} and get up to ${formatBits(p * qty)} minus tax.`}</div>
        <button className="btn-primary" disabled={place.isPending || (side === 'sell' && have < qty)} data-testid="place-order">{side === 'buy' ? '📥 Place buy order' : '📤 Place sell order'}</button>
      </form>
      <div className="card">
        <div className="h3 mb-1">Recent trades</div>
        {!d.recent.length ? <p className="text-sm muted">No trades yet. Be the first!</p> : d.recent.map((t: any) => (
          <div key={t.id} className="flex text-sm gap-2"><span className="flex-1">{t.qty}× @ <b>{t.price} BT</b></span><span className="text-xs muted">{t.venue} · {timeAgo(t.createdAt)}</span></div>
        ))}
      </div>
    </div>
  );
}

function Side({ title, rows, color }: { title: string; rows: any[]; color: string }) {
  return (
    <div>
      <div className="font-bold mb-1">{title}</div>
      {!rows.length ? <div className="muted text-xs">Nobody yet</div> : rows.map((r) => (
        <div key={r.price} className="flex gap-2"><span className={`font-bold ${color}`}>{r.price} BT</span><span className="flex-1 text-right">{r.qty}</span><span className="text-xs muted w-14 text-right">{r.orders} order{r.orders === 1 ? '' : 's'}</span></div>
      ))}
    </div>
  );
}

function MyOrders({ orders }: { orders: any[] }) {
  const cancel = useAction((id: string) => POST(`/game/orders/${id}/cancel`), { invalidate: [['market'], ['home'], ['me']], success: 'Order cancelled; your Bits or items are back.' });
  if (!orders.length) return null;
  return (
    <div className="card">
      <div className="h3 mb-1">📋 Your open orders</div>
      {orders.map((o) => (
        <div key={o.id} className="flex items-center gap-2 text-sm py-1">
          <span className={o.side === 'buy' ? 'chip !bg-emerald-100' : 'chip !bg-rose-100'}>{o.side}</span>
          <span className="flex-1">{itemLabel(o.item)}: {o.qty - o.filled} of {o.qty} @ {o.price} BT</span>
          <button className="btn-ghost btn-sm" onClick={() => cancel.mutate(o.id)}>Cancel</button>
        </div>
      ))}
    </div>
  );
}
