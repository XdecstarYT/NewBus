import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { useStore } from '../../lib/store';
import { sfx } from '../../lib/sound';
import { EmptyState, timeAgo } from '../../components/ui';
import { useGameMe, useBase } from './GameLayout';
import { Scanner } from '../../components/Scanner';

interface Peek {
  code: string;
  name: string;
  emoji: string;
  message: string;
  mystery: boolean;
  contents: Array<{ emoji: string; label: string }> | null;
  canOpen: boolean;
  reason: string | null;
}
interface Opened {
  name: string;
  emoji: string;
  message: string;
  got: Array<{ emoji: string; label: string }>;
  notes: string[];
}

/** Real-life packages: scan the QR on a printed card (or type its code) and unbox it into your company. */
export function Packages() {
  const me = useGameMe();
  const base = useBase();
  const navigate = useNavigate();
  const { code: urlCode } = useParams();
  const confetti = useStore((s) => s.confetti);
  const [code, setCode] = useState(urlCode ?? '');
  const [peek, setPeek] = useState<Peek | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [scanning, setScanning] = useState(false);
  const history = useApi<any[]>(['my-packages'], '/game/packages');
  const look = useAction((c: string) => POST<Peek>('/game/packages/peek', { code: c }), { onSuccess: (r) => { setPeek(r); setOpened(null); } });
  const open = useAction(() => POST<Opened>('/game/packages/redeem', { code: peek!.code }), {
    invalidate: [['my-packages'], ['state', me.access.companyId], ['office'], ['workforce']],
    onSuccess: (r) => {
      sfx.levelUp();
      confetti();
      setOpened(r);
      setPeek(null);
      setCode('');
    },
  });

  // Arriving from a scanned QR link: look the package up straight away.
  useEffect(() => {
    if (urlCode && !me.access.readOnly) look.mutate(urlCode);
  }, [urlCode]);

  const ro = me.access.readOnly;
  return (
    <div className="max-w-xl mx-auto flex flex-col gap-4">
      <h1 className="h1">📦 Real-Life Packages</h1>
      <p className="text-sm muted">Got a package card in real life? Scan its QR code with your phone camera, or type the code below to unbox it into your company.</p>

      {!peek && !opened && (
        <div className="card flex flex-col gap-3">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) look.mutate(code); }}>
            <input className="input flex-1 text-center font-mono text-xl tracking-[0.2em] uppercase" placeholder="ABCD-EFGH" value={code} maxLength={40} onChange={(e) => setCode(e.target.value)} aria-label="Package code" autoCapitalize="characters" autoComplete="off" data-testid="package-code" disabled={ro} />
            <button className="btn-primary" disabled={ro || !code.trim() || look.isPending} data-testid="package-check">Check</button>
          </form>
          <button className="btn-ghost" onClick={() => setScanning(true)} disabled={ro}>📷 Scan a QR code</button>
          {scanning && <Scanner onCode={(c) => { setScanning(false); setCode(c); look.mutate(c); }} onClose={() => setScanning(false)} />}
        </div>
      )}

      <AnimatePresence mode="wait">
        {peek && (
          <motion.div key="peek" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} className="card text-center flex flex-col items-center gap-2">
            <motion.div className="text-8xl" animate={peek.canOpen ? { rotate: [0, -8, 8, -8, 8, 0], y: [0, -6, 0] } : {}} transition={{ repeat: Infinity, duration: 1.4, repeatDelay: 0.6 }}>{peek.emoji}</motion.div>
            <h2 className="h2">{peek.name}</h2>
            {peek.message && <p className="italic">"{peek.message}"</p>}
            {peek.mystery ? <p className="text-sm muted">❓ A mystery package. Who knows what's inside?</p> : (
              <ul className="text-sm">{peek.contents?.map((c, i) => <li key={i}>{c.emoji} {c.label}</li>)}</ul>
            )}
            {peek.canOpen ? (
              <button className="btn-good text-lg mt-2" disabled={open.isPending} onClick={() => open.mutate(undefined)} data-testid="package-open">🎁 Open it!</button>
            ) : <p className="text-bad font-bold">{peek.reason}</p>}
            <button className="btn-ghost btn-sm" onClick={() => { setPeek(null); if (urlCode) navigate(`${base}/packages`); }}>Back</button>
          </motion.div>
        )}
        {opened && (
          <motion.div key="opened" initial={{ scale: 0.5, rotate: -6, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: 'spring' }} className="card text-center flex flex-col items-center gap-2" data-testid="package-opened">
            <div className="text-6xl">🎉</div>
            <h2 className="h2">You opened {opened.emoji} {opened.name}!</h2>
            {opened.message && <p className="italic">"{opened.message}"</p>}
            <div className="flex flex-col gap-2 w-full mt-2">
              {opened.got.map((g, i) => (
                <motion.div key={i} initial={{ x: -30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.25 + i * 0.2 }} className="card-flat text-lg font-bold">{g.emoji} {g.label}</motion.div>
              ))}
            </div>
            {opened.notes.map((n, i) => <p key={i} className="text-xs muted">{n}</p>)}
            <button className="btn-primary mt-2" onClick={() => { setOpened(null); if (urlCode) navigate(`${base}/packages`); }}>Awesome!</button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="card">
        <div className="h3 mb-2">🗃️ Packages you've opened</div>
        {!history.data?.length ? <EmptyState emoji="📭" title="None yet" body="Keep an eye out for package cards in real life!" /> : history.data.map((p, i) => (
          <div key={i} className="flex items-center gap-2 text-sm border-b border-ink/5 py-1">
            <span className="text-xl">{p.emoji}</span>
            <span className="flex-1"><b>{p.name}</b> <span className="muted">{p.got.map((g: any) => `${g.emoji} ${g.label}`).join(' · ')}</span></span>
            <span className="text-xs muted">{timeAgo(p.openedAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
