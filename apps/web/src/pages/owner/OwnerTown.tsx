import { useState } from 'react';
import { FACILITY_IDS, FACILITIES, ITEM_IDS, formatGameDuration, type Boost, type ProjectBlueprint } from '@dw/shared/live';
import { PATCH, POST } from '../../lib/api';
import { useApi, useAction } from '../../lib/hooks';
import { itemLabel } from '../../lib/game';
import { LoadingJoke, Toggle, timeAgo } from '../../components/ui';
import { boostText } from '../play/Town';

/** The Owner's town hall: world events, boosts, town projects and Owner auctions. */
export function OwnerTown() {
  const q = useApi<any>(['owner', 'town'], '/owner/town', { refetchInterval: 20_000 });
  const o = useApi<any>(['owner', 'overview'], '/owner/overview');
  const inv = [['owner'], ['town']];
  const setEvent = useAction((event: string) => POST('/owner/town/event', { event }), { invalidate: inv, success: 'Event started. It lasts until the end of this game day.' });
  const toggle = useAction((v: boolean) => PATCH('/owner/settings', { worldEvents: v }), { invalidate: inv, success: 'Saved.' });
  const land = useAction((v: number) => PATCH('/owner/settings', { landPrice: Math.max(1, Math.floor(v || 1)) }), { invalidate: [...inv, ['world']], success: 'Land price saved.' });
  const clear = useAction((id: string) => POST(`/owner/town/boosts/${id}/clear`), { invalidate: inv, success: 'Boost switched off.' });
  const cancel = useAction((id: string) => POST(`/owner/town/projects/${id}/cancel`), { invalidate: inv, success: 'Project cancelled; everything was handed back.' });
  if (!q.data || !o.data) return <LoadingJoke />;
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">🏙️ Town</h1>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card flex flex-col gap-2">
          <div className="h3">🌦️ World event (game day {d.day})</div>
          {d.event ? <div className="text-sm"><b>{d.event.emoji} {d.event.title}</b>: {d.event.blurb}</div> : <div className="text-sm muted">None right now.</div>}
          <Toggle checked={o.data.settings.worldEvents} onChange={(v) => toggle.mutate(v)} label="A random event every game day" />
          <form className="flex items-end gap-2" onSubmit={(e) => (e.preventDefault(), land.mutate(Number(new FormData(e.currentTarget).get('land'))))}>
            <label className="label flex-1">🏡 Land price (edge plots; the town centre costs up to 2.5×)<input name="land" type="number" className="input" min={1} defaultValue={o.data.settings.landPrice} /></label>
            <button className="btn-ghost btn-sm">Save</button>
          </form>
          <label className="label">Start an event now<select className="input" value="" onChange={(e) => e.target.value && setEvent.mutate(e.target.value)} data-testid="pick-event"><option value="">Pick one...</option>{d.events.map((e: any) => <option key={e.id} value={e.id}>{e.emoji} {e.title}</option>)}</select></label>
        </div>
        <div className="card flex flex-col gap-2">
          <div className="h3">✨ Active boosts</div>
          {!d.boosts.length && <div className="text-sm muted">None.</div>}
          {d.boosts.map((b: Boost) => (
            <div key={b.id} className="flex items-center gap-2 text-sm">
              <span>{b.emoji}</span><span className="flex-1"><b>{boostText(b)}</b> · {b.label} <span className="text-xs muted">({formatGameDuration(b.until - Date.now())} left)</span></span>
              <button className="btn-ghost btn-sm" onClick={() => clear.mutate(b.id)}>Stop</button>
            </div>
          ))}
          <NewBoost />
        </div>
      </div>
      <NewProject blueprints={d.blueprints} />
      <div className="card">
        <div className="h3 mb-1">🏗️ Projects</div>
        {!d.projects.length && <div className="text-sm muted">None yet.</div>}
        {d.projects.map((p: any) => {
          const items = Object.entries(p.needItems as Record<string, number>).map(([k, v]) => `${p.haveItems[k] ?? 0}/${v} ${itemLabel(k)}`);
          return (
            <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm py-1.5 border-b border-ink/5">
              <span className="text-xl">{p.emoji}</span>
              <span className="flex-1">{p.title} · {p.haveBits}/{p.needBits} BT{items.length ? ` · ${items.join(' · ')}` : ''} <span className="text-xs muted">· {timeAgo(p.createdAt)}</span></span>
              <span className="chip text-xs">{p.status === 'open' ? `⏳ ${formatGameDuration(p.deadline - Date.now())}` : p.status === 'done' ? '✅ built' : '⌛ failed'}</span>
              {p.status === 'open' && <button className="btn-ghost btn-sm" onClick={() => cancel.mutate(p.id)}>Cancel</button>}
            </div>
          );
        })}
      </div>
      <OwnerAuction />
    </div>
  );
}

