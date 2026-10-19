import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { LoadingJoke, EmptyState, Modal, Toggle, useConfirm, timeAgo } from '../../components/ui';

const EMOJIS = ['📦', '🎁', '🧧', '💼', '🧰', '🪅', '🎀', '🥡', '💌', '🗝️'];

interface Form {
  name: string;
  emoji: string;
  message: string;
  mystery: boolean;
  cards: number;
  maxClaims: number;
  expiresInDays: number | null;
  targetCompanyId: string | null;
  bits: number;
  pods: Record<string, number>;
  items: string[];
  boost: boolean;
  boostMult: number;
  boostMinutes: number;
}

const EMPTY: Form = { name: 'Surprise Package', emoji: '📦', message: '', mystery: false, cards: 6, maxClaims: 1, expiresInDays: null, targetCompanyId: null, bits: 500, pods: {}, items: [], boost: false, boostMult: 1.5, boostMinutes: 30 };

/** Owner Panel "Packages": make real-life package cards with QR codes, print them, track who opened them. */
export function PackagesAdmin() {
  const confirm = useConfirm();
  const q = useApi<any>(['owner-packages'], '/owner/packages', { refetchInterval: 20_000 });
  const companies = useApi<any[]>(['owner-companies', ''], '/owner/companies?');
  const [f, setF] = useState<Form>(EMPTY);
  const [print, setPrint] = useState<any>(null);
  const [claims, setClaims] = useState<string | null>(null);
  const claimsQ = useApi<any[]>(['package-claims', claims], claims ? `/owner/packages/${claims}/claims` : null);
  const inv = [['owner-packages']];
  const create = useAction(
    () =>
      POST<{ batchId: string }>('/owner/packages', {
        name: f.name,
        emoji: f.emoji,
        message: f.message,
        mystery: f.mystery,
        cards: f.cards,
        maxClaims: f.maxClaims,
        expiresInDays: f.expiresInDays,
        targetCompanyId: f.targetCompanyId,
        contents: {
          bits: f.bits || undefined,
          pods: Object.entries(f.pods).filter(([, n]) => n > 0).map(([type, count]) => ({ type, count })),
          items: f.items,
          boost: f.boost ? { mult: f.boostMult, minutes: f.boostMinutes } : undefined,
        },
      }),
    { invalidate: inv, success: '📦 Packages packed! Print the cards and hand them out.', onSuccess: () => setF({ ...EMPTY }) },
  );
  const voidIt = useAction((v: { batchId?: string; id?: string }) => POST('/owner/packages/void', v), { invalidate: inv, success: 'Voided. Those codes no longer work.' });
  if (!q.data) return <LoadingJoke />;
  const opts = q.data.options;
  const num = (v: string, min = 0) => Math.max(min, Math.floor(Number(v) || 0));
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">📦 Real-Life Packages</h1>
      <p className="text-sm muted max-w-3xl">Make package cards to hand out (or hide!) in real life. Each card has a QR code: players scan it with their phone camera, log in, and unbox the rewards into their company. Bits come out of the Treasury. Codes are random and wrong guesses are limited.</p>
      <div className="card grid lg:grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <div className="h3">1. The package</div>
          <div className="flex gap-1 flex-wrap">{EMOJIS.map((e) => <button key={e} className={`w-10 h-10 text-2xl rounded-xl border-2 ${f.emoji === e ? 'border-ink bg-accent/20' : 'border-transparent'}`} onClick={() => setF({ ...f, emoji: e })} aria-label={`Emoji ${e}`}>{e}</button>)}</div>
          <input className="input" placeholder="Package name" maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Package name" />
          <input className="input" placeholder="Message on the card (optional)" maxLength={200} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} aria-label="Message" />
          <Toggle checked={f.mystery} onChange={(v) => setF({ ...f, mystery: v })} label="❓ Mystery (hide contents until opened)" />
          <div className="h3 mt-2">2. What's inside (per opening)</div>
          <label className="label">💰 Bits<input type="number" className="input" min={0} max={opts.limits.maxBitsPerPackage} value={f.bits} onChange={(e) => setF({ ...f, bits: Math.min(opts.limits.maxBitsPerPackage, num(e.target.value)) })} /></label>
          <div className="grid grid-cols-3 gap-2">
            {opts.pods.map((p: any) => (
              <label key={p.key} className="label">{p.emoji} {p.name}<input type="number" className="input" min={0} max={10} value={f.pods[p.key] ?? 0} onChange={(e) => setF({ ...f, pods: { ...f.pods, [p.key]: Math.min(10, num(e.target.value)) } })} /></label>
            ))}
          </div>
          <label className="label">🪴 Decor / pets
            <select className="input" value="" onChange={(e) => e.target.value && setF({ ...f, items: [...f.items, e.target.value].slice(0, 10) })}>
              <option value="">Add an item...</option>
              {opts.items.map((i: any) => <option key={i.key} value={i.key}>{i.emoji} {i.name} ({i.kind})</option>)}
            </select>
          </label>
          {f.items.length > 0 && <div className="flex flex-wrap gap-1">{f.items.map((k, i) => { const it = opts.items.find((x: any) => x.key === k); return <button key={i} className="chip" onClick={() => setF({ ...f, items: f.items.filter((_, j) => j !== i) })} aria-label={`Remove ${it?.name}`}>{it?.emoji} {it?.name} ✕</button>; })}</div>}
          <Toggle checked={f.boost} onChange={(v) => setF({ ...f, boost: v })} label="⚡ Income boost" />
          {f.boost && (
            <div className="grid grid-cols-2 gap-2">
              <label className="label">Multiplier<input type="number" step="0.1" min={1} max={3} className="input" value={f.boostMult} onChange={(e) => setF({ ...f, boostMult: Math.min(3, Math.max(1, Number(e.target.value) || 1)) })} /></label>
              <label className="label">Minutes<input type="number" min={1} max={1440} className="input" value={f.boostMinutes} onChange={(e) => setF({ ...f, boostMinutes: Math.min(1440, num(e.target.value, 1)) })} /></label>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="h3">3. Cards & rules</div>
          <label className="label">How many cards to print<input type="number" className="input" min={1} max={opts.limits.maxCardsPerBatch} value={f.cards} onChange={(e) => setF({ ...f, cards: Math.min(opts.limits.maxCardsPerBatch, num(e.target.value, 1)) })} /></label>
          <label className="label">Openings per card (1 = first finder wins; more = shareable)<input type="number" className="input" min={1} max={opts.limits.maxClaimsPerCard} value={f.maxClaims} onChange={(e) => setF({ ...f, maxClaims: Math.min(opts.limits.maxClaimsPerCard, num(e.target.value, 1)) })} /></label>
          <label className="label">Expires after (days, blank = never)<input type="number" className="input" min={1} value={f.expiresInDays ?? ''} onChange={(e) => setF({ ...f, expiresInDays: e.target.value ? num(e.target.value, 1) : null })} /></label>
          <label className="label">Only for one company (optional)
            <select className="input" value={f.targetCompanyId ?? ''} onChange={(e) => setF({ ...f, targetCompanyId: e.target.value || null })}>
              <option value="">Anyone who finds it</option>
              {(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
            </select>
          </label>
          <div className="card-flat text-sm mt-auto">
            <b>Preview:</b> {f.cards} card(s) of {f.emoji} <b>{f.name}</b>, each opened up to {f.maxClaims}×. Worst case it pays out {(f.bits * f.cards * f.maxClaims).toLocaleString()} BT from the Treasury.
          </div>
          <button className="btn-good text-lg" disabled={create.isPending || !f.name.trim()} onClick={() => create.mutate(undefined)} data-testid="pack-create">📦 Pack them!</button>
        </div>
      </div>

      <h2 className="h2">🗃️ Your packages</h2>
      {!q.data.batches.length ? <EmptyState emoji="📭" title="No packages yet" body="Pack your first batch above." /> : (
        <div className="grid md:grid-cols-2 gap-3">
          {q.data.batches.map((b: any) => {
            const live = b.cards.filter((c: any) => c.status === 'active').length;
            return (
              <div key={b.batchId} className="card flex flex-col gap-2">
                <div className="flex items-center gap-2"><span className="text-3xl">{b.emoji}</span><b className="flex-1">{b.name}</b>{b.mystery && <span className="chip">❓ mystery</span>}</div>
                <div className="text-sm">{b.contents.map((c: any) => `${c.emoji} ${c.label}`).join(' · ')}</div>
                <div className="text-xs muted">{b.cards.length} cards · opened {b.opened}× (max {b.maxClaims} each) · {live} active{b.target ? ` · only for ${b.target}` : ''}{b.expiresAt ? ` · expires ${new Date(b.expiresAt).toLocaleDateString()}` : ''} · made {timeAgo(b.createdAt)}</div>
                <div className="flex gap-1 flex-wrap">
                  <button className="btn-primary btn-sm" onClick={() => setPrint(b)} data-testid="pack-print">🖨️ Print cards</button>
                  <button className="btn-ghost btn-sm" onClick={() => setClaims(b.batchId)}>👀 Who opened</button>
                  {live > 0 && <button className="btn-bad btn-sm" onClick={async () => (await confirm({ title: `Void all "${b.name}" cards?`, body: 'Their codes stop working. Already-opened rewards stay.', danger: true })) && voidIt.mutate({ batchId: b.batchId })}>Void</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Modal open={!!print} onClose={() => setPrint(null)} title={`🖨️ ${print?.name}`} wide>
        {print && <PrintSheet batch={print} />}
      </Modal>
      <Modal open={!!claims} onClose={() => setClaims(null)} title="👀 Who opened them">
        {!claimsQ.data ? <LoadingJoke /> : !claimsQ.data.length ? <p className="text-sm muted">Nobody yet.</p> : claimsQ.data.map((c, i) => <div key={i} className="text-sm">{c.company} · <span className="font-mono">{c.code}</span> · {timeAgo(c.at)}</div>)}
      </Modal>
    </div>
  );
}

function QR({ text }: { text: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then(setSvg).catch(() => setSvg(''));
  }, [text]);
  return <div className="w-28 h-28 shrink-0 [&>svg]:w-full [&>svg]:h-full" aria-label={`QR code for ${text}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** A sheet of cut-out cards, each with a QR code that opens /redeem/<code>. */
function PrintSheet({ batch }: { batch: any }) {
  const origin = window.location.origin;
  const cards = batch.cards.filter((c: any) => c.status === 'active');
  const doPrint = () => {
    document.body.classList.add('printing-cards');
    window.print();
    setTimeout(() => document.body.classList.remove('printing-cards'), 500);
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 items-center flex-wrap">
        <button className="btn-primary" onClick={doPrint}>🖨️ Print {cards.length} cards</button>
        <span className="text-xs muted">Cut along the dashed lines. Anyone with a card can scan it with their phone camera.</span>
      </div>
      {origin.includes('localhost') && <p className="text-xs text-bad font-bold">⚠️ These QR codes point at {origin}, which only works on this computer. Open the Owner Panel from your game's real address (your Wi-Fi address or hosted URL) before printing.</p>}
      <div id="print-sheet" className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-white text-black p-2">
        {cards.map((c: any) => (
          <div key={c.id} className="pkg-card border-2 border-dashed border-black/40 rounded-xl p-3 flex gap-3 items-center">
            <QR text={`${origin}/redeem/${c.code}`} />
            <div className="flex flex-col gap-1 min-w-0">
              <div className="text-xs font-bold uppercase tracking-wider">Digital Workforce · package</div>
              <div className="text-lg font-extrabold leading-tight">{batch.emoji} {batch.name}</div>
              {batch.message && <div className="text-xs italic">"{batch.message}"</div>}
              <div className="text-[11px]">{batch.mystery ? '❓ Mystery contents!' : batch.contents.map((x: any) => `${x.emoji} ${x.label}`).join(' · ')}</div>
              <div className="font-mono font-bold text-lg tracking-widest">{c.code}</div>
              <div className="text-[10px]">Scan me, or enter the code under 📦 Packages.</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
