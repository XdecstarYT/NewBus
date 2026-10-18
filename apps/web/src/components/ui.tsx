import { AnimatePresence, motion, animate, useMotionValue, useTransform } from 'framer-motion';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatBits } from '@dw/shared';
import { useStore } from '../lib/store';
import { BossByteFace } from './BossByte';
import { t } from '../i18n';

// ---------------------------------------------------------------- toasts
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismiss);
  return (
    <div className="fixed z-50 top-3 left-1/2 -translate-x-1/2 flex flex-col gap-2 items-center w-[min(92vw,420px)]" role="status" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            onClick={() => dismiss(t.id)}
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10 }}
            className={`card !py-2 !px-3 text-sm font-bold text-left w-full flex items-center gap-2 ${
              t.kind === 'good' ? '!bg-good/15' : t.kind === 'bad' ? '!bg-bad/15' : t.kind === 'joke' ? '!bg-accent/10' : t.kind === 'caption' ? '!bg-ink/80 !text-paper !shadow-none !border-0' : ''
            }`}
          >
            <span aria-hidden>{t.emoji ?? (t.kind === 'good' ? '🎉' : t.kind === 'bad' ? '😬' : t.kind === 'joke' ? '😂' : '💬')}</span>
            <span>{t.text}</span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------- floating +BT numbers
export function Floaters() {
  const floaters = useStore((s) => s.floaters);
  const reduce = useStore((s) => s.prefs.reducedMotion);
  return (
    <div className="fixed inset-0 pointer-events-none z-40" aria-hidden>
      <AnimatePresence>
        {floaters.map((f) => (
          <motion.div
            key={f.id}
            initial={{ opacity: 1, x: f.x, y: f.y, scale: f.big ? 1.4 : 1 }}
            animate={{ opacity: 0, y: f.y - (reduce ? 10 : 80), x: f.x + (reduce ? 0 : (f.id % 2 ? 20 : -20)) }}
            transition={{ duration: 1.1, ease: 'easeOut' }}
            className={`absolute font-display font-extrabold ${f.big ? 'text-3xl' : 'text-lg'}`}
            style={{ color: f.color ?? '#16a34a', textShadow: '0 2px 0 #1e1b4b, 0 -1px 0 #1e1b4b, 1px 0 0 #1e1b4b, -1px 0 0 #1e1b4b' }}
          >
            {f.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------- confetti (canvas, no deps)
export function Confetti() {
  const key = useStore((s) => s.confettiKey);
  const reduce = useStore((s) => s.prefs.reducedMotion);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!key || reduce) return;
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    c.width = window.innerWidth;
    c.height = window.innerHeight;
    const colors = ['#f472b6', '#facc15', '#4ade80', '#38bdf8', '#a78bfa', '#fb923c'];
    const parts = Array.from({ length: 160 }, () => ({
      x: c.width / 2 + (Math.random() - 0.5) * 200,
      y: c.height / 3,
      vx: (Math.random() - 0.5) * 16,
      vy: -Math.random() * 14 - 4,
      r: Math.random() * 6 + 4,
      a: Math.random() * Math.PI,
      va: (Math.random() - 0.5) * 0.4,
      col: colors[Math.floor(Math.random() * colors.length)],
    }));
    let frame = 0;
    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const p of parts) {
        p.vy += 0.35;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.a += p.va;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.a);
        ctx.fillStyle = p.col;
        ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
        ctx.restore();
      }
      if (frame++ < 160) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, c.width, c.height);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [key, reduce]);
  return <canvas ref={ref} className="fixed inset-0 pointer-events-none z-50" aria-hidden />;
}

// ---------------------------------------------------------------- rolling balance counter
export function RollingNumber({ value, format = (n: number) => formatBits(Math.round(n)), className = '' }: { value: number; format?: (n: number) => string; className?: string }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => format(v));
  const reduce = useStore((s) => s.prefs.reducedMotion);
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 0.8, ease: 'easeOut' });
    return () => c.stop();
  }, [value, reduce, mv]);
  return <motion.span className={className}>{text}</motion.span>;
}

