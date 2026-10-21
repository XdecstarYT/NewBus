import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { WORK_CATEGORIES, type WorkCategory } from '@dw/shared/live';
import { POST } from '../../lib/api';
import { useApi, useAction } from '../../lib/hooks';
import { formatBits } from '../../lib/game';
import { sfx } from '../../lib/sound';
import { useStore } from '../../lib/store';
import { EmptyState, LoadingJoke, ProgressBar, timeAgo, timeLeft, useNow } from '../../components/ui';

export const GRADING: Record<string, { label: string; emoji: string; blurb: string }> = {
  auto: { label: 'Instant check', emoji: '✅', blurb: 'Exact answers, checked the moment you hand in.' },
  ai: { label: 'AI graded', emoji: '🤖', blurb: 'The AI reads your work and scores it against the rubric.' },
  owner: { label: 'Owner graded', emoji: '👑', blurb: 'The Owner reads it and scores it by hand.' },
};
const stars = (n: number) => '⭐'.repeat(n);
const STATUS: Record<string, string> = { working: '✍️ In progress', grading: '⏳ Being graded', graded: '✅ Graded', expired: '⏰ Ran out of time' };

/** Office work: real tasks posted by the Owner and by AI clients. */
export function WorkBoard() {
  const q = useApi<any>(['work'], '/game/work-board', { refetchInterval: 20_000 });
  const navigate = useNavigate();
  const [cat, setCat] = useState<WorkCategory | 'all'>('all');
  const take = useAction((id: string) => POST<any>(`/game/jobs/${id}/take`), {
    invalidate: [['work'], ['me']],
    onSuccess: (r) => {
      sfx.whoosh();
      navigate(`/work/${r.id}`);
    },
  });
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  const working = d.mine.find((s: any) => s.status === 'working');
  const open = d.jobs.filter((j: any) => !j.mine && (cat === 'all' || j.task.category === cat));
  const cats = [...new Set(d.jobs.filter((j: any) => !j.mine).map((j: any) => j.task.category))] as WorkCategory[];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">💼 Office Work</h1>
      <p className="muted text-sm">Real desk jobs from clients: read the brief and the reference data, fill in the answers, hand in before the timer runs out. You are paid by your score. {d.ai ? '🤖 The AI is on: it grades written work and sends new clients.' : ''}</p>
      {working && (
        <Link to={`/work/${working.id}`} className="card !bg-amber-50 flex items-center gap-3" data-testid="resume-job">
          <span className="text-3xl">{working.emoji}</span>
          <div className="flex-1"><b>Keep going: {working.title}</b><div className="text-xs muted">{timeLeft(working.dueAt)} left</div></div>
          <span className="btn-primary btn-sm">Open ✍️</span>
        </Link>
      )}
      {cats.length > 1 && (
        <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Category">
          <button role="tab" aria-selected={cat === 'all'} className={`btn-sm ${cat === 'all' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setCat('all')}>All</button>
          {cats.map((c) => <button key={c} role="tab" aria-selected={cat === c} className={`btn-sm whitespace-nowrap ${cat === c ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setCat(c)}>{WORK_CATEGORIES[c].emoji} {WORK_CATEGORIES[c].label}</button>)}
        </div>
      )}
      {!open.length ? (
        <EmptyState emoji="🗂️" title="No jobs on the board right now" body="New clients drop in through the day, and the Owner can post work any time. Check back soon!" />
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {open.map((j: any) => (
            <div key={j.id} className="card flex flex-col gap-2" data-testid={`job-${j.id}`}>
              <div className="flex items-start gap-2">
                <span className="text-4xl">{j.task.emoji}</span>
                <div className="flex-1">
                  <div className="h3">{j.task.title}</div>
                  <div className="text-xs muted">{WORK_CATEGORIES[j.task.category as WorkCategory]?.emoji} {WORK_CATEGORIES[j.task.category as WorkCategory]?.label} · {stars(j.task.difficulty)}</div>
                </div>
                <div className="text-right"><b className="text-lg">{formatBits(j.reward)}</b><div className="text-xs muted">for 100%</div></div>
              </div>
              <div className="text-sm"><span className="mr-1">{j.clientEmoji}</span><b>{j.clientName}</b>{j.clientNote ? <span className="italic">: "{j.clientNote}"</span> : null}</div>
              <p className="text-sm">{j.task.brief}</p>
              <div className="flex flex-wrap gap-1 text-xs">
                <span className="chip">{GRADING[j.task.grading].emoji} {GRADING[j.task.grading].label}</span>
                <span className="chip">⚡ {j.task.energy}</span>
                <span className="chip">⏱️ {j.task.minutes} min</span>
                <span className="chip">👥 {j.slots - j.taken} of {j.slots} spots</span>
                {j.targetCompanyId && <span className="chip !bg-amber-100">🎯 Just for you</span>}
                <span className="chip">closes in {timeLeft(j.expiresAt)}</span>
              </div>
              <button className="btn-primary" disabled={take.isPending || !!working} onClick={() => take.mutate(j.id)} data-testid="take-job">{working ? 'Finish your current job first' : 'Take this job ✍️'}</button>
            </div>
          ))}
        </div>
      )}
      {d.mine.length > 0 && (
        <div className="card">
          <div className="h3 mb-1">🗃️ Your jobs</div>
          {d.mine.map((s: any) => (
            <Link key={s.id} to={`/work/${s.id}`} className="flex items-center gap-2 text-sm py-1.5 border-b border-ink/5 hover:bg-accent/5">
              <span className="text-xl">{s.emoji}</span>
              <span className="flex-1">{s.title} <span className="muted text-xs">· {s.clientEmoji} {s.clientName} · {timeAgo(s.startedAt)}</span></span>
              <span className="text-xs">{STATUS[s.status]}</span>
              {s.status === 'graded' && <b className="w-24 text-right">{s.score}% · {s.payout} BT</b>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Show reference data: CSV-like text becomes a table, everything else keeps its layout. */
export function Reference({ text }: { text: string }) {
  const lines = text.trim().split('\n');
  const cols = lines[0]?.split(',').length ?? 0;
  if (lines.length >= 2 && cols >= 2 && lines.every((l) => l.split(',').length === cols)) {
    const [head, ...rows] = lines.map((l) => l.split(',').map((c) => c.trim()));
    return (
      <div className="overflow-x-auto">
        <table className="text-sm w-full border-collapse">
          <thead><tr>{head.map((h, i) => <th key={i} className="text-left border-b-2 border-ink/30 px-2 py-1">{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i} className="odd:bg-ink/5">{r.map((c, k) => <td key={k} className="px-2 py-1">{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  return <pre className="text-sm whitespace-pre-wrap font-mono bg-ink/5 rounded-xl p-3">{text}</pre>;
}

export function AnswerBox({ f, value, onChange, disabled }: { f: any; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  if (f.type === 'long') return <textarea className="input" rows={6} maxLength={4000} value={value} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} aria-label={f.label} disabled={disabled} />;
  if (f.type === 'choice')
    return (
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={f.label} disabled={disabled}>
        <option value="">Pick one...</option>
        {(f.options ?? []).map((o: string) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  return <input className="input" inputMode={f.type === 'number' ? 'decimal' : undefined} maxLength={300} value={value} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} aria-label={f.label} disabled={disabled} />;
}

export function Workspace() {
  const { id } = useParams();
  const now = useNow(1000);
  const confetti = useStore((s) => s.confetti);
  const q = useApi<any>(['work', 'sub', id], `/game/submissions/${id}`, { refetchInterval: 15_000 });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const hand = useAction(() => POST<any>(`/game/submissions/${id}`, { answers }), {
    invalidate: [['work'], ['me'], ['home'], ['quests']],
    onSuccess: (r) => {
      if (r.status === 'graded') {
        if (r.score >= 80) {
          sfx.levelUp();
          confetti();
        } else sfx.coin();
      } else sfx.click();
    },
    success: (r) => (r.status === 'graded' ? `${r.score}%: you earned ${r.payout} BT!` : r.grading === 'owner' ? 'Handed in! The Owner will grade it.' : 'Handed in! The AI is still reading it; your pay arrives when it is graded.'),
  });
  if (!q.data) return <LoadingJoke />;
  const { submission: s, job } = q.data;
  const t = job.task;
  const done = s.status !== 'working';
  const shown = done ? (s.answers ?? {}) : answers;
  const left = s.dueAt - now;
  return (
    <div className="flex flex-col gap-4">
      <Link to="/work" className="text-sm underline">← Office Work</Link>
      <div className="card flex flex-col gap-2">
        <div className="flex items-start gap-3">
          <span className="text-5xl">{t.emoji}</span>
          <div className="flex-1">
            <h1 className="h2">{t.title}</h1>
            <div className="text-sm">{job.clientEmoji} <b>{job.clientName}</b>{job.clientNote ? <i>: "{job.clientNote}"</i> : null}</div>
            <div className="text-xs muted">{GRADING[t.grading].emoji} {GRADING[t.grading].blurb} Pays up to {formatBits(job.reward)}.</div>
          </div>
          {!done && <div className={`text-right font-bold ${left < 60_000 ? 'text-rose-600 animate-pulse' : ''}`} aria-live="polite">⏱️ {timeLeft(s.dueAt)}</div>}
        </div>
        {!done && <ProgressBar value={Math.max(0, left)} max={t.minutes * 60_000} label="Time left" />}
      </div>
      <div className="card flex flex-col gap-2">
        <div className="h3">📋 The brief</div>
        <p className="text-sm whitespace-pre-wrap">{t.brief}</p>
        {t.rubric && t.grading !== 'auto' && <p className="text-xs muted">What a great answer has: {t.rubric}</p>}
      </div>
      {t.reference && (
        <div className="card flex flex-col gap-2">
          <div className="h3">📎 Reference data</div>
          <Reference text={t.reference} />
        </div>
      )}
      <form className="card flex flex-col gap-3" onSubmit={(e) => (e.preventDefault(), hand.mutate(undefined))}>
        <div className="h3">✍️ Your answers</div>
        {t.fields.map((f: any) => {
          const right = s.results?.[f.key];
          return (
            <label key={f.key} className="label">
              <span>{f.label} {s.results && (right ? '✅' : '❌')}</span>
              <AnswerBox f={f} value={String(shown[f.key] ?? '')} onChange={(v) => setAnswers({ ...answers, [f.key]: v })} disabled={done} />
              {s.results && !right && t.answers?.[f.key] !== undefined && <span className="text-xs text-emerald-700">Right answer: <b>{String(t.answers[f.key])}</b></span>}
            </label>
          );
        })}
        {!done && <button className="btn-primary" disabled={hand.isPending || left < -120_000} data-testid="hand-in">{hand.isPending ? (t.grading === 'ai' ? '🤖 The AI is reading...' : 'Handing in...') : '📤 Hand it in'}</button>}
      </form>
      {done && (
        <div className={`card flex flex-col gap-1 ${s.status === 'graded' ? (s.score >= 80 ? '!bg-emerald-50' : s.score >= 50 ? '!bg-amber-50' : '!bg-rose-50') : ''}`} data-testid="job-result">
          <div className="h3">{STATUS[s.status]}</div>
          {s.status === 'graded' && <div className="text-2xl font-black">{s.score}% → {formatBits(s.payout)}</div>}
          {s.feedback && <p className="text-sm">{s.gradedBy === 'ai' ? '🤖' : s.gradedBy === 'owner' ? '👑' : '✅'} {s.feedback}</p>}
          {s.status === 'grading' && <p className="text-sm muted">{t.grading === 'owner' ? 'The Owner will grade this soon.' : 'The AI grades it within a few minutes.'} You will get a notification.</p>}
        </div>
      )}
    </div>
  );
}
