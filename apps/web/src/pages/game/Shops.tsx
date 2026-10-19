import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { GET, POST } from '../../lib/api';
import { onWs } from '../../lib/ws';
import { useStore } from '../../lib/store';
import { sfx } from '../../lib/sound';
import { LoadingJoke, EmptyState, timeAgo } from '../../components/ui';
import { QR } from '../../components/QR';
import { Scanner } from '../../components/Scanner';
import { useGameMe } from './GameLayout';

/** Directory of businesses with stock on their online shelves. */
export function Shops() {
  const q = useApi<any[]>(['shops'], '/game/shops');
  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <div className="flex items-end gap-3 flex-wrap">
        <h1 className="h1 flex-1">🛒 Shops</h1>
        <Link to="/orders" className="btn-ghost">🧾 My orders</Link>
        <Link to="/pay" className="btn-primary">💳 Pay at a register</Link>
      </div>
      {!q.data ? <LoadingJoke /> : !q.data.length ? <EmptyState emoji="🏚️" title="No shops open" body="No business has products on sale right now. Check back soon!" /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {q.data.map((s) => (
            <Link key={s.id} to={`/shops/${s.id}`} className="card hover:ring-2 ring-accent flex flex-col gap-1" data-testid={`shop-${s.id}`}>
              <div className="flex items-center gap-2"><span className="text-3xl">{s.emoji}</span><b className="flex-1">{s.name}</b><span className="text-xs">⭐ {s.stars}</span></div>
              {s.slogan && <div className="text-xs italic muted">{s.slogan}</div>}
              <div className="text-sm">{s.products} product{s.products === 1 ? '' : 's'} in stock</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** One business's storefront: build a cart, then pay now or pay when you pick it up. */
export function Storefront() {
  const { id = '' } = useParams();
  const me = useGameMe();
  const navigate = useNavigate();
  const q = useApi<any>(['shop', id], `/game/shops/${id}`);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const order = useAction((payMode: 'now' | 'pickup') => POST<any>(`/game/shops/${id}/order`, { lines: Object.entries(cart).filter(([, n]) => n > 0).map(([productId, qty]) => ({ productId, qty })), payMode, note }), {
    invalidate: [['orders'], ['shop', id], ['shops']],
    onSuccess: (o) => {
      sfx.coin();
      useStore.getState().toast(`Order placed! Pickup code ${o.pickupCode}`, 'good', '🛍️');
      navigate('/orders');
    },
  });
  if (!q.data) return <LoadingJoke />;
  const { seller, products, taxBps } = q.data;
  const lines = Object.entries(cart).filter(([, n]) => n > 0);
  const subtotal = lines.reduce((s, [pid, n]) => s + n * (products.find((p: any) => p.productId === pid)?.price ?? 0), 0);
  const tax = Math.round((subtotal * taxBps) / 10_000);
  const add = (pid: string, d: number) => {
    const p = products.find((x: any) => x.productId === pid);
    setCart((c) => ({ ...c, [pid]: Math.max(0, Math.min(p?.stock ?? 0, (c[pid] ?? 0) + d)) }));
    sfx.click();
  };
  const busy = order.isPending || me.access.readOnly || !lines.length;
  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link to="/shops" className="btn-ghost btn-sm">← Shops</Link>
        <h1 className="h1 flex-1">{seller.emoji} {seller.name}</h1>
        <span className="chip">⭐ {seller.stars}</span>
      </div>
      <div className="grid md:grid-cols-[1fr_320px] gap-4">
        <div className="card">
          {!products.length ? <EmptyState emoji="📭" title="Sold out" body="This shop has nothing on the shelf right now." /> : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {products.map((p: any) => (
                <div key={p.productId} className="card-flat !p-2 flex flex-col gap-1">
                  <span className="text-3xl">{p.emoji}</span>
                  <b className="text-sm leading-tight">{p.name}</b>
                  <span className="text-xs">{formatBits(p.price)} · {p.stock} left · Q{p.quality}</span>
                  <div className="flex items-center gap-1">
                    <button className="btn-ghost btn-sm !px-2" onClick={() => add(p.productId, -1)} aria-label={`One less ${p.name}`}>−</button>
                    <b className="w-6 text-center">{cart[p.productId] ?? 0}</b>
                    <button className="btn-ghost btn-sm !px-2" onClick={() => add(p.productId, 1)} aria-label={`One more ${p.name}`} data-testid={`shop-add-${p.productId}`}>+</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card flex flex-col gap-2">
          <div className="h3">🛒 Your basket</div>
          {!lines.length ? <p className="text-sm muted">Add something tasty.</p> : lines.map(([pid, n]) => {
            const p = products.find((x: any) => x.productId === pid);
            return <div key={pid} className="flex text-sm"><span className="flex-1">{n}× {p.emoji} {p.name}</span><span>{formatBits(n * p.price)}</span></div>;
          })}
          <label className="label">Note for the shop<input className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Extra sprinkles please" /></label>
          <div className="text-sm border-t border-ink/10 pt-2">
            <div className="flex"><span className="flex-1">Subtotal</span><span>{formatBits(subtotal)}</span></div>
            <div className="flex muted"><span className="flex-1">Sales tax ({taxBps / 100}%)</span><span>{formatBits(tax)}</span></div>
            <div className="flex text-xl font-extrabold"><span className="flex-1">Total</span><span>{formatBits(subtotal + tax)}</span></div>
          </div>
          <button className="btn-good" disabled={busy} onClick={() => order.mutate('now')} data-testid="order-pay-now">💳 Pay now, pick up later</button>
          <button className="btn-primary" disabled={busy} onClick={() => order.mutate('pickup')} data-testid="order-pay-pickup">🏪 Pay when I pick it up</button>
          <p className="text-xs muted">You get a pickup code. Show it at the shop's register to collect your order.</p>
        </div>
      </div>
    </div>
  );
}

const STATUS: Record<string, string> = { placed: '⏳ Being packed', ready: '📦 Ready for pickup', collected: '✅ Collected', cancelled: '❌ Cancelled' };

/** The buyer's orders and their pickup codes. */
export function MyOrders() {
  const me = useGameMe();
  const qc = useQueryClient();
  const q = useApi<any[]>(['orders'], '/game/orders', { refetchInterval: 20_000 });
  useEffect(() => onWs('company', () => qc.invalidateQueries({ queryKey: ['orders'] })), [qc]);
  const cancel = useAction((id: string) => POST(`/game/orders/${id}/cancel`), { invalidate: [['orders']], success: 'Order cancelled. Any payment was refunded.' });
  const [show, setShow] = useState<string | null>(null);
  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <div className="flex items-end gap-3 flex-wrap">
        <h1 className="h1 flex-1">🧾 My orders</h1>
        <Link to="/shops" className="btn-ghost">🛒 Shops</Link>
        <Link to="/pay" className="btn-primary">💳 Pay</Link>
      </div>
      {!q.data ? <LoadingJoke /> : !q.data.length ? <EmptyState emoji="🛍️" title="No orders yet" body={<>Browse the <Link to="/shops" className="underline">shops</Link> and order something.</>} /> : q.data.map((o) => {
        const open = o.status === 'placed' || o.status === 'ready';
        return (
          <div key={o.id} className="card flex flex-col gap-1 text-sm" data-testid={`order-${o.id}`}>
            <div className="flex items-center gap-2 flex-wrap"><b className="flex-1">{o.sellerEmoji} {o.seller}</b><span className="chip">{STATUS[o.status] ?? o.status}</span><span className="chip">{o.paid ? '✅ paid' : '💳 pay at pickup'}</span></div>
            <div>{o.items.map((l: any) => `${l.qty}× ${l.emoji} ${l.name}`).join(' · ')} · <b>{formatBits(o.total)}</b></div>
            {open && (
              <div className="flex items-center gap-2 flex-wrap">
                <span>Pickup code</span>
                <span className="font-mono text-xl font-extrabold tracking-[0.3em]" data-testid="pickup-code">{o.pickupCode}</span>
                <button className="btn-ghost btn-sm" onClick={() => setShow(show === o.id ? null : o.id)}>{show === o.id ? 'Hide QR' : 'Show QR'}</button>
                {o.status === 'placed' && <button className="btn-ghost btn-sm ml-auto" disabled={me.access.readOnly} onClick={() => cancel.mutate(o.id)}>Cancel</button>}
              </div>
            )}
            {open && show === o.id && <div className="self-center"><QR text={o.pickupCode} size={180} label={`Pickup QR ${o.pickupCode}`} /></div>}
            <div className="text-xs muted">{timeAgo(o.createdAt)}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Pay at a register: scan the cashier's QR, or type the code. */
export function Pay() {
  const { code: urlCode } = useParams();
  const me = useGameMe();
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
  const pay = useAction(() => POST<any>(`/game/pay/${sale.code}`), {
    invalidate: [['orders'], ['state']],
    onSuccess: (r) => {
      sfx.bigCoin();
      confetti();
      setDone(r);
    },
  });
  if (done) {
    return (
      <div className="max-w-md mx-auto card flex flex-col items-center gap-2 text-center" data-testid="pay-done">
        <div className="text-7xl">🧾</div>
        <h1 className="h1">Paid {formatBits(done.total)}</h1>
        <p>to {done.seller}. Enjoy your {done.items.map((l: any) => `${l.qty}× ${l.emoji} ${l.name}`).join(', ')}!</p>
        <button className="btn-primary" onClick={() => { setDone(null); setSale(null); setCode(''); navigate('/pay'); }}>Done</button>
      </div>
    );
  }
  return (
    <div className="max-w-md mx-auto flex flex-col gap-4">
      <h1 className="h1">💳 Pay</h1>
      <div className="card flex flex-col gap-2">
        <p className="text-sm muted">Scan the QR on the cashier's screen, or type the code under it.</p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) look(code); }}>
          <input className="input flex-1 font-mono uppercase tracking-widest" placeholder="ABC123" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Payment code" data-testid="pay-code" />
          <button className="btn-primary">Look up</button>
          <button type="button" className="btn-ghost" onClick={() => setScan(true)} aria-label="Scan payment QR">📷</button>
        </form>
        {scan && <Scanner onCode={(c) => { setScan(false); setCode(c); look(c); }} onClose={() => setScan(false)} />}
      </div>
      {sale && (
        <div className="card flex flex-col gap-2" data-testid="pay-receipt">
          <div className="flex items-center gap-2"><span className="text-3xl">{sale.seller?.emoji}</span><b className="flex-1">{sale.seller?.name}</b><span className="font-mono">{sale.code}</span></div>
          {sale.items.map((l: any, i: number) => <div key={i} className="flex text-sm"><span className="flex-1">{l.qty}× {l.emoji} {l.name}</span><span>{formatBits(l.qty * l.unitPrice)}</span></div>)}
          <div className="text-sm border-t border-ink/10 pt-2">
            {sale.discountPct > 0 && <div className="flex muted"><span className="flex-1">Discount</span><span>{sale.discountPct}%</span></div>}
            <div className="flex"><span className="flex-1">Subtotal</span><span>{formatBits(sale.subtotal)}</span></div>
            <div className="flex muted"><span className="flex-1">Sales tax</span><span>{formatBits(sale.tax)}</span></div>
            <div className="flex text-2xl font-extrabold"><span className="flex-1">Total</span><span>{formatBits(sale.total)}</span></div>
          </div>
          {sale.status === 'open' ? (
            <button className="btn-good text-lg" disabled={pay.isPending || me.access.readOnly} onClick={() => pay.mutate(undefined)} data-testid="pay-confirm">✅ Pay {formatBits(sale.total)}</button>
          ) : (
            <div className="chip self-start">This sale is {sale.status}.</div>
          )}
        </div>
      )}
    </div>
  );
}
