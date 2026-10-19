import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { CASE_KINDS, EVIDENCE_KINDS, MODULE_INFO, formatBits, type CaseKind, type EvidenceKind, type Module } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { onWs } from '../../lib/ws';
import { LoadingJoke, EmptyState, timeAgo, timeLeft, useConfirm, useNow } from '../../components/ui';
import { useGameMe, useMaybeGameMe } from './GameLayout';

const STATUS: Record<string, string> = {
  filed: '📥 Filed',
  hearing: '🏛️ In session',
  decided: '🔨 Decided (appeal window)',
  appealed: '📣 On appeal',
  closed: '📁 Closed',
  settled: '🤝 Settled',
  dismissed: '📭 Dismissed',
};

export function CaseRow({ c, to }: { c: any; to: string }) {
  return (
    <Link to={to} className="card-flat !p-2 flex items-center gap-2 text-sm hover:ring-2 ring-accent" data-testid={`case-${c.id}`}>
      <span className="font-mono text-xs">#{c.number}</span>
      <span>{CASE_KINDS[c.kind as CaseKind]?.emoji}</span>
      <span className="flex-1 truncate"><b>{c.plaintiff.emoji} {c.plaintiff.name}</b> v. <b>{c.defendant.emoji} {c.defendant.name}</b> · {c.title}</span>
      <span className="chip !text-[11px]">{STATUS[c.status] ?? c.status}</span>
    </Link>
  );
}

