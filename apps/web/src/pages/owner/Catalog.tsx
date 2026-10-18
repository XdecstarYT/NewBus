import { useRef, useState } from 'react';
import { formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { PATCH, POST } from '../../lib/api';
import { LoadingJoke, Modal, Tabs, Toggle } from '../../components/ui';
import { useStore } from '../../lib/store';

export function CatalogManager() {
  const [tab, setTab] = useState<'industries' | 'products' | 'market'>('industries');
  return (
    <div className="flex flex-col gap-3">
      <h1 className="h1">📚 Catalog manager</h1>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'industries', label: '🏭 Industries' }, { id: 'products', label: '📦 Products' }, { id: 'market', label: '📈 Market controls' }]} />
      {tab === 'industries' && <Industries />}
      {tab === 'products' && <ProductsManager />}
      {tab === 'market' && <MarketControls />}
    </div>
  );
}

function Industries() {
  const q = useApi<any[]>(['owner-catalog-industries'], '/owner/catalog/industries');
  const [filter, setFilter] = useState('');
  const [edit, setEdit] = useState<any>(null);
  const save = useAction((v: any) => PATCH(`/owner/catalog/industries/${v.id}`, { name: v.name, emoji: v.emoji, color: v.color, enabled: v.enabled }), { invalidate: [['owner-catalog-industries'], ['owner-industries']], success: 'Industry saved.', onSuccess: () => setEdit(null) });
  const dup = useAction((v: { id: string; name: string }) => POST(`/owner/catalog/industries/${v.id}/duplicate`, { name: v.name }), { invalidate: [['owner-catalog-industries'], ['owner-industries']], success: 'Duplicated! Edit away.' });
  if (!q.data) return <LoadingJoke />;
  const rows = q.data.filter((i) => !filter || i.name.toLowerCase().includes(filter.toLowerCase()) || i.category.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="flex flex-col gap-2">
      <input className="input" placeholder={`Search ${q.data.length} industries...`} value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="card !p-0 overflow-x-auto max-h-[70vh]">
        <table className="table-clean text-sm">
          <thead><tr><th>Industry</th><th>Category</th><th>Products</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td><span style={{ color: i.color }}>{i.emoji}</span> {i.name} {i.custom && <span className="chip">custom</span>}</td>
                <td className="text-xs">{i.category}</td>
                <td>{i.products}</td>
                <td>{i.enabled ? '🟢' : '⚪ disabled'}</td>
                <td className="whitespace-nowrap">
                  <button className="btn-ghost btn-sm" onClick={() => setEdit({ ...i })}>✏️</button>{' '}
                  <button className="btn-ghost btn-sm" onClick={() => { const name = window.prompt('Name for the copy?', `${i.name} Deluxe`); if (name) dup.mutate({ id: i.id, name }); }}>🧬</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Edit industry">
        {edit && (
          <div className="flex flex-col gap-2">
            <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} aria-label="Name" />
            <input className="input" value={edit.emoji} onChange={(e) => setEdit({ ...edit, emoji: e.target.value })} aria-label="Emoji" />
            <input type="color" value={edit.color} onChange={(e) => setEdit({ ...edit, color: e.target.value })} aria-label="Colour" />
            <Toggle checked={edit.enabled} onChange={(v) => setEdit({ ...edit, enabled: v })} label="Enabled (shown in the Company Builder)" />
            <button className="btn-primary" onClick={() => save.mutate(edit)}>Save</button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ProductsManager() {
  const [industry, setIndustry] = useState('bakery');
  const [q, setQ] = useState('');
  const inds = useApi<any[]>(['owner-catalog-industries'], '/owner/catalog/industries');
  const list = useApi<any[]>(['owner-catalog-products', industry, q], `/owner/catalog/products?industryId=${industry}&q=${encodeURIComponent(q)}`);
  const [edit, setEdit] = useState<any>(null);
  const toast = useStore((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);
  const save = useAction((v: any) => PATCH(`/owner/catalog/products/${encodeURIComponent(v.id)}`, { name: v.name, emoji: v.emoji, basePrice: v.basePrice, baseCost: v.baseCost, productionMs: v.productionMs, unlockLevel: v.unlockLevel, enabled: v.enabled }), { invalidate: [['owner-catalog-products']], success: 'Product saved.', onSuccess: () => setEdit(null) });
  const dup = useAction((v: { id: string; name: string }) => POST(`/owner/catalog/products/${encodeURIComponent(v.id)}/duplicate`, { name: v.name }), { invalidate: [['owner-catalog-products']], success: 'Duplicated.' });
  const imp = useAction((items: any[]) => POST('/owner/catalog/products-import', items), { invalidate: [['owner-catalog-products']], success: (r: any) => `Imported ${r.imported} products.` });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 flex-wrap">
        <select className="input w-auto" value={industry} onChange={(e) => setIndustry(e.target.value)} aria-label="Industry">
          {(inds.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.emoji} {i.name}</option>)}
        </select>
        <input className="input flex-1" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
        <a className="btn-ghost btn-sm" href="/api/owner/catalog/products-export">⬇️ JSON</a>
        <a className="btn-ghost btn-sm" href="/api/owner/catalog/products-export?format=csv">⬇️ CSV</a>
        <button className="btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>⬆️ Import JSON</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const data = JSON.parse(await f.text());
              imp.mutate(Array.isArray(data) ? data : [data]);
            } catch {
              toast('That file is not valid JSON.', 'bad');
            }
          }}
        />
      </div>
      {!list.data ? <LoadingJoke /> : (
        <div className="card !p-0 overflow-x-auto">
          <table className="table-clean text-sm">
            <thead><tr><th>Product</th><th>Tier</th><th>Price</th><th>Cost</th><th>Time</th><th>Lv</th><th></th></tr></thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.id} className={p.enabled ? '' : 'opacity-50'}>
                  <td>{p.emoji} {p.name}</td><td>{p.tier}</td><td>{formatBits(p.basePrice)}</td><td>{p.baseCost}</td><td>{Math.round(p.productionMs / 1000)}s</td><td>{p.unlockLevel}</td>
                  <td className="whitespace-nowrap">
                    <button className="btn-ghost btn-sm" onClick={() => setEdit({ ...p })}>✏️</button>{' '}
                    <button className="btn-ghost btn-sm" onClick={() => { const name = window.prompt('Name for the copy?', `${p.name} (Collector's Edition)`); if (name) dup.mutate({ id: p.id, name }); }}>🧬</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Edit product">
        {edit && (
          <div className="flex flex-col gap-2">
            {(['name', 'emoji'] as const).map((k) => <label key={k} className="label">{k}<input className="input" value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></label>)}
            {(['basePrice', 'baseCost', 'productionMs', 'unlockLevel'] as const).map((k) => <label key={k} className="label">{k}<input type="number" className="input" value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: Math.max(0, Math.floor(Number(e.target.value))) })} /></label>)}
            <Toggle checked={edit.enabled} onChange={(v) => setEdit({ ...edit, enabled: v })} label="Enabled" />
            <button className="btn-primary" onClick={() => save.mutate(edit)}>Save</button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function MarketControls() {
  const q = useApi<any>(['owner-market-data'], '/owner/market-data', { refetchInterval: 20_000 });
  const [f, setF] = useState({ productId: '', mult: 2, minutes: 30, label: 'fad' });
  const go = useAction(() => POST('/owner/market-controls/demand', { ...f, productId: f.productId || null }), { invalidate: [['owner-market-data']], success: 'Market nudged! Everyone will notice.' });
  if (!q.data) return <LoadingJoke />;
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="card flex flex-col gap-2">
        <div className="h3">🎛️ Trends, fads & recalls</div>
        <input className="input" placeholder="Product id (blank = all products)" value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value.trim() })} />
        <select className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value, mult: e.target.value === 'recall' ? 0.2 : 2 })}>
          <option value="fad">🔥 Fad (demand up)</option><option value="trend">📈 Trend</option><option value="recall">⚠️ Recall (demand down)</option>
        </select>
        <label className="label">Demand multiplier x{f.mult}<input type="range" min={0} max={5} step={0.1} value={f.mult} onChange={(e) => setF({ ...f, mult: Number(e.target.value) })} className="w-full" /></label>
        <label className="label">Minutes<input type="number" className="input" value={f.minutes} min={1} max={1440} onChange={(e) => setF({ ...f, minutes: Number(e.target.value) })} /></label>
        <button className="btn-primary" onClick={() => go.mutate(undefined)}>Apply</button>
        <p className="text-xs muted">Global demand, price floors/ceilings and NPC pool budget live in Flags & settings (economy.demandMultiplier, products.priceFloor/priceCeiling, economy.npcPoolRefillPerCompanyPerTick).</p>
      </div>
      <div className="card">
        <div className="h3 mb-1">📊 Product price index: {q.data.priceIndex}</div>
        <p className="text-xs muted mb-2">100 = products sell at their base price on average.</p>
        <div className="h3 mb-1">🔥 Trending (24h)</div>
        {q.data.trending.map((t: any) => <div key={t.productId} className="text-sm">{t.emoji} {t.name} · {t.units} sold @ ~{t.avgPrice} {t.trending && '🔥'}</div>)}
      </div>
      <div className="card">
        <div className="h3 mb-1">🏆 Top sellers (24h)</div>
        {q.data.topSellers.map((t: any) => <div key={t.companyId} className="text-sm">{t.emoji} {t.name} · {t.units} units · {formatBits(t.revenue)}</div>)}
      </div>
      <div className="card">
        <div className="h3 mb-1">🚩 Possible exploit loops</div>
        {!q.data.exploitSuspects.length ? <p className="text-sm muted">Nobody is dumping suspicious amounts on the wholesaler. 👍</p> : q.data.exploitSuspects.map((s: any) => <div key={s.companyId} className="text-sm">{s.companyId}: {formatBits(s.wholesale)} wholesale in 24h</div>)}
      </div>
    </div>
  );
}