// ---------------------------------------------------------------- modal
export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-2 sm:p-6 bg-ink/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            className={`card w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}
            initial={{ y: 40, scale: 0.95 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 40, scale: 0.95 }}
            onClick={(e) => e.stopPropagation()}
          >
            {title && (
              <div className="flex items-center justify-between mb-3 gap-2">
                <h2 className="h2">{title}</h2>
                <button className="btn-ghost btn-sm" onClick={onClose} aria-label={t('common.close')}>
                  ✕
                </button>
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------- silly confirm dialogs
const SILLY = ['Are you sure-sure?', 'Is this your final answer?', 'Boss Byte is holding his breath...', 'Pinky promise?', 'No take-backsies?'];
type ConfirmOpts = { title?: string; body?: ReactNode; yes?: string; no?: string; danger?: boolean };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (b: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal open={!!state} onClose={() => close(false)} title={state?.title ?? SILLY[Math.floor(Math.random() * SILLY.length)]}>
        <div className="flex gap-3 items-start">
          <BossByteFace mood={state?.danger ? 'wow' : 'think'} size={56} />
          <div className="flex-1">{state?.body}</div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-ghost" onClick={() => close(false)}>
            {state?.no ?? 'Nope, go back'}
          </button>
          <button className={state?.danger ? 'btn-bad' : 'btn-primary'} onClick={() => close(true)} autoFocus>
            {state?.yes ?? 'Yes, do it!'}
          </button>
        </div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

// ---------------------------------------------------------------- bits
export function Bits({ n, className = '' }: { n: number; className?: string }) {
  return <span className={`font-display font-bold tabular-nums ${className}`}>{formatBits(n)}</span>;
}

export function ProgressBar({ value, max, color = 'bg-accent', label, className = '' }: { value: number; max: number; color?: string; label?: string; className?: string }) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return (
    <div className={className}>
      {label && <div className="text-xs font-bold mb-1 flex justify-between"><span>{label}</span><span className="muted">{Math.round(pct)}%</span></div>}
      <div className="h-4 rounded-full border-[3px] border-ink bg-paper overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <motion.div className={`h-full ${color}`} initial={false} animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
      </div>
    </div>
  );
}

export function EmptyState({ emoji = '🦗', title, body, children }: { emoji?: string; title: string; body?: ReactNode; children?: ReactNode }) {
  return (
    <div className="card-flat text-center py-8 flex flex-col items-center gap-2">
      <div className="text-5xl animate-bob" aria-hidden>{emoji}</div>
      <div className="h3">{title}</div>
      {body && <p className="muted text-sm max-w-sm">{body}</p>}
      {children}
    </div>
  );
}

export function LockedScreen({ module }: { module: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-12">
      <BossByteFace mood="think" size={110} className="animate-bob" />
      <div className="text-5xl" aria-hidden>🔒</div>
      <h2 className="h1">{t('locked.title')}</h2>
      <p className="muted max-w-sm">{t('locked.body', { module })}</p>
      <p className="text-xs muted">(He tried bribing the Owner with cookies. It didn't work.)</p>
    </div>
  );
}

const GENERIC_JOKES = [
  'Reticulating spreadsheets...',
  'Teaching the interns to blink...',
  'Polishing the Bits...',
  'Untangling the printer cable...',
  'Feeding the office goldfish...',
  'Counting to infinity (twice)...',
  'Asking the server nicely...',
  'Warming up the coffee machine...',
  'Defragmenting the break room...',
  'Herding the robots...',
];
export function LoadingJoke({ jokes }: { jokes?: string[] }) {
  const list = jokes?.length ? jokes : GENERIC_JOKES;
  const [i, setI] = useState(() => Math.floor(Math.random() * list.length));
  useEffect(() => {
    const iv = setInterval(() => setI((x) => (x + 1) % list.length), 1800);
    return () => clearInterval(iv);
  }, [list.length]);
  return (
    <div className="flex flex-col items-center gap-3 py-16" role="status">
      <BossByteFace mood="think" size={72} className="animate-wiggle" />
      <p className="font-display font-bold text-center px-4">{list[i]}</p>
    </div>
  );
}

export function Pill({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span className="chip" style={color ? { background: color, color: '#fff', borderColor: '#1e1b4b' } : undefined}>
      {children}
    </span>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className={`flex items-center justify-between gap-3 py-1 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <span className="text-sm font-bold">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`w-12 h-7 rounded-full border-[3px] border-ink relative transition-colors ${checked ? 'bg-good' : 'bg-paper'}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-ink transition-all ${checked ? 'left-6' : 'left-1'}`} />
      </button>
    </label>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1" role="tablist">
      {tabs.map((tb) => (
        <button key={tb.id} role="tab" aria-selected={value === tb.id} onClick={() => onChange(tb.id)} className={`btn-sm ${value === tb.id ? 'btn-primary' : 'btn-ghost'} whitespace-nowrap`}>
          {tb.label}
        </button>
      ))}
    </div>
  );
}

export function timeAgo(ms: number | null | undefined) {
  if (!ms) return 'never';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function timeLeft(ms: number) {
  const s = Math.max(0, Math.round((ms - Date.now()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** Re-render every `ms` (for countdowns). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(iv);
  }, [ms]);
  return now;
}
