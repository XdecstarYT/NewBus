import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router';
import { PERMISSION_PRESETS, type Permissions, formatBits } from '@dw/shared';
import { GET, POST } from '../../lib/api';
import { useApi, useAction } from '../../lib/hooks';
import { useStore } from '../../lib/store';
import { BossByteFace } from '../../components/BossByte';
import { PermissionEditor } from '../../components/PermissionEditor';
import { LoadingJoke, Toggle } from '../../components/ui';
import { sfx } from '../../lib/sound';

const EMOJIS = ['🏢', '🚀', '🍕', '🥐', '☕', '🎮', '🤖', '🦄', '🐙', '🌈', '🍩', '🎸', '🧪', '🌵', '🐝', '🦖', '💎', '🛸', '🍦', '🐧', '🌻', '⚡', '🎪', '🧸', '🐉', '🍔', '🧁', '🛠️', '📦', '🎨', '🪐', '🐸', '🦊', '🌮', '🎲', '🧙'];
const COLORS = ['#7c3aed', '#ec4899', '#f59e0b', '#16a34a', '#0ea5e9', '#ef4444', '#14b8a6', '#8b5cf6', '#f97316', '#64748b'];
const GENERIC_SLOGANS = ['Doing digital things, digitally.', 'Now with 30% more synergy!', 'Proudly powered by snacks.', 'Small company, huge ambitions, medium coffee.', 'We put the "pro" in "procrastination". Wait.'];
const STEPS = ['Details', 'Industry', 'Starting package', 'Permissions', 'Login', 'Confirm'];

interface IndustryLite {
  id: string;
  name: string;
  emoji: string;
  color: string;
  category: string;
  categoryId: string;
}

export interface BuilderForm {
  name: string;
  emoji: string;
  color: string;
  slogan: string;
  industryId: string;
  startingBits: number;
  startingWorkers: number;
  startingWorkplace: number;
  difficulty: 'CHILL' | 'NORMAL' | 'CHAOS';
  permissions: Permissions;
  accountNumber: string;
  autoNumber: boolean;
  password: string;
  autoPassword: boolean;
  mustChangePassword: boolean;
  adminName: string;
}

const DIFF_BITS = { CHILL: 3000, NORMAL: 1500, CHAOS: 600 };

