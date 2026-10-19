import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { UNION_MOVES, UNION_OFFICES, formatBits, type UnionMove, type UnionOffice } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST, PATCH } from '../../lib/api';
import { onWs } from '../../lib/ws';
import { sfx } from '../../lib/sound';
import { LoadingJoke, EmptyState, Tabs, timeAgo, timeLeft, useConfirm, useNow } from '../../components/ui';
import { useGameMe } from './GameLayout';

/** Union hall: your union if you have one, otherwise the list of unions to join or found. */
export function Unions() {
  const q = useApi<any>(['unions'], '/game/unions');
  const qc = useQueryClient();
  useEffect(() => onWs('union', () => qc.invalidateQueries({ queryKey: ['unions'] })), [qc]);
  if (!q.data) return <LoadingJoke />;
  if (q.data.mine) return <UnionHall id={q.data.mine} />;
  return <UnionList data={q.data} />;
}

export function UnionPage() {
  const { id = '' } = useParams();
  return <UnionHall id={id} />;
}

function UnionList({ data }: { data: any }) {
  const me = useGameMe();
  const [form, setForm] = useState({ name: '', emoji: '✊', motto: '', dues: 100 });
  const create = useAction(() => POST('/game/unions', form), { invalidate: [['unions']], success: '✊ Union founded! You are its first President.', onSuccess: () => sfx.levelUp() });
  const join = useAction((id: string) => POST(`/game/unions/${id}/join`), { invalidate: [['unions']], success: '✊ Welcome to the union!' });
  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <h1 className="h1">✊ Unions</h1>
      <p className="muted">Businesses band together. Every member business names a <b>rep</b> who votes in union elections and can run for <b>President</b>, <b>Vice President</b> or <b>Treasurer</b>. Officers spend the union treasury on collective moves like bargaining for lower wages, co-op marketing or a strike against a rival.</p>
      <div className="grid md:grid-cols-[1fr_320px] gap-4">
        <div className="flex flex-col gap-2">
          {!data.unions.length ? <EmptyState emoji="🪧" title="No unions yet" body="Be the first to found one!" /> : data.unions.map((u: any) => (
            <div key={u.id} className="card flex items-center gap-3 flex-wrap" data-testid={`union-${u.id}`}>
              <span className="text-3xl">{u.emoji}</span>
              <div className="flex-1 min-w-[10rem]">
                <Link to={`/unions/${u.id}`} className="font-bold underline">{u.name}</Link>
                <div className="text-xs muted">{u.motto}</div>
                <div className="text-xs">👥 {u.members} · 👑 {u.president ? `${u.president.emoji} ${u.president.name}` : 'vacant'} · 💼 {formatBits(u.treasury)} · dues {formatBits(u.dues)}/day</div>
              </div>
              <button className="btn-primary btn-sm" disabled={!u.open || me.access.readOnly || join.isPending} onClick={() => join.mutate(u.id)}>{u.open ? 'Join' : '🔒 Closed'}</button>
            </div>
          ))}
        </div>
        <div className="card flex flex-col gap-2">
          <div className="h3">🏗️ Found a union</div>
          <label className="label">Name<input className="input" maxLength={40} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Bakers United" /></label>
          <label className="label">Emoji<input className="input" maxLength={8} value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} /></label>
          <label className="label">Motto<input className="input" maxLength={120} value={form.motto} onChange={(e) => setForm({ ...form, motto: e.target.value })} placeholder="Rise together" /></label>
          <label className="label">Daily dues (BT)<input type="number" className="input" min={0} max={5000} value={form.dues} onChange={(e) => setForm({ ...form, dues: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></label>
          <button className="btn-good" disabled={form.name.trim().length < 3 || me.access.readOnly || create.isPending} onClick={() => create.mutate(undefined)} data-testid="union-create">Found it (3,000 BT)</button>
        </div>
      </div>
    </div>
  );
}

type Tab = 'members' | 'elections' | 'moves' | 'settings';

function UnionHall({ id }: { id: string }) {
  const q = useApi<any>(['union', id], `/game/unions/${id}`, { refetchInterval: 20_000 });
  const qc = useQueryClient();
  useEffect(() => onWs('union', () => qc.invalidateQueries({ queryKey: ['union', id] })), [qc, id]);
  const [tab, setTab] = useState<Tab>('elections');
  if (!q.data) return <LoadingJoke />;
  const u = q.data;
  const open = u.elections.filter((e: any) => e.status !== 'closed').length;
  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-5xl">{u.emoji}</span>
        <div className="flex-1">
          <h1 className="h1">{u.name}</h1>
          <div className="text-sm muted">{u.motto}</div>
        </div>
        <div className="card !py-2 text-center"><div className="text-xs muted">Treasury</div><div className="font-extrabold">{formatBits(u.treasury)}</div></div>
        <div className="card !py-2 text-center"><div className="text-xs muted">Influence</div><div className="font-extrabold">🏛️ {u.influence}</div></div>
        <div className="card !py-2 text-center"><div className="text-xs muted">Clout</div><div className="font-extrabold">+{u.clout}% income</div></div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(['president', 'vp', 'treasurer'] as UnionOffice[]).map((o) => (
          <div key={o} className="card !p-2 text-center">
            <div className="text-xs muted">{UNION_OFFICES[o].emoji} {UNION_OFFICES[o].label}</div>
            <div className="font-bold text-sm">{u[o] ? `${u[o].emoji} ${u[o].name}` : <span className="muted">vacant</span>}</div>
          </div>
        ))}
      </div>
      {!u.me ? (
        <div className="card text-sm">You are looking at another union. <Link to="/unions" className="underline">Back to unions</Link></div>
      ) : (
        <>
          <Tabs<Tab> tabs={[{ id: 'elections', label: `🗳️ Elections${open ? ` (${open})` : ''}` }, { id: 'members', label: `👥 Members (${u.members.length})` }, { id: 'moves', label: '✊ Moves' }, { id: 'settings', label: '⚙️ Settings' }]} value={tab} onChange={setTab} />
          {tab === 'elections' && <Elections u={u} />}
          {tab === 'members' && <Members u={u} />}
          {tab === 'moves' && <Moves u={u} />}
          {tab === 'settings' && <Settings u={u} />}
        </>
      )}
      {!u.me && <Members u={u} />}
    </div>
  );
}

