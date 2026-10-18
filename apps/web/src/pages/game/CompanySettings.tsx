import { useState } from 'react';
import { MODULE_INFO, STAFF_TITLES, type Module } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST, PATCH } from '../../lib/api';
import { Modal, Toggle, timeAgo, EmptyState } from '../../components/ui';
import { useCan, useGameMe } from './GameLayout';
import { IpoRequestCard } from './ExchangeExtras';

/** Company Settings (company admins): staff logins + IPO request. */
export function CompanySettings() {
  const me = useGameMe();
  const canStaff = useCan('staff');
  const canExchange = useCan('exchange');
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">⚙️ Company settings</h1>
      <div className="card">
        <div className="flex items-center gap-3">
          <span className="text-4xl">{me.company?.emoji}</span>
          <div>
            <div className="h2">{me.company?.name}</div>
            <div className="text-sm italic muted">{me.company?.slogan}</div>
          </div>
        </div>
        <p className="text-xs muted mt-2">Name, logo and industry are managed by the Owner.</p>
      </div>
      {canStaff ? <StaffManager /> : <div className="card-flat text-sm">🪪 Staff management is locked. Boss Byte says: ask the Owner!</div>}
      {canExchange && <IpoRequestCard />}
    </div>
  );
}

function StaffManager() {
  const me = useGameMe();
  const ro = me.access.readOnly;
  const q = useApi<any>(['staff'], '/game/staff');
  const [create, setCreate] = useState<{ displayName: string; jobTitle: string; modules: Partial<Record<Module, boolean>> } | null>(null);
  const [pw, setPw] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const createAct = useAction((v: any) => POST('/game/staff', v), { invalidate: [['staff']], onSuccess: (r) => { setCreate(null); setPw(r); } });
  const update = useAction(({ id, ...p }: any) => PATCH(`/game/staff/${id}`, p), { invalidate: [['staff']], success: 'Staff updated - applied instantly!', onSuccess: () => setEdit(null) });
  if (!q.data) return null;
  const grantable: Module[] = q.data.grantable;
  return (
    <div className="card">
      <div className="flex items-center mb-2">
        <h2 className="h2 mr-auto">🪪 Staff logins ({q.data.staff.length}/{q.data.limits.maxStaff})</h2>
        {!ro && q.data.limits.canCreateStaff && (
          <button className="btn-primary btn-sm" disabled={q.data.staff.length >= q.data.limits.maxStaff} onClick={() => setCreate({ displayName: '', jobTitle: 'Intern', modules: { office: true } })}>➕ Hire staff login</button>
        )}
      </div>
      {!q.data.limits.canCreateStaff && <p className="text-sm muted mb-2">The Owner hasn't allowed staff logins for your company.</p>}
      {q.data.staff.length === 0 ? (
        <EmptyState emoji="🧑‍💼" title="Just you so far" body="Create logins for your CFO, Trader or Intern and choose exactly what they can touch." />
      ) : (
        q.data.staff.map((s: any) => (
          <div key={s.id} className="card-flat mb-2 flex items-center gap-2 flex-wrap text-sm">
            <span className="font-display font-extrabold text-lg">{s.accountNumber}</span>
            <span className="font-bold">{s.displayName}</span>
            <span className="chip">{s.jobTitle}</span>
            <span className="chip">{s.status}</span>
            <span className="text-xs muted">last login {timeAgo(s.lastLogin)}</span>
            {!ro && <button className="btn-ghost btn-sm ml-auto" onClick={() => setEdit({ id: s.id, modules: { ...s.modules }, jobTitle: s.jobTitle, status: s.status })}>✏️ Access</button>}
          </div>
        ))
      )}
      <Modal open={!!create} onClose={() => setCreate(null)} title="➕ New staff login">
        {create && (
          <div className="flex flex-col gap-2">
            <input className="input" placeholder="Display name" value={create.displayName} onChange={(e) => setCreate({ ...create, displayName: e.target.value })} />
            <select className="input" value={create.jobTitle} onChange={(e) => setCreate({ ...create, jobTitle: e.target.value })}>
              {STAFF_TITLES.map((t) => <option key={t}>{t}</option>)}
            </select>
            <div className="text-sm font-bold">What can they use? (only modules the Owner lets you hand out)</div>
            {grantable.map((m) => <Toggle key={m} checked={!!create.modules[m]} onChange={(v) => setCreate({ ...create, modules: { ...create.modules, [m]: v } })} label={`${MODULE_INFO[m].emoji} ${MODULE_INFO[m].label}`} />)}
            <button className="btn-primary" disabled={!create.displayName} onClick={() => createAct.mutate(create)}>Create login</button>
          </div>
        )}
      </Modal>
      <Modal open={!!edit} onClose={() => setEdit(null)} title="✏️ Staff access">
        {edit && (
          <div className="flex flex-col gap-2">
            {grantable.map((m) => <Toggle key={m} checked={!!edit.modules[m]} onChange={(v) => setEdit({ ...edit, modules: { ...edit.modules, [m]: v } })} label={`${MODULE_INFO[m].emoji} ${MODULE_INFO[m].label}`} />)}
            <select className="input" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
            <button className="btn-primary" onClick={() => update.mutate({ id: edit.id, modules: Object.fromEntries(Object.entries(edit.modules).filter(([k]) => grantable.includes(k as Module))), status: edit.status })}>Save</button>
          </div>
        )}
      </Modal>
      <Modal open={!!pw} onClose={() => setPw(null)} title="🪪 Staff badge">
        <p>Account <b className="font-display text-2xl">{pw?.account?.accountNumber}</b></p>
        <p>Temp password <b className="font-display text-xl">{pw?.tempPassword}</b></p>
        <p className="text-xs muted mt-2">Shown once - they'll change it on first login.</p>
      </Modal>
    </div>
  );
}