/** The Courthouse: your legal standing, your cases, the public docket and suing someone. */
export function Court() {
  const me = useGameMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useApi<any>(['court'], '/game/court', { refetchInterval: 30_000 });
  const dir = useApi<any[]>(['directory'], '/game/companies/directory');
  useEffect(() => onWs('court', () => qc.invalidateQueries({ queryKey: ['court'] })), [qc]);
  const [form, setForm] = useState({ defendantId: '', kind: 'breach' as CaseKind, title: '', claim: 1000 });
  const file = useAction(() => POST<any>('/game/court/cases', form), { invalidate: [['court']], success: '⚖️ Case filed. Add evidence before the hearing!', onSuccess: (c) => navigate(`/court/${c.id}`) });
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  const fee = Math.max(100, Math.round(form.claim * 0.05));
  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <h1 className="h1">⚖️ Courthouse</h1>
      <div className="grid sm:grid-cols-4 gap-2">
        <div className="card !p-2 text-center"><div className="text-xs muted">Legal strength</div><div className="font-extrabold">⚖️ {d.legal}</div></div>
        <div className={`card !p-2 text-center ${d.auditRisk >= 50 ? '!bg-rose-100' : ''}`}><div className="text-xs muted">Audit risk</div><div className="font-extrabold">🔦 {d.auditRisk}</div></div>
        <div className={`card !p-2 text-center ${d.underAudit ? '!bg-amber-100' : ''}`}><div className="text-xs muted">Tax audit</div><div className="font-extrabold">{d.underAudit ? '🔦 Under audit' : '✅ None'}</div></div>
        <div className={`card !p-2 text-center ${d.sanctions.length ? '!bg-rose-100' : ''}`}><div className="text-xs muted">Sanctions</div><div className="font-extrabold">{d.sanctions.length ? `⛔ ${d.sanctions.length}` : '✅ None'}</div></div>
      </div>
      {d.sanctions.map((s: any) => (
        <div key={s.id} className="card !bg-rose-50 text-sm">
          {s.kind === 'freeze' ? '🧊 Assets frozen' : `⛔ ${MODULE_INFO[s.module as Module]?.label ?? s.module} licence suspended`} until {new Date(s.until).toLocaleString()} ({timeLeft(s.until)} left). <span className="muted">{s.reason}</span>
        </div>
      ))}
      <p className="text-sm muted">Raise your legal strength with ⚖️ Legal plays in the ♟️ Strategy Room. Shady deals raise your audit risk, and the Owner can audit you and take you to court.</p>
      <div className="grid md:grid-cols-[1fr_340px] gap-4">
        <div className="flex flex-col gap-3">
          <div className="card flex flex-col gap-1">
            <div className="h3">📂 Your cases</div>
            {!d.cases.length ? <p className="text-sm muted">No cases. Keep it that way!</p> : d.cases.map((c: any) => <CaseRow key={c.id} c={c} to={`/court/${c.id}`} />)}
          </div>
          <div className="card flex flex-col gap-1">
            <div className="h3">📜 Public docket (open cases)</div>
            {!d.docket.length ? <p className="text-sm muted">The courtroom is quiet.</p> : d.docket.map((c: any) => <CaseRow key={c.id} c={c} to={`/court/${c.id}`} />)}
          </div>
          {d.audits.length > 0 && (
            <div className="card flex flex-col gap-1">
              <div className="h3">🔦 Your tax audits</div>
              {d.audits.map((a: any) => (
                <div key={a.id} className="text-sm flex gap-2"><span className="flex-1">{a.depth} audit · {timeAgo(a.createdAt)}</span><span>{a.status === 'open' ? '⏳ open' : a.outcome === 'fined' ? `🧾 fined ${formatBits(a.fine)}` : a.outcome}</span></div>
              ))}
            </div>
          )}
        </div>
        <div className="card flex flex-col gap-2">
          <div className="h3">📝 Sue a company</div>
          <select className="input" value={form.defendantId} onChange={(e) => setForm({ ...form, defendantId: e.target.value })} aria-label="Defendant">
            <option value="">Who are you suing?</option>
            {(dir.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
          </select>
          <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as CaseKind })} aria-label="Kind of case">
            {(Object.entries(CASE_KINDS) as Array<[CaseKind, any]>).filter(([k]) => k !== 'tax').map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
          </select>
          <label className="label">What happened?<input className="input" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="They copied our croissant recipe" /></label>
          <label className="label">Claim (BT)<input type="number" className="input" min={0} value={form.claim} onChange={(e) => setForm({ ...form, claim: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></label>
          <div className="text-xs muted">Filing fee: {formatBits(fee)} (5% of the claim, min 100). The hearing starts in an hour; then the Owner (or the auto-judge) rules on the evidence.</div>
          <button className="btn-primary" disabled={!form.defendantId || form.title.trim().length < 3 || me.access.readOnly || file.isPending} onClick={() => file.mutate(undefined)} data-testid="file-case">⚖️ File case</button>
        </div>
      </div>
    </div>
  );
}

export function CaseDetail({ owner = false }: { owner?: boolean }) {
  const { id = '' } = useParams();
  const me = useMaybeGameMe();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const base = owner ? '/owner' : '/game';
  const q = useApi<any>(['case', id], `${base}/court/cases/${id}`, { refetchInterval: 20_000 });
  useEffect(() => onWs('court', () => qc.invalidateQueries({ queryKey: ['case', id] })), [qc, id]);
  useNow(1000);
  const inv = [['case', id], ['court']];
  const [ev, setEv] = useState({ kind: 'document' as EvidenceKind, text: '' });
  const [offer, setOffer] = useState(0);
  const addEv = useAction(() => POST(`${base}/court/cases/${id}/evidence`, ev), { invalidate: inv, success: '📎 Evidence filed.', onSuccess: () => setEv({ ...ev, text: '' }) });
  const settle = useAction(() => POST(`${base}/court/cases/${id}/settle`, { amount: offer }), { invalidate: inv, success: '🤝 Offer sent.' });
  const accept = useAction(() => POST(`${base}/court/cases/${id}/accept`), { invalidate: inv, success: '🤝 Settled!' });
  const withdraw = useAction(() => POST(`${base}/court/cases/${id}/withdraw`), { invalidate: inv, success: 'Case withdrawn.' });
  const appeal = useAction(() => POST(`${base}/court/cases/${id}/appeal`), { invalidate: inv, success: '📣 Appeal filed.' });
  if (!q.data) return <LoadingJoke />;
  const c = q.data;
  const ro = !owner && !!me?.access.readOnly;
  const party = !!c.mySide;
  const open = ['filed', 'hearing', 'appealed'].includes(c.status);
  const lost = c.status === 'decided' && c.verdict && c.verdict !== c.mySide;
  const r = c.remedy ?? {};
  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-4">
      <Link to={owner ? '/owner/justice' : '/court'} className="btn-ghost btn-sm self-start">← Back</Link>
      <div className="card flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono">Case #{c.number}</span>
          <span className="chip">{CASE_KINDS[c.kind as CaseKind]?.emoji} {CASE_KINDS[c.kind as CaseKind]?.label}</span>
          <span className="chip">{STATUS[c.status] ?? c.status}</span>
        </div>
        <h1 className="h1">{c.title}</h1>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className={`card-flat !p-2 ${c.verdict === 'plaintiff' ? 'ring-2 ring-emerald-500' : ''}`}><div className="text-xs muted">Plaintiff</div><b>{c.plaintiff.emoji} {c.plaintiff.name}</b>{c.mySide === 'plaintiff' && ' (you)'}</div>
          <div className={`card-flat !p-2 ${c.verdict === 'defendant' ? 'ring-2 ring-emerald-500' : ''}`}><div className="text-xs muted">Defendant</div><b>{c.defendant.emoji} {c.defendant.name}</b>{c.mySide === 'defendant' && ' (you)'}</div>
        </div>
        <div className="text-sm">Claim: <b>{formatBits(c.claim)}</b> · filed {timeAgo(c.createdAt)}{['filed', 'appealed'].includes(c.status) && c.hearingAt > Date.now() ? ` · hearing in ${timeLeft(c.hearingAt)}` : ''}</div>
        {c.score && <div className="text-sm">⚖️ Evidence score: plaintiff <b>{c.score.plaintiff}</b> vs defendant <b>{c.score.defendant}</b></div>}
        {c.verdict && (
          <div className="card-flat !p-2 text-sm">
            🔨 <b>{c.verdict === 'plaintiff' ? c.plaintiff.name : c.defendant.name} wins.</b> {c.reasoning}
            {c.verdict === 'plaintiff' && <div>{[r.damages && `${formatBits(r.damages)} damages`, r.fine && `${formatBits(r.fine)} fine`, r.freezeHours && `assets frozen ${r.freezeHours} h`, r.suspendModule && r.suspendHours && `${MODULE_INFO[r.suspendModule as Module]?.label} licence suspended ${r.suspendHours} h`].filter(Boolean).join(' · ') || 'No penalties.'}</div>}
            {c.status === 'decided' && c.appealDeadline && <div className="text-xs muted">Penalties apply in {timeLeft(c.appealDeadline)} unless appealed.</div>}
          </div>
        )}
        {c.settleOffer != null && open && <div className="text-sm">🤝 Offer on the table from the <b>{c.settleFrom}</b>: {formatBits(c.settleOffer)} paid by the defendant.</div>}
        <div className="flex gap-2 flex-wrap">
          {party && open && c.settleOffer != null && c.settleFrom !== c.mySide && <button className="btn-good btn-sm" disabled={ro} onClick={() => accept.mutate(undefined)}>✅ Accept settlement</button>}
          {party && lost && !c.appealed && !owner && <button className="btn-primary btn-sm" disabled={ro} onClick={async () => (await confirm({ title: 'Appeal?', body: `Costs ${formatBits(Math.max(200, c.filingFee * 2))}. The appeals court ruling is final.` })) && appeal.mutate(undefined)}>📣 Appeal</button>}
          {c.mySide === 'plaintiff' && ['filed', 'hearing'].includes(c.status) && <button className="btn-ghost btn-sm" disabled={ro} onClick={() => withdraw.mutate(undefined)}>Withdraw case</button>}
        </div>
      </div>
      {(party || owner) && (
        <div className="card flex flex-col gap-2">
          <div className="h3">📎 Evidence</div>
          {!c.evidence.length ? <p className="text-sm muted">No evidence yet. The side with stronger evidence (and better lawyers) usually wins.</p> : c.evidence.map((e: any) => (
            <div key={e.id} className={`card-flat !p-2 text-sm ${e.side === 'plaintiff' ? 'border-l-4 border-sky-400' : 'border-l-4 border-amber-400'}`}>
              <div className="text-xs muted">{e.side} · {EVIDENCE_KINDS[e.kind as EvidenceKind]?.emoji} {EVIDENCE_KINDS[e.kind as EvidenceKind]?.label} · weight {e.weight} · {timeAgo(e.createdAt)}</div>
              <div className="whitespace-pre-line">{e.text}</div>
            </div>
          ))}
          {party && open && (
            <div className="flex flex-col gap-2 border-t border-ink/10 pt-2">
              <div className="flex gap-2 flex-wrap">
                {(Object.entries(EVIDENCE_KINDS) as Array<[EvidenceKind, any]>).map(([k, v]) => (
                  <button key={k} className={`chip ${ev.kind === k ? '!bg-accent !text-white' : ''}`} onClick={() => setEv({ ...ev, kind: k })} aria-pressed={ev.kind === k}>{v.emoji} {v.label} · weight {v.weight}{v.cost ? ` · ${formatBits(v.cost)}` : ''}</button>
                ))}
              </div>
              <textarea className="input" rows={2} maxLength={500} value={ev.text} onChange={(e) => setEv({ ...ev, text: e.target.value })} placeholder={ev.kind === 'ledger' ? 'Optional note: the ledger records are attached for you' : 'Describe the evidence'} aria-label="Evidence" />
              <button className="btn-primary btn-sm self-start" disabled={ro || (ev.kind !== 'ledger' && !ev.text.trim())} onClick={() => addEv.mutate(undefined)}>File evidence</button>
            </div>
          )}
        </div>
      )}
      {party && open && !owner && (
        <div className="card flex flex-col gap-2">
          <div className="h3">🤝 Offer a settlement</div>
          <div className="flex gap-2"><input type="number" className="input flex-1" min={0} value={offer} onChange={(e) => setOffer(Math.max(0, Math.floor(Number(e.target.value) || 0)))} aria-label="Settlement amount" /><button className="btn-ghost" disabled={ro} onClick={() => settle.mutate(undefined)}>Offer</button></div>
          <p className="text-xs muted">The defendant pays the plaintiff this amount and the case closes. The other side has to accept.</p>
        </div>
      )}
      {!party && !owner && <EmptyState emoji="🔒" title="Public record" body="Only the parties can see the evidence." />}
    </div>
  );
}
