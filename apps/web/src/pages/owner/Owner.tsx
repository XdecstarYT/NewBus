import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { CASE_KINDS, FACILITIES, FACILITY_IDS, FEATURES, ITEM_IDS, LAW_KINDS, type CaseKind, type Feature, type LawKind } from '@dw/shared/live';
import { POST, PATCH } from '../../lib/api';
import { useApi, useAction } from '../../lib/hooks';
import { formatBits, itemLabel } from '../../lib/game';
import { QR } from '../../components/QR';
import { EmptyState, LoadingJoke, Tabs, timeAgo, timeLeft, useConfirm } from '../../components/ui';
import { CaseDetail, CaseRow } from '../play/Politics';

// ============================================================ overview
export function OwnerOverview() {
  const q = useApi<any>(['owner', 'overview'], '/owner/overview', { refetchInterval: 30_000 });
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  const tiles = [
    ['🏦 Treasury', formatBits(d.treasury)],
    ['💰 Money supply', formatBits(d.moneySupply)],
    ['🔒 In escrow', formatBits(d.escrow)],
    ['🏢 Companies', d.companies],
    ['🧑 Logins', d.accounts],
    ['🟢 Online now', d.online],
    ['📅 Players today', d.players24h],
    ['🤝 Trades today', `${d.trades24h.n} (${formatBits(d.trades24h.v)})`],
    ['🧾 Tax today', formatBits(d.trades24h.tax)],
    ['⚒️ Batches worked today', d.shifts24h.b],
    ['📒 Ledger', d.ledgerOk ? '✅ balanced' : '❌ CHECK'],
    ['🧾 Sales tax', `${d.settings.salesTaxPct}%`],
  ];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">👑 Owner overview</h1>
      <p className="muted text-sm">You run the world: create companies, hold the Treasury, set taxes, judge cases and propose laws. Everyone else makes the economy by playing.</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {tiles.map(([k, v]) => <div key={k as string} className="card !py-3"><div className="text-xs muted">{k}</div><div className="text-xl font-extrabold">{v}</div></div>)}
      </div>
      <div className="flex gap-2 flex-wrap">
        <Link className="btn-primary" to="/owner/companies">➕ Create a company</Link>
        <Link className="btn-ghost" to="/owner/justice">🏛️ Justice & laws</Link>
        <Link className="btn-ghost" to="/owner/economy">💰 Treasury</Link>
      </div>
    </div>
  );
}

