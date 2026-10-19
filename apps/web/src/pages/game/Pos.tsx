import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { GET, POST } from '../../lib/api';
import { onWs } from '../../lib/ws';
import { useStore } from '../../lib/store';
import { sfx } from '../../lib/sound';
import { LoadingJoke, EmptyState, Tabs, timeAgo, timeLeft, useNow } from '../../components/ui';
import { QR } from '../../components/QR';
import { Scanner } from '../../components/Scanner';
import { useGameMe } from './GameLayout';

interface Checkout {
  id: string;
  code: string;
  total: number;
  subtotal: number;
  tax: number;
  discountPct: number;
  items: Array<{ productId: string; name: string; emoji: string; qty: number; unitPrice: number }>;
  expiresAt: number;
  orderId: string | null;
}

/** The business side: ring up sales at the register and hand over online orders. */
export function Pos() {
  const [tab, setTab] = useState<'register' | 'orders'>('register');
  const q = useApi<any>(['pos'], '/game/pos', { refetchInterval: 15_000 });
  const qc = useQueryClient();
  useEffect(() => onWs('pos', () => qc.invalidateQueries({ queryKey: ['pos'] })), [qc]);
  const waiting = q.data?.orders?.length ?? 0;
  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <div className="flex items-end gap-3 flex-wrap">
        <h1 className="h1 flex-1">🧾 POS Register</h1>
        {q.data && <div className="card !py-2 text-center"><div className="text-xs muted">Today</div><div className="font-extrabold">{q.data.today.sales} sales · {formatBits(q.data.today.takings)}</div></div>}
      </div>
      <Tabs tabs={[{ id: 'register', label: '🧾 Register' }, { id: 'orders', label: `🛍️ Online orders${waiting ? ` (${waiting})` : ''}` }]} value={tab} onChange={setTab} />
      {!q.data ? <LoadingJoke /> : tab === 'register' ? <Register data={q.data} /> : <Orders data={q.data} />}
    </div>
  );
}

