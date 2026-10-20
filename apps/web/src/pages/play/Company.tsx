import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { ITEM_IDS } from '@dw/shared/live';
import { POST, PATCH } from '../../lib/api';
import { useApi, useAction } from '../../lib/hooks';
import { formatBits, itemLabel } from '../../lib/game';
import { sfx } from '../../lib/sound';
import { useStore } from '../../lib/store';
import { Scanner } from '../../components/Scanner';
import { LoadingJoke, Toggle, timeAgo, useConfirm } from '../../components/ui';
import { ChangePasswordForm } from '../ChangePassword';
import { useMe2 } from '../Layout';

export function CompanyPicker({ value, onChange, label = 'Company' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const me = useMe2();
  const q = useApi<any[]>(['companies'], '/game/companies');
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{label}...</option>
      {(q.data ?? []).filter((c) => c.id !== me.company?.id).map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
    </select>
  );
}

export function Send() {
  const home = useApi<any>(['home'], '/game/home');
  const [to, setTo] = useState('');
  const [bits, setBits] = useState(100);
  const [memo, setMemo] = useState('');
  const [it, setIt] = useState('');
  const [qty, setQty] = useState(1);
  const inv = [['home'], ['me']];
  const sendBits = useAction(() => POST('/game/send/bits', { to, amount: bits, memo }), { invalidate: inv, success: '💸 Sent!', onSuccess: () => sfx.coin() });
  const sendItems = useAction(() => POST('/game/send/items', { to, item: it, qty, memo }), { invalidate: inv, success: '📦 Shipped!', onSuccess: () => sfx.coin() });
  const stock = ITEM_IDS.filter((i) => home.data?.inventory?.[i]);
  return (
    <div className="max-w-xl mx-auto flex flex-col gap-4">
      <h1 className="h1">💸 Send</h1>
      <p className="text-sm muted">Pay a friend, settle a deal, or ship goods. Transfers skip the sales tax, so the Owner may audit them.</p>
      <div className="card flex flex-col gap-2">
        <CompanyPicker value={to} onChange={setTo} label="Send to" />
        <input className="input" maxLength={120} placeholder="What's it for? (optional)" value={memo} onChange={(e) => setMemo(e.target.value)} aria-label="Memo" />
      </div>
      <div className="card flex flex-col gap-2">
        <div className="h3">Bits</div>
        <div className="flex gap-2">
          <input type="number" className="input flex-1" min={1} value={bits} onChange={(e) => setBits(Math.max(1, Math.floor(Number(e.target.value) || 1)))} aria-label="Amount" />
          <button className="btn-good" disabled={!to || sendBits.isPending} onClick={() => sendBits.mutate(undefined)}>Send {formatBits(bits)}</button>
        </div>
      </div>
      <div className="card flex flex-col gap-2">
        <div className="h3">Items</div>
        <div className="flex gap-2 flex-wrap">
          <select className="input flex-1" value={it} onChange={(e) => setIt(e.target.value)} aria-label="Item">
            <option value="">Item...</option>
            {stock.map((i) => <option key={i} value={i}>{itemLabel(i)} ({home.data.inventory[i]})</option>)}
          </select>
          <input type="number" className="input !w-24" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))} aria-label="Quantity" />
          <button className="btn-good" disabled={!to || !it || sendItems.isPending} onClick={() => sendItems.mutate(undefined)}>Ship</button>
        </div>
      </div>
    </div>
  );
}

