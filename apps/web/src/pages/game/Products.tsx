import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { CUSTOMER_TYPES, formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST, PATCH } from '../../lib/api';
import { onWs } from '../../lib/ws';
import { useStore } from '../../lib/store';
import { sfx } from '../../lib/sound';
import { LoadingJoke, Tabs, ProgressBar, Modal, EmptyState, Bits, timeAgo, Toggle } from '../../components/ui';
import { BarList } from '../../components/Charts';
import { useCan, useGameMe } from './GameLayout';

const CUST = Object.fromEntries(CUSTOMER_TYPES.map((c) => [c.id, c]));

export function Products() {
  const canInv = useCan('inventory');
  const canMk = useCan('marketing');
  const [tab, setTab] = useState<'catalog' | 'production' | 'shop' | 'reviews' | 'marketing' | 'money'>('catalog');
  const q = useApi<any>(['products'], '/game/products', { refetchInterval: 10_000 });
  const qc = useQueryClient();
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    const offs = [
      onWs('production_done', (m) => {
        sfx.pop();
        toast(`🏭 Made ${m.qty}x ${m.product}!`, 'good');
        qc.invalidateQueries({ queryKey: ['products'] });
      }),
      onWs('oops', (m) => toast(m.text, 'joke', '🔥')),
    ];
    return () => offs.forEach((o) => o());
  }, [qc, toast]);
  if (q.isLoading || !q.data) return <LoadingJoke />;
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="h1 mr-auto">📦 Products & Sales</h1>
        <span className="chip">⭐ {(d.reputation / 100).toFixed(2)} reputation</span>
        {canInv && <span className="chip">🏭 Warehouse {d.warehouse.used}/{d.warehouse.capacity}</span>}
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'catalog', label: '🏷️ Products & prices' },
          { id: 'production', label: '🏭 Production' },
          { id: 'shop', label: '🛍️ Shopfront' },
          { id: 'reviews', label: '⭐ Reviews' },
          ...(canMk ? [{ id: 'marketing' as const, label: '📣 Marketing' }] : []),
          { id: 'money', label: '📊 Financials' },
        ]}
      />
      {tab === 'catalog' && <Catalog d={d} />}
      {tab === 'production' && <Production d={d} canInv={canInv} />}
      {tab === 'shop' && <Shopfront />}
      {tab === 'reviews' && <Reviews />}
      {tab === 'marketing' && <Marketing />}
      {tab === 'money' && <Financials />}
    </div>
  );
}

