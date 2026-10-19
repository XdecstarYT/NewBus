import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Props every mini-game gets. Call onEnd exactly once with the final score. */
export interface GameProps {
  seed: number;
  questions?: Array<{ q: string; options: string[] }>;
  onEnd: (score: number, answers?: number[]) => void;
}

/** Small seeded RNG so a session's layout is reproducible. */
export function makeRng(seed: number) {
  let a = seed >>> 0 || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T,>(arr: readonly T[]) => arr[Math.floor(next() * arr.length)],
    shuffle: <T,>(arr: T[]) => {
      const a2 = [...arr];
      for (let i = a2.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a2[i], a2[j]] = [a2[j], a2[i]];
      }
      return a2;
    },
  };
}

/** Countdown in seconds; calls onZero once when it hits 0. */
export function useCountdown(seconds: number, onZero: () => void, running = true) {
  const [left, setLeft] = useState(seconds);
  const fired = useRef(false);
  const cb = useRef(onZero);
  cb.current = onZero;
  useEffect(() => {
    if (!running) return;
    const started = Date.now() - (seconds - left) * 1000;
    const t = setInterval(() => {
      const l = Math.max(0, seconds - (Date.now() - started) / 1000);
      setLeft(l);
      if (l <= 0 && !fired.current) {
        fired.current = true;
        clearInterval(t);
        cb.current();
      }
    }, 100);
    return () => clearInterval(t);
  }, [running]);
  return left;
}

/** Calls fn only the first time, so onEnd can never fire twice. */
export function useOnce(fn: (...a: any[]) => void) {
  const done = useRef(false);
  return (...a: any[]) => {
    if (done.current) return;
    done.current = true;
    fn(...a);
  };
}

export function HUD({ score, left, total, label = 'Score', extra }: { score: number; left: number; total: number; label?: string; extra?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 mb-2">
      <div className="flex items-center gap-3 font-bold">
        <span className="text-lg" aria-live="polite">{label}: {score}</span>
        {extra}
        <span className="ml-auto tabular-nums">⏱️ {Math.ceil(left)}s</span>
      </div>
      <div className="h-2 rounded-full bg-ink/10 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.ceil(left)}>
        <div className={`h-full transition-all ${left / total < 0.25 ? 'bg-bad' : 'bg-accent'}`} style={{ width: `${(left / total) * 100}%` }} />
      </div>
    </div>
  );
}

/** A floating "+1" / "-1" bubble. */
export function Pop({ text, good = true }: { text: string; good?: boolean }) {
  return <span className={`absolute -top-2 left-1/2 -translate-x-1/2 text-sm font-extrabold pointer-events-none animate-bounce ${good ? 'text-good' : 'text-bad'}`}>{text}</span>;
}