// ============================================================ companies
export function OwnerCompanies() {
  const q = useApi<any[]>(['owner', 'companies'], '/owner/companies');
  const [f, setF] = useState({ name: '', emoji: '🏢', industry: 'farm', adminName: '', slogan: '', number: '', password: '' });
  const [made, setMade] = useState<any>(null);
  const create = useAction(() => POST<any>('/owner/companies', { ...f, number: f.number || undefined, password: f.password || undefined }), { invalidate: [['owner']], onSuccess: (r) => (setMade(r), setF({ ...f, name: '', adminName: '', slogan: '', number: '', password: '' })) });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">🏢 Companies</h1>
      <div className="grid lg:grid-cols-[1fr_360px] gap-4">
        <div className="card flex flex-col gap-1">
          {!q.data ? <LoadingJoke /> : !q.data.length ? <EmptyState emoji="🏗️" title="No companies yet" body="Create one for each friend (or team of friends)." /> : q.data.map((c) => (
            <Link key={c.id} to={`/owner/companies/${c.id}`} className="flex items-center gap-2 text-sm py-2 border-b border-ink/5 last:border-0 hover:bg-accent/5 rounded">
              <span className="text-2xl">{c.emoji}</span>
              <span className="flex-1"><b>{c.name}</b> <span className="muted">{FACILITIES[c.industry as keyof typeof FACILITIES]?.emoji} {FACILITIES[c.industry as keyof typeof FACILITIES]?.name} · {c.team} login{c.team === 1 ? '' : 's'}</span></span>
              {c.status !== 'active' && <span className="chip">suspended</span>}
              <b>{formatBits(c.balance)}</b>
            </Link>
          ))}
        </div>
        <form className="card flex flex-col gap-2" onSubmit={(e) => (e.preventDefault(), create.mutate(undefined))}>
          <div className="h3">➕ New company</div>
          <div className="grid grid-cols-[70px_1fr] gap-2">
            <input className="input text-center text-2xl" maxLength={8} value={f.emoji} onChange={(e) => setF({ ...f, emoji: e.target.value })} aria-label="Emoji" />
            <input className="input" maxLength={40} placeholder="Company name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Company name" />
          </div>
          <select className="input" value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })} aria-label="Starting facility">
            {FACILITY_IDS.map((id) => <option key={id} value={id}>{FACILITIES[id].emoji} {FACILITIES[id].name} ({FACILITIES[id].kind})</option>)}
          </select>
          <input className="input" maxLength={120} placeholder="Slogan (optional)" value={f.slogan} onChange={(e) => setF({ ...f, slogan: e.target.value })} aria-label="Slogan" />
          <input className="input" maxLength={40} placeholder="Player's name" value={f.adminName} onChange={(e) => setF({ ...f, adminName: e.target.value })} aria-label="Player's name" />
          <div className="grid grid-cols-2 gap-2">
            <input className="input" maxLength={10} placeholder="Account no. (auto)" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} aria-label="Account number" />
            <input className="input" maxLength={100} placeholder="Password (auto)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} aria-label="Password" />
          </div>
          <button className="btn-primary" disabled={!f.name.trim() || !f.adminName.trim() || create.isPending} data-testid="create-company">Create company</button>
          {made && (
            <div className="card-flat !bg-amber-50 text-sm" role="status">
              ✅ <b>{made.name}</b> created with {formatBits(made.grant)}. Login: <span className="font-mono font-bold" data-testid="new-number">{made.admin.number}</span> / <span className="font-mono font-bold" data-testid="new-password">{made.admin.password}</span>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

export function OwnerCompany() {
  const { id = '' } = useParams();
  const confirm = useConfirm();
  const q = useApi<any>(['owner', 'company', id], `/owner/companies/${id}`);
  const inv = [['owner']];
  const [amt, setAmt] = useState(500);
  const [memo, setMemo] = useState('');
  const [pw, setPw] = useState<string | null>(null);
  const grant = useAction(() => POST('/owner/grant', { to: id, amount: amt, memo }), { invalidate: inv, success: 'Granted from the Treasury.' });
  const mint = useAction(() => POST('/owner/mint', { to: id, amount: amt, memo }), { invalidate: inv, success: 'Minted.' });
  const fine = useAction(() => POST('/owner/fine', { companyId: id, amount: amt, memo }), { invalidate: inv, success: 'Fined.' });
  const status = useAction((s: string) => POST(`/owner/companies/${id}/status`, { status: s }), { invalidate: inv, success: 'Updated.' });
  const reset = useAction((accId: string) => POST<any>(`/owner/accounts/${accId}/reset`), { onSuccess: (r) => setPw(r.password) });
  const audit = useAction(() => POST('/owner/audits', { companyId: id }), { invalidate: [['owner']], success: '🔦 Audit opened: see Justice.' });
  if (!q.data) return <LoadingJoke />;
  const c = q.data;
  return (
    <div className="flex flex-col gap-4">
      <Link to="/owner/companies" className="btn-ghost btn-sm self-start">← Companies</Link>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-5xl">{c.emoji}</span>
        <div className="flex-1"><h1 className="h1">{c.name}</h1><div className="text-sm muted">{c.slogan}</div></div>
        <div className="card !py-2 text-center"><div className="text-xs muted">Bits</div><b>{formatBits(c.balance)}</b></div>
        <div className="card !py-2 text-center"><div className="text-xs muted">Prestige</div><b>✨ {c.prestige}</b></div>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card flex flex-col gap-2">
          <div className="h3">💰 Money</div>
          <div className="flex gap-2"><input type="number" className="input !w-32" min={1} value={amt} onChange={(e) => setAmt(Math.max(1, Math.floor(Number(e.target.value) || 1)))} aria-label="Amount" /><input className="input flex-1" maxLength={200} placeholder="Note" value={memo} onChange={(e) => setMemo(e.target.value)} aria-label="Note" /></div>
          <div className="flex gap-2 flex-wrap">
            <button className="btn-good btn-sm" onClick={() => grant.mutate(undefined)}>🎁 Grant from Treasury</button>
            <button className="btn-ghost btn-sm" onClick={() => mint.mutate(undefined)}>🪙 Mint new Bits</button>
            <button className="btn-bad btn-sm" onClick={() => fine.mutate(undefined)}>🧾 Fine</button>
            <button className="btn-ghost btn-sm" onClick={() => audit.mutate(undefined)}>🔦 Audit</button>
            {c.status === 'active' ? <button className="btn-bad btn-sm" onClick={async () => (await confirm({ title: `Suspend ${c.name}?`, body: 'Its players are logged out and can not play until you reactivate it.', danger: true })) && status.mutate('suspended')}>Suspend</button> : <button className="btn-good btn-sm" onClick={() => status.mutate('active')}>Reactivate</button>}
          </div>
        </div>
        <div className="card flex flex-col gap-1">
          <div className="h3">👥 Logins</div>
          {c.team.map((a: any) => <div key={a.id} className="flex items-center gap-2 text-sm"><span className="flex-1">{a.name} <span className="muted">#{a.number} · {a.role} · seen {timeAgo(a.lastSeen)}</span></span><button className="btn-ghost btn-sm" onClick={() => reset.mutate(a.id)}>Reset password</button></div>)}
          {pw && <div className="card-flat !bg-amber-50 text-sm">New temporary password: <span className="font-mono font-bold">{pw}</span></div>}
        </div>
        <div className="card">
          <div className="h3 mb-1">🏭 Facilities & 📦 stock</div>
          <div className="text-sm">{c.facilities.map((f: any) => `${FACILITIES[f.type as keyof typeof FACILITIES]?.emoji} ${FACILITIES[f.type as keyof typeof FACILITIES]?.name} Lv${f.level}`).join(' · ')}</div>
          <div className="text-sm mt-1">{Object.entries(c.inventory).map(([i, n]) => `${n}× ${itemLabel(i)}`).join(' · ') || 'Empty warehouse'}</div>
        </div>
        <div className="card">
          <div className="h3 mb-1">📒 Recent money</div>
          <div className="max-h-64 overflow-y-auto">
            {c.ledger.map((l: any) => <div key={l.id} className="text-xs flex gap-2"><span className="flex-1">{l.kind} {l.memo ? `· ${l.memo}` : ''}</span><span className={l.toWallet === `co:${c.id}` ? 'text-emerald-700' : 'text-rose-700'}>{l.toWallet === `co:${c.id}` ? '+' : '−'}{l.amount}</span><span className="muted">{timeAgo(l.createdAt)}</span></div>)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================ economy
export function OwnerEconomy() {
  const confirm = useConfirm();
  const o = useApi<any>(['owner', 'overview'], '/owner/overview');
  const ledger = useApi<any[]>(['owner', 'ledger'], '/owner/ledger');
  const [amt, setAmt] = useState(10_000);
  const [s, setS] = useState<any>(null);
  const inv = [['owner']];
  const mint = useAction(() => POST('/owner/mint', { amount: amt, memo: 'Treasury top-up' }), { invalidate: inv, success: '🪙 Minted into the Treasury.' });
  const burn = useAction(() => POST('/owner/burn', { amount: amt }), { invalidate: inv, success: '🔥 Burned.' });
  const save = useAction(() => PATCH('/owner/settings', s), { invalidate: inv, success: 'Settings saved.' });
  const reset = useAction(() => POST('/owner/season/reset', { confirm: 'RESET' }), { invalidate: inv, success: '🌅 New season started.' });
  if (!o.data) return <LoadingJoke />;
  const settings = s ?? o.data.settings;
  const num = (k: string, label: string) => (
    <label className="label">{label}<input type="number" className="input" value={settings[k]} onChange={(e) => setS({ ...settings, [k]: Number(e.target.value) })} /></label>
  );
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">💰 Economy</h1>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card flex flex-col gap-2">
          <div className="h3">🏦 Treasury: {formatBits(o.data.treasury)}</div>
          <p className="text-xs muted">Taxes, building costs and fines flow in. Pay prizes, grants and stimulus out of it. Minting creates new Bits (inflation!); burning destroys them.</p>
          <div className="flex gap-2"><input type="number" className="input flex-1" min={1} value={amt} onChange={(e) => setAmt(Math.max(1, Math.floor(Number(e.target.value) || 1)))} aria-label="Amount" /><button className="btn-good" onClick={() => mint.mutate(undefined)}>🪙 Mint</button><button className="btn-bad" onClick={() => burn.mutate(undefined)}>🔥 Burn</button></div>
        </div>
        <div className="card flex flex-col gap-2">
          <div className="h3">⚙️ Rules</div>
          <div className="grid grid-cols-2 gap-2">
            {num('salesTaxPct', 'Sales tax %')}
            {num('startingGrant', 'Starting grant (BT)')}
            {num('unionCreateCost', 'Found a union (BT)')}
            {num('courtFilingPct', 'Court filing fee %')}
            {num('hearingMinutes', 'Minutes to hearing')}
            {num('appealHours', 'Appeal window (h)')}
            {num('nominateMinutes', 'Election nominations (min)')}
            {num('voteMinutes', 'Election voting (min)')}
            {num('unionTermDays', 'Union term (days)')}
            {num('lawVoteHours', 'Law voting (h)')}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.unionTaxDiscount} onChange={(e) => setS({ ...settings, unionTaxDiscount: e.target.checked })} /> Union members trade at half tax</label>
          <button className="btn-primary self-start" disabled={!s} onClick={() => save.mutate(undefined)}>Save rules</button>
        </div>
      </div>
      <div className="card">
        <div className="h3 mb-1">📒 Ledger (latest 200)</div>
        <div className="max-h-96 overflow-y-auto text-xs">
          {(ledger.data ?? []).map((l) => <div key={l.id} className="flex gap-2 py-0.5 border-b border-ink/5"><span className="w-28 muted">{timeAgo(l.createdAt)}</span><span className="w-32">{l.kind}</span><span className="flex-1 truncate">{l.fromWallet} → {l.toWallet} {l.memo ? `· ${l.memo}` : ''}</span><b>{l.amount}</b></div>)}
        </div>
      </div>
      <div className="card !bg-rose-50 flex flex-col gap-2">
        <div className="h3">🌅 New season</div>
        <p className="text-sm">Wipes every wallet, warehouse, order, building and the ledger, then gives every company its starting grant again. Logins, companies and unions stay.</p>
        <button className="btn-bad self-start" onClick={async () => (await confirm({ title: 'Start a new season?', body: 'Everyone starts from zero. This can not be undone.', danger: true })) && reset.mutate(undefined)}>Start a new season</button>
      </div>
    </div>
  );
}

// ============================================================ justice
type JTab = 'audits' | 'court' | 'sanctions' | 'laws' | 'unions';

export function OwnerJustice() {
  const q = useApi<any>(['owner', 'justice'], '/owner/justice', { refetchInterval: 20_000 });
  const companies = useApi<any[]>(['companies'], '/game/companies');
  const [tab, setTab] = useState<JTab>('court');
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  const cos = companies.data ?? [];
  const toRule = d.docket.filter((c: any) => ['filed', 'hearing', 'appealed'].includes(c.status)).length;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">🏛️ Justice & laws</h1>
      <Tabs<JTab> tabs={[{ id: 'court', label: `🔨 Court${toRule ? ` (${toRule})` : ''}` }, { id: 'audits', label: '🔦 Tax audits' }, { id: 'sanctions', label: `⛔ Sanctions (${d.sanctions.length})` }, { id: 'laws', label: '📜 Laws' }, { id: 'unions', label: '✊ Unions' }]} value={tab} onChange={setTab} />
      {tab === 'court' && <Bench d={d} cos={cos} />}
      {tab === 'audits' && <Audits d={d} cos={cos} />}
      {tab === 'sanctions' && <Sanctions d={d} cos={cos} />}
      {tab === 'laws' && <Laws d={d} />}
      {tab === 'unions' && <UnionsAdmin d={d} />}
    </div>
  );
}

const inv = [['owner']];

function Pick({ cos, value, onChange, label }: { cos: any[]; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{label}...</option>
      {cos.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
    </select>
  );
}

function Bench({ d, cos }: { d: any; cos: any[] }) {
  const [f, setF] = useState({ defendantId: '', kind: 'unfair' as CaseKind, title: '', claim: 500 });
  const file = useAction(() => POST('/owner/court', f), { invalidate: inv, success: '⚖️ The State has filed its case.' });
  const waiting = d.docket.filter((c: any) => ['filed', 'hearing', 'appealed'].includes(c.status));
  const rest = d.docket.filter((c: any) => !['filed', 'hearing', 'appealed'].includes(c.status));
  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-4">
      <div className="flex flex-col gap-3">
        <div className="card flex flex-col gap-1"><div className="h3">🔨 Waiting for your ruling</div><p className="text-xs muted">You are the judge. If you don't rule within 2 hours of the hearing, the evidence decides.</p>{!waiting.length ? <p className="text-sm muted">Nothing on the bench.</p> : waiting.map((c: any) => <CaseRow key={c.id} c={c} to={`/owner/justice/cases/${c.id}`} />)}</div>
        <div className="card flex flex-col gap-1"><div className="h3">📁 All cases</div>{!rest.length ? <p className="text-sm muted">None yet.</p> : rest.map((c: any) => <CaseRow key={c.id} c={c} to={`/owner/justice/cases/${c.id}`} />)}</div>
      </div>
      <div className="card flex flex-col gap-2">
        <div className="h3">🏛️ The State v. a company</div>
        <Pick cos={cos} value={f.defendantId} onChange={(v) => setF({ ...f, defendantId: v })} label="Defendant" />
        <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as CaseKind })} aria-label="Charge">{(Object.entries(CASE_KINDS) as Array<[CaseKind, any]>).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}</select>
        <label className="label">Title<input className="input" maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="label">Fine sought (BT)<input type="number" className="input" min={0} value={f.claim} onChange={(e) => setF({ ...f, claim: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></label>
        <button className="btn-primary" disabled={!f.defendantId || f.title.trim().length < 3} onClick={() => file.mutate(undefined)}>⚖️ Take them to court</button>
      </div>
    </div>
  );
}

export function OwnerCase() {
  const { id = '' } = useParams();
  const q = useApi<any>(['case', id], `/owner/court/${id}`);
  const [rem, setRem] = useState({ damages: 0, fine: 0, freezeHours: 0, suspend: '', suspendHours: 0 });
  const [reasoning, setReasoning] = useState('');
  const decide = useAction((verdict: string) => POST(`/owner/court/${id}/decide`, { verdict, reasoning, remedy: { ...rem, suspend: rem.suspend || null } }), { invalidate: [['case', id], ['owner']], success: '🔨 Ruling entered.' });
  const c = q.data;
  const canRule = c && ['filed', 'hearing', 'appealed'].includes(c.status);
  const num = (k: keyof typeof rem) => (e: React.ChangeEvent<HTMLInputElement>) => setRem({ ...rem, [k]: Math.max(0, Math.floor(Number(e.target.value) || 0)) });
  return (
    <div className="flex flex-col gap-4">
      <CaseDetail owner />
      {canRule && (
        <div className="card flex flex-col gap-2 max-w-4xl mx-auto w-full" data-testid="rule-form">
          <div className="h3">🔨 Your ruling</div>
          <p className="text-xs muted">Penalties only apply if the plaintiff wins, once the 24 h appeal window closes. A ruling on appeal is final.</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {c.plaintiffId && <label className="label">Damages<input type="number" className="input" min={0} value={rem.damages} onChange={num('damages')} /></label>}
            <label className="label">Fine<input type="number" className="input" min={0} value={rem.fine} onChange={num('fine')} /></label>
            <label className="label">Freeze (h)<input type="number" className="input" min={0} value={rem.freezeHours} onChange={num('freezeHours')} /></label>
            <label className="label">Suspend<select className="input" value={rem.suspend} onChange={(e) => setRem({ ...rem, suspend: e.target.value })}><option value="">nothing</option>{(Object.entries(FEATURES) as Array<[Feature, any]>).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}</select></label>
            <label className="label">For (h)<input type="number" className="input" min={0} value={rem.suspendHours} onChange={num('suspendHours')} /></label>
          </div>
          <input className="input" maxLength={500} value={reasoning} onChange={(e) => setReasoning(e.target.value)} placeholder="Reasoning (shown to the parties and in the news)" aria-label="Reasoning" />
          <div className="flex gap-2"><button className="btn-good" onClick={() => decide.mutate('plaintiff')}>Rule for the plaintiff</button><button className="btn-ghost" onClick={() => decide.mutate('defendant')}>Rule for the defendant</button></div>
        </div>
      )}
    </div>
  );
}

function Audits({ d, cos }: { d: any; cos: any[] }) {
  const [who, setWho] = useState('');
  const [fines, setFines] = useState<Record<string, { fine: number; note: string; freezeHours: number }>>({});
  const open = useAction(() => POST('/owner/audits', { companyId: who }), { invalidate: inv, success: '🔦 Audit opened.' });
  const close = useAction((v: any) => POST(`/owner/audits/${v.id}/close`, v), { invalidate: inv, success: 'Audit closed.' });
  return (
    <div className="grid lg:grid-cols-[1fr_300px] gap-4">
      <div className="flex flex-col gap-3">
        {d.audits.filter((a: any) => a.status === 'open').map((a: any) => {
          const f = a.findings;
          const v = fines[a.id] ?? { fine: a.suggestedFine, note: '', freezeHours: 0 };
          const set = (p: any) => setFines({ ...fines, [a.id]: { ...v, ...p } });
          return (
            <div key={a.id} className="card flex flex-col gap-2" data-testid={`audit-${a.id}`}>
              <b>🔦 {a.company.emoji} {a.company.name} <span className="text-xs muted">{timeAgo(a.createdAt)}</span></b>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <div className="card-flat !p-2"><div className="text-xs muted">Taxed sales (7 d)</div><b>{formatBits(f.salesIncome)}</b></div>
                <div className="card-flat !p-2"><div className="text-xs muted">Tax paid</div><b>{formatBits(f.taxPaid)}</b></div>
                <div className="card-flat !p-2"><div className="text-xs muted">Untaxed transfers in</div><b>{formatBits(f.transfersIn)}</b></div>
                <div className="card-flat !p-2"><div className="text-xs muted">Item shipments in</div><b>{f.itemsIn}</b></div>
              </div>
              {f.flags.length ? <ul className="text-sm list-disc pl-5">{f.flags.map((x: string) => <li key={x}>{x}</li>)}</ul> : <p className="text-sm">No red flags. 🧼</p>}
              <div className="flex gap-2 flex-wrap items-end">
                <label className="label">Fine<input type="number" className="input !w-28" min={0} value={v.fine} onChange={(e) => set({ fine: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></label>
                <label className="label">Freeze (h)<input type="number" className="input !w-20" min={0} value={v.freezeHours} onChange={(e) => set({ freezeHours: Math.max(0, Number(e.target.value) || 0) })} /></label>
                <label className="label flex-1">Note<input className="input" maxLength={300} value={v.note} onChange={(e) => set({ note: e.target.value })} /></label>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button className="btn-good btn-sm" onClick={() => close.mutate({ id: a.id, outcome: 'clean', note: v.note })}>✅ Clean</button>
                <button className="btn-ghost btn-sm" onClick={() => close.mutate({ id: a.id, outcome: 'warning', note: v.note })}>⚠️ Warning</button>
                <button className="btn-bad btn-sm" onClick={() => close.mutate({ id: a.id, outcome: 'fined', fine: v.fine, note: v.note, freezeHours: v.freezeHours || undefined })}>🧾 Fine {formatBits(v.fine)}</button>
                <button className="btn-primary btn-sm" onClick={() => close.mutate({ id: a.id, outcome: 'referred', fine: v.fine, note: v.note })}>⚖️ Take to court</button>
              </div>
            </div>
          );
        })}
        <div className="card flex flex-col gap-1"><div className="h3">📁 Closed audits</div>{d.audits.filter((a: any) => a.status === 'closed').map((a: any) => <div key={a.id} className="text-sm flex gap-2"><span className="flex-1">{a.company.emoji} {a.company.name}</span><span>{a.outcome}{a.fine ? ` · ${formatBits(a.fine)}` : ''}</span><span className="muted text-xs">{timeAgo(a.closedAt)}</span></div>)}</div>
      </div>
      <div className="card flex flex-col gap-2 self-start">
        <div className="h3">🔦 Open an audit</div>
        <p className="text-xs muted">Looks at the last 7 days: taxed sales vs untaxed transfers and shipments.</p>
        <Pick cos={cos} value={who} onChange={setWho} label="Company to audit" />
        <button className="btn-primary" disabled={!who} onClick={() => open.mutate(undefined)} data-testid="open-audit">Start audit</button>
      </div>
    </div>
  );
}

function Sanctions({ d, cos }: { d: any; cos: any[] }) {
  const [f, setF] = useState({ companyId: '', kind: 'freeze', feature: 'market', hours: 6, reason: '' });
  const add = useAction(() => POST('/owner/sanctions', { ...f, feature: f.kind === 'suspend' ? f.feature : null }), { invalidate: inv, success: '⛔ In force.' });
  const lift = useAction((id: string) => POST(`/owner/sanctions/${id}/lift`), { invalidate: inv, success: 'Lifted.' });
  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-4">
      <div className="card flex flex-col gap-1">
        {!d.sanctions.length ? <EmptyState emoji="🕊️" title="No sanctions in force" /> : d.sanctions.map((s: any) => (
          <div key={s.id} className="flex items-center gap-2 text-sm"><span className="flex-1"><b>{s.company.emoji} {s.company.name}</b>: {s.kind === 'freeze' ? '🧊 frozen' : `⛔ ${FEATURES[s.feature as Feature]?.label} suspended`} · {timeLeft(s.until)} left · {s.reason}</span><button className="btn-ghost btn-sm" onClick={() => lift.mutate(s.id)}>Lift</button></div>
        ))}
      </div>
      <div className="card flex flex-col gap-2">
        <div className="h3">⛔ Impose a sanction</div>
        <Pick cos={cos} value={f.companyId} onChange={(v) => setF({ ...f, companyId: v })} label="Company" />
        <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="Sanction"><option value="freeze">🧊 Freeze assets (no spending)</option><option value="suspend">⛔ Suspend a feature</option></select>
        {f.kind === 'suspend' && <select className="input" value={f.feature} onChange={(e) => setF({ ...f, feature: e.target.value })} aria-label="Feature">{(Object.entries(FEATURES) as Array<[Feature, any]>).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}</select>}
        <label className="label">Hours<input type="number" className="input" min={1} value={f.hours} onChange={(e) => setF({ ...f, hours: Math.max(1, Number(e.target.value) || 1) })} /></label>
        <label className="label">Reason<input className="input" maxLength={200} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
        <button className="btn-bad" disabled={!f.companyId || f.reason.trim().length < 2} onClick={() => add.mutate(undefined)}>Impose</button>
      </div>
    </div>
  );
}

function Laws({ d }: { d: any }) {
  const [f, setF] = useState<{ kind: LawKind; value: number }>({ kind: 'stimulus', value: 100 });
  const propose = useAction(() => POST('/owner/laws', f), { invalidate: inv, success: '📜 Bill introduced. Companies can vote now.' });
  const decide = useAction((v: { id: string; decision: string }) => POST(`/owner/laws/${v.id}/decide`, { decision: v.decision }), { invalidate: inv, success: 'Decided.' });
  return (
    <div className="grid lg:grid-cols-[320px_1fr] gap-4">
      <div className="card flex flex-col gap-2 self-start">
        <div className="h3">📜 Propose a law</div>
        <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as LawKind })} aria-label="Kind of law">{(Object.entries(LAW_KINDS) as Array<[LawKind, any]>).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}</select>
        <label className="label">{LAW_KINDS[f.kind].unit}<input type="number" className="input" value={f.value} onChange={(e) => setF({ ...f, value: Math.floor(Number(e.target.value) || 0) })} /></label>
        <p className="text-xs muted">{LAW_KINDS[f.kind].blurb}</p>
        <button className="btn-primary" onClick={() => propose.mutate(undefined)}>Introduce bill</button>
      </div>
      <div className="card flex flex-col gap-2">
        {!d.laws.length ? <p className="text-sm muted">No bills yet.</p> : d.laws.map((l: any) => (
          <div key={l.id} className="card-flat !p-2 flex flex-col gap-1">
            <div className="flex items-center gap-2"><b className="flex-1 text-sm">{l.title}</b><span className="chip !text-[11px]">{l.status === 'voting' ? `⏳ ${timeLeft(l.closesAt)}` : l.status}</span></div>
            <div className="text-xs">👍 {l.yes} · 👎 {l.no}</div>
            {l.status === 'voting' && <div className="flex gap-1"><button className="btn-good btn-sm" onClick={() => decide.mutate({ id: l.id, decision: 'pass' })}>Sign into law</button><button className="btn-bad btn-sm" onClick={() => decide.mutate({ id: l.id, decision: 'veto' })}>Veto</button><button className="btn-ghost btn-sm" onClick={() => decide.mutate({ id: l.id, decision: 'count' })}>Count votes now</button></div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function UnionsAdmin({ d }: { d: any }) {
  const confirm = useConfirm();
  const dissolve = useAction((id: string) => POST(`/owner/unions/${id}/dissolve`), { invalidate: inv, success: 'Dissolved; its treasury went to the State.' });
  return (
    <div className="card flex flex-col gap-1">
      {!d.unions.length ? <p className="text-sm muted">No unions yet.</p> : d.unions.map((u: any) => (
        <div key={u.id} className="flex items-center gap-2 text-sm py-1"><span className="text-xl">{u.emoji}</span><span className="flex-1"><b>{u.name}</b> · 👥 {u.members} · 👑 {u.president ? `${u.president.emoji} ${u.president.name}` : 'vacant'} · 💼 {formatBits(u.treasury)}</span><button className="btn-ghost btn-sm" onClick={async () => (await confirm({ title: `Dissolve ${u.name}?`, danger: true })) && dissolve.mutate(u.id)}>Dissolve</button></div>
      ))}
    </div>
  );
}

// ============================================================ QR reward cards
export function OwnerCodes() {
  const q = useApi<any[]>(['owner', 'codes'], '/owner/codes');
  const [f, setF] = useState({ label: 'Reward card', bits: 100, item: '', qty: 0, uses: 1, count: 1 });
  const create = useAction(() => POST('/owner/codes', { label: f.label, bits: f.bits, items: f.item && f.qty ? { [f.item]: f.qty } : {}, uses: f.uses, count: f.count }), { invalidate: [['owner', 'codes']], success: 'Cards made! Print the QR codes below.' });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">🎁 Real-life QR cards</h1>
      <p className="text-sm muted">Print these and hand them out. Bits come out of the Treasury when someone redeems one; items are a gift from you.</p>
      <div className="card grid sm:grid-cols-3 gap-2">
        <label className="label sm:col-span-3">Label<input className="input" maxLength={80} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></label>
        <label className="label">Bits each<input type="number" className="input" min={0} value={f.bits} onChange={(e) => setF({ ...f, bits: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></label>
        <label className="label">Item<select className="input" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })}><option value="">none</option>{ITEM_IDS.map((i) => <option key={i} value={i}>{itemLabel(i)}</option>)}</select></label>
        <label className="label">Item qty<input type="number" className="input" min={0} value={f.qty} onChange={(e) => setF({ ...f, qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></label>
        <label className="label">Uses per card<input type="number" className="input" min={1} value={f.uses} onChange={(e) => setF({ ...f, uses: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} /></label>
        <label className="label">How many cards<input type="number" className="input" min={1} max={100} value={f.count} onChange={(e) => setF({ ...f, count: Math.max(1, Math.min(100, Math.floor(Number(e.target.value) || 1))) })} /></label>
        <button className="btn-primary self-end" onClick={() => create.mutate(undefined)}>Make cards</button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 print:grid-cols-3">
        {(q.data ?? []).map((c) => (
          <div key={c.code} className={`card flex flex-col items-center gap-1 text-center ${c.usesLeft ? '' : 'opacity-50'}`}>
            <b className="text-sm">{c.label}</b>
            <QR text={`${window.location.origin}/redeem/${c.code}`} size={130} />
            <span className="font-mono font-bold">{c.code}</span>
            <span className="text-xs">{[c.bits ? formatBits(c.bits) : '', ...Object.entries(c.items).map(([i, n]) => `${n}× ${itemLabel(i)}`)].filter(Boolean).join(' + ')} · {c.usesLeft} left</span>
          </div>
        ))}
      </div>
    </div>
  );
}
