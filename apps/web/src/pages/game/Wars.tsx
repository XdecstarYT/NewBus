import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { onWs } from '../../lib/ws';
import { LoadingJoke, EmptyState, Tabs, timeLeft, timeAgo, useNow } from '../../components/ui';
import { useGameMe, useCan } from './GameLayout';

function Board({ war }: { war: any }) {
  const max = Math.max(1, ...war.board.map((b: any) => b.score));
  return (
    <div className="flex flex-col gap-1">
      {war.board.map((b: any, i: number) => (
        <div key={b.sideId} className="flex items-center gap-2 text-sm">
          <span className="w-6 text-center">{war.status === 'finished' && war.winnerId === b.sideId ? '🏆' : i + 1}</span>
          <span className="w-40 truncate">{b.name}</span>
          <div className="flex-1 h-3 rounded-full bg-ink/10 overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${(b.score / max) * 100}%` }} /></div>
          <span className="w-20 text-right tabular-nums font-bold">{b.score.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function WarCard({ war, children }: { war: any; children?: React.ReactNode }) {
  useNow(1000); // re-render so countdowns tick
  return (
    <div className={`card flex flex-col gap-2 ${war.mine ? 'ring-2 ring-accent' : ''}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-2xl">{war.contestInfo.emoji}</span>
        <b className="flex-1">{war.name}</b>
        {war.status === 'active' && <span className="chip">⏱️ {timeLeft(war.endsAt)}</span>}
        {war.status === 'scheduled' && <span className="chip">Starts in {timeLeft(war.startsAt)}</span>}
        {war.status === 'finished' && <span className="chip">{timeAgo(war.endsAt)}</span>}
      </div>
      <p className="text-xs muted">{war.contestInfo.name}: most {war.contestInfo.unit} wins {formatBits(war.prize)} · consolation {formatBits(war.consolation)}</p>
      <Board war={war} />
      {children}
    </div>
  );
}

/** Business Wars + Trade Fairs. */
export function Wars() {
  const canFairs = useCan('products');
  const [tab, setTab] = useState<'wars' | 'fairs'>('wars');
  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-4">
      <h1 className="h1">⚔️ Business Wars</h1>
      {canFairs && <Tabs tabs={[{ id: 'wars', label: '⚔️ Wars' }, { id: 'fairs', label: '🎪 Trade fairs' }]} value={tab} onChange={setTab} />}
      {tab === 'wars' ? <WarsTab /> : <FairsTab />}
    </div>
  );
}

function WarsTab() {
  const me = useGameMe();
  const qc = useQueryClient();
  const q = useApi<any>(['wars'], '/game/wars', { refetchInterval: 30_000 });
  const dir = useApi<any[]>(['directory'], '/game/directory');
  const guilds = useApi<any[]>(['guild-list'], '/game/guilds/list', { enabled: !!q.data?.isGuildLeader });
  const [f, setF] = useState({ kind: 'company', targetId: '', contest: 'sprint', durationMin: 30 });
  useEffect(() => onWs('war', (m) => {
    if (m.event === 'score') qc.setQueryData(['wars'], (old: any) => old && { ...old, live: old.live.map((w: any) => (w.id === m.id ? { ...w, board: m.board } : w)) });
    else qc.invalidateQueries({ queryKey: ['wars'] });
  }), [qc]);
  const send = useAction(() => POST('/game/wars/challenge', f), { invalidate: [['wars']], success: '⚔️ Challenge sent! Waiting for them to accept.' });
  const respond = useAction((v: { id: string; accept: boolean }) => POST(`/game/wars/${v.id}/respond`, { accept: v.accept }), { invalidate: [['wars']], success: (r: any) => (r?.ok ? 'Done!' : undefined) });
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  const ro = me.access.readOnly;
  const targets = f.kind === 'guild' ? (guilds.data ?? []).filter((g) => g.id !== d.guildId) : (dir.data ?? []).filter((c) => c.id !== me.access.companyId);
  return (
    <div className="flex flex-col gap-4">
      {d.pending.length > 0 && (
        <div className="card flex flex-col gap-2">
          <div className="h3">📨 Challenges</div>
          {d.pending.map((w: any) => (
            <div key={w.id} className="card-flat flex items-center gap-2 text-sm flex-wrap">
              <span className="flex-1">{w.name} · {Math.round((w.endsAt - w.startsAt) / 60_000)} min · prize {formatBits(w.prize)}</span>
              {w.incoming ? (
                <>
                  <button className="btn-good btn-sm" disabled={ro} onClick={() => respond.mutate({ id: w.id, accept: true })} data-testid="accept-war">Accept</button>
                  <button className="btn-ghost btn-sm" disabled={ro} onClick={() => respond.mutate({ id: w.id, accept: false })}>Decline</button>
                </>
              ) : <span className="chip">⏳ waiting</span>}
            </div>
          ))}
        </div>
      )}
      <h2 className="h2">🔥 Live wars</h2>
      {!d.live.length ? <EmptyState emoji="🕊️" title="Peace reigns" body="No wars right now. Challenge a rival below!" /> : d.live.map((w: any) => <WarCard key={w.id} war={w} />)}
      <div className="card flex flex-col gap-2">
        <div className="h3">🥊 Challenge a rival</div>
        <p className="text-xs muted">Friendly contests scored on real activity. Winner gets {formatBits(d.challengePrize)} and a trophy. {d.challengesLeft} challenges left today.</p>
        <div className="grid sm:grid-cols-4 gap-2">
          <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, targetId: '' })} aria-label="War type">
            <option value="company">Company vs company</option>
            {d.isGuildLeader && <option value="guild">Guild vs guild</option>}
          </select>
          <select className="input" value={f.targetId} onChange={(e) => setF({ ...f, targetId: e.target.value })} aria-label="Opponent">
            <option value="">Opponent...</option>
            {targets.map((t: any) => <option key={t.id} value={t.id}>{t.emoji} {t.name}</option>)}
          </select>
          <select className="input" value={f.contest} onChange={(e) => setF({ ...f, contest: e.target.value })} aria-label="Contest">
            {Object.entries(d.contests).map(([k, c]: any) => <option key={k} value={k}>{c.emoji} {c.name}</option>)}
          </select>
          <select className="input" value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })} aria-label="Duration">
            {d.durations.map((m: number) => <option key={m} value={m}>{m} minutes</option>)}
          </select>
        </div>
        <button className="btn-primary self-start" disabled={ro || !f.targetId || d.challengesLeft < 1 || send.isPending} onClick={() => send.mutate(undefined)} data-testid="send-challenge">Send challenge ⚔️</button>
      </div>
      {d.trophies.length > 0 && (
        <div className="card">
          <div className="h3 mb-1">🏆 Your trophy shelf</div>
          <div className="flex flex-wrap gap-1">{d.trophies.map((t: string, i: number) => <span key={i} className="chip">{t}</span>)}</div>
        </div>
      )}
      {d.recent.length > 0 && (
        <>
          <h2 className="h2">📜 Recent results</h2>
          <div className="grid md:grid-cols-2 gap-3">{d.recent.map((w: any) => <WarCard key={w.id} war={w} />)}</div>
        </>
      )}
    </div>
  );
}

function FairsTab() {
  const me = useGameMe();
  useNow(1000); // re-render so countdowns tick
  const q = useApi<any>(['fairs'], '/game/fairs', { refetchInterval: 20_000 });
  const prods = useApi<any>(['products'], '/game/products');
  const [pick, setPick] = useState({ productId: '', qty: 10 });
  const join = useAction(() => POST('/game/fairs/join', pick), { invalidate: [['fairs'], ['products']], success: '🎪 Booth set up! Results when the fair closes.' });
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  if (!d.enabled) return <EmptyState emoji="🎪" title="No trade fairs" body="The Owner has trade fairs switched off right now." />;
  const stock = ((prods.data?.products ?? []) as any[]).filter((p) => (p.stock ?? 0) > 0);
  return (
    <div className="flex flex-col gap-4">
      {!d.fair ? (
        <EmptyState emoji="🎪" title="No fair right now" body="Fairs pop up every few hours. Stock up on your best products!" />
      ) : (
        <div className="card flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap"><b className="text-lg flex-1">🎪 {d.fair.name}</b><span className="chip">⏱️ {timeLeft(d.fair.endsAt)}</span></div>
          <p className="text-sm">Booth fee {formatBits(d.fair.boothFee)}. Units sell at {Math.round(d.config.priceBonus * 100)}% of base price. Top 3 booths split {formatBits(d.fair.prizePool)} and gain reputation. {d.fair.theme !== 'any' && <>Theme bonus for <b>{d.fair.theme}</b> products!</>}</p>
          {!d.myBooth ? (
            <div className="flex gap-2 flex-wrap items-end">
              <label className="label flex-1 min-w-[180px]">Product<select className="input" value={pick.productId} onChange={(e) => setPick({ ...pick, productId: e.target.value })}>
                <option value="">Choose from your stock...</option>
                {stock.map((p) => <option key={p.id} value={p.id}>{p.emoji} {p.name} ({p.stock} in stock, Q{p.quality ?? '?'})</option>)}
              </select></label>
              <label className="label w-28">Units<input type="number" className="input" min={1} max={d.config.maxUnits} value={pick.qty} onChange={(e) => setPick({ ...pick, qty: Math.max(1, Math.min(d.config.maxUnits, Math.floor(Number(e.target.value)))) })} /></label>
              <button className="btn-primary" disabled={me.access.readOnly || !pick.productId || join.isPending} onClick={() => join.mutate(undefined)}>Rent booth</button>
            </div>
          ) : <p className="font-bold text-good">✅ Your booth is set up!</p>}
          <div className="grid sm:grid-cols-2 gap-2">
            {d.booths.map((b: any) => (
              <div key={b.companyId} className={`card-flat text-sm ${b.mine ? 'ring-2 ring-accent' : ''}`}>{b.emoji} <b>{b.name}</b>: {b.productEmoji} {b.product} × {b.qty} (Q{b.quality})</div>
            ))}
          </div>
        </div>
      )}
      {d.past.length > 0 && (
        <div className="card flex flex-col gap-2">
          <div className="h3">📜 Past fairs</div>
          {d.past.map((f: any) => (
            <div key={f.id} className="text-sm"><b>{f.name}</b>: {(f.results ?? []).slice(0, 3).map((r: any) => `#${r.place} ${r.name}`).join(' · ') || 'no booths'}</div>
          ))}
        </div>
      )}
    </div>
  );
}
