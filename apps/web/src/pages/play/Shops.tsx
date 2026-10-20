import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { GET, POST } from '../../lib/api';
import { useApi, useAction } from '../../lib/hooks';
import { formatBits, item, lineText } from '../../lib/game';
import { sfx } from '../../lib/sound';
import { useStore } from '../../lib/store';
import { QR } from '../../components/QR';
import { Scanner } from '../../components/Scanner';
import { EmptyState, LoadingJoke, timeAgo } from '../../components/ui';

export function Shops() {
  const q = useApi<any[]>(['shops'], '/game/shops');
  const orders = useApi<any[]>(['shops', 'pickups'], '/game/pickups');
  const cancel = useAction((id: string) => POST(`/game/pickups/${id}/cancel`), { invalidate: [['shops']], success: 'Order cancelled.' });
  const [show, setShow] = useState<string | null>(null);
  const open = (orders.data ?? []).filter((o) => ['waiting', 'ready'].includes(o.status));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-3 flex-wrap">
        <h1 className="h1 flex-1">🛒 Shops</h1>
        <Link to="/pay" className="btn-primary">💳 Pay at a register</Link>
      </div>
      {open.length > 0 && (
        <div className="card flex flex-col gap-2">
          <div className="h3">🧾 Your pickup orders</div>
          {open.map((o) => (
            <div key={o.id} className="card-flat !p-2 text-sm flex flex-col gap-1" data-testid={`pickup-${o.id}`}>
              <div className="flex items-center gap-2 flex-wrap"><b className="flex-1">{o.other?.emoji} {o.other?.name}</b><span className="chip">{o.status === 'ready' ? '📦 Ready!' : '⏳ Being packed'}</span></div>
              <div>{lineText(o.lines)} · pay <b>{formatBits(o.total)}</b> at the counter</div>
              <div className="flex items-center gap-2 flex-wrap">
                Pickup code <span className="font-mono text-xl font-extrabold tracking-[0.3em]" data-testid="pickup-code">{o.code}</span>
                <button className="btn-ghost btn-sm" onClick={() => setShow(show === o.id ? null : o.id)}>{show === o.id ? 'Hide QR' : 'Show QR'}</button>
                <button className="btn-ghost btn-sm ml-auto" onClick={() => cancel.mutate(o.id)}>Cancel</button>
              </div>
              {show === o.id && <div className="self-center"><QR text={o.code} size={160} /></div>}
            </div>
          ))}
        </div>
      )}
      {!q.data ? <LoadingJoke /> : !q.data.length ? <EmptyState emoji="🏚️" title="No shops open" body="When players list items in 🧾 My shop, they show up here." /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {q.data.map((s) => (
            <Link key={s.id} to={`/shops/${s.id}`} className="card hover:ring-2 ring-accent flex flex-col gap-1" data-testid={`shop-${s.id}`}>
              <div className="flex items-center gap-2"><span className="text-3xl">{s.emoji}</span><b className="flex-1">{s.name}</b></div>
              {s.slogan && <div className="text-xs italic muted">{s.slogan}</div>}
              <div className="text-sm">{s.items} item{s.items === 1 ? '' : 's'} for sale</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function Storefront() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const q = useApi<any>(['storefront', id], `/game/shops/${id}`);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const lines = Object.entries(cart).filter(([, n]) => n > 0).map(([i, qty]) => ({ item: i, qty }));
  const buy = useAction(() => POST<any>(`/game/shops/${id}/buy`, { lines }), { invalidate: [['home'], ['me'], ['storefront']], success: (r) => `Bought for ${formatBits(r.total)}! It's in your warehouse.`, onSuccess: () => (sfx.bigCoin(), setCart({})) });
  const pickup = useAction(() => POST<any>(`/game/shops/${id}/pickup`, { lines, note }), { invalidate: [['shops']], success: (r) => `Ordered! Pickup code ${r.code}.`, onSuccess: () => navigate('/shops') });
  if (!q.data) return <LoadingJoke />;
  const { seller, items } = q.data;
  const total = lines.reduce((s, l) => s + l.qty * (items.find((x: any) => x.item === l.item)?.price ?? 0), 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3"><Link to="/shops" className="btn-ghost btn-sm">← Shops</Link><h1 className="h1 flex-1">{seller.emoji} {seller.name}</h1></div>
      <div className="grid md:grid-cols-[1fr_300px] gap-4">
        <div className="card grid grid-cols-2 sm:grid-cols-3 gap-2 content-start">
          {!items.length && <EmptyState emoji="📭" title="Sold out" />}
          {items.map((x: any) => (
            <div key={x.item} className="card-flat !p-2 flex flex-col gap-1">
              <span className="text-3xl">{item(x.item).emoji}</span>
              <b className="text-sm">{item(x.item).name}</b>
              <span className="text-xs">{formatBits(x.price)} · {x.stock} left</span>
              <div className="flex items-center gap-1">
                <button className="btn-ghost btn-sm !px-2" onClick={() => setCart({ ...cart, [x.item]: Math.max(0, (cart[x.item] ?? 0) - 1) })} aria-label={`One less ${item(x.item).name}`}>−</button>
                <b className="w-6 text-center">{cart[x.item] ?? 0}</b>
                <button className="btn-ghost btn-sm !px-2" onClick={() => setCart({ ...cart, [x.item]: Math.min(x.stock, (cart[x.item] ?? 0) + 1) })} aria-label={`One more ${item(x.item).name}`} data-testid={`shop-add-${x.item}`}>+</button>
              </div>
            </div>
          ))}
        </div>
        <div className="card flex flex-col gap-2">
          <div className="h3">🧺 Basket</div>
          {!lines.length ? <p className="text-sm muted">Add something.</p> : <p className="text-sm">{lineText(lines)}</p>}
          <div className="flex text-xl font-extrabold"><span className="flex-1">Total</span><span>{formatBits(total)}</span></div>
          <button className="btn-good" disabled={!lines.length || buy.isPending} onClick={() => buy.mutate(undefined)} data-testid="buy-now">💳 Buy now</button>
          <label className="label">Note for pickup<input className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <button className="btn-primary" disabled={!lines.length || pickup.isPending} onClick={() => pickup.mutate(undefined)} data-testid="order-pickup">🏪 Order & pay at pickup</button>
          <p className="text-xs muted">Pickup: the shop holds the items for you; you pay at their register with a code.</p>
        </div>
      </div>
    </div>
  );
}

/** Pay at a register: scan the cashier's QR, or type the code. */
export function Pay() {
  const { code: urlCode } = useParams();
  const navigate = useNavigate();
  const confetti = useStore((s) => s.confetti);
  const [code, setCode] = useState(urlCode ?? '');
  const [scan, setScan] = useState(false);
  const [sale, setSale] = useState<any>(null);
  const [done, setDone] = useState<any>(null);
  const look = async (c: string) => {
    try {
      setDone(null);
      setSale(await GET(`/game/pay/${encodeURIComponent(c.trim())}`));
    } catch (e: any) {
      setSale(null);
      useStore.getState().toast(e.message, 'bad');
    }
  };
  useEffect(() => {
    if (urlCode) look(urlCode);
  }, [urlCode]);
  const pay = useAction(() => POST<any>(`/game/pay/${sale.code}`), { invalidate: [['home'], ['me'], ['shops']], onSuccess: (r) => (sfx.bigCoin(), confetti(), setDone(r)) });
  if (done) {
    return (
      <div className="max-w-md mx-auto card flex flex-col items-center gap-2 text-center" data-testid="pay-done">
        <div className="text-7xl">🧾</div>
        <h1 className="h1">Paid {formatBits(done.total)}</h1>
        <p>Enjoy your {lineText(done.lines)}!</p>
        <button className="btn-primary" onClick={() => (setDone(null), setSale(null), setCode(''), navigate('/pay'))}>Done</button>
      </div>
    );
  }
  return (
    <div className="max-w-md mx-auto flex flex-col gap-4">
      <h1 className="h1">💳 Pay</h1>
      <div className="card flex flex-col gap-2">
        <p className="text-sm muted">Scan the QR on the cashier's screen, or type the code under it.</p>
        <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), code.trim() && look(code))}>
          <input className="input flex-1 font-mono uppercase tracking-widest" placeholder="ABC123" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Payment code" data-testid="pay-code" />
          <button className="btn-primary">Look up</button>
          <button type="button" className="btn-ghost" onClick={() => setScan(true)} aria-label="Scan payment QR">📷</button>
        </form>
        {scan && <Scanner onCode={(c) => (setScan(false), setCode(c), look(c))} onClose={() => setScan(false)} />}
      </div>
      {sale && (
        <div className="card flex flex-col gap-2" data-testid="pay-receipt">
          <div className="flex items-center gap-2"><span className="text-3xl">{sale.seller?.emoji}</span><b className="flex-1">{sale.seller?.name}</b><span className="font-mono">{sale.code}</span></div>
          {sale.lines.map((l: any, i: number) => <div key={i} className="flex text-sm"><span className="flex-1">{l.qty}× {item(l.item).emoji} {item(l.item).name}</span><span>{formatBits(l.qty * l.price)}</span></div>)}
          <div className="flex text-2xl font-extrabold border-t border-ink/10 pt-2"><span className="flex-1">Total</span><span>{formatBits(sale.total)}</span></div>
          {sale.status === 'open' ? <button className="btn-good text-lg" disabled={pay.isPending} onClick={() => pay.mutate(undefined)} data-testid="pay-confirm">✅ Pay {formatBits(sale.total)}</button> : <div className="chip self-start">This sale is {sale.status}.</div>}
          <div className="text-xs muted">{timeAgo(sale.createdAt)}</div>
        </div>
      )}
    </div>
  );
}
