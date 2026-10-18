import { useState } from 'react';
import { RARITY_INFO, formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { useStore } from '../../lib/store';
import { sfx } from '../../lib/sound';
import { LoadingJoke, Tabs, Modal, EmptyState, Bits, timeLeft, useNow, Toggle } from '../../components/ui';
import { WorkerAvatar } from '../../components/WorkerAvatar';
import { useGameMe } from './GameLayout';

// ================================================================== supply chain
export function SupplyChain() {
  const me = useGameMe();
  const ro = me.access.readOnly;
  const q = useApi<any>(['supply'], '/game/supply', { refetchInterval: 15_000 });
  const prods = useApi<any>(['products'], me.access.modules.products ? '/game/products' : null);
  const recipients = useApi<any[]>(['recipients-all'], '/game/transfers/recipients', { enabled: me.access.modules.transfers });
  const [tab, setTab] = useState<'market' | 'wholesaler' | 'sell' | 'invoices'>('market');
  const [buyQty, setBuyQty] = useState<Record<string, number>>({});
  const [sell, setSell] = useState({ itemType: 'commodity', itemId: '', qty: 10, unitPrice: 10, targetId: '' });
  const [whQty, setWhQty] = useState(10);
  const inv = [['supply'], ['products'], ['state']];
  const buy = useAction((v: { id: string; qty: number }) => POST(`/game/supply/listings/${v.id}/buy`, { qty: v.qty }), {
    invalidate: inv,
    onSuccess: (r) => {
      sfx.coin();
      useStore.getState().say(`Supply deal done! You both got a ${r.bonus} BT bonus. Teamwork! 🤝`);
    },
  });
  const cancel = useAction((id: string) => POST(`/game/supply/listings/${id}/cancel`), { invalidate: inv, success: 'Listing cancelled, stock returned.' });
  const list = useAction(() => POST('/game/supply/listings', { ...sell, targetId: sell.targetId || null }), { invalidate: inv, success: 'Listed on the supply market!' });
  const whBuy = useAction((id: string) => POST('/game/supply/wholesaler/buy', { commodityId: id, qty: whQty }), { invalidate: inv, success: (r: any) => `Bought for ${r.total} BT (wholesaler markup!)` });
  const whSell = useAction((v: { itemType: string; itemId: string }) => POST('/game/supply/wholesaler/sell', { ...v, qty: whQty }), { invalidate: inv, success: (r: any) => `Sold to the wholesaler for ${r.total} BT.` });
  if (q.isLoading || !q.data) return <LoadingJoke />;
  const d = q.data;
  const stock = [
    ...(prods.data?.commodities ?? []).map((c: any) => ({ itemType: 'commodity', itemId: c.itemId, label: `${c.def?.emoji} ${c.def?.name}`, qty: c.qty })),
    ...(prods.data?.products ?? []).filter((p: any) => p.stock > 0).map((p: any) => ({ itemType: 'product', itemId: p.id, label: `${p.emoji} ${p.name}`, qty: p.stock })),
  ];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">🚚 Supply Chain</h1>
      <div className="card !p-3 text-sm flex flex-wrap gap-3">
        <span><b>You need:</b> {d.needs.map((n: any) => `${n.emoji} ${n.name}`).join(', ') || 'nothing (lucky!)'}</span>
        <span><b>You make:</b> {d.supplies.map((n: any) => `${n.emoji} ${n.name}`).join(', ') || 'finished goods only'}</span>
        <span className="muted">Player deals give both sides a +{d.dealBonusBps / 100}% bonus from the Treasury.</span>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'market', label: '🤝 Player market' }, { id: 'wholesaler', label: '🏭 NPC wholesaler' }, { id: 'sell', label: '📤 Sell to players' }, { id: 'invoices', label: '🧾 Invoices' }]} />
      {tab === 'market' && (
        !d.listings.length ? <EmptyState emoji="🦗" title="The market is quiet" body="No player listings right now. Be the first to list your goods!" /> : (
          <div className="card !p-0 overflow-x-auto">
            <table className="table-clean text-sm">
              <thead><tr><th>Item</th><th>Seller</th><th>Qty</th><th>Price</th><th>Quality</th><th></th></tr></thead>
              <tbody>
                {d.listings.map((l: any) => (
                  <tr key={l.id} className={l.privateDeal ? 'bg-accent2/10' : ''}>
                    <td>{l.item?.emoji} {l.item?.name} {l.privateDeal && <span className="chip">🔒 private deal</span>}</td>
                    <td>{l.seller?.emoji} {l.seller?.name}</td>
                    <td>{l.qty}</td>
                    <td className="font-bold">{l.unitPrice} BT</td>
                    <td>Q{l.quality}</td>
                    <td className="whitespace-nowrap">
                      {l.mine ? !ro && <button className="btn-ghost btn-sm" onClick={() => cancel.mutate(l.id)}>Cancel</button> : !ro && (
                        <span className="flex gap-1">
                          <input type="number" min={1} max={l.qty} className="input !min-h-[32px] w-20" value={buyQty[l.id] ?? Math.min(10, l.qty)} onChange={(e) => setBuyQty({ ...buyQty, [l.id]: Math.max(1, Math.min(l.qty, Number(e.target.value))) })} aria-label="Quantity" />
                          <button className="btn-primary btn-sm" onClick={() => buy.mutate({ id: l.id, qty: buyQty[l.id] ?? Math.min(10, l.qty) })} data-testid="buy-supply">Buy</button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {tab === 'wholesaler' && (
        <div className="flex flex-col gap-2">
          <label className="label">Quantity per click: {whQty}<input type="range" min={1} max={200} value={whQty} onChange={(e) => setWhQty(Number(e.target.value))} className="w-full" /></label>
          <p className="text-sm muted">The NPC wholesaler is always open but charges a markup when selling and pays little when buying. Player deals are better!</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {[...d.needs, ...d.supplies].map((c: any) => (
              <div key={c.id} className="card-flat flex items-center gap-2 text-sm">
                <span className="text-2xl">{c.emoji}</span>
                <span className="flex-1">{c.name}</span>
                {!ro && c.wholesaleBuy && <button className="btn-primary btn-sm" onClick={() => whBuy.mutate(c.id)}>Buy @{c.wholesaleBuy}</button>}
                {!ro && <button className="btn-ghost btn-sm" onClick={() => whSell.mutate({ itemType: 'commodity', itemId: c.id })}>Sell @{c.wholesaleSell}</button>}
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === 'sell' && !ro && (
        <div className="card flex flex-col gap-2 max-w-lg">
          <select className="input" value={`${sell.itemType}:${sell.itemId}`} onChange={(e) => { const [t, ...id] = e.target.value.split(':'); setSell({ ...sell, itemType: t, itemId: id.join(':') }); }} aria-label="Item">
            <option value=":">Pick something from your stock</option>
            {stock.map((s) => <option key={`${s.itemType}:${s.itemId}`} value={`${s.itemType}:${s.itemId}`}>{s.label} (have {s.qty})</option>)}
          </select>
          <label className="label">Quantity<input type="number" className="input" min={1} value={sell.qty} onChange={(e) => setSell({ ...sell, qty: Math.max(1, Math.floor(Number(e.target.value))) })} /></label>
          <label className="label">Price per unit (BT)<input type="number" className="input" min={1} value={sell.unitPrice} onChange={(e) => setSell({ ...sell, unitPrice: Math.max(1, Math.floor(Number(e.target.value))) })} /></label>
          <label className="label">Private escrow deal for (optional)
            <select className="input" value={sell.targetId} onChange={(e) => setSell({ ...sell, targetId: e.target.value })}>
              <option value="">Anyone (public listing)</option>
              {(recipients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
            </select>
          </label>
          <p className="text-xs muted">Your goods are held in escrow while listed. Market fee applies on sale.</p>
          <button className="btn-primary" disabled={!sell.itemId || list.isPending} onClick={() => list.mutate(undefined)} data-testid="list-supply">📤 List it</button>
        </div>
      )}
      {tab === 'invoices' && <Invoices />}
      {d.history.length > 0 && (
        <div className="card">
          <div className="h3 mb-1">📈 Recent supply prices</div>
          <div className="flex flex-wrap gap-1 text-xs">{d.history.map((h: any, i: number) => <span key={i} className="chip">{h.itemKey.split(':')[1]} {h.price} BT x{h.qty}</span>)}</div>
        </div>
      )}
    </div>
  );
}

function Invoices() {
  const me = useGameMe();
  const ro = me.access.readOnly;
  const q = useApi<any[]>(['invoices'], '/game/supply/invoices');
  const recipients = useApi<any[]>(['recipients-all'], '/game/transfers/recipients', { enabled: me.access.modules.transfers });
  const [f, setF] = useState({ toCompanyId: '', amount: 100, memo: '' });
  const send = useAction(() => POST('/game/supply/invoices', f), { invalidate: [['invoices']], success: 'Invoice sent! 🧾' });
  const resolve = useAction((v: { id: string; accept: boolean }) => POST(`/game/supply/invoices/${v.id}`, { accept: v.accept }), { invalidate: [['invoices'], ['state']], success: 'Done.' });
  return (
    <div className="flex flex-col gap-3">
      {!ro && recipients.data && (
        <div className="card flex gap-2 flex-wrap items-end">
          <select className="input w-auto" value={f.toCompanyId} onChange={(e) => setF({ ...f, toCompanyId: e.target.value })} aria-label="Bill to"><option value="">Bill to...</option>{recipients.data.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</select>
          <input type="number" className="input w-28" value={f.amount} min={1} onChange={(e) => setF({ ...f, amount: Math.max(1, Math.floor(Number(e.target.value))) })} aria-label="Amount" />
          <input className="input flex-1" placeholder="For what?" value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} />
          <button className="btn-primary" disabled={!f.toCompanyId} onClick={() => send.mutate(undefined)}>Send invoice</button>
        </div>
      )}
      {!q.data?.length ? <EmptyState emoji="🧾" title="No invoices" /> : q.data.map((i) => (
        <div key={i.id} className="card-flat flex items-center gap-2 text-sm flex-wrap">
          <span>{i.incoming ? `📥 from ${i.from?.emoji} ${i.from?.name}` : `📤 to ${i.to?.emoji} ${i.to?.name}`}</span>
          <b><Bits n={i.amount} /></b><span className="muted">{i.memo}</span>
          <span className="chip ml-auto">{i.status}</span>
          {i.incoming && i.status === 'pending' && !ro && (
            <>
              <button className="btn-good btn-sm" onClick={() => resolve.mutate({ id: i.id, accept: true })}>Pay</button>
              <button className="btn-ghost btn-sm" onClick={() => resolve.mutate({ id: i.id, accept: false })}>Reject</button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// ================================================================== marketplace / auction house
export function Marketplace() {
  const me = useGameMe();
  const ro = me.access.readOnly;
  const q = useApi<any>(['market'], '/game/market', { refetchInterval: 10_000 });
  const shop = useApi<any>(['shop'], me.access.modules.decor ? '/game/shop' : null);
  const [bids, setBids] = useState<Record<string, number>>({});
  const [listOpen, setListOpen] = useState(false);
  const [f, setF] = useState({ itemRef: '', startPrice: 200, buyNowPrice: 500, hours: 24, auctionOnly: false });
  useNow(1000);
  const inv = [['market'], ['state'], ['workforce'], ['shop']];
  const bid = useAction((v: { id: string; amount: number }) => POST(`/game/market/listings/${v.id}/bid`, { amount: v.amount }), { invalidate: inv, success: 'Bid placed! Fingers crossed. 🤞' });
  const buy = useAction((id: string) => POST(`/game/market/listings/${id}/buy`), {
    invalidate: inv,
    onSuccess: () => {
      sfx.bigCoin();
      useStore.getState().confetti();
    },
  });
  const cancel = useAction((id: string) => POST(`/game/market/listings/${id}/cancel`), { invalidate: inv, success: 'Listing cancelled.' });
  const create = useAction(() => POST('/game/market/listings', { itemType: 'item', itemRef: f.itemRef, startPrice: f.startPrice, buyNowPrice: f.auctionOnly ? null : f.buyNowPrice, hours: f.hours }), { invalidate: inv, success: 'Listed!', onSuccess: () => setListOpen(false) });
  if (!q.data) return <LoadingJoke />;
  const ownedItems = (shop.data?.owned ?? []).filter((o: any) => o.kind !== 'equipment' && !o.listed);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h1 className="h1 mr-auto">🛒 Marketplace & Auction House</h1>
        {!ro && <button className="btn-primary btn-sm" onClick={() => setListOpen(true)}>➕ List a decor/pet</button>}
      </div>
      <p className="text-sm muted">Workers can be listed from their profile card. Listed things are held in escrow - no scams. Fee {q.data.feeBps / 100}%. Late bids extend the auction by 2 minutes.</p>
      {!q.data.listings.length ? <EmptyState emoji="🏷️" title="Nothing for sale" body="The auction house echoes. List something fabulous!" /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {q.data.listings.map((l: any) => {
            const min = l.highBid ? Math.ceil(l.highBid * 1.05) : l.startPrice;
            const w = l.itemType === 'worker' ? l.preview : null;
            return (
              <div key={l.id} className="card !p-3 flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  {w ? <WorkerAvatar species={w.species} color={w.appearance.color} eyes={w.appearance.eyes} accessory={w.appearance.accessory} mood={w.mood} rarity={w.rarity} size={48} /> : <span className="text-4xl">{l.preview?.def?.emoji ?? '📦'}</span>}
                  <div className="min-w-0">
                    <div className="font-bold truncate">{l.title}</div>
                    <div className="text-xs muted">by {l.seller?.emoji} {l.seller?.name}</div>
                  </div>
                </div>
                {w && <div className="text-xs"><span className="chip" style={{ background: RARITY_INFO[w.rarity as keyof typeof RARITY_INFO].color, color: '#fff' }}>{w.rarity}</span> Lv {w.level} · {w.quirkEmoji} {w.quirkName}</div>}
                <div className="text-sm">💰 {l.highBid ? <>Top bid <Bits n={l.highBid} />{l.leading && ' (you!)'}</> : <>Starts at <Bits n={l.startPrice} /></>}</div>
                {l.buyNowPrice && <div className="text-sm">⚡ Buy now <Bits n={l.buyNowPrice} /></div>}
                <div className="text-xs muted">⏳ {timeLeft(l.endsAt)}</div>
                {!ro && (l.mine ? (
                  <button className="btn-ghost btn-sm" disabled={!!l.highBidder} onClick={() => cancel.mutate(l.id)}>Cancel</button>
                ) : (
                  <div className="flex gap-1 mt-1">
                    <input type="number" className="input !min-h-[36px] w-24" min={min} value={bids[l.id] ?? min} onChange={(e) => setBids({ ...bids, [l.id]: Number(e.target.value) })} aria-label="Bid" />
                    <button className="btn-ghost btn-sm" onClick={() => bid.mutate({ id: l.id, amount: bids[l.id] ?? min })}>Bid</button>
                    {l.buyNowPrice && <button className="btn-primary btn-sm" onClick={() => buy.mutate(l.id)}>Buy</button>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {q.data.history.length > 0 && (
        <div className="card">
          <div className="h3 mb-1">📜 Recent sales</div>
          <div className="flex flex-wrap gap-1 text-xs">{q.data.history.map((h: any, i: number) => <span key={i} className="chip">{h.itemKey}: {h.price} BT</span>)}</div>
        </div>
      )}
      <Modal open={listOpen} onClose={() => setListOpen(false)} title="➕ List a decoration or pet">
        <div className="flex flex-col gap-2">
          <select className="input" value={f.itemRef} onChange={(e) => setF({ ...f, itemRef: e.target.value })}>
            <option value="">Pick an item</option>
            {ownedItems.map((o: any) => <option key={o.id} value={o.id}>{o.def?.emoji} {o.def?.name}</option>)}
          </select>
          <label className="label">Starting bid<input type="number" className="input" value={f.startPrice} min={1} onChange={(e) => setF({ ...f, startPrice: Math.max(1, Number(e.target.value)) })} /></label>
          <Toggle checked={f.auctionOnly} onChange={(v) => setF({ ...f, auctionOnly: v })} label="Auction only (no buy-it-now)" />
          {!f.auctionOnly && <label className="label">Buy-it-now price<input type="number" className="input" value={f.buyNowPrice} min={f.startPrice} onChange={(e) => setF({ ...f, buyNowPrice: Math.max(f.startPrice, Number(e.target.value)) })} /></label>}
          <label className="label">Duration (hours)<input type="number" className="input" value={f.hours} min={1} max={72} onChange={(e) => setF({ ...f, hours: Math.max(1, Math.min(72, Number(e.target.value))) })} /></label>
          <button className="btn-primary" disabled={!f.itemRef} onClick={() => create.mutate(undefined)}>List it</button>
        </div>
      </Modal>
    </div>
  );
}

// ================================================================== property & fleet
export function Property() {
  const me = useGameMe();
  const ro = me.access.readOnly;
  const q = useApi<any>(['property'], '/game/property');
  const inv = [['property'], ['state']];
  const buy = useAction((id: string) => POST(`/game/property/${id}/buy`), { invalidate: inv, onSuccess: () => { sfx.levelUp(); useStore.getState().say('You are now a property mogul! Foot traffic incoming. 🏘️'); } });
  const sell = useAction((id: string) => POST(`/game/property/${id}/sell`), { invalidate: inv, success: (r: any) => `Sold back to the bank for ${r.payout} BT.` });
  const rent = useAction((v: { id: string; on: boolean }) => POST(`/game/property/${v.id}/rent`, { on: v.on }), { invalidate: inv, success: 'Done!' });
  const veh = useAction((kind: string) => POST('/game/property/vehicles', { kind }), { invalidate: inv, success: 'Vroom! New vehicle in the fleet.' });
  if (!q.data) return <LoadingJoke />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="h1 mr-auto">🏘️ Property</h1>
        <span className="chip">🚶 Traffic bonus +{Math.round(q.data.bonus * 100)}% (best 3 plots count)</span>
      </div>
      {q.data.districts.map((d: any) => (
        <div key={d.id} className="card">
          <div className="h3">{d.name} <span className="text-xs muted">foot traffic x{d.traffic}</span></div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 mt-2">
            {d.plots.map((p: any) => (
              <div key={p.id} className={`card-flat text-xs flex flex-col gap-1 ${p.mine ? '!border-good border-[3px]' : p.renting ? '!border-accent border-[3px]' : ''}`}>
                <div className="font-bold">{p.kind === 'shopfront' ? '🏪' : p.kind === 'warehouse' ? '🏭' : '🏢'} Plot #{p.plot}</div>
                <div>💰 {formatBits(p.price)}</div>
                <div className="truncate">{p.owner ? `👑 ${p.owner.emoji} ${p.owner.name}` : 'For sale'}</div>
                {p.tenant && <div className="truncate">🧳 {p.tenant.emoji} {p.tenant.name}</div>}
                {!ro && !p.owner && <button className="btn-primary btn-sm" onClick={() => buy.mutate(p.id)}>Buy</button>}
                {!ro && p.mine && <button className="btn-ghost btn-sm" onClick={() => sell.mutate(p.id)}>Sell (85%)</button>}
                {!ro && p.owner && !p.mine && !p.tenant && <button className="btn-ghost btn-sm" onClick={() => rent.mutate({ id: p.id, on: true })}>Rent {p.rentPrice}/min</button>}
                {!ro && p.renting && <button className="btn-ghost btn-sm" onClick={() => rent.mutate({ id: p.id, on: false })}>Stop renting</button>}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="card">
        <div className="h3 mb-2">🚚 Fleet ({q.data.vehicles.length}/6)</div>
        <p className="text-xs muted mb-2">For logistics-heavy industries: vehicles boost delivery traffic.</p>
        <div className="flex flex-wrap gap-2 mb-2">{q.data.vehicles.map((v: any) => <span key={v.id} className="chip">{q.data.vehicleCatalog.find((c: any) => c.kind === v.kind)?.emoji} {v.kind}</span>)}</div>
        {!ro && <div className="flex flex-wrap gap-2">{q.data.vehicleCatalog.map((v: any) => <button key={v.kind} className="btn-ghost btn-sm" onClick={() => veh.mutate(v.kind)}>{v.emoji} {v.name} · {formatBits(v.cost)}</button>)}</div>}
      </div>
    </div>
  );
}