export function CompanyBuilder() {
  const loc = useLocation();
  const navigate = useNavigate();
  const prefill = (loc.state as any)?.template as Partial<BuilderForm> | undefined;
  const [step, setStep] = useState(0);
  const [f, setF] = useState<BuilderForm>(() => ({
    name: '',
    emoji: '🏢',
    color: '#7c3aed',
    slogan: '',
    industryId: '',
    startingBits: 1500,
    startingWorkers: 2,
    startingWorkplace: 0,
    difficulty: 'NORMAL',
    permissions: JSON.parse(JSON.stringify(PERMISSION_PRESETS.standard.perms)),
    accountNumber: '',
    autoNumber: true,
    password: '',
    autoPassword: true,
    mustChangePassword: true,
    adminName: 'CEO',
    ...prefill,
  }));
  const set = (p: Partial<BuilderForm>) => setF((x) => ({ ...x, ...p }));
  const [result, setResult] = useState<any>(null);
  const confetti = useStore((s) => s.confetti);
  const say = useStore((s) => s.say);

  const create = useAction(
    () =>
      POST('/owner/companies', {
        name: f.name,
        emoji: f.emoji,
        color: f.color,
        slogan: f.slogan,
        industryId: f.industryId,
        startingBits: f.startingBits,
        startingWorkers: f.startingWorkers,
        startingWorkplace: f.startingWorkplace,
        difficulty: f.difficulty,
        permissions: f.permissions,
        accountNumber: f.autoNumber ? undefined : f.accountNumber,
        password: f.autoPassword ? undefined : f.password,
        mustChangePassword: f.mustChangePassword,
        adminName: f.adminName,
      }),
    {
      invalidate: [['owner-companies']],
      onSuccess: (r) => {
        setResult(r);
        confetti();
        sfx.levelUp();
        say(`🎉 ${r.company.name} is open for business! Hand them the badge and watch the chaos unfold.`, 'wow');
      },
    },
  );

  const canNext = [f.name.trim().length >= 2, !!f.industryId, true, true, f.autoNumber || /^\d{2,8}$/.test(f.accountNumber), true][step];

  if (result) return <WelcomeBadge result={result} onAnother={() => { setResult(null); setStep(0); set({ name: '', slogan: '' }); }} onList={() => navigate('/owner/companies')} />;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <BossByteFace mood="think" size={56} />
        <div>
          <h1 className="h1">Company Builder</h1>
          <p className="muted text-sm">Six easy steps from "idea" to "badge in hand".</p>
        </div>
      </div>
      <ol className="flex gap-1 mb-4 overflow-x-auto no-scrollbar" aria-label="Builder steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button className={`chip whitespace-nowrap ${i === step ? '!bg-accent !text-white' : i < step ? '!bg-good/20' : ''}`} onClick={() => i < step && setStep(i)} aria-current={i === step ? 'step' : undefined}>
              {i + 1}. {s}
            </button>
          </li>
        ))}
      </ol>
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="card">
          {step === 0 && <StepDetails f={f} set={set} />}
          {step === 1 && <StepIndustry f={f} set={set} />}
          {step === 2 && <StepPackage f={f} set={set} />}
          {step === 3 && (
            <div>
              <h2 className="h2 mb-2">4. Permissions</h2>
              <p className="text-sm muted mb-3">Pick a preset or toggle everything by hand. You can change this any time - it applies instantly.</p>
              <PermissionEditor value={f.permissions} onChange={(permissions) => set({ permissions })} />
            </div>
          )}
          {step === 4 && <StepLogin f={f} set={set} />}
          {step === 5 && <StepConfirm f={f} />}
        </motion.div>
      </AnimatePresence>
      <div className="flex justify-between mt-4">
        <button className="btn-ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
          ← Back
        </button>
        {step < 5 ? (
          <button className="btn-primary" disabled={!canNext} onClick={() => { sfx.click(); setStep(step + 1); }}>
            Next →
          </button>
        ) : (
          <button className="btn-good text-lg" disabled={create.isPending} onClick={() => create.mutate(undefined)} data-testid="create-company">
            🎉 Create company
          </button>
        )}
      </div>
    </div>
  );
}

function StepDetails({ f, set }: { f: BuilderForm; set: (p: Partial<BuilderForm>) => void }) {
  async function suggest() {
    sfx.pop();
    if (f.industryId) {
      const r = await GET<{ slogan: string }>(`/owner/suggest-slogan?industryId=${f.industryId}`);
      set({ slogan: r.slogan });
    } else set({ slogan: GENERIC_SLOGANS[Math.floor(Math.random() * GENERIC_SLOGANS.length)] });
  }
  return (
    <div className="flex flex-col gap-3">
      <h2 className="h2">1. Company details</h2>
      <div>
        <label className="label" htmlFor="cname">Company name</label>
        <input id="cname" className="input" maxLength={40} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Crusty Dreams Bakery" autoFocus />
      </div>
      <div>
        <div className="label">Logo</div>
        <div className="flex flex-wrap gap-1">
          {EMOJIS.map((e) => (
            <button key={e} type="button" className={`w-11 h-11 text-2xl rounded-xl border-2 ${f.emoji === e ? 'border-ink bg-accent/20' : 'border-transparent'}`} onClick={() => set({ emoji: e })} aria-label={`Logo ${e}`}>
              {e}
            </button>
          ))}
          <input className="input !w-20 text-center text-2xl" maxLength={4} value={f.emoji} onChange={(e) => set({ emoji: e.target.value })} aria-label="Custom emoji" />
        </div>
      </div>
      <div>
        <div className="label">Brand colour</div>
        <div className="flex flex-wrap gap-2 items-center">
          {COLORS.map((c) => (
            <button key={c} type="button" className={`w-10 h-10 rounded-full border-[3px] ${f.color === c ? 'border-ink scale-110' : 'border-ink/20'}`} style={{ background: c }} onClick={() => set({ color: c })} aria-label={`Colour ${c}`} />
          ))}
          <input type="color" value={f.color} onChange={(e) => set({ color: e.target.value })} className="w-12 h-10" aria-label="Custom colour" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="slogan">Slogan</label>
        <div className="flex gap-2">
          <input id="slogan" className="input" maxLength={120} value={f.slogan} onChange={(e) => set({ slogan: e.target.value })} placeholder="Something catchy..." />
          <button type="button" className="btn-pink whitespace-nowrap" onClick={suggest}>
            🤖 Boss Byte suggests
          </button>
        </div>
      </div>
      <div className="card-flat flex items-center gap-3" style={{ borderColor: f.color }}>
        <span className="text-4xl">{f.emoji}</span>
        <div>
          <div className="font-display font-extrabold text-xl" style={{ color: f.color }}>{f.name || 'Your Company'}</div>
          <div className="text-sm muted italic">{f.slogan || '"..."'}</div>
        </div>
      </div>
    </div>
  );
}

