import { useEffect, useState } from 'react';
import { ITEMS, ITEM_IDS } from '@dw/shared/live';
import { GET, POST } from '../../lib/api';
import { useApi, useAction } from '../../lib/hooks';
import { onHint } from '../../lib/live';
import { formatBits, item, itemLabel, lineText } from '../../lib/game';
import { sfx } from '../../lib/sound';
import { useStore } from '../../lib/store';
import { QR } from '../../components/QR';
import { Scanner } from '../../components/Scanner';
import { EmptyState, LoadingJoke, Tabs, timeAgo, timeLeft, useNow } from '../../components/ui';

type Tab = 'register' | 'pickups' | 'listings';

/** Your storefront prices, the POS register for in-person sales, and pickup orders. */
export function MyShop() {
  const [tab, setTab] = useState<Tab>('register');
  const q = useApi<any>(['shop'], '/game/shop', { refetchInterval: 30_000 });
  if (!q.data) return <LoadingJoke />;
  const waiting = q.data.pickups.filter((p: any) => ['waiting', 'ready'].includes(p.status)).length;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">🧾 My shop & POS</h1>
      <Tabs<Tab> tabs={[{ id: 'register', label: '🧾 Register' }, { id: 'pickups', label: `🛍️ Pickup orders${waiting ? ` (${waiting})` : ''}` }, { id: 'listings', label: '🏷️ Shop prices' }]} value={tab} onChange={setTab} />
      {tab === 'register' && <Register d={q.data} />}
      {tab === 'pickups' && <Pickups d={q.data} />}
      {tab === 'listings' && <Listings d={q.data} />}
    </div>
  );
}

