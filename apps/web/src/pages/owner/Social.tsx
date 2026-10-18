import { useState } from 'react';
import { formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { LoadingJoke, useConfirm, timeAgo } from '../../components/ui';

/** Owner Panel "Social" tab: schedule Business Wars, run trade fairs, manage guilds, poke the Daily Byte. */
export function SocialAdmin() {
  const confirm = useConfirm();
  const q = useApi<any>(['owner-social'], '/owner/social', { refetchInterval: 15_000 });
  const companies = useApi<any[]>(['owner-companies', ''], '/owner/companies?');
  const inv = [['owner-social']];
  const act = useAction((v: { url: string; body?: any }) => POST(v.url, v.body ?? {}), { invalidate: inv, success: 'Done.' });
  const [war, setWar] = useState({ kind: 'company', contest: 'race', sideIds: [] as string[], durationMin: 60, prize: 10000, consolation: 1500, startInMin: 0, name: '' });
  const [fair, setFair] = useState({ name: '', durationMin: 45, prizePool: 6000 });
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  const sides = war.kind === 'guild' ? d.guilds.map((g: any) => ({ id: g.id, label: `${g.emoji} ${g.name}` })) : (companies.data ?? []).map((c) => ({ id: c.id, label: `${c.emoji} ${c.name}` }));
  const toggleSide = (id: string) => setWar({ ...war, sideIds: war.sideIds.includes(id) ? war.sideIds.filter((x) => x !== id) : [...war.sideIds, id] });
  const openFair = d.fairs.find((f: any) => f.status === 'open');
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">🤝 Social: wars, fairs, guilds</h1>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card flex flex-col gap-2">
          <div className="h3">⚔️ Start a Business War</div>
          <div className="grid grid-cols-2 gap-2">
            <select className="input" value={war.kind} onChange={(e) => setWar({ ...war, kind: e.target.value, sideIds: [] })} aria-label="War kind"><option value="company">Company vs company</option><option value="guild">Guild vs guild</option></select>
            <select className="input" value={war.contest} onChange={(e) => setWar({ ...war, contest: e.target.value })} aria-label="Contest">{Object.entries(d.contests).map(([k, c]: any) => <option key={k} value={k}>{c.emoji} {c.name}</option>)}</select>
            <label className="label">Duration (min)<input type="number" className="input" value={war.durationMin} onChange={(e) => setWar({ ...war, durationMin: Math.max(5, Math.floor(Number(e.target.value))) })} /></label>
            <label className="label">Starts in (min)<input type="number" className="input" value={war.startInMin} onChange={(e) => setWar({ ...war, startInMin: Math.max(0, Math.floor(Number(e.target.value))) })} /></label>
            <label className="label">Prize<input type="number" className="input" value={war.prize} onChange={(e) => setWar({ ...war, prize: Math.max(0, Math.floor(Number(e.target.value))) })} /></label>
            <label className="label">Consolation<input type="number" className="input" value={war.consolation} onChange={(e) => setWar({ ...war, consolation: Math.max(0, Math.floor(Number(e.target.value))) })} /></label>
          </div>
          <input className="input" placeholder="Name (optional, e.g. Great Bake-Off)" value={war.name} maxLength={80} onChange={(e) => setWar({ ...war, name: e.target.value })} />
          <div className="max-h-40 overflow-y-auto card-flat flex flex-wrap gap-1">
            {sides.map((s: any) => <button key={s.id} className={`chip ${war.sideIds.includes(s.id) ? '!bg-accent !text-white' : ''}`} onClick={() => toggleSide(s.id)} aria-pressed={war.sideIds.includes(s.id)}>{s.label}</button>)}
          </div>
          <button className="btn-primary" disabled={war.sideIds.length < 2} onClick={() => act.mutate({ url: '/owner/wars', body: { ...war, name: war.name || undefined } })}>Declare war ({war.sideIds.length} sides)</button>
        </div>
        <div className="card flex flex-col gap-2">
          <div className="h3">🎪 Trade fair</div>
          {openFair ? (
            <>
              <p className="text-sm"><b>{openFair.name}</b> is open, closes {new Date(openFair.endsAt).toLocaleTimeString()}.</p>
              <button className="btn-bad self-start" onClick={() => act.mutate({ url: '/owner/fairs/close' })}>Close it now</button>
            </>
          ) : (
            <>
              <input className="input" placeholder="Name (blank = random)" value={fair.name} onChange={(e) => setFair({ ...fair, name: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <label className="label">Duration (min)<input type="number" className="input" value={fair.durationMin} onChange={(e) => setFair({ ...fair, durationMin: Math.max(5, Math.floor(Number(e.target.value))) })} /></label>
                <label className="label">Prize pool<input type="number" className="input" value={fair.prizePool} onChange={(e) => setFair({ ...fair, prizePool: Math.max(0, Math.floor(Number(e.target.value))) })} /></label>
              </div>
              <button className="btn-primary self-start" onClick={() => act.mutate({ url: '/owner/fairs', body: { ...fair, name: fair.name || undefined } })}>Open a fair</button>
            </>
          )}
          <div className="h3 mt-2">📰 Daily Byte</div>
          <div className="flex gap-1 flex-wrap">
            <button className="btn-ghost btn-sm" onClick={() => act.mutate({ url: '/owner/news/generate', body: { kind: 'report' } })}>📊 Market report</button>
            <button className="btn-ghost btn-sm" onClick={() => act.mutate({ url: '/owner/news/generate', body: { kind: 'classified' } })}>📌 Classified ad</button>
            <button className="btn-ghost btn-sm" onClick={() => act.mutate({ url: '/owner/news/generate', body: { kind: 'column' } })}>🤖 Boss Byte column</button>
          </div>
        </div>
      </div>
      <div className="card !p-0 overflow-x-auto">
        <div className="h3 p-3">⚔️ Wars</div>
        <table className="table-clean text-sm">
          <thead><tr><th>Name</th><th>Status</th><th>Leader</th><th>Prize</th><th>Ends</th><th></th></tr></thead>
          <tbody>
            {d.wars.map((w: any) => (
              <tr key={w.id}>
                <td>{w.name}</td><td>{w.status}</td><td>{w.board[0] ? `${w.board[0].name} (${w.board[0].score})` : '-'}</td><td>{formatBits(w.prize)}</td><td>{timeAgo(w.endsAt)}</td>
                <td className="whitespace-nowrap">
                  {w.status === 'active' && <button className="btn-ghost btn-sm" onClick={() => act.mutate({ url: `/owner/wars/${w.id}/end` })}>🏁 End now</button>}
                  {['pending', 'scheduled', 'active'].includes(w.status) && <button className="btn-bad btn-sm" onClick={() => act.mutate({ url: `/owner/wars/${w.id}/cancel` })}>Cancel</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card !p-0 overflow-x-auto">
        <div className="h3 p-3">🛡️ Guilds</div>
        <table className="table-clean text-sm">
          <thead><tr><th>Guild</th><th>Lv</th><th>Members</th><th>Treasury</th><th>Leader</th><th></th></tr></thead>
          <tbody>
            {d.guilds.map((g: any) => (
              <tr key={g.id}>
                <td>{g.emoji} {g.name}</td><td>{g.level}</td><td>{g.members}</td><td>{formatBits(g.treasury)}</td><td>{g.leader}</td>
                <td><button className="btn-bad btn-sm" onClick={async () => (await confirm({ title: `Disband ${g.name}?`, body: 'The treasury goes back to the Treasury.', danger: true })) && act.mutate({ url: `/owner/guilds/${g.id}/disband` })}>Disband</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
