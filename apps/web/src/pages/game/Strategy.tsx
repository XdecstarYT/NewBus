import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DISTRICTS, POLICIES, STRATEGY_ACTIONS, STRATEGY_CATEGORIES, STRATEGY_TIERS, formatBits, type StrategyAction, type StrategyCategory, type StrategyFx } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { onWs } from '../../lib/ws';
import { sfx } from '../../lib/sound';
import { LoadingJoke, EmptyState, ProgressBar, Tabs, timeAgo, timeLeft, useNow } from '../../components/ui';
import { useGameMe } from './GameLayout';

const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 1000) / 10}%`;
const pts = (v: number) => `${v > 0 ? '+' : ''}${v}`;

/** Short, readable chips for what an action or policy does. */
export function fxChips(fx: StrategyFx): Array<{ text: string; good: boolean }> {
  const out: Array<{ text: string; good: boolean }> = [];
  const add = (v: number | undefined, label: string, fmt: (n: number) => string, goodWhenUp = true) => {
    if (v) out.push({ text: `${fmt(v)} ${label}`, good: goodWhenUp ? v > 0 : v < 0 });
  };
  add(fx.income, 'income', pct);
  add(fx.traffic, 'customers', pct);
  add(fx.speed, 'speed', pct);
  add(fx.research, 'research', pct);
  add(fx.wages, 'wages', pct, false);
  add(fx.mood, 'mood', pts);
  add(fx.quality, 'quality', pts);
  add(fx.influence, 'influence', pts);
  add(fx.presence, 'presence', pts);
  add(fx.legal, 'legal', pts);
  add(fx.reputation, 'rep', pts);
  add(fx.auditRisk, 'audit risk', pts, false);
  if (fx.undeclared) out.push({ text: 'hides income', good: false });
  return out;
}

export function FxChips({ fx }: { fx: StrategyFx }) {
  return (
    <div className="flex flex-wrap gap-1">
      {fxChips(fx).map((c) => (
        <span key={c.text} className={`chip !text-[11px] ${c.good ? '!bg-emerald-100 !text-emerald-900' : '!bg-rose-100 !text-rose-900'}`}>{c.text}</span>
      ))}
    </div>
  );
}

type Tab = 'plays' | 'active' | 'policies' | 'territory' | 'bills';

/** The Strategy Room: 500 plays, policies, district territory and lobbying. */
export function Strategy() {
  const [tab, setTab] = useState<Tab>('plays');
  const qc = useQueryClient();
  const q = useApi<any>(['strategy'], '/game/strategy', { refetchInterval: 30_000 });
  useEffect(() => onWs('law', () => qc.invalidateQueries({ queryKey: ['strategy'] })), [qc]);
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  const s = d.state;
  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-4">
      <div className="flex items-end gap-3 flex-wrap">
        <h1 className="h1 flex-1">♟️ Strategy Room</h1>
        <Stat label="Influence" value={`🏛️ ${s.influence}`} />
        <Stat label="Legal" value={`⚖️ ${s.legal}`} />
        <Stat label="Audit risk" value={`🔦 ${s.auditRisk}`} warn={s.auditRisk >= 50} />
        <Stat label="Reputation" value={`⭐ ${(d.reputation / 100).toFixed(1)}`} />
      </div>
      <Tabs<Tab>
        tabs={[
          { id: 'plays', label: `🎯 Plays (${d.total})` },
          { id: 'active', label: `⏳ Running (${d.active.length}/${d.maxActive})` },
          { id: 'policies', label: '📜 Policies' },
          { id: 'territory', label: '🗺️ Territory' },
          { id: 'bills', label: `🏛️ Bills${d.laws.some((l: any) => l.status === 'lobbying') ? ' •' : ''}` },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'plays' && <Plays d={d} />}
      {tab === 'active' && <Active d={d} />}
      {tab === 'policies' && <PoliciesTab d={d} />}
      {tab === 'territory' && <Territory d={d} />}
      {tab === 'bills' && <Bills d={d} />}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`card !py-2 !px-3 text-center ${warn ? '!bg-rose-100' : ''}`}>
      <div className="text-xs muted">{label}</div>
      <div className="font-extrabold">{value}</div>
    </div>
  );
}

function Plays({ d }: { d: any }) {
  const me = useGameMe();
  const now = useNow(5000);
  const [cat, setCat] = useState<StrategyCategory | 'all'>('all');
  const [tier, setTier] = useState(0);
  const [onlyReady, setOnlyReady] = useState(true);
  const [search, setSearch] = useState('');
  const run = useAction((id: string) => POST<any>('/game/strategy/run', { actionId: id }), {
    invalidate: [['strategy'], ['state']],
    success: (r) => (r.backfired ? `🙈 ${r.note}` : `${r.action.emoji} ${r.action.name} is running!`),
    onSuccess: (r) => (r.backfired ? sfx.click() : sfx.whoosh()),
  });
  const list = useMemo(() => {
    const term = search.trim().toLowerCase();
    return STRATEGY_ACTIONS.filter((a) => (cat === 'all' || a.category === cat) && (!tier || a.tier === tier) && (!term || a.name.toLowerCase().includes(term) || a.blurb.toLowerCase().includes(term)) && (!onlyReady || (a.level <= d.level && !(d.cooldowns[a.id] > now))));
  }, [cat, tier, search, onlyReady, d.level, d.cooldowns, now]);
  const shown = list.slice(0, 120);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1 flex-wrap" role="group" aria-label="Category">
        <button className={`chip ${cat === 'all' ? '!bg-accent !text-white' : ''}`} onClick={() => setCat('all')} aria-pressed={cat === 'all'}>All</button>
        {(Object.entries(STRATEGY_CATEGORIES) as Array<[StrategyCategory, (typeof STRATEGY_CATEGORIES)[StrategyCategory]]>).map(([k, c]) => (
          <button key={k} className={`chip ${cat === k ? '!bg-accent !text-white' : ''}`} onClick={() => setCat(k)} aria-pressed={cat === k} title={c.blurb}>{c.emoji} {c.label}</button>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap items-center">
        <select className="input !w-auto" value={tier} onChange={(e) => setTier(Number(e.target.value))} aria-label="Tier">
          <option value={0}>All tiers</option>
          {STRATEGY_TIERS.map((t) => <option key={t.tier} value={t.tier}>{t.name} (level {t.level}+)</option>)}
        </select>
        <input className="input flex-1 min-w-[10rem]" placeholder="Search plays..." value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search plays" />
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={onlyReady} onChange={(e) => setOnlyReady(e.target.checked)} /> Ready now</label>
      </div>
      {cat !== 'all' && <p className="text-sm muted">{STRATEGY_CATEGORIES[cat].emoji} {STRATEGY_CATEGORIES[cat].blurb}</p>}
      <div className="text-xs muted">{list.length} plays{list.length > shown.length ? `, showing ${shown.length}` : ''}</div>
      {!shown.length ? <EmptyState emoji="🧐" title="No plays match" body="Try another category, or untick Ready now." /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {shown.map((a) => <PlayCard key={a.id} a={a} d={d} now={now} busy={run.isPending || me.access.readOnly} onRun={() => run.mutate(a.id)} />)}
        </div>
      )}
    </div>
  );
}

function PlayCard({ a, d, now, busy, onRun }: { a: StrategyAction; d: any; now: number; busy: boolean; onRun: () => void }) {
  const locked = a.level > d.level;
  const cooling = d.cooldowns[a.id] > now;
  const noInfluence = a.influenceCost > d.state.influence;
  return (
    <div className={`card-flat !p-3 flex flex-col gap-1 ${locked ? 'opacity-60' : ''}`} data-testid={`play-${a.id}`}>
      <div className="flex items-center gap-2">
        <span className="text-2xl" aria-hidden>{a.emoji}</span>
        <b className="flex-1 leading-tight text-sm">{a.name}</b>
        {a.shady && <span className="chip !text-[11px] !bg-slate-800 !text-white">🕶️ shady</span>}
      </div>
      <div className="text-xs muted">{a.blurb}</div>
      <FxChips fx={a.fx} />
      <div className="text-xs flex gap-2 flex-wrap">
        <span>💰 {formatBits(a.cost)}</span>
        {a.influenceCost > 0 && <span>🏛️ {a.influenceCost}</span>}
        <span>⏱️ {a.minutes} min</span>
        {a.risk > 0 && <span className="text-rose-700">⚠️ {Math.round(a.risk * 100)}% backfire</span>}
      </div>
      <button className="btn-primary btn-sm mt-1" disabled={busy || locked || cooling || noInfluence} onClick={onRun}>
        {locked ? `🔒 Level ${a.level}` : cooling ? `⏳ ${timeLeft(d.cooldowns[a.id])}` : noInfluence ? 'Need influence' : 'Run play'}
      </button>
    </div>
  );
}

function Active({ d }: { d: any }) {
  useNow(1000);
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="card flex flex-col gap-2">
        <div className="h3">⏳ Running now</div>
        {!d.active.length ? <p className="text-sm muted">Nothing running. Pick a play!</p> : d.active.map((r: any) => (
          <div key={r.id} className="card-flat !p-2 flex flex-col gap-1">
            <div className="flex gap-2 items-center"><span className="text-xl">{r.action?.emoji}</span><b className="flex-1 text-sm">{r.action?.name}</b><span className="text-xs">{timeLeft(r.endsAt)}</span></div>
            <ProgressBar value={Date.now() - r.startedAt} max={r.endsAt - r.startedAt} />
            {r.backfired && <div className="text-xs text-rose-700">🙈 {r.note}</div>}
          </div>
        ))}
      </div>
      <div className="card flex flex-col gap-1">
        <div className="h3">📒 Recent plays</div>
        {!d.recent.length ? <p className="text-sm muted">No plays yet.</p> : d.recent.map((r: any) => (
          <div key={r.id} className="flex text-sm gap-2"><span>{r.emoji}</span><span className="flex-1">{r.name}{r.backfired ? ' 🙈' : ''}</span><span className="muted text-xs">{formatBits(r.cost)} · {timeAgo(r.startedAt)}</span></div>
        ))}
      </div>
    </div>
  );
}

function PoliciesTab({ d }: { d: any }) {
  const me = useGameMe();
  const set = useAction((v: { key: string; value: string }) => POST('/game/strategy/policy', v), { invalidate: [['strategy']], success: 'Policy changed.' });
  const cooldown = d.state.policyChangedAt ? d.state.policyChangedAt + 3600_000 : 0;
  useNow(5000);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm muted">Policies are permanent stances. You can change one per hour{cooldown > Date.now() ? ` (next change in ${timeLeft(cooldown)})` : ''}.</p>
      <div className="grid md:grid-cols-3 gap-3">
        {(Object.entries(POLICIES) as Array<[string, any]>).map(([key, p]) => (
          <div key={key} className="card flex flex-col gap-2">
            <div className="h3">{p.emoji} {p.label}</div>
            {Object.entries(p.options).map(([opt, o]: any) => {
              const on = d.state.policies[key] === opt;
              return (
                <button key={opt} className={`card-flat !p-2 text-left ${on ? 'ring-2 ring-accent' : ''}`} disabled={on || me.access.readOnly || set.isPending || cooldown > Date.now()} onClick={() => set.mutate({ key, value: opt })} aria-pressed={on}>
                  <b>{o.label}</b> {on && '✅'}
                  <div className="text-xs muted">{o.blurb}</div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Territory({ d }: { d: any }) {
  const me = useGameMe();
  const focus = useAction((district: string) => POST('/game/strategy/focus', { district }), { invalidate: [['strategy']], success: 'Focus district set. Expansion plays now build presence there.' });
  const myId = me.access.companyId;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm muted">Expansion and some marketing plays add presence in your <b>focus district</b>. Hold the biggest share (35%+) to control it: each district you control gives +5% customers (up to 3). Presence fades over time, so defend your turf!</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {d.districts.map((x: any) => {
          const owner = x.top.find((t: any) => t.companyId === x.controller);
          const isFocus = d.state.focusDistrict === x.id;
          const mine = x.controller === myId;
          return (
            <div key={x.id} className={`card !p-3 flex flex-col gap-1 ${mine ? 'ring-2 ring-emerald-500' : ''}`} style={owner ? { borderColor: owner.color } : undefined} data-testid={`district-${x.id}`}>
              <div className="flex items-center gap-1"><span className="text-2xl">{x.emoji}</span><b className="flex-1">{x.name}</b>{isFocus && <span className="chip !text-[11px]">🎯 focus</span>}</div>
              <div className="text-xs">{owner ? <>👑 {owner.emoji} {owner.name}</> : <span className="muted">Up for grabs</span>}</div>
              {x.top.slice(0, 3).map((t: any) => (
                <div key={t.companyId} className="text-xs flex items-center gap-1">
                  <span className="w-20 truncate">{t.emoji} {t.name}</span>
                  <div className="flex-1 h-2 rounded bg-ink/10 overflow-hidden"><div className="h-full" style={{ width: `${t.share}%`, background: t.color }} /></div>
                  <span className="w-10 text-right">{t.share}%</span>
                </div>
              ))}
              <div className="text-xs muted">You: {x.mine} pts ({x.myShare}%)</div>
              {!isFocus && <button className="btn-ghost btn-sm" disabled={me.access.readOnly} onClick={() => focus.mutate(x.id)}>Focus here</button>}
            </div>
          );
        })}
      </div>
      {!DISTRICTS.length && <EmptyState title="No districts" />}
    </div>
  );
}

function Bills({ d }: { d: any }) {
  const me = useGameMe();
  const [amt, setAmt] = useState<Record<string, number>>({});
  const lobby = useAction((v: { id: string; side: 'for' | 'against'; influence: number }) => POST(`/game/laws/${v.id}/lobby`, { side: v.side, influence: v.influence }), { invalidate: [['strategy']], success: '🏛️ Your influence is counted.' });
  useNow(10_000);
  if (!d.laws.length) return <EmptyState emoji="🏛️" title="No bills yet" body="When the Owner proposes a law, lobby for or against it here with your influence." />;
  return (
    <div className="flex flex-col gap-3">
      {d.laws.map((l: any) => {
        const open = l.status === 'lobbying';
        const total = l.support + l.oppose;
        const n = amt[l.id] ?? 1;
        return (
          <div key={l.id} className="card flex flex-col gap-2" data-testid={`law-${l.id}`}>
            <div className="flex items-center gap-2 flex-wrap"><span className="text-2xl">{l.emoji}</span><b className="flex-1">{l.title}</b><span className="chip">{open ? `⏳ ${timeLeft(l.closesAt)}` : l.status === 'passed' ? '✅ passed' : l.status === 'vetoed' ? '⛔ vetoed' : '❌ failed'}</span></div>
            <p className="text-sm">{l.blurb}</p>
            <div className="flex items-center gap-2 text-sm">
              <span>👍 {l.support}</span>
              <div className="flex-1 h-3 rounded bg-rose-300 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${total ? (l.support / total) * 100 : 50}%` }} /></div>
              <span>{l.oppose} 👎</span>
            </div>
            {l.mySide && <div className="text-xs">You lobbied <b>{l.mySide}</b> with {l.myInfluence} influence.</div>}
            {open && (
              <div className="flex gap-2 flex-wrap items-center">
                <input type="number" className="input !w-24" min={1} max={d.state.influence} value={n} onChange={(e) => setAmt({ ...amt, [l.id]: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} aria-label="Influence to spend" />
                {l.mySide !== 'against' && <button className="btn-good btn-sm" disabled={me.access.readOnly || n > d.state.influence} onClick={() => lobby.mutate({ id: l.id, side: 'for', influence: n })}>👍 Lobby for</button>}
                {l.mySide !== 'for' && <button className="btn-bad btn-sm" disabled={me.access.readOnly || n > d.state.influence} onClick={() => lobby.mutate({ id: l.id, side: 'against', influence: n })}>👎 Lobby against</button>}
                <span className="text-xs muted">You have {d.state.influence} influence. Earn more with 🏛️ Lobbying plays.</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