function Catalog({ d }: { d: any }) {
  const me = useGameMe();
  const ro = me.access.readOnly;
  const [edit, setEdit] = useState<any>(null);
  const save = useAction((v: any) => PATCH(`/game/products/${v.id}`, { price: v.price, onSale: v.onSale, autoRestock: v.autoRestock }), { invalidate: [['products']], success: 'Price tag updated! 🏷️', onSuccess: () => setEdit(null) });
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {d.products.map((p: any) => (
        <div key={p.id} className={`card !p-3 flex flex-col gap-1 ${!p.unlocked ? 'opacity-60' : ''}`}>
          <div className="flex items-center gap-2">
            <span className="text-3xl">{p.emoji}</span>
            <div className="flex-1 min-w-0">
              <div className="font-bold truncate">{p.name} {p.trending && <span className="chip !bg-accent2 !text-white">🔥 trending</span>}</div>
              <div className="text-xs muted">{p.tier} · {p.service ? 'service' : p.perishable ? 'perishable' : 'keeps forever'}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 text-xs gap-1">
            <span>🏷️ Price <b>{p.price}</b> (base {p.basePrice})</span>
            <span>📦 Stock <b>{p.stock}</b>{p.quality != null ? ` · Q${p.quality}` : ''}</span>
            <span>🧾 Sold <b>{p.sold}</b></span>
            <span>{p.onSale ? '🟢 on sale' : '⚪ hidden'}{p.autoRestock ? ` · 🤖 restock ${p.autoRestock}` : ''}</span>
          </div>
          <ProgressBar value={p.demandMeter} max={95} label="📈 Demand meter" color={p.demandMeter > 40 ? 'bg-good' : p.demandMeter > 20 ? 'bg-warn' : 'bg-bad'} />
          <div className="text-[11px] italic">{p.tip}</div>
          <div className="text-[11px] muted">Recipe: {p.recipe.map((r: any) => `${r.qty}x ${r.emoji} ${r.name} (have ${r.have})`).join(' + ') || 'none'}</div>
          {!p.unlocked ? <span className="chip mt-1">🔒 Lv {p.unlockLevel} · workplace tier {p.requiredWorkplace + 1}</span> : !ro && (
            <button className="btn-ghost btn-sm mt-1" onClick={() => setEdit({ ...p })}>🏷️ Set price & automation</button>
          )}
        </div>
      ))}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? `${edit.emoji} ${edit.name}` : ''}>
        {edit && (
          <div className="flex flex-col gap-3">
            <label className="label">Price: {edit.price} BT (allowed {edit.bounds.min}-{edit.bounds.max})
              <input type="range" min={edit.bounds.min} max={edit.bounds.max} value={edit.price} onChange={(e) => setEdit({ ...edit, price: Number(e.target.value) })} className="w-full" />
            </label>
            <div className="flex gap-2 text-xs">
              <button className="chip" onClick={() => setEdit({ ...edit, price: Math.max(edit.bounds.min, Math.round(edit.basePrice * 0.8)) })}>Sale (-20%)</button>
              <button className="chip" onClick={() => setEdit({ ...edit, price: edit.basePrice })}>Base price</button>
              <button className="chip" onClick={() => setEdit({ ...edit, price: Math.min(edit.bounds.max, Math.round(edit.basePrice * 1.5)) })}>Premium (+50%)</button>
              {edit.rivalPrice && <button className="chip" onClick={() => setEdit({ ...edit, price: Math.max(edit.bounds.min, edit.rivalPrice - 1) })}>Undercut rival ({edit.rivalPrice})</button>}
            </div>
            <Toggle checked={edit.onSale} onChange={(v) => setEdit({ ...edit, onSale: v })} label="On sale in the shopfront" />
            <label className="label">🤖 Auto-restock target (0 = off): {edit.autoRestock}
              <input type="range" min={0} max={100} step={5} value={edit.autoRestock} onChange={(e) => setEdit({ ...edit, autoRestock: Number(e.target.value) })} className="w-full" />
            </label>
            <button className="btn-primary" onClick={() => save.mutate(edit)}>Save</button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Production({ d, canInv }: { d: any; canInv: boolean }) {
  const me = useGameMe();
  const ro = me.access.readOnly;
  const [queue, setQueue] = useState<{ workplaceId: string; productId: string; qty: number } | null>(null);
  const [equipFor, setEquipFor] = useState<string | null>(null);
  const q = useAction((v: any) => POST('/game/products/queue', v), {
    invalidate: [['products'], ['state']],
    onSuccess: (r) => {
      sfx.click();
      useStore.getState().toast(r.wholesaleCost ? `Queued! Bought missing inputs for ${r.wholesaleCost} BT.` : 'Queued! The machines whirr.', 'good');
      setQueue(null);
    },
  });
  const cancel = useAction((id: string) => POST(`/game/products/jobs/${id}/cancel`), { invalidate: [['products']], success: 'Job cancelled, unused inputs returned.' });
  const buyEq = useAction((v: any) => POST('/game/products/equipment', v), { invalidate: [['products'], ['state']], success: 'Machine installed! 🛠️', onSuccess: () => setEquipFor(null) });
  const repair = useAction((id: string) => POST(`/game/products/equipment/${id}/repair`), { invalidate: [['products'], ['state']], success: 'Fixed! It purrs again.' });
  const upWh = useAction(() => POST('/game/inventory/warehouse/upgrade'), { invalidate: [['products'], ['state']], success: (r: any) => `Warehouse level ${r.level}! Room for ${r.capacity} units.` });
  const unlocked = d.products.filter((p: any) => p.unlocked);
  return (
    <div className="flex flex-col gap-4">
      {canInv && (
        <div className="card !p-3">
          <ProgressBar value={d.warehouse.used} max={d.warehouse.capacity} label={`🏭 Warehouse level ${d.warehouse.level} (${d.warehouse.used}/${d.warehouse.capacity} units)`} color={d.warehouse.used / d.warehouse.capacity > 0.9 ? 'bg-bad' : 'bg-accent'} />
          {!ro && d.warehouse.upgradeCost != null && d.warehouse.level < d.warehouse.maxLevel && (
            <button className="btn-ghost btn-sm mt-2" onClick={() => upWh.mutate(undefined)}>⬆️ Upgrade warehouse ({formatBits(d.warehouse.upgradeCost)})</button>
          )}
        </div>
      )}
      {d.workplaces.map((w: any) => (
        <div key={w.id} className="card">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="h3 mr-auto">{w.name} <span className="text-xs muted">speed x{w.speed}</span></div>
            {!ro && <button className="btn-ghost btn-sm" onClick={() => setEquipFor(w.id)}>🛠️ Machines</button>}
            {!ro && <button className="btn-primary btn-sm" disabled={!unlocked.length} onClick={() => setQueue({ workplaceId: w.id, productId: unlocked.filter((p: any) => p.requiredWorkplace <= w.kind)[0]?.id ?? '', qty: 5 })}>➕ Queue</button>}
          </div>
          <div className="flex flex-wrap gap-1 my-2">
            {w.equipment.map((e: any) => (
              <span key={e.id} className={`chip ${e.working ? '' : '!bg-bad/20'}`}>
                {e.emoji} {e.name} {!e.working && !ro && <button className="underline ml-1" onClick={() => repair.mutate(e.id)}>repair ({e.repairCost})</button>}
              </span>
            ))}
          </div>
          {w.jobs.length === 0 ? <p className="text-sm muted">Idle. The machines are getting bored.</p> : w.jobs.map((j: any) => (
            <div key={j.id} className="flex items-center gap-2 text-sm py-1">
              <span className="text-xl">{j.productEmoji}</span>
              <div className="flex-1">
                <ProgressBar value={j.done + j.progressMs / j.msPerUnit} max={j.qty} label={`${j.productName} ${j.done}/${j.qty} ${j.status === 'blocked' ? '⛔ warehouse full' : j.status === 'queued' ? '⏳ queued' : '⚙️'}`} color={j.status === 'blocked' ? 'bg-bad' : 'bg-good'} />
              </div>
              {!ro && <button className="btn-ghost btn-sm" onClick={() => cancel.mutate(j.id)}>✕</button>}
            </div>
          ))}
        </div>
      ))}
      {d.commodities.length > 0 && (
        <div className="card">
          <h3 className="h3 mb-2">🌾 Raw goods in stock</h3>
          <div className="flex flex-wrap gap-2">{d.commodities.map((c: any) => <span key={c.itemId} className="chip">{c.def?.emoji} {c.def?.name} x{c.qty}</span>)}</div>
        </div>
      )}
      <Modal open={!!queue} onClose={() => setQueue(null)} title="➕ Queue production">
        {queue && (
          <div className="flex flex-col gap-2">
            <select className="input" value={queue.productId} onChange={(e) => setQueue({ ...queue, productId: e.target.value })}>
              {unlocked.filter((p: any) => p.requiredWorkplace <= (d.workplaces.find((w: any) => w.id === queue.workplaceId)?.kind ?? 0)).map((p: any) => (
                <option key={p.id} value={p.id}>{p.emoji} {p.name} ({Math.round(p.productionMs / 1000)}s each)</option>
              ))}
            </select>
            <label className="label">Quantity: {queue.qty}<input type="range" min={1} max={50} value={queue.qty} onChange={(e) => setQueue({ ...queue, qty: Number(e.target.value) })} className="w-full" /></label>
            {(() => {
              const p = d.products.find((x: any) => x.id === queue.productId);
              if (!p) return null;
              return (
                <div className="text-sm card-flat">
                  {p.recipe.map((r: any) => (
                    <div key={r.inputId}>{r.emoji} {r.name}: need {r.qty * queue.qty}, have {r.have} {r.have < r.qty * queue.qty && r.kind === 'commodity' ? `→ auto-buy ${r.qty * queue.qty - r.have} @ ${r.wholesalePrice} BT` : ''}{r.have < r.qty * queue.qty && r.kind === 'product' ? ' ⚠️ make these first!' : ''}</div>
                  ))}
                </div>
              );
            })()}
            <button className="btn-primary" disabled={q.isPending} onClick={() => q.mutate({ ...queue, autoBuy: true })}>Start production</button>
          </div>
        )}
      </Modal>
      <Modal open={!!equipFor} onClose={() => setEquipFor(null)} title="🛠️ Machines & equipment">
        <p className="text-sm muted mb-2">Max 2 per workplace. They speed things up or raise quality, and occasionally break down in funny ways.</p>
        {d.equipmentCatalog.map((e: any) => (
          <div key={e.key} className="card-flat flex items-center gap-2 mb-2">
            <span className="text-2xl">{e.emoji}</span>
            <div className="flex-1 text-sm"><b>{e.name}</b><br />{e.speed ? `+${Math.round(e.speed * 100)}% speed ` : ''}{e.quality ? `+${e.quality} quality` : ''} · Lv {e.minLevel}</div>
            <button className="btn-primary btn-sm" onClick={() => buyEq.mutate({ workplaceId: equipFor, key: e.key })}>{formatBits(e.cost)}</button>
          </div>
        ))}
      </Modal>
    </div>
  );
}

function Shopfront() {
  const q = useApi<any[]>(['customers'], '/game/products/customers', { refetchInterval: 5000 });
  const [live, setLive] = useState<any>(null);
  useEffect(() => onWs('tick', (m) => m.sales && setLive(m.sales)), []);
  const visitors = live?.visitors ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div className="card office-floor overflow-hidden relative min-h-[180px]">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-3xl">🏪</span>
          <div className="h3">Your shopfront</div>
          {live && <span className="ml-auto chip">Last tick: {live.customers} visitors · {live.sold} sold · +{formatBits(live.revenue)}{live.broke ? ` · ${live.broke} were broke 💸` : ''}</span>}
        </div>
        <div className="flex gap-3 flex-wrap">
          <AnimatePresence>
            {visitors.map((v: any, i: number) => (
              <motion.div key={`${v.name}-${i}-${live?.revenue}`} initial={{ x: -60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ opacity: 0 }} transition={{ delay: i * 0.15 }} className="flex flex-col items-center text-center w-20">
                <span className="text-4xl">{CUST[v.type]?.emoji}</span>
                <span className="text-[10px] font-bold">{v.name}</span>
                <span className="text-[10px]">{v.bought ? `🛍️ ${v.product}${v.stars ? ` ${'⭐'.repeat(v.stars)}` : ''}` : v.broke ? '💸 broke!' : '🙅 just looking'}</span>
              </motion.div>
            ))}
          </AnimatePresence>
          {!visitors.length && <p className="text-sm muted">Waiting for customers... make sure you have stock and products on sale!</p>}
        </div>
      </div>
      <div className="card !p-0 overflow-x-auto">
        <table className="table-clean text-sm">
          <thead><tr><th>Who</th><th>Type</th><th>Bought?</th><th>When</th></tr></thead>
          <tbody>
            {(q.data ?? []).map((c) => (
              <tr key={c.id}><td>{c.name}</td><td>{CUST[c.type]?.emoji} {CUST[c.type]?.name}</td><td>{c.bought ? `✅ ${c.satisfaction ? '⭐'.repeat(c.satisfaction) : ''}` : '—'}</td><td className="text-xs">{timeAgo(c.createdAt)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Reviews() {
  const me = useGameMe();
  const ro = me.access.readOnly;
  const q = useApi<any[]>(['reviews'], '/game/products/reviews');
  const complaint = useApi<any>(['complaint'], '/game/products/complaint');
  const [reply, setReply] = useState<Record<string, string>>({});
  const send = useAction((v: { id: string; reply: string }) => POST(`/game/products/reviews/${v.id}/reply`, { reply: v.reply }), { invalidate: [['reviews'], ['complaint']], success: 'Reply posted!' });
  const answer = useAction((v: { id: string; option: string }) => POST(`/game/products/complaint/${v.id}`, { option: v.option }), {
    invalidate: [['reviews'], ['complaint'], ['products']],
    onSuccess: (r) => {
      if (r.good) {
        sfx.coin();
        useStore.getState().say('Smooth! The customer feels heard. Reputation +', 'happy');
      } else {
        sfx.error();
        useStore.getState().say('Oof. That did NOT help. Reputation took a hit.', 'sad');
      }
    },
  });
  return (
    <div className="flex flex-col gap-3">
      {complaint.data && !ro && (
        <div className="card !bg-warn/10">
          <div className="h3">☎️ Customer service mini-game</div>
          <p className="text-sm my-1">"{complaint.data.review.text}" - {complaint.data.review.customerName} ({'⭐'.repeat(complaint.data.review.stars)})</p>
          <div className="flex flex-col gap-1">
            {complaint.data.options.map((o: any) => (
              <button key={o.id} className="btn-ghost btn-sm justify-start text-left" onClick={() => answer.mutate({ id: complaint.data.review.id, option: o.id })}>{o.text}</button>
            ))}
          </div>
        </div>
      )}
      {!q.data?.length ? <EmptyState emoji="⭐" title="No reviews yet" body="Sell some products and the critics will come. They always come." /> : q.data.map((r) => (
        <div key={r.id} className="card !p-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{CUST[r.customerType]?.emoji}</span>
            <b>{r.customerName}</b><span className="text-xs muted">{CUST[r.customerType]?.name}</span>
            <span className="ml-auto">{'⭐'.repeat(r.stars)}{'☆'.repeat(5 - r.stars)}</span>
          </div>
          <div className="text-sm mt-1">{r.productEmoji} <i>{r.productName}</i>: "{r.text}"</div>
          {r.reply ? <div className="text-sm mt-1 ml-6 card-flat">↪️ {r.reply}</div> : !ro && (
            <div className="flex gap-2 mt-2">
              <input className="input !min-h-[36px]" placeholder="Reply..." value={reply[r.id] ?? ''} onChange={(e) => setReply({ ...reply, [r.id]: e.target.value })} />
              <button className="btn-ghost btn-sm" disabled={!reply[r.id]} onClick={() => send.mutate({ id: r.id, reply: reply[r.id] })}>Reply</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Marketing() {
  const me = useGameMe();
  const ro = me.access.readOnly;
  const q = useApi<any>(['marketing'], '/game/marketing');
  const [kind, setKind] = useState('billboard');
  const [minutes, setMinutes] = useState(20);
  const [slogan, setSlogan] = useState<number | null>(null);
  const start = useAction(() => POST('/game/marketing', { kind, minutes, slogan: slogan ?? 0 }), {
    invalidate: [['marketing'], ['state']],
    onSuccess: (r) => {
      if (r.viral) {
        sfx.bigCoin();
        useStore.getState().confetti();
        useStore.getState().say('YOUR SLOGAN WENT VIRAL! Traffic boosted even more! 🚀', 'wow');
      } else useStore.getState().say(`Campaign live! Traffic x${r.trafficMult.toFixed(2)}.`, 'happy');
      setSlogan(null);
    },
  });
  if (!q.data) return <LoadingJoke />;
  const k = q.data.kinds[kind];
  return (
    <div className="flex flex-col gap-4">
      {!ro && (
        <div className="card flex flex-col gap-3">
          <div className="h3">📣 Launch a campaign</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(q.data.kinds).map(([id, v]: any) => (
              <button key={id} className={`card-flat text-center ${kind === id ? '!border-ink !bg-accent/15 border-[3px]' : ''}`} onClick={() => setKind(id)}>
                <div className="text-3xl">{v.emoji}</div><div className="font-bold text-sm">{v.name}</div><div className="text-xs">x{v.trafficMult} traffic · {v.costPerMin} BT/min</div>
              </button>
            ))}
          </div>
          <label className="label">Duration: {minutes} min (cost {formatBits(k.costPerMin * minutes)})<input type="range" min={5} max={q.data.maxMinutes} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="w-full" /></label>
          <div>
            <div className="text-sm font-bold mb-1">🎲 Mini-game: pick a slogan. One of them will secretly go viral!</div>
            <div className="flex flex-col gap-1">
              {q.data.slogans.map((s: string, i: number) => <button key={i} className={`btn-sm ${slogan === i ? 'btn-pink' : 'btn-ghost'} justify-start`} onClick={() => setSlogan(i)}>"{s}"</button>)}
            </div>
          </div>
          <button className="btn-primary" disabled={slogan === null || start.isPending} onClick={() => start.mutate(undefined)}>🚀 Launch</button>
        </div>
      )}
      <div className="card">
        <div className="h3 mb-2">📈 Campaign history & ROI</div>
        {!q.data.campaigns.length ? <p className="text-sm muted">No campaigns yet.</p> : q.data.campaigns.map((c: any) => {
          const roi = c.budget ? Math.round(((c.revenueDuring - c.budget) / c.budget) * 100) : 0;
          return (
            <div key={c.id} className="flex items-center gap-2 text-sm py-1 border-b border-ink/10">
              <span>{q.data.kinds[c.kind]?.emoji} {q.data.kinds[c.kind]?.name}</span>
              <span>spent <Bits n={c.budget} /></span><span>sales <Bits n={c.revenueDuring} /></span>
              <span className={`ml-auto font-bold ${roi >= 0 ? 'text-good' : 'text-bad'}`}>{c.status === 'active' ? '🟢 live · ' : ''}ROI {roi}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Financials() {
  const [hours, setHours] = useState(24);
  const q = useApi<any>(['financials', hours], `/game/products/financials?hours=${hours}`);
  if (!q.data) return <LoadingJoke />;
  const f = q.data;
  const row = (label: string, v: number, bold = false) => (
    <div className={`flex justify-between py-1 border-b border-ink/10 ${bold ? 'font-extrabold' : ''}`}><span>{label}</span><span className={`tabular-nums ${v < 0 ? 'text-bad' : ''}`}>{formatBits(v)}</span></div>
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">{[1, 24, 168].map((h) => <button key={h} className={`btn-sm ${hours === h ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setHours(h)}>{h === 168 ? '7 days' : `${h}h`}</button>)}</div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <div className="h3 mb-2">🧾 Income statement</div>
          {row('Revenue', f.income.revenue)}
          {row('Cost of goods', -f.income.cogs)}
          {row(`Gross margin (${f.income.grossMarginPct}%)`, f.income.grossMargin, true)}
          {row('Wages & upkeep', -f.income.wagesAndUpkeep)}
          {row('Taxes & fees', -f.income.taxesAndFees)}
          {row('Other income (production, rewards...)', f.income.otherIncome)}
          {row('Other expenses', -f.income.otherExpenses)}
          {row('Net profit', f.income.profit, true)}
        </div>
        <div className="card">
          <div className="h3 mb-2">⚖️ Balance sheet</div>
          {row('Cash (all pots)', f.balance.cash)}
          {row('Inventory', f.balance.inventory)}
          {row('Property', f.balance.properties)}
          {row('Investments', f.balance.investments)}
          {row('Total assets', f.balance.assets, true)}
          {row('Loans', -f.balance.liabilities)}
          {row('Equity', f.balance.equity, true)}
          <p className="text-xs muted mt-2">These numbers feed your stock's fundamental value on the Bit Exchange.</p>
        </div>
      </div>
      <div className="card">
        <div className="h3 mb-2">Where the Bits went</div>
        <BarList items={f.byKind.filter((k: any) => k.outflow > 0).sort((a: any, b: any) => b.outflow - a.outflow).slice(0, 8).map((k: any) => ({ label: k.kind, value: k.outflow, color: 'rgb(var(--bad))' }))} />
      </div>
    </div>
  );
}
