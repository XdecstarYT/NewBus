import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router';
import { MODULES, MODULE_INFO, type Permissions, formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { DEL, PATCH, POST, PUT, GET, idemKey } from '../../lib/api';
import { LoadingJoke, Modal, EmptyState, timeAgo, useConfirm, Pill } from '../../components/ui';
import { PermissionEditor } from '../../components/PermissionEditor';
import { useStore } from '../../lib/store';

interface CompanyRow {
  id: string;
  name: string;
  emoji: string;
  color: string;
  status: string;
  industryId: string;
  industryName: string;
  industryEmoji: string;
  category: string;
  level: number;
  balance: number;
  workers: number;
  incomePerTick: number;
  listed: boolean;
  ipoStatus: string;
  admin: { accountNumber: string; lastLogin: number | null; id: string } | null;
  lastActiveAt: number;
}

export function CompanyList() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [listed, setListed] = useState('');
  const [industry, setIndustry] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (listed) params.set('listed', listed);
  if (industry) params.set('industryId', industry);
  const list = useApi<CompanyRow[]>(['owner-companies', params.toString()], `/owner/companies?${params}`);
  const industries = useApi<any[]>(['owner-industries'], '/owner/industries');
  const navigate = useNavigate();
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="h1 mr-auto">Companies</h1>
        <button className="btn-ghost btn-sm" disabled={!selected.size} onClick={() => setBulkOpen(true)}>⚡ Bulk actions ({selected.size})</button>
        <button className="btn-primary btn-sm" onClick={() => navigate('/owner/builder')}>➕ Company Builder</button>
      </div>
      <div className="flex gap-2 flex-wrap">
        <input className="input flex-1 min-w-[160px]" placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search companies" />
        <select className="input w-auto" value={industry} onChange={(e) => setIndustry(e.target.value)} aria-label="Industry filter">
          <option value="">All industries</option>
          {(industries.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.emoji} {i.name}</option>)}
        </select>
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="archived">Archived</option>
        </select>
        <select className="input w-auto" value={listed} onChange={(e) => setListed(e.target.value)} aria-label="Exchange filter">
          <option value="">Listed or not</option>
          <option value="1">On the exchange</option>
          <option value="0">Not listed</option>
        </select>
      </div>
      {list.isLoading ? (
        <LoadingJoke />
      ) : !list.data?.length ? (
        <EmptyState emoji="🏚️" title="No companies yet" body="The town is empty. Fire up the Company Builder and hand out some badges!" />
      ) : (
        <div className="card !p-0 overflow-x-auto">
          <table className="table-clean">
            <thead>
              <tr>
                <th><input type="checkbox" aria-label="Select all" checked={selected.size === list.data.length} onChange={(e) => setSelected(e.target.checked ? new Set(list.data!.map((c) => c.id)) : new Set())} /></th>
                <th>Company</th>
                <th>Industry</th>
                <th>Lv</th>
                <th>Bits</th>
                <th>Workers</th>
                <th>Login</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id} className="hover:bg-accent/5">
                  <td><input type="checkbox" aria-label={`Select ${c.name}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></td>
                  <td>
                    <Link to={`/owner/companies/${c.id}`} className="font-bold flex items-center gap-2 hover:underline">
                      <span className="text-xl">{c.emoji}</span> {c.name}
                      {c.listed && <Pill>📈</Pill>}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap">{c.industryEmoji} {c.industryName}</td>
                  <td>{c.level}</td>
                  <td className="tabular-nums">{formatBits(c.balance)}</td>
                  <td>{c.workers}</td>
                  <td className="whitespace-nowrap">
                    <span className="font-display font-bold">{c.admin?.accountNumber}</span>
                    <span className="text-xs muted block">{timeAgo(c.admin?.lastLogin)}</span>
                  </td>
                  <td><span className={`chip ${c.status === 'active' ? '!bg-good/20' : '!bg-warn/20'}`}>{c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <BulkModal open={bulkOpen} onClose={() => setBulkOpen(false)} ids={[...selected]} />
    </div>
  );
}

function BulkModal({ open, onClose, ids }: { open: boolean; onClose: () => void; ids: string[] }) {
  const [type, setType] = useState('grantBits');
  const [amount, setAmount] = useState(500);
  const [reason, setReason] = useState('Owner bonus');
  const [templateId, setTemplateId] = useState('');
  const [mod, setMod] = useState('pods');
  const [enabled, setEnabled] = useState(true);
  const [title, setTitle] = useState('Hello from the Owner');
  const [body, setBody] = useState('');
  const templates = useApi<any[]>(['owner-templates'], '/owner/templates');
  const act = useAction(
    () => {
      const action =
        type === 'applyTemplate' ? { type, templateId }
        : type === 'grantBits' || type === 'takeBits' ? { type, amount, reason }
        : type === 'suspend' ? { type, suspended: enabled }
        : type === 'message' ? { type, title, body }
        : { type, module: mod, enabled };
      return POST('/owner/companies/bulk', { companyIds: ids, action });
    },
    { invalidate: [['owner-companies']], success: (r: any) => `Done! ${r.results.filter((x: any) => x.ok).length}/${r.results.length} companies updated.`, onSuccess: onClose },
  );
  return (
    <Modal open={open} onClose={onClose} title={`⚡ Bulk action on ${ids.length} companies`}>
      <div className="flex flex-col gap-3">
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="grantBits">🎁 Grant Bits</option>
          <option value="takeBits">💸 Take Bits</option>
          <option value="applyTemplate">📋 Apply permission template</option>
          <option value="toggleModule">🔀 Toggle a module</option>
          <option value="suspend">⛔ Suspend / unsuspend</option>
          <option value="message">📣 Send a message</option>
        </select>
        {(type === 'grantBits' || type === 'takeBits') && (
          <>
            <input type="number" className="input" value={amount} min={1} onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))} aria-label="Amount" />
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
          </>
        )}
        {type === 'applyTemplate' && (
          <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">Pick a template</option>
            {(templates.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        {type === 'toggleModule' && (
          <div className="flex gap-2">
            <select className="input" value={mod} onChange={(e) => setMod(e.target.value)}>
              {MODULES.map((m) => <option key={m} value={m}>{MODULE_INFO[m].emoji} {MODULE_INFO[m].label}</option>)}
            </select>
            <select className="input w-28" value={String(enabled)} onChange={(e) => setEnabled(e.target.value === 'true')}>
              <option value="true">On</option>
              <option value="false">Off</option>
            </select>
          </div>
        )}
        {type === 'suspend' && (
          <select className="input" value={String(enabled)} onChange={(e) => setEnabled(e.target.value === 'true')}>
            <option value="true">Suspend</option>
            <option value="false">Unsuspend</option>
          </select>
        )}
        {type === 'message' && (
          <>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
            <textarea className="input min-h-[80px]" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Message" />
          </>
        )}
        <button className="btn-primary" disabled={act.isPending || (type === 'applyTemplate' && !templateId) || (type === 'message' && !body)} onClick={() => act.mutate(undefined)}>
          Apply to {ids.length} companies
        </button>
      </div>
    </Modal>
  );
}

export function CompanyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useStore((s) => s.toast);
  const detail = useApi<any>(['owner-company', id], `/owner/companies/${id}`);
  const [perms, setPerms] = useState<Permissions | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const [pwResult, setPwResult] = useState<any>(null);
  const [industryOpen, setIndustryOpen] = useState(false);
  const [money, setMoney] = useState({ amount: 1000, reason: 'Owner adjustment' });
  const industries = useApi<any[]>(['owner-industries'], '/owner/industries');
  const [newIndustry, setNewIndustry] = useState('');

  const savePerms = useAction((p: Permissions) => PUT(`/owner/companies/${id}/permissions`, { permissions: p }), { invalidate: [['owner-company', id]], success: 'Permissions saved - applied instantly! ⚡', onSuccess: () => setPerms(null) });
  const saveEdit = useAction((p: any) => PATCH(`/owner/companies/${id}`, p), { invalidate: [['owner-company', id], ['owner-companies']], success: 'Saved!', onSuccess: () => setEdit(null) });
  const resetPw = useAction((accId: string) => POST(`/owner/accounts/${accId}/reset-password`, { mustChangePassword: true }), { onSuccess: (r) => setPwResult(r) });
  const forceLogout = useAction((accId: string) => POST(`/owner/accounts/${accId}/logout`), { success: 'Kicked out of every device. 👢' });
  const moneyAct = useAction((kind: string) => POST(`/owner/money/${kind}`, { companyId: id, amount: money.amount, reason: money.reason, idempotencyKey: idemKey(kind) }), { invalidate: [['owner-company', id]], success: 'Done. Logged in the audit trail. 📝' });
  const changeInd = useAction(() => POST(`/owner/companies/${id}/industry`, { industryId: newIndustry, confirm: true }), { invalidate: [['owner-company', id]], success: 'Industry changed! The workers are re-training.', onSuccess: () => setIndustryOpen(false) });

  if (detail.isLoading || !detail.data) return <LoadingJoke />;
  const c = detail.data;

  async function del() {
    const name = window.prompt(`Type "${c.name}" to permanently delete it. Its Bits go back to the Treasury.`);
    if (name !== c.name) return toast('Deletion cancelled (name did not match).', 'info');
    await DEL(`/owner/companies/${id}`, { confirmName: name });
    toast(`${c.name} has been demolished. 🏚️`, 'good');
    navigate('/owner/companies');
  }
  async function clone() {
    const tpl = await GET(`/owner/companies/${id}/template`);
    navigate('/owner/builder', { state: { template: tpl } });
  }
  async function setStatus(status: string) {
    if (status !== 'active' && !(await confirm({ title: `${status === 'suspended' ? 'Suspend' : 'Archive'} ${c.name}?`, body: 'Their logins will be kicked out until you change this back.', danger: true }))) return;
    saveEdit.mutate({ status });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-5xl">{c.emoji}</span>
        <div className="mr-auto">
          <h1 className="h1" style={{ color: c.color }}>{c.name}</h1>
          <div className="muted text-sm">{c.industryEmoji} {c.industryName} · Lv {c.level} · {formatBits(c.balance)} · {c.workers} workers · <span className="chip">{c.status}</span></div>
        </div>
        <button className="btn-primary btn-sm" onClick={() => navigate(`/viewas/${c.id}/office`)} data-testid="view-as">👀 View as company</button>
        <button className="btn-ghost btn-sm" onClick={() => setEdit({ name: c.name, emoji: c.emoji, color: c.color, slogan: c.raw.slogan, difficulty: c.difficulty })}>✏️ Edit</button>
        <button className="btn-ghost btn-sm" onClick={clone}>🧬 Clone as template</button>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <div className="flex items-center mb-2">
            <h2 className="h2 mr-auto">🔐 Permissions</h2>
            {perms ? (
              <>
                <button className="btn-ghost btn-sm mr-2" onClick={() => setPerms(null)}>Cancel</button>
                <button className="btn-good btn-sm" onClick={() => savePerms.mutate(perms)} data-testid="save-perms">Save (applies instantly)</button>
              </>
            ) : (
              <button className="btn-primary btn-sm" onClick={() => setPerms(JSON.parse(JSON.stringify(c.permissions)))} data-testid="edit-perms">Edit</button>
            )}
          </div>
          {perms ? (
            <PermissionEditor value={perms} onChange={setPerms} />
          ) : (
            <div className="flex flex-wrap gap-1">
              {MODULES.map((m) => (
                <span key={m} className={`chip ${c.permissions.modules[m] ? '!bg-good/20' : 'opacity-40 line-through'}`}>{MODULE_INFO[m].emoji} {MODULE_INFO[m].label}</span>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="card">
            <h2 className="h3 mb-2">🪪 Logins</h2>
            {c.accounts.map((a: any) => (
              <div key={a.id} className="card-flat mb-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-display font-extrabold text-lg">{a.accountNumber}</span>
                  <span>{a.displayName}</span>
                  <span className="chip ml-auto">{a.role === 'COMPANY_ADMIN' ? 'CEO' : a.jobTitle ?? a.role}</span>
                </div>
                <div className="text-xs muted">Last login {timeAgo(a.lastLogin)} · {a.status}</div>
                <div className="flex gap-1 mt-2">
                  <button className="btn-ghost btn-sm" onClick={() => resetPw.mutate(a.id)}>🔑 Reset password</button>
                  <button className="btn-ghost btn-sm" onClick={() => forceLogout.mutate(a.id)}>👢 Force logout</button>
                </div>
              </div>
            ))}
          </div>
          <div className="card">
            <h2 className="h3 mb-2">💰 Money tools</h2>
            <div className="flex gap-2 mb-2">
              <input type="number" className="input" min={1} value={money.amount} onChange={(e) => setMoney({ ...money, amount: Math.max(1, Math.floor(Number(e.target.value))) })} aria-label="Amount" />
            </div>
            <input className="input mb-2" value={money.reason} onChange={(e) => setMoney({ ...money, reason: e.target.value })} aria-label="Reason" />
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-good btn-sm" onClick={() => moneyAct.mutate('grant')}>🎁 Grant (Treasury)</button>
              <button className="btn-ghost btn-sm" onClick={() => moneyAct.mutate('take')}>💸 Take</button>
              <button className="btn-primary btn-sm" onClick={() => moneyAct.mutate('mint')}>🪙 Mint new</button>
              <button className="btn-bad btn-sm" onClick={() => moneyAct.mutate('burn')}>🔥 Burn</button>
            </div>
          </div>
          <div className="card">
            <h2 className="h3 mb-2">⚙️ Status & danger zone</h2>
            <div className="flex flex-wrap gap-2">
              {c.status !== 'active' && <button className="btn-good btn-sm" onClick={() => setStatus('active')}>✅ Reactivate</button>}
              {c.status !== 'suspended' && <button className="btn-ghost btn-sm" onClick={() => setStatus('suspended')}>⛔ Suspend</button>}
              {c.status !== 'archived' && <button className="btn-ghost btn-sm" onClick={() => setStatus('archived')}>🗄️ Archive</button>}
              <button className="btn-ghost btn-sm" onClick={() => setIndustryOpen(true)}>🔁 Change industry</button>
              <button className="btn-bad btn-sm" onClick={del}>💥 Delete</button>
            </div>
          </div>
        </div>
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title="Edit company">
        {edit && (
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); saveEdit.mutate(edit); }}>
            <label className="label">Name<input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label className="label">Emoji<input className="input" value={edit.emoji} onChange={(e) => setEdit({ ...edit, emoji: e.target.value })} /></label>
            <label className="label">Colour<input type="color" className="w-16 h-10" value={edit.color} onChange={(e) => setEdit({ ...edit, color: e.target.value })} /></label>
            <label className="label">Slogan<input className="input" value={edit.slogan} onChange={(e) => setEdit({ ...edit, slogan: e.target.value })} /></label>
            <label className="label">Difficulty
              <select className="input" value={edit.difficulty} onChange={(e) => setEdit({ ...edit, difficulty: e.target.value })}>
                <option value="CHILL">Chill</option><option value="NORMAL">Normal</option><option value="CHAOS">Chaos</option>
              </select>
            </label>
            <button className="btn-primary">Save</button>
          </form>
        )}
      </Modal>
      <Modal open={!!pwResult} onClose={() => setPwResult(null)} title="🔑 New temporary password">
        <p>Account <b className="font-display text-xl">{pwResult?.accountNumber}</b></p>
        <p className="font-display font-extrabold text-2xl my-2" data-testid="reset-password">{pwResult?.tempPassword}</p>
        <p className="text-sm muted">Shown once. They'll have to change it at next login. All their sessions were logged out.</p>
      </Modal>
      <Modal open={industryOpen} onClose={() => setIndustryOpen(false)} title="🔁 Change industry">
        <div className="card-flat !bg-warn/10 text-sm mb-3">
          <b>What resets:</b> workplaces (rebuilt at starter tiers), product prices, product inventory, production queues and open contracts.<br />
          <b>What stays:</b> Bits, workers (re-trained into the new industry's roles), level, achievements, stock listing.
        </div>
        <select className="input mb-3" value={newIndustry} onChange={(e) => setNewIndustry(e.target.value)}>
          <option value="">Pick the new industry</option>
          {(industries.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.emoji} {i.name}</option>)}
        </select>
        <button className="btn-bad w-full" disabled={!newIndustry || changeInd.isPending} onClick={() => changeInd.mutate(undefined)}>I understand - change it</button>
      </Modal>
    </div>
  );
}