function Listings({ d }: { d: any }) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const save = useAction((v: { item: string; price: number; active: boolean }) => POST('/game/shop/listing', v), { invalidate: [['shop']], success: 'Saved.' });
  const items = ITEM_IDS.filter((i) => d.inventory[i] || d.listings.some((l: any) => l.item === i));
  if (!items.length) return <EmptyState emoji="📦" title="Nothing to sell yet" body="Make something in the 🏢 Office first." />;
  return (
    <div className="card flex flex-col gap-2">
      <p className="text-sm muted">Items you list show up in 🛒 Shops for every player, at your price. Buyers can pay now or order for pickup.</p>
      {items.map((i) => {
        const l = d.listings.find((x: any) => x.item === i);
        const p = prices[i] ?? l?.price ?? ITEMS[i].basePrice * 2;
        return (
          <div key={i} className="flex items-center gap-2 flex-wrap text-sm">
            <span className="flex-1 min-w-[8rem]">{itemLabel(i)} <span className="muted">({d.inventory[i] ?? 0} in stock)</span></span>
            <input type="number" className="input !w-24 !py-1" min={1} value={p} onChange={(e) => setPrices({ ...prices, [i]: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} aria-label={`${ITEMS[i].name} price`} />
            <button className="btn-primary btn-sm" onClick={() => save.mutate({ item: i, price: p, active: true })} data-testid={`list-${i}`}>{l?.active ? 'Update' : 'List it'}</button>
            {l?.active && <button className="btn-ghost btn-sm" onClick={() => save.mutate({ item: i, price: l.price, active: false })}>Unlist</button>}
          </div>
        );
      })}
    </div>
  );
}

function Register({ d }: { d: any }) {
  const confetti = useStore((s) => s.confetti);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [sale, setSale] = useState<any>(null);
  const [paid, setPaid] = useState<{ buyer: string; total: number } | null>(null);
  const now = useNow(1000);
  const listed = (i: string) => d.listings.find((l: any) => l.item === i)?.price;
  const priceOf = (i: string) => prices[i] ?? listed(i) ?? ITEMS[i as keyof typeof ITEMS].basePrice * 2;
  const lines = Object.entries(cart).filter(([, n]) => n > 0);
  const total = lines.reduce((s, [i, n]) => s + n * priceOf(i), 0);
  const charge = useAction(() => POST<any>('/game/pos', { lines: lines.map(([i, n]) => ({ item: i, qty: n, price: priceOf(i) })) }), { onSuccess: (r) => (sfx.whoosh(), setSale(r), setPaid(null)) });
  const cancel = useAction((id: string) => POST(`/game/pos/${id}/cancel`), { success: 'Sale cancelled.', onSuccess: () => setSale(null) });
  useEffect(
    () =>
      onHint((_t, h) => {
        if (h.t === 'pos' && h.event === 'paid' && sale && h.code === sale.code) {
          sfx.bigCoin();
          confetti();
          setPaid({ buyer: String(h.buyer), total: Number(h.total) });
          setCart({});
        }
      }),
    [sale, confetti],
  );
  // fallback when live updates are off: check the sale every few seconds
  useEffect(() => {
    if (!sale || paid) return;
    const iv = setInterval(async () => {
      const v = await GET<any>(`/game/pay/${sale.code}`).catch(() => null);
      if (v?.status === 'paid') {
        sfx.bigCoin();
        confetti();
        setPaid({ buyer: 'Your customer', total: v.total });
        setCart({});
      }
    }, 4000);
    return () => clearInterval(iv);
  }, [sale, paid, confetti]);
  if (sale) {
    return (
      <div className="card flex flex-col items-center gap-3 text-center" data-testid="pos-sale">
        {paid ? (
          <div className="flex flex-col items-center gap-2" data-testid="pos-paid">
            <div className="text-7xl">✅</div>
            <h2 className="h1">PAID!</h2>
            <p>{paid.buyer} paid <b>{formatBits(paid.total)}</b></p>
            <button className="btn-primary" onClick={() => setSale(null)}>Next customer</button>
          </div>
        ) : (
          <>
            <p className="text-sm muted">Customer: scan this with your phone, or open 💳 Pay and type the code.</p>
            <QR text={`${window.location.origin}/pay/${sale.code}`} size={220} label={`Payment QR for code ${sale.code}`} />
            <div className="font-mono text-4xl font-extrabold tracking-[0.3em]" data-testid="pos-code">{sale.code}</div>
            <div className="text-3xl font-extrabold">{formatBits(sale.total)}</div>
            <div className="text-xs muted">{lineText(sale.lines)}</div>
            {sale.expiresAt < now ? <button className="btn-primary" onClick={() => setSale(null)}>Expired: start over</button> : <><div className="text-xs">⏳ Waiting... {timeLeft(sale.expiresAt)}</div><button className="btn-ghost btn-sm" onClick={() => cancel.mutate(sale.id)}>Cancel sale</button></>}
          </>
        )}
      </div>
    );
  }
  const stock = ITEM_IDS.filter((i) => d.inventory[i]);
  return (
    <div className="grid md:grid-cols-[1fr_320px] gap-4">
      <div className="card">
        <div className="h3 mb-2">Shelf (tap to add)</div>
        {!stock.length ? <EmptyState emoji="📦" title="Nothing in stock" body="Make something in the Office first." /> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {stock.map((i) => (
              <button key={i} className="card-flat !p-2 text-left hover:ring-2 ring-accent disabled:opacity-40" disabled={(cart[i] ?? 0) >= d.inventory[i]} onClick={() => (sfx.click(), setCart({ ...cart, [i]: (cart[i] ?? 0) + 1 }))} data-testid={`pos-add-${i}`}>
                <div className="text-3xl">{item(i).emoji}</div>
                <b className="text-sm">{item(i).name}</b>
                <div className="text-xs">{priceOf(i)} BT · {d.inventory[i] - (cart[i] ?? 0)} left</div>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="card flex flex-col gap-2">
        <div className="h3">🛒 Sale</div>
        {!lines.length ? <p className="text-sm muted">Tap items to add them.</p> : lines.map(([i, n]) => (
          <div key={i} className="flex items-center gap-1 text-sm">
            <span className="flex-1">{n}× {itemLabel(i)}</span>
            <input type="number" className="input !w-20 !py-1" min={1} value={priceOf(i)} onChange={(e) => setPrices({ ...prices, [i]: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} aria-label={`Price of ${item(i).name}`} />
            <button className="btn-ghost btn-sm !px-2" onClick={() => setCart({ ...cart, [i]: n - 1 })} aria-label="One less">−</button>
          </div>
        ))}
        <div className="flex text-xl font-extrabold border-t border-ink/10 pt-2"><span className="flex-1">Total</span><span>{formatBits(total)}</span></div>
        <button className="btn-good text-lg" disabled={!lines.length || charge.isPending} onClick={() => charge.mutate(undefined)} data-testid="pos-charge">💳 Charge customer</button>
        {d.sales.length > 0 && (
          <div className="text-xs mt-2">
            <div className="font-bold">Recent sales</div>
            {d.sales.map((s: any) => <div key={s.id} className="flex"><span className="flex-1">{lineText(s.lines)}</span><span>{formatBits(s.total)} · {timeAgo(s.paidAt)}</span></div>)}
          </div>
        )}
      </div>
    </div>
  );
}

function Pickups({ d }: { d: any }) {
  const [code, setCode] = useState('');
  const [scan, setScan] = useState(false);
  const [found, setFound] = useState<any>(null);
  const [handover, setHandover] = useState<any>(null);
  const inv = [['shop']];
  const ready = useAction((id: string) => POST(`/game/pickups/${id}/ready`), { invalidate: inv, success: '📦 Customer told: order ready!' });
  const pay = useAction((id: string) => POST<any>(`/game/pickups/${id}/pay`), { invalidate: inv, onSuccess: (r) => (setFound(null), setHandover(r)) });
  const cancel = useAction((id: string) => POST(`/game/pickups/${id}/cancel`), { invalidate: inv, success: 'Cancelled; stock back on the shelf.' });
  const lookup = async (c: string) => {
    try {
      setFound(await GET(`/game/pickups/find/${encodeURIComponent(c)}`));
    } catch (e: any) {
      useStore.getState().toast(e.message, 'bad');
    }
  };
  if (handover) {
    return (
      <div className="card flex flex-col items-center gap-2 text-center">
        <p className="text-sm muted">Customer pays for their pickup: scan this, or type the code under 💳 Pay.</p>
        <QR text={`${window.location.origin}/pay/${handover.code}`} size={200} />
        <div className="font-mono text-3xl font-extrabold tracking-[0.3em]" data-testid="handover-code">{handover.code}</div>
        <div className="text-2xl font-extrabold">{formatBits(handover.total)}</div>
        <button className="btn-ghost btn-sm" onClick={() => setHandover(null)}>Back to orders</button>
      </div>
    );
  }
  const open = d.pickups.filter((p: any) => ['waiting', 'ready'].includes(p.status));
  return (
    <div className="flex flex-col gap-3">
      <div className="card flex flex-col gap-2">
        <div className="h3">🎫 Customer at the counter?</div>
        <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), code.trim() && lookup(code))}>
          <input className="input flex-1 font-mono uppercase tracking-widest" placeholder="Pickup code" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Pickup code" />
          <button className="btn-primary">Find</button>
          <button type="button" className="btn-ghost" onClick={() => setScan(true)} aria-label="Scan pickup QR">📷</button>
        </form>
        {scan && <Scanner onCode={(c) => (setScan(false), setCode(c), lookup(c))} onClose={() => setScan(false)} />}
        {found && (
          <div className="card-flat text-sm flex flex-col gap-1">
            <b>{found.buyer?.emoji} {found.buyer?.name}</b>
            <div>{lineText(found.lines)} · {formatBits(found.total)}</div>
            {['waiting', 'ready'].includes(found.status) ? <button className="btn-good self-start" onClick={() => pay.mutate(found.id)}>💳 Take payment & hand over</button> : <div>Status: {found.status}</div>}
          </div>
        )}
      </div>
      {!open.length ? <EmptyState emoji="🛍️" title="No pickup orders" body="List items under 🏷️ Shop prices and players can order them." /> : open.map((p: any) => (
        <div key={p.id} className="card text-sm flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap"><b className="flex-1">{p.other?.emoji} {p.other?.name}</b><span className="chip">{p.status === 'waiting' ? '🆕 new' : '📦 ready'}</span><span className="font-mono">{p.code}</span></div>
          <div>{lineText(p.lines)} · {formatBits(p.total)}</div>
          {p.note && <div className="italic muted">"{p.note}"</div>}
          <div className="flex gap-1 flex-wrap">
            {p.status === 'waiting' && <button className="btn-primary btn-sm" onClick={() => ready.mutate(p.id)}>📦 Mark ready</button>}
            <button className="btn-good btn-sm" onClick={() => pay.mutate(p.id)}>💳 Take payment</button>
            <button className="btn-ghost btn-sm" onClick={() => cancel.mutate(p.id)}>Cancel</button>
            <span className="text-xs muted ml-auto self-center">{timeAgo(p.createdAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
