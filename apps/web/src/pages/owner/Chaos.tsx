import { useState } from 'react';
import { formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { LoadingJoke, useConfirm, timeAgo, timeLeft, useNow } from '../../components/ui';

/** Owner Panel "Chaos & Seasons": global fun buttons and the season manager. */
export function ChaosControls() {
  const confirm = useConfirm();
  useNow(5000); // re-render so countdowns tick
  const q = useApi<any>(['owner-chaos'], '/owner/chaos', { refetchInterval: 10_000 });
  const seasons = useApi<any>(['owner-seasons'], '/owner/seasons', { refetchInterval: 30_000 });
  const companies = useApi<any[]>(['owner-companies', ''], '/owner/companies?');
  const inv = [['owner-chaos'], ['owner-seasons']];
  const act = useAction((v: { url: string; body?: any }) => POST(v.url, v.body ?? {}), { invalidate: inv, success: '💥 Chaos delivered.' });
  const [rain, setRain] = useState(250);
  const [dbl, setDbl] = useState({ minutes: 60, mult: 2 });
  const [say, setSay] = useState('');
  const [legend, setLegend] = useState('');
  const [ev, setEv] = useState({ target: 'all', eventId: '' });
  const [season, setSeason] = useState({ name: '', theme: 'classic', days: 14 });
  if (!q.data || !seasons.data) return <LoadingJoke />;
  const d = q.data;
  const active = seasons.data.active;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">🌪️ Chaos Controls & Seasons</h1>
      <p className="text-sm muted">{d.activeCompanies} companies active in the last 24h. Every button is logged in the audit log.</p>
      {d.activeGlobal.length > 0 && (
        <div className="card flex flex-wrap gap-2 text-sm">
          <b>Live now:</b>
          {d.activeGlobal.map((m: any, i: number) => <span key={i} className="chip">{m.source} · {m.kind} ×{m.value} · {timeLeft(m.expiresAt)}</span>)}
        </div>
      )}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="card flex flex-col gap-2">
          <div className="h3">🌧️💰 Credit Rain</div>
          <p className="text-xs muted">Every active company gets this many Bits (from the Treasury).</p>
          <input type="number" className="input" min={1} max={d.limits.creditRainMax} value={rain} onChange={(e) => setRain(Math.max(1, Math.min(d.limits.creditRainMax, Math.floor(Number(e.target.value)))))} aria-label="Bits per company" />
          <p className="text-xs">Total ≈ {formatBits(rain * d.activeCompanies)}</p>
          <button className="btn-good" onClick={async () => (await confirm({ title: 'Make it rain?', body: `${d.activeCompanies} companies × ${rain} BT.` })) && act.mutate({ url: '/owner/chaos/rain', body: { amount: rain } })} data-testid="chaos-rain">Make it rain!</button>
        </div>
        <div className="card flex flex-col gap-2">
          <div className="h3">⚡ Double-Bits Hour</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="label">Minutes<input type="number" className="input" min={1} max={d.limits.doubleBitsMaxMinutes} value={dbl.minutes} onChange={(e) => setDbl({ ...dbl, minutes: Math.floor(Number(e.target.value)) })} /></label>
            <label className="label">Multiplier<select className="input" value={dbl.mult} onChange={(e) => setDbl({ ...dbl, mult: Number(e.target.value) })}>{[1.5, 2, 3].map((m) => <option key={m} value={m}>×{m}</option>)}</select></label>
          </div>
          <button className="btn-primary" onClick={() => act.mutate({ url: '/owner/chaos/double', body: dbl })}>Flip the big lever</button>
        </div>
        <div className="card flex flex-col gap-2">
          <div className="h3">📢 Boss Byte broadcast</div>
          <textarea className="input min-h-[70px]" maxLength={280} placeholder="Pizza party at noon! 🍕" value={say} onChange={(e) => setSay(e.target.value)} aria-label="Broadcast text" />
          <div className="flex gap-2">
            <button className="btn-primary flex-1" disabled={!say.trim()} onClick={() => act.mutate({ url: '/owner/chaos/broadcast', body: { text: say } })}>Broadcast</button>
            <button className="btn-ghost" disabled={!say.trim()} onClick={() => act.mutate({ url: '/owner/chaos/broadcast', body: { text: say, news: true } })}>+ Daily Byte</button>
          </div>
        </div>
        <div className="card flex flex-col gap-2">
          <div className="h3">🌟 Spawn a Legendary worker</div>
          <select className="input" value={legend} onChange={(e) => setLegend(e.target.value)} aria-label="Company"><option value="">Pick a lucky company...</option>{(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</select>
          <button className="btn-primary" disabled={!legend} onClick={() => act.mutate({ url: '/owner/chaos/legendary', body: { companyId: legend } })}>Summon ✨</button>
        </div>
        <div className="card flex flex-col gap-2">
          <div className="h3">🎲 Trigger an office event</div>
          <select className="input" value={ev.target} onChange={(e) => setEv({ ...ev, target: e.target.value })} aria-label="Target"><option value="all">Every active company</option>{(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</select>
          <select className="input" value={ev.eventId} onChange={(e) => setEv({ ...ev, eventId: e.target.value })} aria-label="Event"><option value="">Random event</option>{d.officeEvents.map((e: any) => <option key={e.id} value={e.id}>{e.emoji} {e.title}</option>)}</select>
          <button className="btn-primary" onClick={() => act.mutate({ url: '/owner/chaos/event', body: { target: ev.target, eventId: ev.eventId || null } })}>Unleash</button>
        </div>
        <div className="card flex flex-col gap-2">
          <div className="h3">📉📈 Market crash or boom</div>
          <div className="flex flex-col gap-1">
            {d.marketEvents.map((m: any) => <button key={m.key} className="btn-ghost btn-sm justify-start" title={m.text} onClick={() => act.mutate({ url: '/owner/chaos/market', body: { key: m.key } })}>{m.emoji} {m.label}</button>)}
          </div>
        </div>
      </div>

      <h2 className="h2 mt-2">🏁 Season manager</h2>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card flex flex-col gap-2">
          {active ? (
            <>
              <div className="h3">🟢 {active.name} is running</div>
              <p className="text-sm">Theme: {active.theme} · started {timeAgo(active.startsAt)} · ends in {timeLeft(active.endsAt)}</p>
              <p className="text-xs muted">When it ends the top 10 by season earnings get Treasury prizes, the top 3 get titles, and the results go into the Hall of Fame.</p>
              <button className="btn-bad self-start" onClick={async () => (await confirm({ title: `End ${active.name} now?`, body: 'Prizes are paid immediately.', danger: true })) && act.mutate({ url: '/owner/seasons/end' })}>End season now</button>
            </>
          ) : (
            <>
              <div className="h3">Start a new season</div>
              <input className="input" placeholder="Name (e.g. Spooky Season)" maxLength={60} value={season.name} onChange={(e) => setSeason({ ...season, name: e.target.value })} aria-label="Season name" />
              <input className="input" placeholder="Theme" maxLength={40} value={season.theme} onChange={(e) => setSeason({ ...season, theme: e.target.value })} aria-label="Theme" />
              <label className="label">Length (days)<input type="number" className="input" min={1} max={180} value={season.days} onChange={(e) => setSeason({ ...season, days: Math.max(1, Math.floor(Number(e.target.value))) })} /></label>
              <button className="btn-good self-start" onClick={() => act.mutate({ url: '/owner/seasons/start', body: season })} data-testid="season-start">🏁 Start season</button>
            </>
          )}
        </div>
        <div className="card">
          <div className="h3 mb-2">🏛️ Hall of Fame</div>
          {!seasons.data.all.filter((s: any) => s.status === 'finished').length ? <p className="text-sm muted">No finished seasons yet.</p> : seasons.data.all.filter((s: any) => s.status === 'finished').map((s: any) => (
            <div key={s.id} className="text-sm py-1"><b>#{s.number} {s.name}</b>: {(s.winners ?? []).slice(0, 3).map((w: any) => `${['🥇', '🥈', '🥉'][w.place - 1]} ${w.name}`).join('  ') || 'no winners'}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