function Elections({ u }: { u: any }) {
  const me = useGameMe();
  useNow(1000);
  const inv = [['union', u.id]];
  const call = useAction((office: UnionOffice) => POST('/game/union/elections', { office }), { invalidate: inv, success: '🗳️ Election called. Nominations are open!' });
  const recall = useAction((office: UnionOffice) => POST('/game/union/recall', { office }), { invalidate: inv, success: '⚠️ Vote of no confidence called (500 BT).' });
  const [pitch, setPitch] = useState('');
  const nominate = useAction((eid: string) => POST(`/game/union/elections/${eid}/nominate`, { pitch }), { invalidate: inv, success: '📣 You are on the ballot!' });
  const withdraw = useAction((eid: string) => POST(`/game/union/elections/${eid}/withdraw`), { invalidate: inv, success: 'Withdrawn.' });
  const vote = useAction((v: { eid: string; choice: string }) => POST(`/game/union/elections/${v.eid}/vote`, { choice: v.choice }), { invalidate: inv, success: '🗳️ Vote cast!' });
  const ro = me.access.readOnly;
  const isPresident = u.me.offices.includes('president');
  const myId = u.me.companyId;
  const canSpeak = u.me.isRep || me.account.role === 'COMPANY_ADMIN';
  return (
    <div className="flex flex-col gap-3">
      {!canSpeak && <div className="card !bg-amber-50 text-sm">Only your business's union rep (or the company admin) can vote and run for office.</div>}
      <div className="text-xs muted">Terms end {timeLeft(u.termEndsAt)} from now, then all three offices go to a vote.</div>
      {u.elections.length === 0 && <EmptyState emoji="🗳️" title="No elections yet" body="Elections start automatically when the term ends. The President can call one early." />}
      {u.elections.map((e: any) => {
        const isRecall = e.office === 'recall';
        const label = isRecall ? `⚠️ No confidence: ${e.target?.emoji} ${e.target?.name} as ${UNION_OFFICES[e.targetOffice as UnionOffice]?.label}` : `${UNION_OFFICES[e.office as UnionOffice].emoji} ${UNION_OFFICES[e.office as UnionOffice].label}`;
        const running = e.candidates.some((c: any) => c.id === myId);
        return (
          <div key={e.id} className="card flex flex-col gap-2" data-testid={`election-${e.id}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <b className="flex-1">{label}</b>
              <span className="chip">{e.status === 'nominating' ? `📣 nominations · voting in ${timeLeft(e.votingAt)}` : e.status === 'voting' ? `🗳️ voting · closes in ${timeLeft(e.closesAt)}` : `closed ${timeAgo(e.closesAt)}`}</span>
            </div>
            {!isRecall && (
              <div className="flex flex-col gap-1">
                {!e.candidates.length && <div className="text-sm muted">No candidates yet.</div>}
                {e.candidates.map((c: any) => (
                  <div key={c.id} className={`card-flat !p-2 flex items-center gap-2 ${e.winner?.id === c.id ? 'ring-2 ring-emerald-500' : ''}`}>
                    <span className="text-xl">{c.emoji}</span>
                    <div className="flex-1"><b className="text-sm">{c.name}</b>{c.pitch && <div className="text-xs italic muted">"{c.pitch}"</div>}</div>
                    {e.result && <b>{e.result[c.id] ?? 0} votes</b>}
                    {e.winner?.id === c.id && <span>🏆</span>}
                    {e.status === 'voting' && canSpeak && <button className={e.myVote === c.id ? 'btn-good btn-sm' : 'btn-ghost btn-sm'} disabled={ro} onClick={() => vote.mutate({ eid: e.id, choice: c.id })} aria-pressed={e.myVote === c.id}>{e.myVote === c.id ? '✅ Your vote' : 'Vote'}</button>}
                  </div>
                ))}
              </div>
            )}
            {isRecall && e.status === 'voting' && canSpeak && (
              <div className="flex gap-2">
                <button className={e.myVote === 'yes' ? 'btn-bad btn-sm' : 'btn-ghost btn-sm'} disabled={ro} onClick={() => vote.mutate({ eid: e.id, choice: 'yes' })}>👎 Remove them {e.myVote === 'yes' && '✅'}</button>
                <button className={e.myVote === 'no' ? 'btn-good btn-sm' : 'btn-ghost btn-sm'} disabled={ro} onClick={() => vote.mutate({ eid: e.id, choice: 'no' })}>👍 Keep them {e.myVote === 'no' && '✅'}</button>
              </div>
            )}
            {isRecall && e.result && <div className="text-sm">Result: {e.result.yes ?? 0} remove · {e.result.no ?? 0} keep → <b>{e.winnerId === 'yes' ? 'removed' : 'kept'}</b></div>}
            {e.status === 'nominating' && canSpeak && !isRecall && (
              running ? <button className="btn-ghost btn-sm self-start" disabled={ro} onClick={() => withdraw.mutate(e.id)}>Withdraw my candidacy</button> : (
                <div className="flex gap-2 flex-wrap">
                  <input className="input flex-1" maxLength={200} value={pitch} onChange={(ev) => setPitch(ev.target.value)} placeholder="Your campaign promise" aria-label="Campaign pitch" />
                  <button className="btn-primary btn-sm" disabled={ro} onClick={() => nominate.mutate(e.id)}>📣 Run for office</button>
                </div>
              )
            )}
            {e.status !== 'closed' && <div className="text-xs muted">{e.votesCast} vote{e.votesCast === 1 ? '' : 's'} cast so far (results stay secret until it closes).</div>}
          </div>
        );
      })}
      {canSpeak && (
        <div className="card flex flex-col gap-2">
          <div className="h3">🗳️ Call a vote</div>
          <div className="flex gap-2 flex-wrap">
            {isPresident && (['president', 'vp', 'treasurer'] as UnionOffice[]).map((o) => <button key={o} className="btn-ghost btn-sm" disabled={ro} onClick={() => call.mutate(o)}>Early election: {UNION_OFFICES[o].label}</button>)}
            {(['president', 'vp', 'treasurer'] as UnionOffice[]).filter((o) => u[o] && u[o].id !== myId).map((o) => <button key={o} className="btn-bad btn-sm" disabled={ro || u.members.length < 3} onClick={() => recall.mutate(o)} title={u.members.length < 3 ? 'Needs 3+ members' : ''}>No confidence in the {UNION_OFFICES[o].label}</button>)}
          </div>
          <p className="text-xs muted">A vote of no confidence costs 500 BT, runs for an hour and needs more yes than no votes from at least a third of members.</p>
        </div>
      )}
    </div>
  );
}

function Members({ u }: { u: any }) {
  const me = useGameMe();
  const confirm = useConfirm();
  const kick = useAction((companyId: string) => POST('/game/union/kick', { companyId }), { invalidate: [['union', u.id]], success: 'Expelled.' });
  const isPresident = u.me?.offices.includes('president');
  return (
    <div className="card flex flex-col gap-1">
      {u.members.map((m: any) => (
        <div key={m.id} className="flex items-center gap-2 text-sm py-1 border-b border-ink/5 last:border-0">
          <span className="text-xl">{m.emoji}</span>
          <div className="flex-1"><b>{m.name}</b> {m.offices.map((o: UnionOffice) => <span key={o} className="chip !text-[11px] ml-1">{UNION_OFFICES[o].emoji} {UNION_OFFICES[o].label}</span>)}<div className="text-xs muted">Rep: {m.rep} · joined {timeAgo(m.joinedAt)}{m.duesOwed ? ` · ⚠️ ${m.duesOwed} days of dues unpaid` : ''}</div></div>
          {isPresident && m.id !== u.me.companyId && <button className="btn-ghost btn-sm" disabled={me.access.readOnly} onClick={async () => (await confirm({ title: `Expel ${m.name}?`, danger: true })) && kick.mutate(m.id)}>Expel</button>}
        </div>
      ))}
    </div>
  );
}

function Moves({ u }: { u: any }) {
  const me = useGameMe();
  const dir = useApi<any[]>(['directory'], '/game/companies/directory');
  const laws = useApi<any>(['strategy'], '/game/strategy');
  const [target, setTarget] = useState('');
  const [amount, setAmount] = useState(500);
  const [lawSide, setLawSide] = useState<{ lawId: string; side: 'for' | 'against'; amount: number }>({ lawId: '', side: 'for', amount: 1 });
  const move = useAction((m: UnionMove) => POST('/game/union/move', { move: m, targetId: target || undefined, amount }), { invalidate: [['union', u.id]], success: 'Done! ✊' });
  const lobby = useAction(() => POST('/game/union/lobby', lawSide), { invalidate: [['union', u.id], ['strategy']], success: '🏛️ Union influence counted.' });
  useNow(5000);
  const offices: UnionOffice[] = u.me.offices;
  const memberIds = new Set(u.members.map((m: any) => m.id));
  const openLaws = (laws.data?.laws ?? []).filter((l: any) => l.status === 'lobbying');
  return (
    <div className="flex flex-col gap-3">
      {!offices.length && <div className="card !bg-amber-50 text-sm">Only union officers can make moves. Win an election to get the keys!</div>}
      <div className="grid md:grid-cols-2 gap-3">
        {(Object.entries(UNION_MOVES) as Array<[UnionMove, (typeof UNION_MOVES)[UnionMove]]>).map(([k, m]) => {
          const allowed = offices.includes(m.office as UnionOffice) || offices.includes('president');
          const cd = u.cooldowns[k];
          const needsTarget = k === 'strike' || k === 'grant';
          const options = (k === 'strike' ? (dir.data ?? []).filter((c) => !memberIds.has(c.id)) : u.members) as any[];
          return (
            <div key={k} className="card flex flex-col gap-2">
              <div className="flex items-center gap-2"><span className="text-2xl">{m.emoji}</span><b className="flex-1">{m.label}</b><span className="chip !text-[11px]">{UNION_OFFICES[m.office as UnionOffice].label}</span></div>
              <p className="text-sm">{m.blurb}</p>
              {m.cost > 0 && <div className="text-xs">Costs {formatBits(m.cost)} from the treasury.</div>}
              {allowed && needsTarget && (
                <select className="input" value={target} onChange={(e) => setTarget(e.target.value)} aria-label={`${m.label} target`}>
                  <option value="">Pick a company...</option>
                  {options.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                </select>
              )}
              {allowed && (k === 'grant' || k === 'lobby') && <input type="number" className="input" min={k === 'lobby' ? 100 : 1} value={amount} onChange={(e) => setAmount(Math.max(0, Math.floor(Number(e.target.value) || 0)))} aria-label={`${m.label} amount`} />}
              <button className="btn-primary btn-sm self-start" disabled={!allowed || me.access.readOnly || !!(cd && cd > Date.now()) || (needsTarget && !target) || move.isPending} onClick={() => move.mutate(k)}>
                {cd && cd > Date.now() ? `⏳ ${timeLeft(cd)}` : allowed ? 'Do it' : '🔒 Officers only'}
              </button>
            </div>
          );
        })}
      </div>
      {offices.includes('president') && (
        <div className="card flex flex-col gap-2">
          <div className="h3">🏛️ Throw union influence behind a bill</div>
          {!openLaws.length ? <p className="text-sm muted">No bills are open for lobbying.</p> : (
            <div className="flex gap-2 flex-wrap">
              <select className="input flex-1" value={lawSide.lawId} onChange={(e) => setLawSide({ ...lawSide, lawId: e.target.value })} aria-label="Bill">
                <option value="">Pick a bill...</option>
                {openLaws.map((l: any) => <option key={l.id} value={l.id}>{l.emoji} {l.title}</option>)}
              </select>
              <select className="input !w-auto" value={lawSide.side} onChange={(e) => setLawSide({ ...lawSide, side: e.target.value as 'for' | 'against' })} aria-label="Side"><option value="for">For</option><option value="against">Against</option></select>
              <input type="number" className="input !w-24" min={1} max={u.influence} value={lawSide.amount} onChange={(e) => setLawSide({ ...lawSide, amount: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} aria-label="Influence" />
              <button className="btn-primary btn-sm" disabled={!lawSide.lawId || lawSide.amount > u.influence || me.access.readOnly} onClick={() => lobby.mutate(undefined)}>Lobby</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Settings({ u }: { u: any }) {
  const me = useGameMe();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const inv = [['union', u.id], ['unions']];
  const [donation, setDonation] = useState(500);
  const [cfg, setCfg] = useState({ motto: u.motto, dues: u.dues, open: u.open });
  const donate = useAction(() => POST('/game/union/donate', { amount: donation }), { invalidate: inv, success: '💝 Thanks for chipping in!' });
  const save = useAction(() => PATCH('/game/union', cfg), { invalidate: inv, success: 'Saved.' });
  const rep = useAction((accountId: string) => POST('/game/union/rep', { accountId }), { invalidate: inv, success: 'New rep set.' });
  const resign = useAction((office: UnionOffice) => POST('/game/union/resign', { office }), { invalidate: inv, success: 'You resigned. An election has been called.' });
  const leave = useAction(() => POST('/game/union/leave'), { invalidate: inv, success: 'You left the union.', onSuccess: () => navigate('/unions') });
  const ro = me.access.readOnly;
  const isPresident = u.me.offices.includes('president');
  return (
    <div className="grid md:grid-cols-2 gap-3">
      <div className="card flex flex-col gap-2">
        <div className="h3">💝 Donate to the treasury</div>
        <div className="flex gap-2"><input type="number" className="input flex-1" min={1} value={donation} onChange={(e) => setDonation(Math.max(1, Math.floor(Number(e.target.value) || 1)))} aria-label="Donation" /><button className="btn-good" disabled={ro} onClick={() => donate.mutate(undefined)}>Donate</button></div>
        <div className="h3 mt-2">🧑‍💼 Your rep</div>
        <select className="input" value={u.me.repAccountId} disabled={ro} onChange={(e) => rep.mutate(e.target.value)} aria-label="Union rep">
          {u.logins.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <p className="text-xs muted">The rep votes for your business and runs for office.</p>
      </div>
      <div className="card flex flex-col gap-2">
        {isPresident ? (
          <>
            <div className="h3">👑 President's desk</div>
            <label className="label">Motto<input className="input" maxLength={120} value={cfg.motto} onChange={(e) => setCfg({ ...cfg, motto: e.target.value })} /></label>
            <label className="label">Daily dues (BT)<input type="number" className="input" min={0} max={5000} value={cfg.dues} onChange={(e) => setCfg({ ...cfg, dues: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.open} onChange={(e) => setCfg({ ...cfg, open: e.target.checked })} /> Open to new members</label>
            <button className="btn-primary self-start" disabled={ro} onClick={() => save.mutate(undefined)}>Save</button>
          </>
        ) : <p className="text-sm muted">Dues: {formatBits(u.dues)} a day, paid automatically. Miss three days and you are out.</p>}
        {u.me.offices.map((o: UnionOffice) => <button key={o} className="btn-ghost btn-sm self-start" disabled={ro} onClick={async () => (await confirm({ title: `Resign as ${UNION_OFFICES[o].label}?`, danger: true })) && resign.mutate(o)}>Resign as {UNION_OFFICES[o].label}</button>)}
        <button className="btn-bad btn-sm self-start mt-2" disabled={ro} onClick={async () => (await confirm({ title: `Leave ${u.name}?`, body: 'Your dues stay in the treasury.', danger: true })) && leave.mutate(undefined)}>Leave union</button>
      </div>
    </div>
  );
}
