import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { CASE_KINDS, MODULES, MODULE_INFO, formatBits, type CaseKind, type Module } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { LoadingJoke, EmptyState, Tabs, timeAgo, timeLeft, useConfirm } from '../../components/ui';
import { CaseDetail, CaseRow } from '../game/Court';

type Tab = 'audits' | 'court' | 'sanctions' | 'laws' | 'unions';

/** Owner Panel "Justice": tax audits, the court bench, sanctions, bills and unions. */
export function JusticeAdmin() {
  const q = useApi<any>(['owner-justice'], '/owner/justice', { refetchInterval: 20_000 });
  const [tab, setTab] = useState<Tab>('audits');
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  const openAudits = d.audits.filter((a: any) => a.status === 'open').length;
  const awaiting = d.docket.filter((c: any) => ['hearing', 'appealed'].includes(c.status)).length;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">🏛️ Justice & Politics</h1>
      <Tabs<Tab>
        tabs={[
          { id: 'audits', label: `🔦 Tax audits${openAudits ? ` (${openAudits})` : ''}` },
          { id: 'court', label: `🔨 Court${awaiting ? ` (${awaiting} to rule)` : ''}` },
          { id: 'sanctions', label: `⛔ Sanctions (${d.sanctions.length})` },
          { id: 'laws', label: '📜 Bills & laws' },
          { id: 'unions', label: `✊ Unions & territory` },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'audits' && <Audits d={d} />}
      {tab === 'court' && <Bench d={d} />}
      {tab === 'sanctions' && <Sanctions d={d} />}
      {tab === 'laws' && <Laws d={d} />}
      {tab === 'unions' && <UnionsTerritory d={d} />}
    </div>
  );
}

const inv = [['owner-justice']];