function NewProject({ blueprints }: { blueprints: ProjectBlueprint[] }) {
  const [pick, setPick] = useState(blueprints[0].id);
  const [scale, setScale] = useState(1);
  const [days, setDays] = useState(3);
  const bp = blueprints.find((b) => b.id === pick)!;
  const make = useAction(() => POST('/owner/town/projects', { blueprint: pick, scale, days }), { invalidate: [['owner', 'town'], ['town']], success: '🏗️ Project started. Everyone can chip in under 🏙️ Town.' });
  return (
    <form className="card flex flex-col gap-2" onSubmit={(e) => (e.preventDefault(), make.mutate(undefined))}>
      <div className="h3">🏗️ Start a town project</div>
      <div className="grid sm:grid-cols-3 gap-2">
        {blueprints.map((b) => (
          <button type="button" key={b.id} className={`card-flat !p-2 text-left text-sm ${pick === b.id ? 'ring-4 ring-accent' : ''}`} onClick={() => setPick(b.id)} aria-pressed={pick === b.id}>
            <div className="font-bold">{b.emoji} {b.title}</div>
            <div className="text-xs">{b.blurb}</div>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 max-w-md">
        <label className="label">Size (× the amounts)<input type="number" className="input" min={0.25} max={10} step={0.25} value={scale} onChange={(e) => setScale(Math.max(0.25, Math.min(10, Number(e.target.value) || 1)))} /></label>
        <label className="label">Game days to finish<input type="number" className="input" min={1} max={30} value={days} onChange={(e) => setDays(Math.max(1, Math.min(30, Math.floor(Number(e.target.value) || 1))))} /></label>
      </div>
      <div className="text-sm">Needs {Math.round(bp.bits * scale)} BT{Object.entries(bp.items).map(([k, v]) => ` + ${Math.max(1, Math.round((v ?? 0) * scale))} ${itemLabel(k)}`).join('')}. Reward lasts {bp.days} game days.</div>
      <button className="btn-primary self-start" disabled={make.isPending} data-testid="start-project">🏗️ Start project</button>
    </form>
  );
}

function NewBoost() {
  const [f, setF] = useState({ kind: 'output', facility: '', item: '', pct: 20, days: 1, label: '' });
  const add = useAction(() => POST('/owner/town/boosts', f), { invalidate: [['owner', 'town'], ['town']], success: '✨ Boost switched on.', onSuccess: () => setF({ ...f, label: '' }) });
  return (
    <form className="flex flex-col gap-2 border-t border-ink/10 pt-2" onSubmit={(e) => (e.preventDefault(), add.mutate(undefined))}>
      <div className="text-sm font-bold">Give the town a boost</div>
      <div className="flex flex-wrap gap-2">
        <select className="input !w-auto" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="Kind"><option value="output">Output %</option><option value="customers">Customers pay %</option><option value="regen">Energy/hour</option><option value="quests">Quest reward %</option><option value="taxfree">No sales tax</option></select>
        {f.kind === 'output' && <select className="input !w-auto" value={f.facility} onChange={(e) => setF({ ...f, facility: e.target.value })} aria-label="Facility"><option value="">Every facility</option>{FACILITY_IDS.map((x) => <option key={x} value={x}>{FACILITIES[x].name}</option>)}</select>}
        {f.kind === 'customers' && <select className="input !w-auto" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} aria-label="Item"><option value="">Everything</option>{ITEM_IDS.map((x) => <option key={x} value={x}>{itemLabel(x)}</option>)}</select>}
        {f.kind !== 'taxfree' && <input type="number" className="input !w-20" value={f.pct} onChange={(e) => setF({ ...f, pct: Math.floor(Number(e.target.value) || 0) })} aria-label="Amount" />}
        <input type="number" className="input !w-20" min={0.25} step={0.25} value={f.days} onChange={(e) => setF({ ...f, days: Math.max(0.25, Number(e.target.value) || 1) })} aria-label="Game days" title="Game days" />
      </div>
      <input className="input" maxLength={80} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Name it (shown in the news): Owner's birthday bonus!" aria-label="Boost name" />
      <button className="btn-ghost btn-sm self-start" disabled={f.label.trim().length < 2 || add.isPending}>✨ Switch on</button>
    </form>
  );
}

function OwnerAuction() {
  const [f, setF] = useState({ item: 'gadget', qty: 3, startPrice: 200, hours: 12, note: '' });
  const make = useAction(() => POST('/owner/auctions', f), { invalidate: [['auctions']], success: '🔨 Auction started. The winning bid goes to the Treasury.' });
  return (
    <form className="card flex flex-col gap-2" onSubmit={(e) => (e.preventDefault(), make.mutate(undefined))}>
      <div className="h3">🔨 Auction brand-new goods</div>
      <p className="text-xs muted">The goods are made fresh for the winner; the winning bid goes to the Treasury. A fun way to drop rare items into the game.</p>
      <div className="grid sm:grid-cols-4 gap-2">
        <label className="label">Item<select className="input" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })}>{ITEM_IDS.map((i) => <option key={i} value={i}>{itemLabel(i)}</option>)}</select></label>
        <label className="label">How many<input type="number" className="input" min={1} value={f.qty} onChange={(e) => setF({ ...f, qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} /></label>
        <label className="label">Starting price<input type="number" className="input" min={1} value={f.startPrice} onChange={(e) => setF({ ...f, startPrice: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} /></label>
        <label className="label">Game hours<input type="number" className="input" min={1} max={72} value={f.hours} onChange={(e) => setF({ ...f, hours: Math.max(1, Math.min(72, Number(e.target.value) || 1)) })} /></label>
      </div>
      <input className="input" maxLength={200} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Limited edition!" aria-label="Note" />
      <button className="btn-primary self-start" disabled={make.isPending}>🔨 Start auction</button>
    </form>
  );
}
