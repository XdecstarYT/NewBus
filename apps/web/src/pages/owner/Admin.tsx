import { useState } from 'react';
import { ALL_FLAGS, MODULE_INFO, PERMISSION_PRESETS, STAFF_TITLES, type Permissions, formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { DEL, POST, PUT, PATCH } from '../../lib/api';
import { LoadingJoke, Modal, Toggle, timeAgo, useConfirm, EmptyState } from '../../components/ui';
import { PermissionEditor } from '../../components/PermissionEditor';
import { useStore } from '../../lib/store';

// ------------------------------------------------------------------ templates
export function Templates() {
  const list = useApi<Array<{ id: string; name: string; permissions: Permissions; updatedAt: number }>>(['owner-templates'], '/owner/templates');
  const [edit, setEdit] = useState<{ id?: string; name: string; permissions: Permissions } | null>(null);
  const confirm = useConfirm();
  const save = useAction((t: { id?: string; name: string; permissions: Permissions }) => (t.id ? PUT(`/owner/templates/${t.id}`, t) : POST('/owner/templates', t)), {
    invalidate: [['owner-templates']],
    success: 'Template saved!',
    onSuccess: () => setEdit(null),
  });
  const del = useAction((id: string) => DEL(`/owner/templates/${id}`), { invalidate: [['owner-templates']], success: 'Template deleted.' });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center">
        <h1 className="h1 mr-auto">Permission templates</h1>
        <button className="btn-primary btn-sm" onClick={() => setEdit({ name: 'New template', permissions: JSON.parse(JSON.stringify(PERMISSION_PRESETS.standard.perms)) })}>➕ New template</button>
      </div>
      <p className="muted text-sm">Apply templates to many companies at once from the Company List (bulk actions).</p>
      {list.isLoading ? <LoadingJoke /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(list.data ?? []).map((t) => (
            <div key={t.id} className="card">
              <div className="h3">{t.name}</div>
              <div className="text-xs muted mb-2">{Object.values(t.permissions.modules).filter(Boolean).length} modules on · updated {timeAgo(t.updatedAt)}</div>
              <div className="flex gap-2">
                <button className="btn-ghost btn-sm" onClick={() => setEdit({ id: t.id, name: t.name, permissions: t.permissions })}>✏️ Edit</button>
                <button className="btn-ghost btn-sm" onClick={async () => (await confirm({ title: `Delete "${t.name}"?`, danger: true })) && del.mutate(t.id)}>🗑️ Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit template' : 'New template'} wide>
        {edit && (
          <div className="flex flex-col gap-3">
            <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} aria-label="Template name" />
            <PermissionEditor value={edit.permissions} onChange={(p) => setEdit({ ...edit, permissions: p })} />
            <button className="btn-primary" onClick={() => save.mutate(edit)}>Save template</button>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ accounts
export function Accounts() {
  const list = useApi<any[]>(['owner-accounts'], '/owner/accounts');
  const companies = useApi<any[]>(['owner-companies', ''], '/owner/companies?');
  const [q, setQ] = useState('');
  const [pw, setPw] = useState<any>(null);
  const [create, setCreate] = useState<any>(null);
  const [linkEdit, setLinkEdit] = useState<any>(null);
  const reset = useAction((id: string) => POST(`/owner/accounts/${id}/reset-password`, { mustChangePassword: true }), { onSuccess: (r) => setPw(r) });
  const logout = useAction((id: string) => POST(`/owner/accounts/${id}/logout`), { invalidate: [['owner-accounts']], success: 'Logged out everywhere.' });
  const patch = useAction(({ id, ...p }: any) => PATCH(`/owner/accounts/${id}`, p), { invalidate: [['owner-accounts']], success: 'Account updated.', onSuccess: () => setLinkEdit(null) });
  const createAct = useAction((v: any) => POST('/owner/accounts', v), { invalidate: [['owner-accounts']], onSuccess: (r) => { setCreate(null); setPw({ accountNumber: r.account.accountNumber, tempPassword: r.tempPassword }); } });
  const rows = (list.data ?? []).filter((a) => !q || a.accountNumber.includes(q) || a.displayName.toLowerCase().includes(q.toLowerCase()) || a.company?.name?.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="h1 mr-auto">Accounts</h1>
        <input className="input w-48" placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search accounts" />
        <button className="btn-primary btn-sm" onClick={() => setCreate({ role: 'MODERATOR', displayName: '', mustChangePassword: true, moderatorTools: ['mute', 'reports'] })}>➕ New login</button>
      </div>
      {list.isLoading ? <LoadingJoke /> : (
        <div className="card !p-0 overflow-x-auto">
          <table className="table-clean">
            <thead><tr><th>No.</th><th>Name</th><th>Role</th><th>Company</th><th>Status</th><th>Last login</th><th>Sessions</th><th>Linked</th><th></th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="font-display font-extrabold">{a.accountNumber}</td>
                  <td>{a.displayName}{a.mustChangePassword && <span className="chip ml-1">temp pw</span>}{a.totpEnabled && <span className="chip ml-1">2FA</span>}</td>
                  <td>{a.role}{a.jobTitle ? ` · ${a.jobTitle}` : ''}</td>
                  <td>{a.company ? `${a.company.emoji} ${a.company.name}` : '-'}</td>
                  <td>
                    {a.role !== 'OWNER' ? (
                      <select className="input !min-h-[32px] !py-0 !px-2 w-28 text-xs" value={a.status} onChange={(e) => patch.mutate({ id: a.id, status: e.target.value })} aria-label="Status">
                        <option value="active">active</option><option value="suspended">suspended</option><option value="archived">archived</option>
                      </select>
                    ) : 'active'}
                  </td>
                  <td className="text-xs">{timeAgo(a.lastLogin)}</td>
                  <td>{a.activeSessions}</td>
                  <td><button className="chip" onClick={() => setLinkEdit({ id: a.id, linkedGroup: a.linkedGroup ?? '' })}>{a.linkedGroup ?? '—'}</button></td>
                  <td className="whitespace-nowrap">
                    <button className="btn-ghost btn-sm" onClick={() => reset.mutate(a.id)} title="Reset password">🔑</button>{' '}
                    <button className="btn-ghost btn-sm" onClick={() => logout.mutate(a.id)} title="Force logout">👢</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!pw} onClose={() => setPw(null)} title="🔑 Temporary password">
        <p>Account <b className="font-display text-xl">{pw?.accountNumber}</b></p>
        <p className="font-display font-extrabold text-2xl my-2">{pw?.tempPassword}</p>
        <p className="text-sm muted">Shown once. They'll be asked to change it.</p>
      </Modal>
      <Modal open={!!linkEdit} onClose={() => setLinkEdit(null)} title="🔗 Linked-account group">
        <p className="text-sm muted mb-2">Accounts in the same group are treated as the same person: no transfers or trades between them (anti multi-account).</p>
        <input className="input mb-3" value={linkEdit?.linkedGroup ?? ''} onChange={(e) => setLinkEdit({ ...linkEdit, linkedGroup: e.target.value })} placeholder="e.g. family-smith (blank = none)" />
        <button className="btn-primary w-full" onClick={() => patch.mutate({ id: linkEdit.id, linkedGroup: linkEdit.linkedGroup.trim() || null })}>Save</button>
      </Modal>
      <Modal open={!!create} onClose={() => setCreate(null)} title="➕ New login">
        {create && (
          <div className="flex flex-col gap-2">
            <select className="input" value={create.role} onChange={(e) => setCreate({ ...create, role: e.target.value })}>
              <option value="MODERATOR">🛡️ Moderator</option>
              <option value="COMPANY_ADMIN">👔 Company admin (CEO)</option>
              <option value="STAFF">🪪 Staff</option>
            </select>
            <input className="input" placeholder="Display name" value={create.displayName} onChange={(e) => setCreate({ ...create, displayName: e.target.value })} />
            {create.role !== 'MODERATOR' && (
              <select className="input" value={create.companyId ?? ''} onChange={(e) => setCreate({ ...create, companyId: e.target.value })}>
                <option value="">Pick a company</option>
                {(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
              </select>
            )}
            {create.role === 'STAFF' && (
              <select className="input" value={create.jobTitle ?? ''} onChange={(e) => setCreate({ ...create, jobTitle: e.target.value })}>
                <option value="">Job title</option>
                {STAFF_TITLES.map((t) => <option key={t}>{t}</option>)}
              </select>
            )}
            {create.role === 'MODERATOR' && (
              <div>
                <div className="text-sm font-bold">Moderator tools</div>
                {['mute', 'kick', 'reports', 'audit'].map((tool) => (
                  <Toggle key={tool} label={tool} checked={create.moderatorTools.includes(tool)} onChange={(v) => setCreate({ ...create, moderatorTools: v ? [...create.moderatorTools, tool] : create.moderatorTools.filter((x: string) => x !== tool) })} />
                ))}
              </div>
            )}
            <input className="input" placeholder="Account number (blank = auto)" inputMode="numeric" value={create.accountNumber ?? ''} onChange={(e) => setCreate({ ...create, accountNumber: e.target.value.replace(/\D/g, '') || undefined })} />
            <button className="btn-primary" disabled={!create.displayName} onClick={() => createAct.mutate(create)}>Create login</button>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ flags & live settings
const FLAG_INFO: Record<string, string> = {
  lotto: '🎰 Bit Lotto & Lucky Wheel',
  autoBalancer: '⚖️ Economy auto-balancer',
  reviewBombs: '💣 Review-bomb events',
  shorting: '📉 Shorting on the exchange',
  mentorship: '🧑‍🏫 Mentorship',
  tradeFairs: '🎪 Trade fairs',
  peerLending: '🤝 Peer lending',
  insurance: '☂️ Insurance',
  maintenance: '🛠️ Maintenance (read-only) mode',
  chatKillSwitch: '🔇 Chat kill switch',
};
export function Flags() {
  const flags = useApi<Record<string, boolean>>(['owner-flags'], '/owner/flags');
  const set = useAction((v: { flag: string; enabled: boolean }) => PUT('/owner/flags', v), { invalidate: [['owner-flags']], success: 'Flag flipped live! 🎚️' });
  const settings = useApi<Array<{ key: string; default: any; value: any; overridden: boolean }>>(['owner-settings'], '/owner/settings');
  const [q, setQ] = useState('');
  const save = useAction((v: { key: string; value: any }) => PUT('/owner/settings', v), { invalidate: [['owner-settings']], success: 'Setting saved - effective on the next tick.' });
  const reset = useAction((key: string) => DEL(`/owner/settings/${encodeURIComponent(key)}`), { invalidate: [['owner-settings']], success: 'Back to default.' });
  const announcement = useAction((text: string) => POST('/owner/announcement', { text }), { success: 'Announcement updated.' });
  const [ann, setAnn] = useState('');
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="card">
        <h2 className="h2 mb-2">🎚️ Feature flags (global, live)</h2>
        {flags.data && ALL_FLAGS.map((f) => (
          <Toggle key={f} checked={!!flags.data![f]} onChange={(v) => set.mutate({ flag: f, enabled: v })} label={(MODULE_INFO as any)[f] ? `${(MODULE_INFO as any)[f].emoji} ${(MODULE_INFO as any)[f].label}` : FLAG_INFO[f] ?? f} />
        ))}
        <div className="mt-4">
          <h3 className="h3 mb-1">📣 Announcement banner</h3>
          <div className="flex gap-2">
            <input className="input" value={ann} onChange={(e) => setAnn(e.target.value)} placeholder="Blank to clear" />
            <button className="btn-primary" onClick={() => announcement.mutate(ann)}>Set</button>
          </div>
        </div>
      </div>
      <div className="card">
        <h2 className="h2 mb-2">🧮 Live economy settings</h2>
        <input className="input mb-2" placeholder="Filter (e.g. fee, pods, tick)" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-[70vh] overflow-y-auto">
          {(settings.data ?? []).filter((s) => !q || s.key.toLowerCase().includes(q.toLowerCase())).map((s) => (
            <SettingRow key={s.key} s={s} onSave={(value) => save.mutate({ key: s.key, value })} onReset={() => reset.mutate(s.key)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingRow({ s, onSave, onReset }: { s: { key: string; default: any; value: any; overridden: boolean }; onSave: (v: any) => void; onReset: () => void }) {
  const [v, setV] = useState(Array.isArray(s.value) ? s.value.join(',') : String(s.value));
  const parse = () => (typeof s.default === 'number' ? Number(v) : typeof s.default === 'boolean' ? v === 'true' : Array.isArray(s.default) ? v.split(',').map(Number) : v);
  return (
    <div className="flex items-center gap-2 py-1 border-b border-ink/10 text-sm">
      <code className={`flex-1 break-all ${s.overridden ? 'text-accent font-bold' : ''}`}>{s.key}</code>
      <input className="input !min-h-[32px] !py-0 w-32" value={v} onChange={(e) => setV(e.target.value)} aria-label={s.key} />
      <button className="btn-ghost btn-sm" onClick={() => onSave(parse())}>💾</button>
      {s.overridden && <button className="btn-ghost btn-sm" onClick={onReset} title={`Default: ${s.default}`}>↩️</button>}
    </div>
  );
}

// ------------------------------------------------------------------ audit & ledger
export function AuditLog() {
  const [action, setAction] = useState('');
  const list = useApi<any[]>(['owner-audit', action], `/owner/audit?limit=300${action ? `&action=${encodeURIComponent(action)}` : ''}`);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="h1 mr-auto">📝 Audit log</h1>
        <input className="input w-56" placeholder="Filter action prefix (e.g. permissions)" value={action} onChange={(e) => setAction(e.target.value)} />
        <a className="btn-ghost btn-sm" href={`/api/owner/audit?format=csv&limit=5000${action ? `&action=${encodeURIComponent(action)}` : ''}`}>⬇️ CSV</a>
      </div>
      <p className="text-xs muted">Append-only. Every permission change, money tool, trade and admin action is here.</p>
      {list.isLoading ? <LoadingJoke /> : !list.data?.length ? <EmptyState title="Nothing logged yet" /> : (
        <div className="card !p-0 overflow-x-auto">
          <table className="table-clean text-xs">
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Old</th><th>New</th></tr></thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="font-mono">{r.actorId?.slice(0, 10) ?? 'system'}</td>
                  <td className="font-bold">{r.action}</td>
                  <td className="font-mono">{r.targetType}:{r.targetId?.slice(0, 14)}</td>
                  <td className="font-mono max-w-[220px] truncate" title={JSON.stringify(r.oldValue)}>{r.oldValue != null ? JSON.stringify(r.oldValue) : ''}</td>
                  <td className="font-mono max-w-[220px] truncate" title={JSON.stringify(r.newValue)}>{r.newValue != null ? JSON.stringify(r.newValue) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function Ledger() {
  const [wallet, setWallet] = useState('');
  const [kind, setKind] = useState('');
  const qs = new URLSearchParams({ limit: '300' });
  if (wallet) qs.set('wallet', wallet);
  if (kind) qs.set('kind', kind);
  const list = useApi<any[]>(['owner-ledger', qs.toString()], `/owner/ledger?${qs}`);
  const verify = useApi<any>(['owner-ledger-verify'], '/owner/ledger/verify');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="h1 mr-auto">📒 Ledger</h1>
        {verify.data && (
          <span className={`chip ${verify.data.balanced ? '!bg-good/20' : '!bg-bad/20'}`} data-testid="ledger-balanced">
            {verify.data.balanced ? '✅ Balanced (sum = 0)' : `❌ Off by ${verify.data.sum}`} · supply {formatBits(verify.data.supply)}
          </span>
        )}
        <input className="input w-48" placeholder="Wallet / company id" value={wallet} onChange={(e) => setWallet(e.target.value)} />
        <input className="input w-40" placeholder="Kind prefix" value={kind} onChange={(e) => setKind(e.target.value)} />
        <a className="btn-ghost btn-sm" href={`/api/owner/ledger?format=csv&limit=100000${wallet ? `&wallet=${wallet}` : ''}${kind ? `&kind=${kind}` : ''}`} data-testid="ledger-csv">⬇️ Export CSV</a>
      </div>
      {list.isLoading ? <LoadingJoke /> : (
        <div className="card !p-0 overflow-x-auto">
          <table className="table-clean text-xs">
            <thead><tr><th>#</th><th>When</th><th>Kind</th><th>From</th><th>To</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {(list.data ?? []).map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td className="whitespace-nowrap">{new Date(r.createdAt).toLocaleTimeString()}</td>
                  <td className="font-bold">{r.kind}</td>
                  <td className="font-mono">{r.fromWallet.replace(/^w:/, '')}</td>
                  <td className="font-mono">{r.toWallet.replace(/^w:/, '')}</td>
                  <td className="text-right tabular-nums font-bold">{r.amount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function useOwnerToast() {
  return useStore((s) => s.toast);
}