function Audits({ d }: { d: any }) {
  const [pick, setPick] = useState({ companyId: '', depth: 'field' });
  const open = useAction((v: { companyId: string; depth: string }) => POST('/owner/audits', v), { invalidate: inv, success: '🔦 Audit opened. Findings are ready.' });
  const close = useAction((v: { id: string; outcome: string; fine?: number; note?: string; freezeHours?: number }) => POST(`/owner/audits/${v.id}/close`, v), { invalidate: inv, success: 'Audit closed.' });
  const [fines, setFines] = useState<Record<string, { fine: number; note: string; freezeHours: number }>>({});
  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-4">
      <div className="flex flex-col gap-3">
        {d.audits.filter((a: any) => a.status === 'open').map((a: any) => {
          const f = a.findings;
          const v = fines[a.id] ?? { fine: a.suggestedFine, note: '', freezeHours: 0 };
          const set = (p: Partial<typeof v>) => setFines({ ...fines, [a.id]: { ...v, ...p } });
          return (
            <div key={a.id} className="card flex flex-col gap-2" data-testid={`audit-${a.id}`}>
              <div className="flex items-center gap-2"><b className="flex-1">🔦 {a.company.emoji} {a.company.name}</b><span className="chip">{a.depth} audit</span><span className="text-xs muted">{timeAgo(a.createdAt)}</span></div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <div className="card-flat !p-2"><div className="text-xs muted">Income (7 d)</div><b>{formatBits(f.income)}</b></div>
                <div className="card-flat !p-2"><div className="text-xs muted">Tax paid</div><b>{formatBits(f.taxPaid)}</b></div>
                <div className="card-flat !p-2"><div className="text-xs muted">Hidden income found</div><b className={f.hiddenIncomeFound ? 'text-rose-700' : ''}>{formatBits(f.hiddenIncomeFound)}</b></div>
                <div className="card-flat !p-2"><div className="text-xs muted">Audit risk / legal</div><b>{f.auditRisk} / {f.legal}</b></div>
              </div>
              {f.flags.length ? <ul className="text-sm list-disc pl-5">{f.flags.map((x: string) => <li key={x}>{x}</li>)}</ul> : <p className="text-sm">No red flags. 🧼</p>}
              <div className="text-sm">Suggested fine: <b>{formatBits(a.suggestedFine)}</b> (hidden income + {f.detection}% detection penalty)</div>
              <div className="flex gap-2 flex-wrap items-end">
                <label className="label">Fine<input type="number" className="input !w-28" min={0} value={v.fine} onChange={(e) => set({ fine: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></label>
                <label className="label">Freeze (h)<input type="number" className="input !w-20" min={0} max={720} value={v.freezeHours} onChange={(e) => set({ freezeHours: Math.max(0, Number(e.target.value) || 0) })} /></label>
                <label className="label flex-1">Note<input className="input" maxLength={300} value={v.note} onChange={(e) => set({ note: e.target.value })} /></label>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button className="btn-good btn-sm" onClick={() => close.mutate({ id: a.id, outcome: 'clean', note: v.note })}>✅ Clean</button>
                <button className="btn-ghost btn-sm" onClick={() => close.mutate({ id: a.id, outcome: 'warning', note: v.note })}>⚠️ Warning</button>
                <button className="btn-bad btn-sm" onClick={() => close.mutate({ id: a.id, outcome: 'fined', fine: v.fine, note: v.note, freezeHours: v.freezeHours || undefined })}>🧾 Fine {formatBits(v.fine)}</button>
                <button className="btn-primary btn-sm" onClick={() => close.mutate({ id: a.id, outcome: 'referred', fine: v.fine, note: v.note })}>⚖️ Take them to court</button>
              </div>
            </div>
          );
        })}
        <div className="card flex flex-col gap-1">
          <div className="h3">📁 Closed audits</div>
          {!d.audits.some((a: any) => a.status === 'closed') ? <p className="text-sm muted">None yet.</p> : d.audits.filter((a: any) => a.status === 'closed').slice(0, 30).map((a: any) => (
            <div key={a.id} className="text-sm flex gap-2"><span className="flex-1">{a.company.emoji} {a.company.name} · {a.depth}</span><span>{a.outcome}{a.fine ? ` · ${formatBits(a.fine)}` : ''}</span><span className="muted text-xs">{timeAgo(a.closedAt)}</span></div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <div className="card flex flex-col gap-2">
          <div className="h3">🔦 Open an audit</div>
          <select className="input" value={pick.companyId} onChange={(e) => setPick({ ...pick, companyId: e.target.value })} aria-label="Company to audit">
            <option value="">Pick a company...</option>
            {d.companies.map((c: any) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
          </select>
          <select className="input" value={pick.depth} onChange={(e) => setPick({ ...pick, depth: e.target.value })} aria-label="Audit depth">
            <option value="desk">🗂️ Desk audit (finds ~35%)</option>
            <option value="field">🔍 Field audit (finds ~65%)</option>
            <option value="forensic">🧬 Forensic audit (finds ~90%)</option>
          </select>
          <button className="btn-primary" disabled={!pick.companyId} onClick={() => open.mutate(pick)} data-testid="open-audit">Start audit</button>
        </div>
        <div className="card flex flex-col gap-1">
          <div className="h3">🚩 Most suspicious</div>
          {!d.candidates.length ? <p className="text-sm muted">Everyone looks squeaky clean.</p> : d.candidates.map((c: any) => (
            <button key={c.company.id} className="flex gap-2 text-sm text-left hover:underline" onClick={() => setPick({ ...pick, companyId: c.company.id })}>
              <span className="flex-1">{c.company.emoji} {c.company.name}</span><span>🔦 {c.auditRisk}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Bench({ d }: { d: any }) {
  const [form, setForm] = useState({ defendantId: '', kind: 'unfair' as CaseKind, title: '', claim: 2000 });
  const file = useAction(() => POST('/owner/court/cases', form), { invalidate: inv, success: '⚖️ The State has filed its case.' });
  const awaiting = d.docket.filter((c: any) => ['hearing', 'appealed', 'filed'].includes(c.status));
  const rest = d.docket.filter((c: any) => !['hearing', 'appealed', 'filed'].includes(c.status));
  return (
    <div className="grid lg:grid-cols-[1fr_340px] gap-4">
      <div className="flex flex-col gap-3">
        <div className="card flex flex-col gap-1">
          <div className="h3">🔨 Waiting for a ruling</div>
          <p className="text-xs muted">You are the judge. If you do not rule within 2 hours of the hearing, the auto-judge decides on the evidence.</p>
          {!awaiting.length ? <p className="text-sm muted">Nothing on the bench.</p> : awaiting.map((c: any) => <CaseRow key={c.id} c={c} to={`/owner/justice/cases/${c.id}`} />)}
        </div>
        <div className="card flex flex-col gap-1">
          <div className="h3">📁 All cases</div>
          {!rest.length ? <p className="text-sm muted">None yet.</p> : rest.map((c: any) => <CaseRow key={c.id} c={c} to={`/owner/justice/cases/${c.id}`} />)}
        </div>
      </div>
      <div className="card flex flex-col gap-2">
        <div className="h3">🏛️ The State v. a company</div>
        <select className="input" value={form.defendantId} onChange={(e) => setForm({ ...form, defendantId: e.target.value })} aria-label="Defendant">
          <option value="">Defendant...</option>
          {d.companies.map((c: any) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
        </select>
        <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as CaseKind })} aria-label="Charge">
          {(Object.entries(CASE_KINDS) as Array<[CaseKind, any]>).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
        </select>
        <label className="label">Title<input className="input" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="State v. Sneaky Co: price fixing" /></label>
        <label className="label">Fine sought (BT)<input type="number" className="input" min={0} value={form.claim} onChange={(e) => setForm({ ...form, claim: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></label>
        <button className="btn-primary" disabled={!form.defendantId || form.title.trim().length < 3} onClick={() => file.mutate(undefined)}>⚖️ Take them to court</button>
      </div>
    </div>
  );
}

/** Owner case page: the shared case view plus the judge's ruling form. */
export function OwnerCase() {
  const { id = '' } = useParams();
  const q = useApi<any>(['case', id], `/owner/court/cases/${id}`);
  const [rem, setRem] = useState({ damages: 0, fine: 0, freezeHours: 0, suspendModule: '', suspendHours: 0 });
  const [reasoning, setReasoning] = useState('');
  const decide = useAction((verdict: 'plaintiff' | 'defendant') => POST(`/owner/court/cases/${id}/decide`, { verdict, reasoning, remedy: { ...rem, suspendModule: rem.suspendModule || null } }), { invalidate: [['case', id], ['owner-justice']], success: '🔨 Ruling entered.' });
  const c = q.data;
  const canRule = c && ['filed', 'hearing', 'appealed'].includes(c.status);
  const num = (k: keyof typeof rem) => (e: React.ChangeEvent<HTMLInputElement>) => setRem({ ...rem, [k]: Math.max(0, Math.floor(Number(e.target.value) || 0)) });
  return (
    <div className="flex flex-col gap-4">
      <CaseDetail owner />
      {canRule && (
        <div className="card flex flex-col gap-2 max-w-4xl mx-auto w-full" data-testid="rule-form">
          <div className="h3">🔨 Your ruling</div>
          <p className="text-xs muted">Penalties only apply if the plaintiff wins. The loser may appeal once (within 24 h); a ruling on appeal is final.</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {c.plaintiffId && <label className="label">Damages<input type="number" className="input" min={0} value={rem.damages} onChange={num('damages')} /></label>}
            <label className="label">Fine<input type="number" className="input" min={0} value={rem.fine} onChange={num('fine')} /></label>
            <label className="label">Freeze (h)<input type="number" className="input" min={0} max={720} value={rem.freezeHours} onChange={num('freezeHours')} /></label>
            <label className="label">Suspend<select className="input" value={rem.suspendModule} onChange={(e) => setRem({ ...rem, suspendModule: e.target.value })}><option value="">nothing</option>{MODULES.map((m) => <option key={m} value={m}>{MODULE_INFO[m].emoji} {MODULE_INFO[m].label}</option>)}</select></label>
            <label className="label">For (h)<input type="number" className="input" min={0} max={720} value={rem.suspendHours} onChange={num('suspendHours')} /></label>
          </div>
          <input className="input" maxLength={500} value={reasoning} onChange={(e) => setReasoning(e.target.value)} placeholder="Reasoning (shown to the parties and in the news)" aria-label="Reasoning" />
          <div className="flex gap-2">
            <button className="btn-good" onClick={() => decide.mutate('plaintiff')}>Rule for the plaintiff</button>
            <button className="btn-ghost" onClick={() => decide.mutate('defendant')}>Rule for the defendant</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Sanctions({ d }: { d: any }) {
  const confirm = useConfirm();
  const [f, setF] = useState({ companyId: '', kind: 'freeze', module: 'exchange', hours: 6, reason: '' });
  const add = useAction(() => POST('/owner/sanctions', { ...f, module: f.kind === 'suspend' ? f.module : null }), { invalidate: inv, success: '⛔ Sanction in force.' });
  const lift = useAction((id: string) => POST(`/owner/sanctions/${id}/lift`), { invalidate: inv, success: 'Lifted.' });
  return (
    <div className="grid lg:grid-cols-[1fr_340px] gap-4">
      <div className="card flex flex-col gap-1">
        {!d.sanctions.length ? <EmptyState emoji="🕊️" title="No sanctions in force" /> : d.sanctions.map((s: any) => (
          <div key={s.id} className="flex items-center gap-2 text-sm py-1 border-b border-ink/5 last:border-0">
            <span className="flex-1"><b>{s.company.emoji} {s.company.name}</b>: {s.kind === 'freeze' ? '🧊 assets frozen' : `⛔ ${MODULE_INFO[s.module as Module]?.label ?? s.module} suspended`} · {timeLeft(s.until)} left <span className="muted">({s.source}: {s.reason})</span></span>
            <button className="btn-ghost btn-sm" onClick={async () => (await confirm({ title: 'Lift this sanction?' })) && lift.mutate(s.id)}>Lift</button>
          </div>
        ))}
      </div>
      <div className="card flex flex-col gap-2">
        <div className="h3">⛔ Impose a sanction</div>
        <select className="input" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })} aria-label="Company"><option value="">Company...</option>{d.companies.map((c: any) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</select>
        <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="Sanction"><option value="freeze">🧊 Freeze assets (no spending)</option><option value="suspend">⛔ Suspend a licence (module)</option></select>
        {f.kind === 'suspend' && <select className="input" value={f.module} onChange={(e) => setF({ ...f, module: e.target.value })} aria-label="Module">{MODULES.map((m) => <option key={m} value={m}>{MODULE_INFO[m].emoji} {MODULE_INFO[m].label}</option>)}</select>}
        <label className="label">Hours<input type="number" className="input" min={1} max={720} value={f.hours} onChange={(e) => setF({ ...f, hours: Math.max(1, Number(e.target.value) || 1) })} /></label>
        <label className="label">Reason<input className="input" maxLength={200} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
        <button className="btn-bad" disabled={!f.companyId || f.reason.trim().length < 2} onClick={() => add.mutate(undefined)}>Impose</button>
      </div>
    </div>
  );
}

function Laws({ d }: { d: any }) {
  const [hours, setHours] = useState(24);
  const propose = useAction((templateKey: string) => POST('/owner/laws', { templateKey, hoursOpen: hours }), { invalidate: inv, success: '📜 Bill introduced. Companies can lobby now.' });
  const decide = useAction((v: { id: string; decision: string }) => POST(`/owner/laws/${v.id}/decide`, { decision: v.decision }), { invalidate: inv, success: 'Decided.' });
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="card flex flex-col gap-2">
        <div className="h3">📜 Introduce a bill</div>
        <label className="label">Lobbying open for (hours)<input type="number" className="input" min={1} max={168} value={hours} onChange={(e) => setHours(Math.max(1, Math.min(168, Number(e.target.value) || 1)))} /></label>
        {d.lawTemplates.map((t: any) => (
          <div key={t.key} className="card-flat !p-2 flex items-center gap-2">
            <span className="text-2xl">{t.emoji}</span>
            <div className="flex-1"><b className="text-sm">{t.title}</b><div className="text-xs muted">{t.blurb}</div></div>
            <button className="btn-primary btn-sm" onClick={() => propose.mutate(t.key)}>Introduce</button>
          </div>
        ))}
      </div>
      <div className="card flex flex-col gap-2">
        <div className="h3">🏛️ Bills</div>
        {!d.laws.length ? <p className="text-sm muted">No bills yet.</p> : d.laws.map((l: any) => (
          <div key={l.id} className="card-flat !p-2 flex flex-col gap-1">
            <div className="flex items-center gap-2"><span>{l.emoji}</span><b className="flex-1 text-sm">{l.title}</b><span className="chip !text-[11px]">{l.status === 'lobbying' ? `⏳ ${timeLeft(l.closesAt)}` : l.status}</span></div>
            <div className="text-xs">👍 {l.support} · 👎 {l.oppose}</div>
            {l.status === 'lobbying' && (
              <div className="flex gap-1">
                <button className="btn-good btn-sm" onClick={() => decide.mutate({ id: l.id, decision: 'pass' })}>Sign into law</button>
                <button className="btn-bad btn-sm" onClick={() => decide.mutate({ id: l.id, decision: 'veto' })}>Veto</button>
                <button className="btn-ghost btn-sm" onClick={() => decide.mutate({ id: l.id, decision: 'count' })}>Count the lobby now</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function UnionsTerritory({ d }: { d: any }) {
  const confirm = useConfirm();
  const dissolve = useAction((id: string) => POST(`/owner/unions/${id}/dissolve`), { invalidate: inv, success: 'Union dissolved; its treasury went to the State.' });
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="card flex flex-col gap-1">
        <div className="h3">✊ Unions</div>
        {!d.unions.length ? <p className="text-sm muted">No unions yet.</p> : d.unions.map((u: any) => (
          <div key={u.id} className="flex items-center gap-2 text-sm py-1 border-b border-ink/5 last:border-0">
            <span className="text-xl">{u.emoji}</span>
            <span className="flex-1"><b>{u.name}</b> · 👥 {u.members} · 👑 {u.president ? `${u.president.emoji} ${u.president.name}` : 'vacant'} · 💼 {formatBits(u.treasury)} · 🏛️ {u.influence}</span>
            <button className="btn-ghost btn-sm" onClick={async () => (await confirm({ title: `Dissolve ${u.name}?`, body: 'The treasury goes to the State. This can not be undone.', danger: true })) && dissolve.mutate(u.id)}>Dissolve</button>
          </div>
        ))}
      </div>
      <div className="card flex flex-col gap-1">
        <div className="h3">🗺️ Territory</div>
        {d.districts.map((x: any) => {
          const owner = x.top.find((t: any) => t.companyId === x.controller);
          return <div key={x.id} className="text-sm flex gap-2"><span>{x.emoji}</span><span className="flex-1">{x.name}</span><span>{owner ? `👑 ${owner.emoji} ${owner.name} (${owner.share}%)` : <span className="muted">uncontrolled</span>}</span></div>;
        })}
      </div>
      <p className="text-xs muted lg:col-span-2">Players manage unions themselves under ✊ Unions; see the <Link to="/owner/social" className="underline">Social</Link> tab for guilds and wars.</p>
    </div>
  );
}