function StepIndustry({ f, set }: { f: BuilderForm; set: (p: Partial<BuilderForm>) => void }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const list = useApi<IndustryLite[]>(['owner-industries'], '/owner/industries');
  const detail = useApi<any>(['owner-industry', f.industryId], f.industryId ? `/owner/industries/${f.industryId}` : null);
  const cats = useMemo(() => [...new Map((list.data ?? []).map((i) => [i.categoryId, i.category])).entries()], [list.data]);
  const filtered = (list.data ?? []).filter((i) => (!cat || i.categoryId === cat) && (!q || i.name.toLowerCase().includes(q.toLowerCase()) || i.category.toLowerCase().includes(q.toLowerCase())));
  if (list.isLoading) return <LoadingJoke />;
  return (
    <div className="flex flex-col gap-3">
      <h2 className="h2">2. Pick an industry <span className="text-sm muted">({list.data?.length} to choose from)</span></h2>
      <div className="flex gap-2 flex-wrap">
        <input className="input flex-1 min-w-[180px]" placeholder="Search industries..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search industries" />
        <select className="input w-auto" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          {cats.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto p-1">
        {filtered.map((i) => (
          <button
            key={i.id}
            type="button"
            onClick={() => { sfx.click(); set({ industryId: i.id }); }}
            className={`card-flat text-left flex items-center gap-2 ${f.industryId === i.id ? '!border-ink !bg-accent/15 border-[3px]' : ''}`}
            data-testid={`industry-${i.id}`}
          >
            <span className="text-2xl">{i.emoji}</span>
            <span className="text-sm font-bold leading-tight">{i.name}<br /><span className="text-[11px] muted font-normal">{i.category}</span></span>
          </button>
        ))}
      </div>
      {detail.data && (
        <div className="card-flat" style={{ borderColor: detail.data.color }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-3xl">{detail.data.emoji}</span>
            <div>
              <div className="h3">{detail.data.name}</div>
              <div className="text-xs muted">{detail.data.category}{detail.data.service ? ' · service industry' : ''}{detail.data.perishable ? ' · perishable goods' : ''}</div>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <div>
              <div className="font-bold">🏢 Workplaces</div>
              <div className="muted">{detail.data.workplaces.map((w: any) => w.name).join(' → ')}</div>
            </div>
            <div>
              <div className="font-bold">🤖 Worker types</div>
              <div className="muted">{detail.data.workers.map((w: any) => `${w.emoji} ${w.name}`).join(', ')}</div>
            </div>
            <div>
              <div className="font-bold">📦 Products</div>
              <div className="muted">{detail.data.productDefs.map((p: any) => `${p.emoji} ${p.name}`).join(', ')}</div>
            </div>
            <div>
              <div className="font-bold">🚚 Supply chain</div>
              <div className="muted">Needs: {detail.data.needs.join(', ') || 'nothing'} · Makes: {detail.data.supplies.join(', ') || 'finished goods only'}</div>
            </div>
          </div>
          <div className="mt-2 text-sm italic">😂 "{detail.data.jokes[0]}"</div>
          <div className="text-sm italic">😂 "{detail.data.jokes[1]}"</div>
        </div>
      )}
    </div>
  );
}

function StepPackage({ f, set }: { f: BuilderForm; set: (p: Partial<BuilderForm>) => void }) {
  const detail = useApi<any>(['owner-industry', f.industryId], f.industryId ? `/owner/industries/${f.industryId}` : null);
  return (
    <div className="flex flex-col gap-3">
      <h2 className="h2">3. Starting package</h2>
      <div>
        <div className="label">Difficulty</div>
        <div className="grid grid-cols-3 gap-2">
          {(['CHILL', 'NORMAL', 'CHAOS'] as const).map((d) => (
            <button key={d} type="button" className={`btn ${f.difficulty === d ? 'bg-accent text-white' : 'bg-card'}`} onClick={() => set({ difficulty: d, startingBits: DIFF_BITS[d] })}>
              {d === 'CHILL' ? '😌 Chill' : d === 'NORMAL' ? '🙂 Normal' : '🤪 Chaos'}
            </button>
          ))}
        </div>
        <p className="text-xs muted mt-1">Chill: more income, fewer disasters. Chaos: events everywhere, a little less starting cash.</p>
      </div>
      <div>
        <label className="label" htmlFor="sbits">Starting Bits: {formatBits(f.startingBits)}</label>
        <input id="sbits" type="number" className="input" min={0} max={10000000} value={f.startingBits} onChange={(e) => set({ startingBits: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
      </div>
      <div>
        <label className="label" htmlFor="sworkers">Starting workers: {f.startingWorkers}</label>
        <input id="sworkers" type="range" min={0} max={10} value={f.startingWorkers} onChange={(e) => set({ startingWorkers: Number(e.target.value) })} className="w-full" />
      </div>
      <div>
        <label className="label" htmlFor="swp">Starting workplace</label>
        <select id="swp" className="input" value={f.startingWorkplace} onChange={(e) => set({ startingWorkplace: Number(e.target.value) })}>
          {(detail.data?.workplaces ?? [{ name: 'Starter workplace' }]).map((w: any, i: number) => (
            <option key={i} value={i}>{w.emoji ?? '🏠'} {w.name}{i > 0 ? ' (a head start!)' : ''}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function StepLogin({ f, set }: { f: BuilderForm; set: (p: Partial<BuilderForm>) => void }) {
  const next = useApi<{ accountNumber: string }>(['owner-next-number'], '/owner/next-account-number');
  useEffect(() => {
    if (next.data && !f.accountNumber) set({ accountNumber: next.data.accountNumber });
  }, [next.data]);
  return (
    <div className="flex flex-col gap-3">
      <h2 className="h2">5. Create the login</h2>
      <div>
        <label className="label" htmlFor="adminName">CEO display name</label>
        <input id="adminName" className="input" value={f.adminName} maxLength={40} onChange={(e) => set({ adminName: e.target.value })} />
      </div>
      <Toggle checked={f.autoNumber} onChange={(v) => set({ autoNumber: v })} label={`Auto-generate account number (next free: ${next.data?.accountNumber ?? '...'})`} />
      {!f.autoNumber && (
        <div>
          <label className="label" htmlFor="accno">Account number (zero-padded, e.g. 07)</label>
          <input id="accno" className="input font-display tracking-widest" inputMode="numeric" value={f.accountNumber} onChange={(e) => set({ accountNumber: e.target.value.replace(/\D/g, '').slice(0, 8) })} />
        </div>
      )}
      <Toggle checked={f.autoPassword} onChange={(v) => set({ autoPassword: v })} label="Generate a fun temporary password" />
      {!f.autoPassword && (
        <div>
          <label className="label" htmlFor="tpw">Temporary password</label>
          <input id="tpw" className="input" value={f.password} onChange={(e) => set({ password: e.target.value })} minLength={4} />
        </div>
      )}
      <Toggle checked={f.mustChangePassword} onChange={(v) => set({ mustChangePassword: v })} label="Force a password change on first login" />
    </div>
  );
}

function StepConfirm({ f }: { f: BuilderForm }) {
  const on = Object.entries(f.permissions.modules).filter(([, v]) => v).length;
  return (
    <div className="flex flex-col gap-2">
      <h2 className="h2">6. Confirm</h2>
      <div className="card-flat flex items-center gap-3">
        <span className="text-5xl">{f.emoji}</span>
        <div>
          <div className="h2" style={{ color: f.color }}>{f.name}</div>
          <div className="italic muted text-sm">{f.slogan}</div>
        </div>
      </div>
      <ul className="text-sm grid sm:grid-cols-2 gap-1">
        <li>🏭 Industry: <b>{f.industryId}</b></li>
        <li>🎚️ Difficulty: <b>{f.difficulty}</b></li>
        <li>💰 Starting Bits: <b>{formatBits(f.startingBits)}</b></li>
        <li>🤖 Starting workers: <b>{f.startingWorkers}</b></li>
        <li>🔓 Modules enabled: <b>{on}</b></li>
        <li>🪪 Account: <b>{f.autoNumber ? 'auto' : f.accountNumber}</b></li>
      </ul>
    </div>
  );
}

function WelcomeBadge({ result, onAnother, onList }: { result: any; onAnother: () => void; onList: () => void }) {
  const toast = useStore((s) => s.toast);
  const link = `${window.location.origin}/`;
  const text = `🪪 Digital Workforce - Welcome Badge\nCompany: ${result.company.name}\nAccount number: ${result.account.accountNumber}\nTemporary password: ${result.tempPassword}\nLogin: ${link}`;
  return (
    <div className="max-w-md mx-auto flex flex-col gap-4">
      <motion.div initial={{ rotate: -8, scale: 0.6, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} transition={{ type: 'spring' }} className="card print:shadow-none" id="welcome-badge" data-testid="welcome-badge">
        <div className="rounded-2xl p-4 text-white" style={{ background: result.company.color }}>
          <div className="flex justify-between items-center">
            <span className="font-display font-extrabold tracking-widest text-sm">WELCOME BADGE</span>
            <span className="text-3xl">{result.company.emoji}</span>
          </div>
          <div className="font-display font-extrabold text-2xl mt-2">{result.company.name}</div>
          <div className="text-sm opacity-90">{result.company.industryEmoji} {result.company.industryName}</div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <dt className="font-bold">Account number</dt>
          <dd className="font-display font-extrabold text-xl tracking-widest" data-testid="badge-account">{result.account.accountNumber}</dd>
          <dt className="font-bold">Temp password</dt>
          <dd className="font-display font-extrabold text-lg" data-testid="badge-password">{result.tempPassword}</dd>
          <dt className="font-bold">Login link</dt>
          <dd className="break-all">{link}</dd>
        </dl>
        <p className="text-xs text-bad font-bold mt-2">⚠️ This password is shown only once. Copy or print it now!</p>
      </motion.div>
      <div className="flex gap-2 flex-wrap">
        <button className="btn-primary flex-1" onClick={() => navigator.clipboard?.writeText(text).then(() => toast('Badge copied to clipboard!', 'good'))}>📋 Copy</button>
        <button className="btn-ghost flex-1" onClick={() => window.print()}>🖨️ Print</button>
      </div>
      <div className="flex gap-2">
        <button className="btn-ghost flex-1" onClick={onAnother}>➕ Build another</button>
        <button className="btn-ghost flex-1" onClick={onList}>📋 Company list</button>
      </div>
    </div>
  );
}
