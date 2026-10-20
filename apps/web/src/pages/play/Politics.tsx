import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CASE_KINDS, EVIDENCE_KINDS, FEATURES, UNION_OFFICES, type CaseKind, type EvidenceKind, type Feature, type UnionOffice } from '@dw/shared/live';
import { POST, PATCH } from '../../lib/api';
import { useApi, useAction } from '../../lib/hooks';
import { formatBits } from '../../lib/game';
import { sfx } from '../../lib/sound';
import { EmptyState, LoadingJoke, Tabs, timeAgo, timeLeft, useConfirm, useNow } from '../../components/ui';
import { CompanyPicker } from './Company';
import { useMe2 } from '../Layout';

const OFFICES = Object.keys(UNION_OFFICES) as UnionOffice[];

// ============================================================ unions
export function Unions() {
  const q = useApi<any>(['unions'], '/game/unions');
  if (!q.data) return <LoadingJoke />;
  if (q.data.mine) return <UnionHall id={q.data.mine} />;
  return <UnionList data={q.data} />;
}
export function UnionPage() {
  return <UnionHall id={useParams().id ?? ''} />;
}

function UnionList({ data }: { data: any }) {
  const [f, setF] = useState({ name: '', emoji: '✊', motto: '', dues: 50 });
  const create = useAction(() => POST('/game/unions', f), { invalidate: [['unions']], success: '✊ Union founded! You are its first President.', onSuccess: () => sfx.levelUp() });
  const join = useAction((id: string) => POST(`/game/unions/${id}/join`), { invalidate: [['unions']], success: '✊ Welcome to the union!' });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">✊ Unions</h1>
      <p className="muted text-sm">Companies band together. Each company names a <b>rep</b> who votes and can run for <b>President</b>, <b>Vice President</b> or <b>Treasurer</b>. Members pay daily dues into a treasury and trade with each other at <b>half the sales tax</b>.</p>
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
              <button className="btn-primary btn-sm" disabled={!u.open} onClick={() => join.mutate(u.id)}>{u.open ? 'Join' : '🔒 Closed'}</button>
            </div>
          ))}
        </div>
        <div className="card flex flex-col gap-2">
          <div className="h3">🏗️ Found a union</div>
          <label className="label">Name<input className="input" maxLength={40} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="label">Emoji<input className="input" maxLength={8} value={f.emoji} onChange={(e) => setF({ ...f, emoji: e.target.value })} /></label>
          <label className="label">Motto<input className="input" maxLength={120} value={f.motto} onChange={(e) => setF({ ...f, motto: e.target.value })} /></label>
          <label className="label">Daily dues (BT)<input type="number" className="input" min={0} value={f.dues} onChange={(e) => setF({ ...f, dues: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></label>
          <button className="btn-good" disabled={f.name.trim().length < 3 || create.isPending} onClick={() => create.mutate(undefined)} data-testid="union-create">Found it (500 BT to the Treasury)</button>
        </div>
      </div>
    </div>
  );
}

type UTab = 'elections' | 'members' | 'treasury';

function UnionHall({ id }: { id: string }) {
  const q = useApi<any>(['union', id], `/game/unions/${id}`, { refetchInterval: 20_000 });
  const [tab, setTab] = useState<UTab>('elections');
  if (!q.data) return <LoadingJoke />;
  const u = q.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-5xl">{u.emoji}</span>
        <div className="flex-1"><h1 className="h1">{u.name}</h1><div className="text-sm muted">{u.motto}</div></div>
        <div className="card !py-2 text-center"><div className="text-xs muted">Treasury</div><div className="font-extrabold">{formatBits(u.treasury)}</div></div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {OFFICES.map((o) => (
          <div key={o} className="card !p-2 text-center">
            <div className="text-xs muted">{UNION_OFFICES[o].emoji} {UNION_OFFICES[o].label}</div>
            <div className="font-bold text-sm">{u[o === 'president' ? 'president' : o === 'vp' ? 'vp' : 'treasurer'] ? `${u[o].emoji} ${u[o].name}` : <span className="muted">vacant</span>}</div>
          </div>
        ))}
      </div>
      {!u.me ? (
        <>
          <div className="card text-sm">You are looking at another union. <Link to="/unions" className="underline">Back</Link></div>
          <Members u={u} />
        </>
      ) : (
        <>
          <Tabs<UTab> tabs={[{ id: 'elections', label: '🗳️ Elections' }, { id: 'members', label: `👥 Members (${u.members.length})` }, { id: 'treasury', label: '💼 Treasury & settings' }]} value={tab} onChange={setTab} />
          {tab === 'elections' && <Elections u={u} />}
          {tab === 'members' && <Members u={u} />}
          {tab === 'treasury' && <UnionSettings u={u} />}
        </>
      )}
    </div>
  );
}