function Register({ data }: { data: any }) {
  const me = useGameMe();
  const confetti = useStore((s) => s.confetti);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [discount, setDiscount] = useState(0);
  const [sale, setSale] = useState<Checkout | null>(null);
  const [paid, setPaid] = useState<{ buyer: string; total: number } | null>(null);
  const now = useNow(1000);
  const products: any[] = data.products;
  const lines = Object.entries(cart).filter(([, n]) => n > 0);
  const gross = lines.reduce((s, [id, n]) => s + n * (products.find((p) => p.productId === id)?.price ?? 0), 0);
  const subtotal = Math.round(gross * (1 - discount / 100));
  const tax = Math.round((subtotal * data.taxBps) / 10_000);
  const charge = useAction(() => POST<Checkout>('/game/pos/checkout', { lines: lines.map(([productId, qty]) => ({ productId, qty })), discountPct: discount }), {
    invalidate: [['pos']],
    onSuccess: (c) => {
      sfx.whoosh();
      setSale(c);
      setPaid(null);
    },
  });
  const cancel = useAction((id: string) => POST(`/game/pos/checkout/${id}/cancel`), { invalidate: [['pos']], success: 'Sale cancelled.', onSuccess: () => setSale(null) });
  useEffect(
    () =>
      onWs('pos', (m) => {
        if (m.event === 'paid' && sale && m.code === sale.code) {
          sfx.bigCoin();
          confetti();
          setPaid({ buyer: m.buyer, total: m.total });
          setCart({});
          setDiscount(0);
        }
      }),
    [sale, confetti],
  );
  const add = (id: string, d: number) => {
    const p = products.find((x) => x.productId === id);
    setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(p?.stock ?? 0, (c[id] ?? 0) + d)) }));
    sfx.click();
  };
  if (sale) {
    const url = `${window.location.origin}/pay/${sale.code}`;
    return (
      <div className="card flex flex-col items-center gap-3 text-center" data-testid="pos-sale">
        <AnimatePresence mode="wait">
          {paid ? (
            <motion.div key="paid" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center gap-2" data-testid="pos-paid">
              <div className="text-7xl">✅</div>
              <h2 className="h1">PAID!</h2>
              <p className="text-lg">{paid.buyer} paid <b>{formatBits(paid.total)}</b></p>
              <button className="btn-primary" onClick={() => setSale(null)}>Next customer</button>
            </motion.div>
          ) : (
            <motion.div key="wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-2">
              <div className="text-sm muted">Customer: scan this with your phone camera, or open 💳 Pay and type the code</div>
              <QR text={url} size={220} label={`Payment QR for code ${sale.code}`} />
              <div className="font-mono text-4xl font-extrabold tracking-[0.3em]" data-testid="pos-code">{sale.code}</div>
              <div className="text-3xl font-extrabold">{formatBits(sale.total)}</div>
              <div className="text-xs muted">{sale.items.map((l) => `${l.qty}× ${l.emoji} ${l.name}`).join(' · ')}{sale.discountPct ? ` · ${sale.discountPct}% off` : ''} · incl. {formatBits(sale.tax)} tax</div>
              <div className="text-xs">⏳ Waiting for payment... expires in {timeLeft(sale.expiresAt)}</div>
              {sale.expiresAt < now ? <button className="btn-primary" onClick={() => setSale(null)}>Expired: start over</button> : <button className="btn-ghost btn-sm" onClick={() => cancel.mutate(sale.id)}>Cancel sale</button>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }
  return (
    <div className="grid md:grid-cols-[1fr_320px] gap-4">
      <div className="card">
        <div className="h3 mb-2">Shelf (tap to add)</div>
        {!products.length ? <EmptyState emoji="📦" title="Nothing in stock" body="Make products first (📦 Products), then sell them here." /> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {products.map((p) => (
              <button key={p.productId} className="card-flat !p-2 text-left flex flex-col gap-0.5 hover:ring-2 ring-accent disabled:opacity-40" onClick={() => add(p.productId, 1)} disabled={(cart[p.productId] ?? 0) >= p.stock} data-testid={`pos-add-${p.productId}`}>
                <span className="text-3xl">{p.emoji}</span>
                <b className="text-sm leading-tight">{p.name}</b>
                <span className="text-xs">{formatBits(p.price)} · {p.stock - (cart[p.productId] ?? 0)} left</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="card flex flex-col gap-2">
        <div className="h3">🛒 Sale</div>
        {!lines.length ? <p className="text-sm muted">Tap products to add them.</p> : lines.map(([id, n]) => {
          const p = products.find((x) => x.productId === id)!;
          return (
            <div key={id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{p.emoji} {p.name}</span>
              <button className="btn-ghost btn-sm !px-2" onClick={() => add(id, -1)} aria-label={`One less ${p.name}`}>−</button>
              <b className="w-6 text-center">{n}</b>
              <button className="btn-ghost btn-sm !px-2" onClick={() => add(id, 1)} aria-label={`One more ${p.name}`}>+</button>
            </div>
          );
        })}
        <label className="label">Discount %<input type="number" className="input" min={0} max={50} value={discount} onChange={(e) => setDiscount(Math.max(0, Math.min(50, Math.floor(Number(e.target.value) || 0))))} /></label>
        <div className="text-sm border-t border-ink/10 pt-2">
          <div className="flex"><span className="flex-1">Subtotal</span><span>{formatBits(subtotal)}</span></div>
          <div className="flex muted"><span className="flex-1">Sales tax ({data.taxBps / 100}%)</span><span>{formatBits(tax)}</span></div>
          <div className="flex text-xl font-extrabold"><span className="flex-1">Total</span><span>{formatBits(subtotal + tax)}</span></div>
        </div>
        <button className="btn-good text-lg" disabled={!lines.length || me.access.readOnly || charge.isPending} onClick={() => charge.mutate(undefined)} data-testid="pos-charge">💳 Charge customer</button>
        {data.recent.length > 0 && (
          <div className="text-xs mt-2">
            <div className="font-bold mb-1">Recent sales</div>
            {data.recent.slice(0, 6).map((c: any) => <div key={c.id} className="flex"><span className="flex-1">{c.buyer}</span><span>{formatBits(c.total)} · {timeAgo(c.paidAt)}</span></div>)}
          </div>
        )}
      </div>
    </div>
  );
}

function Orders({ data }: { data: any }) {
  const me = useGameMe();
  const [code, setCode] = useState('');
  const [scan, setScan] = useState(false);
  const [found, setFound] = useState<any>(null);
  const [handover, setHandover] = useState<Checkout | null>(null);
  const inv = [['pos']];
  const ready = useAction((id: string) => POST(`/game/pos/orders/${id}/ready`), { invalidate: inv, success: '📦 Customer told: your order is ready!' });
  const collect = useAction((id: string) => POST<{ collected: boolean; checkout: Checkout | null }>(`/game/pos/orders/${id}/collect`), {
    invalidate: inv,
    onSuccess: (r) => {
      setFound(null);
      if (r.collected) {
        sfx.bigCoin();
        useStore.getState().toast('Handed over! Order complete.', 'good', '🤝');
      } else setHandover(r.checkout);
    },
  });
  const cancel = useAction((id: string) => POST(`/game/pos/orders/${id}/cancel`), { invalidate: inv, success: 'Order cancelled (stock back on the shelf).' });
  const lookup = async (c: string) => {
    try {
      setFound(await GET(`/game/pos/pickup/${encodeURIComponent(c)}`));
    } catch (e: any) {
      useStore.getState().toast(e.message, 'bad');
    }
  };
  const orders: any[] = data.orders;
  const ro = me.access.readOnly;
  if (handover) {
    return (
      <div className="card flex flex-col items-center gap-2 text-center">
        <p className="text-sm muted">Customer pays for their pickup: scan this, or type the code under 💳 Pay</p>
        <QR text={`${window.location.origin}/pay/${handover.code}`} size={200} />
        <div className="font-mono text-3xl font-extrabold tracking-[0.3em]" data-testid="handover-code">{handover.code}</div>
        <div className="text-2xl font-extrabold">{formatBits(handover.total)}</div>
        <button className="btn-ghost btn-sm" onClick={() => setHandover(null)}>Back to orders</button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="card flex flex-col gap-2">
        <div className="h3">🎫 Customer at the counter?</div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) lookup(code); }}>
          <input className="input flex-1 font-mono uppercase tracking-widest" placeholder="Pickup code" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Pickup code" />
          <button className="btn-primary">Find</button>
          <button type="button" className="btn-ghost" onClick={() => setScan(true)} aria-label="Scan pickup QR">📷</button>
        </form>
        {scan && <Scanner onCode={(c) => { setScan(false); setCode(c); lookup(c); }} onClose={() => setScan(false)} />}
        {found && (
          <div className="card-flat text-sm flex flex-col gap-1">
            <b>{found.buyer?.emoji} {found.buyer?.name}</b>
            <div>{found.items.map((l: any) => `${l.qty}× ${l.emoji} ${l.name}`).join(' · ')}</div>
            <div>{found.paid ? '✅ Paid online' : `💳 Pays ${formatBits(found.total)} now`} · status {found.status}</div>
            {['placed', 'ready'].includes(found.status) && <button className="btn-good self-start" disabled={ro} onClick={() => collect.mutate(found.id)}>{found.paid ? '🤝 Hand over' : '💳 Take payment & hand over'}</button>}
          </div>
        )}
      </div>
      {!orders.length ? <EmptyState emoji="🛍️" title="No online orders" body="List products as on sale (📦 Products) and players can order them from 🛒 Shops." /> : orders.map((o) => (
        <div key={o.id} className="card flex flex-col gap-1 text-sm">
          <div className="flex items-center gap-2 flex-wrap"><b className="flex-1">{o.buyerEmoji} {o.buyer}</b><span className="chip">{o.status === 'placed' ? '🆕 new' : '📦 ready'}</span><span className="chip">{o.paid ? '✅ paid' : '💳 pay at pickup'}</span></div>
          <div>{o.items.map((l: any) => `${l.qty}× ${l.emoji} ${l.name}`).join(' · ')} · {formatBits(o.total)}</div>
          {o.note && <div className="italic muted">"{o.note}"</div>}
          <div className="flex gap-1 flex-wrap">
            {o.status === 'placed' && <button className="btn-primary btn-sm" disabled={ro} onClick={() => ready.mutate(o.id)}>📦 Mark ready</button>}
            <button className="btn-good btn-sm" disabled={ro} onClick={() => collect.mutate(o.id)}>{o.paid ? '🤝 Hand over' : '💳 Take payment'}</button>
            <button className="btn-ghost btn-sm" disabled={ro} onClick={() => cancel.mutate(o.id)}>Cancel</button>
            <span className="text-xs muted ml-auto self-center">{timeAgo(o.createdAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
