import { useMemo, useState } from 'react';
import { GAME_HOUR, ITEM_IDS, WORK_CATEGORIES, formatGameDuration, type WorkCategory } from '@dw/shared/live';
import { PATCH, POST } from '../../lib/api';
import { useApi, useAction } from '../../lib/hooks';
import { formatBits, itemLabel } from '../../lib/game';
import { EmptyState, LoadingJoke, Tabs, timeAgo, timeLeft, Toggle } from '../../components/ui';
import { AnswerBox, GRADING, Reference } from '../play/Work';

type Tab = 'post' | 'templates' | 'ai' | 'review' | 'jobs';

/** The Owner's office-work desk: post jobs, build templates, grade hand-ins. */
export function OwnerWork() {
  const q = useApi<any>(['owner', 'work'], '/owner/work', { refetchInterval: 20_000 });
  const [tab, setTab] = useState<Tab>('post');
  const [editing, setEditing] = useState<any>(null);
  const [posting, setPosting] = useState<any>(null);
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  const startEdit = (t: any) => (setEditing(t), setTab('templates'));
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">💼 Office Work</h1>
      <p className="text-sm muted">Post real desk jobs for players. Pick from {d.templates.length} templates or write your own with reference data. Pay comes from the Treasury and is paid by score.</p>
      <Tabs
        tabs={[
          { id: 'post', label: '📮 Post a job' },
          { id: 'templates', label: '🧩 My templates' },
          { id: 'ai', label: '🤖 AI template maker' },
          { id: 'review', label: `🗂️ To grade (${d.review.length})` },
          { id: 'jobs', label: '📋 Jobs' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'post' && (posting ? <PostJob t={posting} onDone={() => (setPosting(null), setTab('jobs'))} onBack={() => setPosting(null)} /> : <Browser templates={d.templates} onPick={setPosting} onCopy={(t) => startEdit({ ...t, id: undefined, title: `${t.title} (copy)` })} />)}
      {tab === 'templates' && (editing ? <Editor initial={editing} onDone={() => setEditing(null)} /> : <MyTemplates templates={d.templates.filter((t: any) => t.source !== 'builtin')} onEdit={startEdit} onNew={() => setEditing(blank())} onPost={(t) => (setPosting(t), setTab('post'))} />)}
      {tab === 'ai' && <AiMaker on={d.aiOn} onDraft={(t) => startEdit(t)} />}
      {tab === 'review' && <Review queue={d.review} aiOn={d.aiOn} />}
      {tab === 'jobs' && <Jobs jobs={d.jobs} />}
    </div>
  );
}

const blank = () => ({ category: 'data', title: '', emoji: '💼', brief: '', reference: '', fields: [{ key: 'answer', label: 'Answer', type: 'text' }], grading: 'owner', answers: {}, rubric: '', reward: 60, energy: 5, minutes: 15, difficulty: 1 });

function Browser({ templates, onPick, onCopy }: { templates: any[]; onPick: (t: any) => void; onCopy: (t: any) => void }) {
  const [cat, setCat] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [peek, setPeek] = useState<any>(null);
  const shown = useMemo(() => templates.filter((t) => (cat === 'all' || t.category === cat) && (!search || `${t.title} ${t.brief}`.toLowerCase().includes(search.toLowerCase()))), [templates, cat, search]);
  return (
    <div className="grid lg:grid-cols-[220px_1fr] gap-3">
      <div className="card !p-2 flex flex-col gap-0.5 max-h-[70vh] overflow-y-auto">
        <button className={`text-left text-sm p-1.5 rounded-lg ${cat === 'all' ? 'bg-accent text-white' : 'hover:bg-accent/10'}`} onClick={() => setCat('all')}>📚 Everything ({templates.length})</button>
        {(Object.keys(WORK_CATEGORIES) as WorkCategory[]).map((c) => (
          <button key={c} className={`text-left text-sm p-1.5 rounded-lg ${cat === c ? 'bg-accent text-white' : 'hover:bg-accent/10'}`} onClick={() => setCat(c)}>
            {WORK_CATEGORIES[c].emoji} {WORK_CATEGORIES[c].label} ({templates.filter((t) => t.category === c).length})
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <input className="input" placeholder="🔎 Search templates" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search templates" />
        {!shown.length && <EmptyState emoji="🔎" title="No templates match" />}
        <div className="grid md:grid-cols-2 gap-2">
          {shown.map((t) => (
            <div key={t.id} className="card !p-3 flex flex-col gap-1" data-testid={`tpl-${t.id}`}>
              <div className="flex items-center gap-2">
                <span className="text-2xl">{t.emoji}</span>
                <b className="flex-1">{t.title}</b>
                <span className="chip text-xs">{GRADING[t.grading].emoji}</span>
                {t.source !== 'builtin' && <span className="chip text-xs">{t.source === 'ai' ? '🤖 AI-made' : '✏️ Yours'}</span>}
              </div>
              <p className="text-xs">{t.brief}</p>
              <div className="text-xs muted">{'⭐'.repeat(t.difficulty)} · {t.reward} BT · ⚡{t.energy} · {t.minutes} min · {t.fields.length} answer box{t.fields.length === 1 ? '' : 'es'}</div>
              <div className="flex gap-1">
                <button className="btn-primary btn-sm" onClick={() => onPick(t)}>📮 Post</button>
                <button className="btn-ghost btn-sm" onClick={() => setPeek(peek?.id === t.id ? null : t)}>{peek?.id === t.id ? 'Hide' : '👀 Preview'}</button>
                <button className="btn-ghost btn-sm" onClick={() => onCopy(t)}>📄 Copy & edit</button>
              </div>
              {peek?.id === t.id && <Preview t={t} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Preview({ t }: { t: any }) {
  return (
    <div className="flex flex-col gap-2 border-t border-ink/10 pt-2 text-sm">
      {t.reference && <Reference text={t.reference} />}
      {t.fields.map((f: any) => <div key={f.key}><b>{f.label}</b> <span className="text-xs muted">({f.type}{f.options ? `: ${f.options.join(' / ')}` : ''})</span>{t.answers?.[f.key] !== undefined && <span className="text-xs text-emerald-700"> → {String(t.answers[f.key])}</span>}</div>)}
      {t.rubric && <div className="text-xs muted">Rubric: {t.rubric}</div>}
    </div>
  );
}

function PostJob({ t, onDone, onBack }: { t: any; onDone: () => void; onBack: () => void }) {
  const companies = useApi<any[]>(['companies'], '/game/companies');
  const [f, setF] = useState({ slots: 3, reward: t.reward, hours: 24, clientName: '', clientEmoji: '', clientNote: '', targetCompanyId: '' });
  const post = useAction(() => POST<any>('/owner/work/jobs', { templateId: t.id, ...f, clientName: f.clientName || undefined, clientEmoji: f.clientEmoji || undefined, clientNote: f.clientNote || undefined, targetCompanyId: f.targetCompanyId || null }), {
    invalidate: [['owner']],
    success: (r) => `📮 Posted! ${r.slots} spot${r.slots === 1 ? '' : 's'} at ${r.reward} BT.`,
    onSuccess: onDone,
  });
  return (
    <form className="card flex flex-col gap-2 max-w-2xl" onSubmit={(e) => (e.preventDefault(), post.mutate(undefined))}>
      <button type="button" className="text-sm underline self-start" onClick={onBack}>← Back to templates</button>
      <div className="h2">{t.emoji} {t.title}</div>
      <p className="text-sm">{t.brief}</p>
      <div className="grid grid-cols-3 gap-2">
        <label className="label">Spots<input type="number" className="input" min={1} max={50} value={f.slots} onChange={(e) => setF({ ...f, slots: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} /></label>
        <label className="label">Pay per spot (BT)<input type="number" className="input" min={1} value={f.reward} onChange={(e) => setF({ ...f, reward: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} /></label>
        <label className="label">Open for (game hours)<input type="number" className="input" min={1} max={336} value={f.hours} onChange={(e) => setF({ ...f, hours: Number(e.target.value) || 1 })} /></label>
      </div>
      <div className="grid grid-cols-[1fr_80px] gap-2">
        <label className="label">Client name (blank = random)<input className="input" maxLength={40} value={f.clientName} onChange={(e) => setF({ ...f, clientName: e.target.value })} placeholder="Grandma Gloria" /></label>
        <label className="label">Emoji<input className="input" maxLength={8} value={f.clientEmoji} onChange={(e) => setF({ ...f, clientEmoji: e.target.value })} placeholder="👵" /></label>
      </div>
      <label className="label">Note from the client<input className="input" maxLength={300} value={f.clientNote} onChange={(e) => setF({ ...f, clientNote: e.target.value })} placeholder="Need this before my 3 o'clock!" /></label>
      <label className="label">Who can take it<select className="input" value={f.targetCompanyId} onChange={(e) => setF({ ...f, targetCompanyId: e.target.value })}><option value="">Everyone</option>{(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>Only {c.emoji} {c.name}</option>)}</select></label>
      <div className="text-sm">The Treasury sets aside <b>{formatBits(f.slots * f.reward)}</b>. Unearned pay goes back to it.</div>
      <button className="btn-primary" disabled={post.isPending} data-testid="post-job">📮 Post job</button>
    </form>
  );
}

function MyTemplates({ templates, onEdit, onNew, onPost }: { templates: any[]; onEdit: (t: any) => void; onNew: () => void; onPost: (t: any) => void }) {
  const archive = useAction((id: string) => POST(`/owner/work/templates/${id}/archive`), { invalidate: [['owner', 'work']], success: 'Template removed.' });
  return (
    <div className="flex flex-col gap-2">
      <button className="btn-primary self-start" onClick={onNew} data-testid="new-template">➕ New template</button>
      {!templates.length && <EmptyState emoji="🧩" title="No templates of your own yet" body="Make one from scratch, copy a built-in one, or let the AI draft one." />}
      {templates.map((t) => (
        <div key={t.id} className="card !p-3 flex items-center gap-2">
          <span className="text-2xl">{t.emoji}</span>
          <div className="flex-1"><b>{t.title}</b><div className="text-xs muted">{WORK_CATEGORIES[t.category as WorkCategory]?.label} · {GRADING[t.grading].label} · {t.reward} BT {t.source === 'ai' ? '· 🤖 AI-made' : ''}</div></div>
          <button className="btn-primary btn-sm" onClick={() => onPost(t)}>📮 Post</button>
          <button className="btn-ghost btn-sm" onClick={() => onEdit(t)}>✏️ Edit</button>
          <button className="btn-ghost btn-sm" onClick={() => archive.mutate(t.id)}>🗑️</button>
        </div>
      ))}
    </div>
  );
}

/** Build or edit a template: brief, reference data, answer boxes, grading. */
function Editor({ initial, onDone }: { initial: any; onDone: () => void }) {
  const [t, setT] = useState<any>(() => ({ ...blank(), ...initial, answers: { ...(initial.answers ?? {}) }, fields: initial.fields.map((f: any) => ({ ...f })) }));
  const save = useAction(() => POST<any>('/owner/work/templates', { ...t, reference: t.reference || undefined, rubric: t.rubric || undefined, answers: t.grading === 'auto' ? t.answers : undefined, id: t.source === 'builtin' ? undefined : t.id, source: undefined }), {
    invalidate: [['owner', 'work']],
    success: 'Template saved. Post it from "Post a job".',
    onSuccess: onDone,
  });
  const setField = (i: number, patch: any) => setT({ ...t, fields: t.fields.map((f: any, k: number) => (k === i ? { ...f, ...patch } : f)) });
  const rekey = (i: number, key: string) => {
    const old = t.fields[i].key;
    const answers = { ...t.answers };
    if (old in answers) {
      answers[key] = answers[old];
      delete answers[old];
    }
    setT({ ...t, answers, fields: t.fields.map((f: any, k: number) => (k === i ? { ...f, key } : f)) });
  };
  return (
    <form className="card flex flex-col gap-3" onSubmit={(e) => (e.preventDefault(), save.mutate(undefined))}>
      <div className="flex items-center gap-2"><div className="h2 flex-1">{t.id ? '✏️ Edit template' : '➕ New template'}</div><button type="button" className="btn-ghost btn-sm" onClick={onDone}>Cancel</button></div>
      <div className="grid sm:grid-cols-[80px_1fr_200px_120px] gap-2">
        <label className="label">Emoji<input className="input" maxLength={8} value={t.emoji} onChange={(e) => setT({ ...t, emoji: e.target.value })} /></label>
        <label className="label">Title<input className="input" maxLength={80} value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} required /></label>
        <label className="label">Category<select className="input" value={t.category} onChange={(e) => setT({ ...t, category: e.target.value })}>{(Object.keys(WORK_CATEGORIES) as WorkCategory[]).map((c) => <option key={c} value={c}>{WORK_CATEGORIES[c].emoji} {WORK_CATEGORIES[c].label}</option>)}</select></label>
        <label className="label">Difficulty<select className="input" value={t.difficulty} onChange={(e) => setT({ ...t, difficulty: Number(e.target.value) })}><option value={1}>⭐ Easy</option><option value={2}>⭐⭐ Medium</option><option value={3}>⭐⭐⭐ Hard</option></select></label>
      </div>
      <label className="label">Brief: what should the player do?<textarea className="input" rows={3} maxLength={2000} value={t.brief} onChange={(e) => setT({ ...t, brief: e.target.value })} required /></label>
      <label className="label">
        <span>📎 Reference data <span className="text-xs muted">(notes, a list, an email, or CSV like "Name,Qty,Price" — CSV shows as a table)</span></span>
        <textarea className="input font-mono text-sm" rows={8} maxLength={8000} value={t.reference} onChange={(e) => setT({ ...t, reference: e.target.value })} placeholder={'Item,Qty,Price\nPens,10,2\nPaper,4,5'} />
      </label>
      {t.reference && <div className="card-flat !p-2"><div className="text-xs muted mb-1">Players see:</div><Reference text={t.reference} /></div>}
      <div className="flex flex-col gap-2">
        <div className="h3">✍️ Answer boxes</div>
        {t.fields.map((f: any, i: number) => (
          <div key={i} className="card-flat !p-2 grid sm:grid-cols-[1fr_120px_110px_auto] gap-2 items-end">
            <label className="label">Label<input className="input" maxLength={80} value={f.label} onChange={(e) => setField(i, { label: e.target.value })} required /></label>
            <label className="label">Key<input className="input" maxLength={30} value={f.key} onChange={(e) => rekey(i, e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} required /></label>
            <label className="label">Type<select className="input" value={f.type} onChange={(e) => setField(i, { type: e.target.value, options: e.target.value === 'choice' ? (f.options ?? ['Yes', 'No']) : undefined })}><option value="text">Short text</option><option value="long">Paragraph</option><option value="number">Number</option><option value="choice">Choice</option></select></label>
            <button type="button" className="btn-ghost btn-sm" disabled={t.fields.length <= 1} onClick={() => setT({ ...t, fields: t.fields.filter((_: any, k: number) => k !== i) })} aria-label="Remove box">🗑️</button>
            {f.type === 'choice' && <label className="label sm:col-span-4">Options (comma separated)<input className="input" value={(f.options ?? []).join(', ')} onChange={(e) => setField(i, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></label>}
            {t.grading === 'auto' && <label className="label sm:col-span-4">✅ Right answer<AnswerBox f={f} value={String(t.answers[f.key] ?? '')} onChange={(v) => setT({ ...t, answers: { ...t.answers, [f.key]: f.type === 'number' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v } })} /></label>}
          </div>
        ))}
        <button type="button" className="btn-ghost btn-sm self-start" disabled={t.fields.length >= 10} onClick={() => setT({ ...t, fields: [...t.fields, { key: `answer-${t.fields.length + 1}`, label: `Answer ${t.fields.length + 1}`, type: 'text' }] })}>➕ Add a box</button>
      </div>
      <div className="flex flex-col gap-2">
        <div className="h3">🏁 Grading</div>
        <div className="flex flex-wrap gap-2">
          {(['auto', 'ai', 'owner'] as const).map((g) => <button type="button" key={g} className={t.grading === g ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'} onClick={() => setT({ ...t, grading: g })} aria-pressed={t.grading === g}>{GRADING[g].emoji} {GRADING[g].label}</button>)}
        </div>
        <p className="text-xs muted">{GRADING[t.grading].blurb}{t.grading === 'auto' ? ' Numbers allow a tiny rounding difference; text ignores capitals and extra spaces.' : ''}</p>
        {t.grading !== 'auto' && <label className="label">Rubric: what does a great answer have?<textarea className="input" rows={2} maxLength={1000} value={t.rubric} onChange={(e) => setT({ ...t, rubric: e.target.value })} required={t.grading === 'ai'} /></label>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="label">Pay (BT)<input type="number" className="input" min={1} value={t.reward} onChange={(e) => setT({ ...t, reward: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} /></label>
        <label className="label">Energy<input type="number" className="input" min={0} max={100} value={t.energy} onChange={(e) => setT({ ...t, energy: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></label>
        <label className="label">Minutes<input type="number" className="input" min={1} value={t.minutes} onChange={(e) => setT({ ...t, minutes: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} /></label>
      </div>
      <button className="btn-primary" disabled={save.isPending} data-testid="save-template">💾 Save template</button>
    </form>
  );
}

function AiMaker({ on, onDraft }: { on: boolean; onDraft: (t: any) => void }) {
  const [idea, setIdea] = useState('');
  const [category, setCategory] = useState('');
  const make = useAction(() => POST<any>('/owner/work/ai-template', { idea, category: category || undefined }), {
    success: '🤖 Draft ready. Check it, tweak it, then save.',
    onSuccess: (r) => onDraft(r.draft),
  });
  const ideas = ['Reconcile a week of café receipts', 'Write a polite reply to a customer whose parcel is late', 'Sort 10 support tickets by urgency', 'Calculate staff overtime from a timesheet', 'Name a new energy drink and write its tagline'];
  if (!on) return <EmptyState emoji="🔌" title="The AI is off" body="Add your AI key (Groq or Claude) as AIK in Netlify (Site settings → Environment variables), redeploy, and keep AI switched on in the 🤖 AI page." />;
  return (
    <form className="card flex flex-col gap-2 max-w-2xl" onSubmit={(e) => (e.preventDefault(), make.mutate(undefined))}>
      <div className="h3">🤖 Describe a job, the AI builds the template</div>
      <p className="text-sm muted">It writes the brief, invents realistic reference data, picks answer boxes and either the exact answers (instant check) or a rubric (AI graded). You review everything before saving.</p>
      <textarea className="input" rows={3} maxLength={1500} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="e.g. Work out the total cost of a catering order from a price list" aria-label="Your idea" />
      <div className="flex flex-wrap gap-1">{ideas.map((i) => <button type="button" key={i} className="chip text-xs hover:bg-accent/10" onClick={() => setIdea(i)}>{i}</button>)}</div>
      <label className="label">Category (optional)<select className="input" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Let the AI pick</option>{(Object.keys(WORK_CATEGORIES) as WorkCategory[]).map((c) => <option key={c} value={c}>{WORK_CATEGORIES[c].emoji} {WORK_CATEGORIES[c].label}</option>)}</select></label>
      <button className="btn-primary" disabled={make.isPending || idea.trim().length < 3} data-testid="ai-make">{make.isPending ? '🤖 Designing... (up to 10 s)' : '✨ Make template'}</button>
    </form>
  );
}

function Review({ queue, aiOn }: { queue: any[]; aiOn: boolean }) {
  const [scores, setScores] = useState<Record<string, { score: number; feedback: string }>>({});
  const grade = useAction(({ id }: { id: string }) => POST<any>(`/owner/work/submissions/${id}/grade`, scores[id] ?? { score: 70, feedback: '' }), { invalidate: [['owner', 'work']], success: (r) => `Graded: ${r.score}% → ${r.payout} BT` });
  const suggest = useAction((id: string) => POST<any>(`/owner/work/submissions/${id}/ai-grade`), {
    success: '🤖 Suggestion filled in. Adjust it if you like.',
    onSuccess: (r, id) => setScores((s) => ({ ...s, [id]: r.suggestion })),
  });
  if (!queue.length) return <EmptyState emoji="🗂️" title="Nothing to grade" body="Owner-graded work (and AI work the AI could not grade) lands here." />;
  return (
    <div className="flex flex-col gap-3">
      {queue.map((s) => {
        const v = scores[s.id] ?? { score: 70, feedback: '' };
        return (
          <div key={s.id} className="card flex flex-col gap-2" data-testid={`review-${s.id}`}>
            <div className="flex items-center gap-2"><span className="text-3xl">{s.task.emoji}</span><div className="flex-1"><b>{s.task.title}</b><div className="text-xs muted">by {s.player} · {s.company?.emoji} {s.company?.name} · handed in {timeAgo(s.submittedAt)} · pays up to {s.job.reward} BT</div></div></div>
            <details className="text-sm"><summary className="cursor-pointer">Brief & reference</summary><p>{s.task.brief}</p>{s.task.reference && <Reference text={s.task.reference} />}{s.task.rubric && <p className="text-xs muted">Rubric: {s.task.rubric}</p>}</details>
            {s.task.fields.map((f: any) => <div key={f.key} className="text-sm"><b>{f.label}</b><div className="whitespace-pre-wrap rounded-xl bg-ink/5 p-2">{String(s.answers?.[f.key] ?? '') || <i className="muted">(blank)</i>}</div></div>)}
            <div className="grid sm:grid-cols-[140px_1fr] gap-2">
              <label className="label">Score {v.score}%<input type="range" min={0} max={100} step={5} value={v.score} onChange={(e) => setScores({ ...scores, [s.id]: { ...v, score: Number(e.target.value) } })} /></label>
              <label className="label">Feedback<input className="input" maxLength={2000} value={v.feedback} onChange={(e) => setScores({ ...scores, [s.id]: { ...v, feedback: e.target.value } })} placeholder="Great work, next time..." /></label>
            </div>
            <div className="flex gap-2">
              <button className="btn-good btn-sm" onClick={() => grade.mutate({ id: s.id })}>✅ Grade: pay {Math.floor((s.job.reward * v.score) / 100)} BT</button>
              {aiOn && <button className="btn-ghost btn-sm" disabled={suggest.isPending} onClick={() => suggest.mutate(s.id)}>🤖 Ask the AI for a score</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Jobs({ jobs }: { jobs: any[] }) {
  const close = useAction((id: string) => POST<any>(`/owner/work/jobs/${id}/close`), { invalidate: [['owner', 'work']], success: (r) => `Closed. ${r.refunded} BT back to the Treasury.` });
  if (!jobs.length) return <EmptyState emoji="📋" title="No jobs yet" />;
  return (
    <div className="card">
      {jobs.map((j) => (
        <div key={j.id} className="flex items-center gap-2 text-sm py-1.5 border-b border-ink/5">
          <span className="text-xl">{j.task.emoji}</span>
          <span className="flex-1">{j.task.title} <span className="text-xs muted">· {j.clientEmoji} {j.clientName} · {j.postedBy === 'auto' ? '🤖 AI client' : '👑 you'} · {timeAgo(j.createdAt)}</span></span>
          <span className="text-xs">{j.taken}/{j.slots} taken · {j.reward} BT</span>
          {j.status === 'open' ? <><span className="text-xs muted">{timeLeft(j.expiresAt)}</span><button className="btn-ghost btn-sm" onClick={() => close.mutate(j.id)}>Close</button></> : <span className="chip text-xs">closed</span>}
        </div>
      ))}
    </div>
  );
}

// ============================================================ AI panel
export function OwnerAI() {
  const q = useApi<any>(['owner', 'ai'], '/owner/ai', { refetchInterval: 30_000 });
  const o = useApi<any>(['owner', 'overview'], '/owner/overview');
  const [s, setS] = useState<any>(null);
  const [reply, setReply] = useState<string | null>(null);
  const test = useAction(() => POST<any>('/owner/ai/test'), { invalidate: [['owner', 'ai']], onSuccess: (r) => setReply(`${r.reply} (${(r.ms / 1000).toFixed(1)} s)`) });
  const summon = useAction(() => POST<any>('/owner/ai/customers'), { success: (r) => (r.added ? `🧑‍💼 ${r.added} customer${r.added === 1 ? '' : 's'} walked in.` : 'The shop floor is already full.') });
  const save = useAction(() => PATCH('/owner/settings', s), { invalidate: [['owner']], success: 'Saved.', onSuccess: () => setS(null) });
  if (!q.data || !o.data) return <LoadingJoke />;
  const a = q.data;
  const settings = s ?? o.data.settings;
  const num = (k: string, label: string) => <label className="label">{label}<input type="number" className="input" value={settings[k]} onChange={(e) => setS({ ...settings, [k]: Number(e.target.value) })} /></label>;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">🤖 AI</h1>
      <AiActions on={a.on} />
      <SendClient on={a.on} />
      <Requests />
      <div className={`card flex flex-col gap-2 ${a.on ? '!bg-emerald-50' : '!bg-amber-50'}`}>
        <div className="h3">{a.on ? '🟢 The AI is on' : a.configured ? '🟡 Key found, but AI is switched off' : '🔴 No AI key yet'}</div>
        {!a.configured && <p className="text-sm">Add your AI key (Groq <code>gsk_...</code> or Claude <code>sk-ant-...</code>) in Netlify: <b>Site configuration → Environment variables → AIK</b>, then redeploy. Everything still works without it: built-in customers and clients, and written work goes to you to grade.</p>}
        {a.configured && !a.keyLooksRight && <p className="text-sm">⚠️ The AIK value does not look like a Groq key (<code>gsk_...</code>) or a Claude key (<code>sk-ant-...</code>). Check for extra spaces or a missing part.</p>}
        <div className="text-sm">Provider: <b>{a.provider === 'groq' ? 'Groq' : 'Claude'}</b> · model: <code>{a.model}</code> · calls since the server woke up: {a.calls} · failures: {a.failures}</div>
        {a.lastError && <div className="text-xs text-rose-700">Last problem: {a.lastError}</div>}
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary btn-sm" disabled={!a.configured || test.isPending} onClick={() => test.mutate(undefined)} data-testid="ai-test">{test.isPending ? 'Asking...' : '👋 Test the AI'}</button>
          <button className="btn-ghost btn-sm" onClick={() => summon.mutate(undefined)}>🧑‍💼 Bring in customers now</button>
        </div>
        {reply && <div className="text-sm">🤖 {reply}</div>}
      </div>
      <div className="card flex flex-col gap-2">
        <div className="h3">What the AI does</div>
        <ul className="text-sm list-disc pl-5">
          <li>🤖 Grades written office work (emails, reports, pitches) against your rubric.</li>
          <li>🧑‍💼 Plays the walk-in customers, writes what they want, and decides when players haggle.</li>
          <li>💼 Invents the clients who post office jobs on their own each day.</li>
          <li>✨ Drafts new office-work templates for you (Office Work → AI template maker).</li>
        </ul>
        <Toggle checked={settings.aiEnabled} onChange={(v) => setS({ ...settings, aiEnabled: v })} label="Use the AI" />
        <div className="grid sm:grid-cols-3 gap-2">
          {num('autoJobsPerDay', 'AI client jobs per day')}
          {num('customersOpen', 'Customers in the shop at once')}
          {num('customerPayPct', 'Customers pay (% of market)')}
          {num('questReward', 'Daily quest reward (BT)')}
        </div>
        <Toggle checked={settings.mintForWork} onChange={(v) => setS({ ...settings, mintForWork: v })} label="If the Treasury runs dry, print new Bits for office pay, customers and quests" />
        <button className="btn-primary self-start" disabled={!s || save.isPending} onClick={() => save.mutate(undefined)}>Save</button>
      </div>
    </div>
  );
}

// ============================================================ send an AI client
function SendClient({ on }: { on: boolean }) {
  const companies = useApi<any[]>(['companies'], '/game/companies');
  const [f, setF] = useState({ companyId: '', idea: '', slots: 1, reward: 0, hours: 24 });
  const send = useAction(() => POST<any>('/owner/ai/client', { companyId: f.companyId || null, idea: f.idea, slots: f.slots, reward: f.reward || undefined, hours: f.hours }), {
    invalidate: [['owner', 'work']],
    success: (r) => `${r.client.emoji} ${r.client.name} is on the way with "${r.title}" (${r.reward} BT).`,
    onSuccess: () => setF({ ...f, idea: '' }),
  });
  return (
    <form className="card flex flex-col gap-2" onSubmit={(e) => (e.preventDefault(), send.mutate(undefined))}>
      <div className="h3">🧑‍💼 Send an AI client to a business</div>
      <p className="text-sm muted">A client character walks into a company with an office job. Describe the job and the AI writes it from scratch, or leave it empty for a ready-made job.</p>
      <div className="grid sm:grid-cols-[1fr_90px_110px_130px] gap-2">
        <label className="label">Send to<select className="input" value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })} data-testid="client-company"><option value="">Anyone (open job)</option>{(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</select></label>
        <label className="label">Spots<input type="number" className="input" min={1} max={50} value={f.slots} onChange={(e) => setF({ ...f, slots: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} /></label>
        <label className="label">Pay (0 = usual)<input type="number" className="input" min={0} value={f.reward} onChange={(e) => setF({ ...f, reward: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></label>
        <label className="label">Stays (game h)<input type="number" className="input" min={1} max={720} value={f.hours} onChange={(e) => setF({ ...f, hours: Math.max(1, Number(e.target.value) || 1) })} /></label>
      </div>
      <label className="label">The job (optional)<input className="input" maxLength={1500} value={f.idea} onChange={(e) => setF({ ...f, idea: e.target.value })} placeholder="a café owner needs this week's receipts added up" disabled={!on} /></label>
      {!on && <p className="text-xs muted">AI is off: clients bring ready-made jobs with built-in characters.</p>}
      <button className="btn-primary self-start" disabled={send.isPending} data-testid="send-client">{send.isPending ? '🤖 Writing the client...' : '🚪 Send the client'}</button>
    </form>
  );
}

// ============================================================ AI actions
const KINDS: Record<string, string> = {
  request_bits: '📬 Request Bits',
  request_items: '📦 Request goods',
  grant: '🎁 Grant Bits',
  fine: '🧾 Fine',
  message: '✉️ Message',
  news: '📰 News headline',
  client_job: '💼 Client job',
};

function AiActions({ on }: { on: boolean }) {
  const companies = useApi<any[]>(['companies'], '/game/companies');
  const [instruction, setInstruction] = useState('');
  const [plan, setPlan] = useState<{ summary: string; actions: any[] } | null>(null);
  const make = useAction(() => POST<any>('/owner/ai/plan', { instruction }), { onSuccess: (r) => setPlan(r) });
  const run = useAction(() => POST<any>('/owner/ai/run', { actions: plan!.actions }), {
    invalidate: [['owner']],
    success: (r) => `Sent! ${r.done.join(' · ')}`,
    onSuccess: () => (setPlan(null), setInstruction('')),
  });
  const set = (i: number, patch: any) => setPlan({ ...plan!, actions: plan!.actions.map((a, k) => (k === i ? { ...a, ...patch } : a)) });
  const examples = ['Request 200 bits from every company for the new road', 'Ask Wheaty Farms for 30 wheat for the town festival', 'Give everyone 100 bits and post a news headline about the holiday bonus', 'Send a client with an invoice job to every company'];
  const name = (id: string) => (id === 'all' ? '🌍 Every company' : (companies.data ?? []).find((c) => c.id === id)?.name ?? id);
  if (!on) return <div className="card"><div className="h3">✨ AI actions</div><p className="text-sm muted">Turn the AI on (add AIK in Netlify) to give orders in plain English.</p></div>;
  return (
    <div className="card flex flex-col gap-2">
      <div className="h3">✨ AI actions</div>
      <p className="text-sm muted">Say what you want in plain English. The AI turns it into actions; you check and edit them, then send. Nothing happens until you press Send.</p>
      <form className="flex flex-col gap-2" onSubmit={(e) => (e.preventDefault(), make.mutate(undefined))}>
        <textarea className="input" rows={2} maxLength={1500} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Request 500 bits from Crusty Dreams for the bakery licence, due tomorrow" aria-label="Your instruction" />
        <div className="flex flex-wrap gap-1">{examples.map((x) => <button type="button" key={x} className="chip text-xs hover:bg-accent/10" onClick={() => setInstruction(x)}>{x}</button>)}</div>
        <button className="btn-primary self-start" disabled={make.isPending || instruction.trim().length < 3} data-testid="ai-plan">{make.isPending ? '🤖 Thinking...' : '✨ Turn into actions'}</button>
      </form>
      {plan && (
        <div className="flex flex-col gap-2 border-t border-ink/10 pt-2">
          <div className="text-sm">🤖 {plan.summary}</div>
          {!plan.actions.length && <p className="text-sm muted">No actions. Try saying it another way.</p>}
          {plan.actions.map((a, i) => (
            <div key={i} className="card-flat !p-2 flex flex-col gap-2" data-testid="ai-action">
              <div className="flex flex-wrap gap-2 items-end">
                <label className="label">What<select className="input" value={a.kind} onChange={(e) => set(i, { kind: e.target.value })}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                {a.kind !== 'news' && <label className="label">Who<select className="input" value={a.target} onChange={(e) => set(i, { target: e.target.value })}><option value="all">🌍 Every company</option>{(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</select></label>}
                {['request_bits', 'grant', 'fine', 'client_job'].includes(a.kind) && <label className="label">{a.kind === 'client_job' ? 'Pay (0 = usual)' : 'Bits'}<input type="number" className="input !w-28" min={0} value={a.amount} onChange={(e) => set(i, { amount: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></label>}
                {a.kind === 'request_items' && (
                  <>
                    <label className="label">Item<select className="input" value={a.item} onChange={(e) => set(i, { item: e.target.value })}><option value="">Pick...</option>{ITEM_IDS.map((x) => <option key={x} value={x}>{itemLabel(x)}</option>)}</select></label>
                    <label className="label">How many<input type="number" className="input !w-24" min={0} value={a.qty} onChange={(e) => set(i, { qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></label>
                  </>
                )}
                {['request_bits', 'request_items', 'client_job'].includes(a.kind) && <label className="label">Within (game h)<input type="number" className="input !w-24" min={1} max={720} value={a.dueHours} onChange={(e) => set(i, { dueHours: Math.max(1, Number(e.target.value) || 1) })} /></label>}
                <button type="button" className="btn-ghost btn-sm ml-auto" onClick={() => setPlan({ ...plan, actions: plan.actions.filter((_, k) => k !== i) })} aria-label="Remove action">🗑️</button>
              </div>
              <input className="input" maxLength={100} value={a.title} onChange={(e) => set(i, { title: e.target.value })} placeholder="Title" aria-label="Title" />
              <textarea className="input" rows={2} maxLength={500} value={a.message} onChange={(e) => set(i, { message: e.target.value })} placeholder="Message" aria-label="Message" />
              <div className="text-xs muted">→ {a.kind === 'news' ? 'everyone' : name(a.target)}{['request_bits', 'request_items'].includes(a.kind) ? ` · they can pay or decline within ${formatGameDuration(a.dueHours * GAME_HOUR)} (${Math.round((a.dueHours / 12) * 10) / 10} real hours)` : ''}</div>
            </div>
          ))}
          <div className="flex gap-2">
            <button className="btn-good" disabled={run.isPending || !plan.actions.length} onClick={() => run.mutate(undefined)} data-testid="ai-run">📨 Send {plan.actions.length} action{plan.actions.length === 1 ? '' : 's'}</button>
            <button className="btn-ghost" onClick={() => setPlan(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Requests() {
  const q = useApi<any[]>(['owner', 'requests'], '/owner/requests', { refetchInterval: 30_000 });
  const cancel = useAction((id: string) => POST(`/owner/requests/${id}/cancel`), { invalidate: [['owner', 'requests']], success: 'Request withdrawn.' });
  const STATUS: Record<string, string> = { pending: '⏳ Waiting', paid: '✅ Paid', declined: '🙅 Declined', expired: '⌛ No answer', cancelled: '🚫 Withdrawn' };
  if (!q.data?.length) return null;
  return (
    <div className="card">
      <div className="h3 mb-1">📬 Your requests</div>
      {q.data.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2 text-sm py-1 border-b border-ink/5">
          <span className="flex-1">{r.company?.emoji} {r.company?.name}: <b>{r.title}</b> · {r.kind === 'bits' ? formatBits(r.amount) : `${r.qty}× ${itemLabel(r.item)}`}</span>
          <span className="text-xs">{STATUS[r.status]}</span>
          {r.status === 'pending' && <><span className="text-xs muted">{timeLeft(r.dueAt)} left</span><button className="btn-ghost btn-sm" onClick={() => cancel.mutate(r.id)}>Withdraw</button></>}
        </div>
      ))}
    </div>
  );
}