function Elections({ u }: { u: any }) {
  useNow(1000);
  const inv = [['union', u.id]];
  const call = useAction((office: UnionOffice) => POST('/game/union/elections', { office }), { invalidate: inv, success: '🗳️ Election called. Nominations are open!' });
  const recall = useAction((office: UnionOffice) => POST('/game/union/recall', { office }), { invalidate: inv, success: '⚠️ Vote of no confidence called (100 BT).' });
  const [pitch, setPitch] = useState('');
  const nominate = useAction((eid: string) => POST(`/game/union/elections/${eid}/nominate`, { pitch }), { invalidate: inv, success: '📣 You are on the ballot!' });
  const withdraw = useAction((eid: string) => POST(`/game/union/elections/${eid}/withdraw`), { invalidate: inv });
  const vote = useAction((v: { eid: string; choice: string }) => POST(`/game/union/elections/${v.eid}/vote`, { choice: v.choice }), { invalidate: inv, success: '🗳️ Vote cast!' });
  const speak = u.me.canSpeak;
  const myId = u.me.companyId;
  return (
    <div className="flex flex-col gap-3">
      {!speak && <div className="card !bg-amber-50 text-sm">Only your company's union rep (or the admin) votes and runs for office.</div>}
      <div className="text-xs muted">The term ends in {timeLeft(u.termEndsAt)}; then all three offices go to a vote.</div>
      {!u.elections.length && <EmptyState emoji="🗳️" title="No elections yet" body="They start when the term ends. The President can call one early." />}
      {u.elections.map((e: any) => {
        const isRecall = e.office === 'recall';
        const running = e.candidates.some((c: any) => c.id === myId);
        return (
          <div key={e.id} className="card flex flex-col gap-2" data-testid={`election-${e.id}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <b className="flex-1">{isRecall ? `⚠️ No confidence in the ${UNION_OFFICES[e.targetOffice as UnionOffice]?.label} (${e.target?.emoji} ${e.target?.name})` : `${UNION_OFFICES[e.office as UnionOffice].emoji} ${UNION_OFFICES[e.office as UnionOffice].label}`}</b>
              <span className="chip">{e.status === 'nominating' ? `📣 nominations · voting in ${timeLeft(e.votingAt)}` : e.status === 'voting' ? `🗳️ voting · ${timeLeft(e.closesAt)} left` : `closed ${timeAgo(e.closesAt)}`}</span>
            </div>
            {!isRecall && e.candidates.map((c: any) => (
              <div key={c.id} className={`card-flat !p-2 flex items-center gap-2 ${e.winnerId === c.id ? 'ring-2 ring-emerald-500' : ''}`}>
                <span className="text-xl">{c.emoji}</span>
                <div className="flex-1"><b className="text-sm">{c.name}</b>{c.pitch && <div className="text-xs italic muted">"{c.pitch}"</div>}</div>
                {e.result && <b>{e.result[c.id] ?? 0} votes</b>}
                {e.status === 'voting' && speak && <button className={e.myVote === c.id ? 'btn-good btn-sm' : 'btn-ghost btn-sm'} onClick={() => vote.mutate({ eid: e.id, choice: c.id })}>{e.myVote === c.id ? '✅ Your vote' : 'Vote'}</button>}
              </div>
            ))}
            {!isRecall && !e.candidates.length && <div className="text-sm muted">No candidates yet.</div>}
            {isRecall && e.status === 'voting' && speak && (
              <div className="flex gap-2">
                <button className={e.myVote === 'yes' ? 'btn-bad btn-sm' : 'btn-ghost btn-sm'} onClick={() => vote.mutate({ eid: e.id, choice: 'yes' })}>👎 Remove them</button>
                <button className={e.myVote === 'no' ? 'btn-good btn-sm' : 'btn-ghost btn-sm'} onClick={() => vote.mutate({ eid: e.id, choice: 'no' })}>👍 Keep them</button>
              </div>
            )}
            {isRecall && e.result && <div className="text-sm">{e.result.yes ?? 0} remove · {e.result.no ?? 0} keep → <b>{e.winnerId === 'yes' ? 'removed' : 'kept'}</b></div>}
            {e.status === 'nominating' && speak && !isRecall && (running ? <button className="btn-ghost btn-sm self-start" onClick={() => withdraw.mutate(e.id)}>Withdraw</button> : (
              <div className="flex gap-2"><input className="input flex-1" maxLength={200} value={pitch} onChange={(ev) => setPitch(ev.target.value)} placeholder="Your campaign promise" aria-label="Campaign pitch" /><button className="btn-primary btn-sm" onClick={() => nominate.mutate(e.id)}>📣 Run</button></div>
            ))}
            {e.status !== 'closed' && <div className="text-xs muted">{e.votesCast} vote{e.votesCast === 1 ? '' : 's'} cast (secret until it closes)</div>}
          </div>
        );
      })}
      {speak && (
        <div className="card flex gap-2 flex-wrap">
          {u.me.offices.includes('president') && OFFICES.map((o) => <button key={o} className="btn-ghost btn-sm" onClick={() => call.mutate(o)}>Early election: {UNION_OFFICES[o].label}</button>)}
          {OFFICES.filter((o) => u[o] && u[o].id !== myId).map((o) => <button key={o} className="btn-bad btn-sm" disabled={u.members.length < 3} onClick={() => recall.mutate(o)}>No confidence in the {UNION_OFFICES[o].label}</button>)}
        </div>
      )}
    </div>
  );
}

function Members({ u }: { u: any }) {
  const confirm = useConfirm();
  const kick = useAction((companyId: string) => POST('/game/union/kick', { companyId }), { invalidate: [['union', u.id]], success: 'Expelled.' });
  return (
    <div className="card flex flex-col gap-1">
      {u.members.map((m: any) => (
        <div key={m.id} className="flex items-center gap-2 text-sm py-1 border-b border-ink/5 last:border-0">
          <span className="text-xl">{m.emoji}</span>
          <div className="flex-1"><b>{m.name}</b> {m.offices.map((o: UnionOffice) => <span key={o} className="chip !text-[11px] ml-1">{UNION_OFFICES[o].emoji} {UNION_OFFICES[o].label}</span>)}<div className="text-xs muted">Rep: {m.rep} · joined {timeAgo(m.joinedAt)}{m.duesOwed ? ` · ⚠️ ${m.duesOwed} days of dues unpaid` : ''}</div></div>
          {u.me?.offices.includes('president') && m.id !== u.me.companyId && <button className="btn-ghost btn-sm" onClick={async () => (await confirm({ title: `Expel ${m.name}?`, danger: true })) && kick.mutate(m.id)}>Expel</button>}
        </div>
      ))}
    </div>
  );
}

function UnionSettings({ u }: { u: any }) {
  const me = useMe2();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const team = useApi<any[]>(['team'], '/game/team');
  const inv = [['union', u.id], ['unions'], ['home'], ['me']];
  const [donation, setDonation] = useState(100);
  const [grant, setGrant] = useState({ to: '', amount: 100 });
  const [cfg, setCfg] = useState({ motto: u.motto, dues: u.dues, open: u.open });
  const donate = useAction(() => POST('/game/union/donate', { amount: donation }), { invalidate: inv, success: '💝 Thanks!' });
  const pay = useAction(() => POST('/game/union/grant', grant), { invalidate: inv, success: '🎁 Grant paid.' });
  const save = useAction(() => PATCH('/game/union', cfg), { invalidate: inv, success: 'Saved.' });
  const rep = useAction((accountId: string) => POST('/game/union/rep', { accountId }), { invalidate: inv, success: 'New rep set.' });
  const resign = useAction((office: UnionOffice) => POST('/game/union/resign', { office }), { invalidate: inv, success: 'You resigned; an election was called.' });
  const leave = useAction(() => POST('/game/union/leave'), { invalidate: inv, success: 'You left the union.', onSuccess: () => navigate('/unions') });
  const officer = u.me.offices.includes('president') || u.me.offices.includes('treasurer');
  return (
    <div className="grid md:grid-cols-2 gap-3">
      <div className="card flex flex-col gap-2">
        <div className="h3">💝 Donate</div>
        <div className="flex gap-2"><input type="number" className="input flex-1" min={1} value={donation} onChange={(e) => setDonation(Math.max(1, Math.floor(Number(e.target.value) || 1)))} aria-label="Donation" /><button className="btn-good" onClick={() => donate.mutate(undefined)}>Donate</button></div>
        {officer && (
          <>
            <div className="h3 mt-2">🎁 Grant to a member</div>
            <select className="input" value={grant.to} onChange={(e) => setGrant({ ...grant, to: e.target.value })} aria-label="Member"><option value="">Member...</option>{u.members.map((m: any) => <option key={m.id} value={m.id}>{m.emoji} {m.name}</option>)}</select>
            <div className="flex gap-2"><input type="number" className="input flex-1" min={1} value={grant.amount} onChange={(e) => setGrant({ ...grant, amount: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} aria-label="Grant amount" /><button className="btn-primary" disabled={!grant.to} onClick={() => pay.mutate(undefined)}>Pay</button></div>
          </>
        )}
        <div className="h3 mt-2">🧑‍💼 Your rep</div>
        <select className="input" value={u.me.repAccountId} disabled={me.account.role !== 'ADMIN' && !u.me.isRep} onChange={(e) => rep.mutate(e.target.value)} aria-label="Union rep">
          {(team.data ?? []).filter((a) => a.status === 'active').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div className="card flex flex-col gap-2">
        {u.me.offices.includes('president') ? (
          <>
            <div className="h3">👑 President's desk</div>
            <label className="label">Motto<input className="input" maxLength={120} value={cfg.motto} onChange={(e) => setCfg({ ...cfg, motto: e.target.value })} /></label>
            <label className="label">Daily dues<input type="number" className="input" min={0} value={cfg.dues} onChange={(e) => setCfg({ ...cfg, dues: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.open} onChange={(e) => setCfg({ ...cfg, open: e.target.checked })} /> Open to new members</label>
            <button className="btn-primary self-start" onClick={() => save.mutate(undefined)}>Save</button>
          </>
        ) : <p className="text-sm muted">Dues: {formatBits(u.dues)} a day. Miss three days and you're out.</p>}
        {u.me.offices.map((o: UnionOffice) => <button key={o} className="btn-ghost btn-sm self-start" onClick={async () => (await confirm({ title: `Resign as ${UNION_OFFICES[o].label}?` })) && resign.mutate(o)}>Resign as {UNION_OFFICES[o].label}</button>)}
        <button className="btn-bad btn-sm self-start mt-2" onClick={async () => (await confirm({ title: `Leave ${u.name}?`, danger: true })) && leave.mutate(undefined)}>Leave union</button>
      </div>
    </div>
  );
}

// ============================================================ town hall
export function TownHall() {
  const q = useApi<any>(['laws'], '/game/laws', { refetchInterval: 30_000 });
  const vote = useAction((v: { id: string; vote: 'yes' | 'no' }) => POST(`/game/laws/${v.id}/vote`, { vote: v.vote }), { invalidate: [['laws']], success: '🗳️ Your company voted.' });
  useNow(10_000);
  if (!q.data) return <LoadingJoke />;
  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-3">
      <h1 className="h1">🏛️ Town Hall</h1>
      <div className="flex gap-2 flex-wrap">
        <div className="card !py-2">🧾 Sales tax: <b>{q.data.salesTaxPct}%</b></div>
        <div className="card !py-2">🏦 Treasury: <b>{formatBits(q.data.treasury)}</b></div>
      </div>
      <p className="text-sm muted">The Owner proposes laws; every company gets one vote. More yes than no and it passes (unless the Owner vetoes it).</p>
      {!q.data.laws.length ? <EmptyState emoji="🏛️" title="No bills yet" /> : q.data.laws.map((l: any) => {
        const open = l.status === 'voting';
        const total = l.yes + l.no;
        return (
          <div key={l.id} className="card flex flex-col gap-2" data-testid={`law-${l.id}`}>
            <div className="flex items-center gap-2 flex-wrap"><b className="flex-1">{l.title}</b><span className="chip">{open ? `⏳ ${timeLeft(l.closesAt)}` : l.status === 'passed' ? '✅ passed' : l.status === 'vetoed' ? '⛔ vetoed' : '❌ failed'}</span></div>
            <div className="flex items-center gap-2 text-sm"><span>👍 {l.yes}</span><div className="flex-1 h-3 rounded bg-rose-300 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${total ? (l.yes / total) * 100 : 50}%` }} /></div><span>{l.no} 👎</span></div>
            {open && (
              <div className="flex gap-2">
                <button className={l.myVote === 'yes' ? 'btn-good btn-sm' : 'btn-ghost btn-sm'} onClick={() => vote.mutate({ id: l.id, vote: 'yes' })}>👍 Yes{l.myVote === 'yes' ? ' ✅' : ''}</button>
                <button className={l.myVote === 'no' ? 'btn-bad btn-sm' : 'btn-ghost btn-sm'} onClick={() => vote.mutate({ id: l.id, vote: 'no' })}>👎 No{l.myVote === 'no' ? ' ✅' : ''}</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================ court
const STATUS: Record<string, string> = { filed: '📥 Filed', hearing: '🏛️ In session', decided: '🔨 Decided (appeal window)', appealed: '📣 On appeal', closed: '📁 Closed', settled: '🤝 Settled', dismissed: '📭 Dismissed' };

export function CaseRow({ c, to }: { c: any; to: string }) {
  return (
    <Link to={to} className="card-flat !p-2 flex items-center gap-2 text-sm hover:ring-2 ring-accent" data-testid={`case-${c.id}`}>
      <span className="font-mono text-xs">#{c.number}</span>
      <span className="flex-1 truncate"><b>{c.plaintiff.emoji} {c.plaintiff.name}</b> v. <b>{c.defendant.emoji} {c.defendant.name}</b> · {c.title}</span>
      <span className="chip !text-[11px]">{STATUS[c.status] ?? c.status}</span>
    </Link>
  );
}

export function Court() {
  const navigate = useNavigate();
  const q = useApi<any>(['court'], '/game/court', { refetchInterval: 30_000 });
  const [f, setF] = useState({ defendantId: '', kind: 'breach' as CaseKind, title: '', claim: 500 });
  const file = useAction(() => POST<any>('/game/court', f), { invalidate: [['court']], success: '⚖️ Case filed. Add evidence before the hearing!', onSuccess: (c) => navigate(`/court/${c.id}`) });
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">⚖️ Courthouse</h1>
      {d.sanctions.map((s: any) => <div key={s.id} className="card !bg-rose-50 text-sm">{s.kind === 'freeze' ? '🧊 Assets frozen' : `⛔ ${FEATURES[s.feature as Feature]?.label} suspended`} for {timeLeft(s.until)}: {s.reason}</div>)}
      <div className="grid md:grid-cols-[1fr_320px] gap-4">
        <div className="flex flex-col gap-3">
          <div className="card flex flex-col gap-1"><div className="h3">📂 Your cases</div>{!d.cases.length ? <p className="text-sm muted">No cases. Keep it that way!</p> : d.cases.map((c: any) => <CaseRow key={c.id} c={c} to={`/court/${c.id}`} />)}</div>
          <div className="card flex flex-col gap-1"><div className="h3">📜 Public docket</div>{!d.docket.length ? <p className="text-sm muted">The courtroom is quiet.</p> : d.docket.map((c: any) => <CaseRow key={c.id} c={c} to={`/court/${c.id}`} />)}</div>
          {d.audits.length > 0 && <div className="card flex flex-col gap-1"><div className="h3">🔦 Your tax audits</div>{d.audits.map((a: any) => <div key={a.id} className="text-sm flex gap-2"><span className="flex-1">{timeAgo(a.createdAt)}</span><span>{a.status === 'open' ? '⏳ open' : a.outcome === 'fined' ? `🧾 fined ${formatBits(a.fine)}` : a.outcome}</span></div>)}</div>}
        </div>
        <div className="card flex flex-col gap-2">
          <div className="h3">📝 Sue a company</div>
          <CompanyPicker value={f.defendantId} onChange={(v) => setF({ ...f, defendantId: v })} label="Who are you suing" />
          <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as CaseKind })} aria-label="Kind of case">
            {(Object.entries(CASE_KINDS) as Array<[CaseKind, any]>).filter(([k]) => k !== 'tax').map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
          </select>
          <label className="label">What happened?<input className="input" maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
          <label className="label">Claim (BT)<input type="number" className="input" min={0} value={f.claim} onChange={(e) => setF({ ...f, claim: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></label>
          <div className="text-xs muted">Filing fee {formatBits(Math.max(50, Math.round(f.claim * 0.05)))}. The Owner is the judge; if they don't rule within 2 hours of the hearing, the evidence decides.</div>
          <button className="btn-primary" disabled={!f.defendantId || f.title.trim().length < 3 || file.isPending} onClick={() => file.mutate(undefined)} data-testid="file-case">⚖️ File case</button>
        </div>
      </div>
    </div>
  );
}

export function CaseDetail({ owner = false }: { owner?: boolean }) {
  const { id = '' } = useParams();
  const confirm = useConfirm();
  const base = owner ? '/owner/court' : '/game/court';
  const q = useApi<any>(['case', id], `${base}/${id}`, { refetchInterval: 20_000 });
  useNow(1000);
  const inv = [['case', id], ['court']];
  const [ev, setEv] = useState({ kind: 'document' as EvidenceKind, text: '' });
  const [offer, setOffer] = useState(0);
  const addEv = useAction(() => POST(`${base}/${id}/evidence`, ev), { invalidate: inv, success: '📎 Evidence filed.', onSuccess: () => setEv({ ...ev, text: '' }) });
  const settle = useAction(() => POST(`${base}/${id}/settle`, { amount: offer }), { invalidate: inv, success: '🤝 Offer sent.' });
  const accept = useAction(() => POST(`${base}/${id}/accept`), { invalidate: inv, success: '🤝 Settled!' });
  const withdraw = useAction(() => POST(`${base}/${id}/withdraw`), { invalidate: inv, success: 'Withdrawn.' });
  const appeal = useAction(() => POST(`${base}/${id}/appeal`), { invalidate: inv, success: '📣 Appeal filed.' });
  if (!q.data) return <LoadingJoke />;
  const c = q.data;
  const party = !!c.mySide;
  const open = ['filed', 'hearing', 'appealed'].includes(c.status);
  const lost = c.status === 'decided' && c.verdict && c.verdict !== c.mySide;
  const r = c.remedy ?? {};
  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-4">
      <Link to={owner ? '/owner/justice' : '/court'} className="btn-ghost btn-sm self-start">← Back</Link>
      <div className="card flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap"><span className="font-mono">Case #{c.number}</span><span className="chip">{CASE_KINDS[c.kind as CaseKind]?.emoji} {CASE_KINDS[c.kind as CaseKind]?.label}</span><span className="chip">{STATUS[c.status]}</span></div>
        <h1 className="h1">{c.title}</h1>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className={`card-flat !p-2 ${c.verdict === 'plaintiff' ? 'ring-2 ring-emerald-500' : ''}`}><div className="text-xs muted">Plaintiff</div><b>{c.plaintiff.emoji} {c.plaintiff.name}</b>{c.mySide === 'plaintiff' && ' (you)'}</div>
          <div className={`card-flat !p-2 ${c.verdict === 'defendant' ? 'ring-2 ring-emerald-500' : ''}`}><div className="text-xs muted">Defendant</div><b>{c.defendant.emoji} {c.defendant.name}</b>{c.mySide === 'defendant' && ' (you)'}</div>
        </div>
        <div className="text-sm">Claim {formatBits(c.claim)} · filed {timeAgo(c.createdAt)}{['filed', 'appealed'].includes(c.status) && c.hearingAt > Date.now() ? ` · hearing in ${timeLeft(c.hearingAt)}` : ''}</div>
        {c.score && <div className="text-sm">⚖️ Evidence: plaintiff <b>{c.score.plaintiff}</b> vs defendant <b>{c.score.defendant}</b></div>}
        {c.verdict && (
          <div className="card-flat !p-2 text-sm">
            🔨 <b>{c.verdict === 'plaintiff' ? c.plaintiff.name : c.defendant.name} wins.</b> {c.reasoning}
            {c.verdict === 'plaintiff' && <div>{[r.damages && `${formatBits(r.damages)} damages`, r.fine && `${formatBits(r.fine)} fine`, r.freezeHours && `assets frozen ${r.freezeHours} h`, r.suspend && `${FEATURES[r.suspend as Feature]?.label} suspended ${r.suspendHours} h`].filter(Boolean).join(' · ') || 'No penalties.'}</div>}
            {c.status === 'decided' && c.appealDeadline && <div className="text-xs muted">Penalties apply in {timeLeft(c.appealDeadline)} unless appealed.</div>}
          </div>
        )}
        {c.settleOffer != null && open && <div className="text-sm">🤝 Offer from the <b>{c.settleFrom}</b>: {formatBits(c.settleOffer)} paid by the defendant.</div>}
        <div className="flex gap-2 flex-wrap">
          {party && open && c.settleOffer != null && c.settleFrom !== c.mySide && <button className="btn-good btn-sm" onClick={() => accept.mutate(undefined)}>✅ Accept settlement</button>}
          {!owner && party && lost && !c.appealed && <button className="btn-primary btn-sm" onClick={async () => (await confirm({ title: 'Appeal?', body: `Costs ${formatBits(Math.max(100, c.fee * 2))}. The ruling on appeal is final.` })) && appeal.mutate(undefined)}>📣 Appeal</button>}
          {c.mySide === 'plaintiff' && ['filed', 'hearing'].includes(c.status) && <button className="btn-ghost btn-sm" onClick={() => withdraw.mutate(undefined)}>Withdraw case</button>}
        </div>
      </div>
      {(party || owner) && (
        <div className="card flex flex-col gap-2">
          <div className="h3">📎 Evidence</div>
          {!c.evidence.length ? <p className="text-sm muted">No evidence yet. Stronger evidence usually wins.</p> : c.evidence.map((e: any) => (
            <div key={e.id} className={`card-flat !p-2 text-sm border-l-4 ${e.side === 'plaintiff' ? 'border-sky-400' : 'border-amber-400'}`}>
              <div className="text-xs muted">{e.side} · {EVIDENCE_KINDS[e.kind as EvidenceKind]?.emoji} {EVIDENCE_KINDS[e.kind as EvidenceKind]?.label} · weight {e.weight}</div>
              <div className="whitespace-pre-line">{e.text}</div>
            </div>
          ))}
          {party && open && (
            <div className="flex flex-col gap-2 border-t border-ink/10 pt-2">
              <div className="flex gap-2 flex-wrap">
                {(Object.entries(EVIDENCE_KINDS) as Array<[EvidenceKind, any]>).map(([k, v]) => <button key={k} className={`chip ${ev.kind === k ? '!bg-accent !text-white' : ''}`} onClick={() => setEv({ ...ev, kind: k })} aria-pressed={ev.kind === k}>{v.emoji} {v.label} · weight {v.weight}{v.cost ? ` · ${v.cost} BT` : ''}</button>)}
              </div>
              <textarea className="input" rows={2} maxLength={500} value={ev.text} onChange={(e) => setEv({ ...ev, text: e.target.value })} placeholder={ev.kind === 'ledger' ? 'Optional note; the payment records are attached for you' : 'Describe the evidence'} aria-label="Evidence" />
              <button className="btn-primary btn-sm self-start" disabled={ev.kind !== 'ledger' && !ev.text.trim()} onClick={() => addEv.mutate(undefined)}>File evidence</button>
            </div>
          )}
        </div>
      )}
      {party && open && !owner && (
        <div className="card flex flex-col gap-2">
          <div className="h3">🤝 Offer a settlement</div>
          <div className="flex gap-2"><input type="number" className="input flex-1" min={0} value={offer} onChange={(e) => setOffer(Math.max(0, Math.floor(Number(e.target.value) || 0)))} aria-label="Settlement amount" /><button className="btn-ghost" onClick={() => settle.mutate(undefined)}>Offer</button></div>
        </div>
      )}
      {!party && !owner && <EmptyState emoji="🔒" title="Public record" body="Only the parties can see the evidence." />}
    </div>
  );
}