export function Team() {
  const me = useMe2();
  const confirm = useConfirm();
  const q = useApi<any[]>(['team'], '/game/team');
  const [name, setName] = useState('');
  const [made, setMade] = useState<{ number: string; password: string; name: string } | null>(null);
  const [co, setCo] = useState({ slogan: me.company?.slogan ?? '', emoji: me.company?.emoji ?? '🏢', color: me.company?.color ?? '#7c3aed' });
  const add = useAction(() => POST<any>('/game/team', { name }), { invalidate: [['team']], onSuccess: (r) => (setMade({ ...r, name }), setName('')) });
  const toggle = useAction((v: { id: string; active: boolean }) => POST(`/game/team/${v.id}/status`, { active: v.active }), { invalidate: [['team']] });
  const reset = useAction((id: string) => POST<any>(`/game/team/${id}/reset`), { onSuccess: (r) => setMade({ number: '', password: r.password, name: 'New temporary password' }) });
  const save = useAction(() => PATCH('/game/company', co), { invalidate: [['me']], success: 'Saved.' });
  const admin = me.account.role === 'ADMIN';
  if (!q.data) return <LoadingJoke />;
  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <h1 className="h1">👥 Team</h1>
      <p className="text-sm muted">Every login is a real friend with their own Energy. More teammates means more work gets done.</p>
      <div className="card flex flex-col gap-1">
        {q.data.map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-sm py-1 border-b border-ink/5 last:border-0">
            <span className="flex-1"><b>{a.name}</b> <span className="muted">#{a.number} · {a.role === 'ADMIN' ? 'admin' : 'staff'} · {a.xp} XP · seen {timeAgo(a.lastSeen)}</span></span>
            {a.status !== 'active' && <span className="chip">off</span>}
            {admin && a.role !== 'ADMIN' && (
              <>
                <button className="btn-ghost btn-sm" onClick={() => toggle.mutate({ id: a.id, active: a.status !== 'active' })}>{a.status === 'active' ? 'Switch off' : 'Switch on'}</button>
                <button className="btn-ghost btn-sm" onClick={async () => (await confirm({ title: `Reset ${a.name}'s password?` })) && reset.mutate(a.id)}>Reset password</button>
              </>
            )}
          </div>
        ))}
      </div>
      {admin && (
        <>
          <form className="card flex gap-2" onSubmit={(e) => (e.preventDefault(), name.trim() && add.mutate(undefined))}>
            <input className="input flex-1" maxLength={40} placeholder="Friend's name" value={name} onChange={(e) => setName(e.target.value)} aria-label="New teammate name" />
            <button className="btn-primary" disabled={!name.trim()}>➕ Add login</button>
          </form>
          {made && (
            <div className="card !bg-amber-50 text-sm" role="status">
              <b>{made.name}</b>: {made.number && <>account <span className="font-mono font-bold">{made.number}</span>, </>}temporary password <span className="font-mono font-bold">{made.password}</span>. Give these to your friend; they pick their own password on first login.
            </div>
          )}
          <div className="card flex flex-col gap-2">
            <div className="h3">🏢 Company look</div>
            <div className="grid grid-cols-[80px_1fr_80px] gap-2">
              <input className="input text-center text-2xl" maxLength={8} value={co.emoji} onChange={(e) => setCo({ ...co, emoji: e.target.value })} aria-label="Emoji" />
              <input className="input" maxLength={120} value={co.slogan} onChange={(e) => setCo({ ...co, slogan: e.target.value })} aria-label="Slogan" placeholder="Slogan" />
              <input type="color" className="input !p-1 h-11" value={co.color} onChange={(e) => setCo({ ...co, color: e.target.value })} aria-label="Colour" />
            </div>
            <button className="btn-primary self-start" onClick={() => save.mutate(undefined)}>Save</button>
          </div>
        </>
      )}
    </div>
  );
}

/** Real-life QR reward cards from the Owner. */
export function Redeem() {
  const { code: urlCode } = useParams();
  const confetti = useStore((s) => s.confetti);
  const [code, setCode] = useState(urlCode ?? '');
  const [scan, setScan] = useState(false);
  const [got, setGot] = useState<any>(null);
  const redeem = useAction((c: string) => POST<any>('/game/redeem', { code: c }), { invalidate: [['home'], ['me']], onSuccess: (r) => (sfx.levelUp(), confetti(), setGot(r)) });
  useEffect(() => {
    if (urlCode) redeem.mutate(urlCode);
  }, [urlCode]);
  return (
    <div className="max-w-md mx-auto flex flex-col gap-4">
      <h1 className="h1">🎁 Redeem a card</h1>
      <div className="card flex flex-col gap-2">
        <p className="text-sm muted">Got a real-life card from the Owner? Scan its QR or type the code.</p>
        <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), code.trim() && redeem.mutate(code))}>
          <input className="input flex-1 font-mono uppercase tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Card code" />
          <button className="btn-primary">Redeem</button>
          <button type="button" className="btn-ghost" onClick={() => setScan(true)} aria-label="Scan card">📷</button>
        </form>
        {scan && <Scanner onCode={(c) => (setScan(false), setCode(c), redeem.mutate(c))} onClose={() => setScan(false)} />}
      </div>
      {got && (
        <div className="card text-center" data-testid="redeemed">
          <div className="text-6xl">🎉</div>
          <h2 className="h2">{got.label}</h2>
          <p>{[got.bits ? formatBits(got.bits) : '', ...Object.entries(got.items).map(([i, n]) => `${n}× ${itemLabel(i)}`)].filter(Boolean).join(' + ')}</p>
        </div>
      )}
    </div>
  );
}

export function Settings() {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  return (
    <div className="max-w-xl mx-auto flex flex-col gap-4">
      <h1 className="h1">⚙️ Settings</h1>
      <div className="card flex flex-col gap-2">
        <Toggle checked={prefs.dark} onChange={(v) => setPrefs({ dark: v })} label="🌙 Dark mode" />
        <Toggle checked={prefs.reducedMotion} onChange={(v) => setPrefs({ reducedMotion: v })} label="🐢 Reduce motion" />
        <Toggle checked={prefs.highContrast} onChange={(v) => setPrefs({ highContrast: v })} label="🔆 High contrast" />
        <Toggle checked={!prefs.muted} onChange={(v) => setPrefs({ muted: !v })} label="🔊 Sound effects" />
        <label className="label">Text size<input type="range" min={0.85} max={1.4} step={0.05} value={prefs.textSize} onChange={(e) => setPrefs({ textSize: Number(e.target.value) })} /></label>
      </div>
      <div className="card">
        <div className="h3 mb-2">🔐 Change password</div>
        <ChangePasswordForm compact />
      </div>
    </div>
  );
}
