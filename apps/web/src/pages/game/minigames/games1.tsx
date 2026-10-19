import { useEffect, useMemo, useRef, useState } from 'react';
import { sfx } from '../../../lib/sound';
import { HUD, makeRng, useCountdown, useOnce, type GameProps } from './kit';

// ------------------------------------------------------------ whack-style: Debug Rush + Server Whack
function Whacker({ seed, onEnd, cols, rows, target, decoy, spawnMs, lifeMs, seconds, hit }: GameProps & { cols: number; rows: number; target: string; decoy?: string; spawnMs: number; lifeMs: number; seconds: number; hit: string }) {
  const rng = useMemo(() => makeRng(seed), [seed]);
  const end = useOnce(onEnd);
  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);
  const [cells, setCells] = useState<Array<{ kind: 'target' | 'decoy' | 'hit'; until: number } | null>>(() => Array(cols * rows).fill(null));
  const left = useCountdown(seconds, () => end(scoreRef.current));
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setCells((prev) => {
        const next = prev.map((c) => (c && c.until > now ? c : null));
        const free = next.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
        if (free.length) {
          const i = free[rng.int(free.length)];
          next[i] = { kind: decoy && rng.next() < 0.2 ? 'decoy' : 'target', until: now + lifeMs * (0.7 + rng.next() * 0.6) };
        }
        return next;
      });
    }, spawnMs);
    return () => clearInterval(t);
  }, [rng, spawnMs, lifeMs, decoy]);
  const tap = (i: number) => {
    const c = cells[i];
    if (!c || c.kind === 'hit' || left <= 0) return;
    const delta = c.kind === 'target' ? 1 : -1;
    scoreRef.current = Math.max(0, scoreRef.current + delta);
    setScore(scoreRef.current);
    (delta > 0 ? sfx.pop : sfx.error)();
    setCells((prev) => prev.map((x, j) => (j === i ? { kind: 'hit', until: Date.now() + 250 } : x)));
  };
  return (
    <div>
      <HUD score={score} left={left} total={seconds} />
      <div className="grid gap-2 select-none" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {cells.map((c, i) => (
          <button key={i} onPointerDown={() => tap(i)} className="aspect-square rounded-2xl bg-ink/5 border-2 border-ink/10 text-4xl sm:text-5xl flex items-center justify-center active:scale-95 transition-transform" aria-label={c ? (c.kind === 'target' ? 'Hit!' : c.kind === 'decoy' ? 'Do not hit' : 'Done') : 'Empty'}>
            {c?.kind === 'target' ? target : c?.kind === 'decoy' ? decoy : c?.kind === 'hit' ? hit : ''}
          </button>
        ))}
      </div>
      {decoy && <p className="text-xs muted mt-2">Tap {target}, but not {decoy}!</p>}
    </div>
  );
}

export function DebugRush(p: GameProps) {
  return <Whacker {...p} cols={4} rows={4} target="🐛" decoy="🦋" hit="💥" spawnMs={650} lifeMs={1300} seconds={30} />;
}

export function ServerWhack(p: GameProps) {
  return <Whacker {...p} cols={3} rows={3} target="🖥️" decoy="☕" hit="✅" spawnMs={600} lifeMs={1100} seconds={30} />;
}

// ------------------------------------------------------------ Coffee Run: stop the pour on the line
export function CoffeeRun({ seed, onEnd }: GameProps) {
  const rng = useMemo(() => makeRng(seed), [seed]);
  const ROUNDS = 8;
  const end = useOnce(onEnd);
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(0);
  const [target, setTarget] = useState(() => 55 + rng.int(35));
  const [result, setResult] = useState<string | null>(null);
  const speed = useRef(0.9 + rng.next() * 0.6);
  const raf = useRef(0);
  const pouring = useRef(true);
  useEffect(() => {
    pouring.current = true;
    const start = performance.now();
    const loop = (t: number) => {
      if (!pouring.current) return;
      const l = ((t - start) / 1000) * 45 * speed.current;
      setLevel(Math.min(110, l));
      if (l >= 110) return stop(110);
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [round]);
  const stop = (at = level) => {
    if (!pouring.current) return;
    pouring.current = false;
    cancelAnimationFrame(raf.current);
    const diff = Math.abs(at - target);
    const pts = at > 100 ? 0 : diff <= 3 ? 3 : diff <= 8 ? 2 : diff <= 15 ? 1 : 0;
    const total = score + pts;
    setScore(total);
    setResult(at > 100 ? '☕💦 Overflow!' : pts === 3 ? `Perfect pour! +${pts}` : pts ? `+${pts}` : 'Way off!');
    (pts === 3 ? sfx.coin : sfx.pop)();
    setTimeout(() => {
      if (round + 1 >= ROUNDS) return end(total);
      setResult(null);
      setTarget(55 + rng.int(35));
      speed.current = 0.9 + rng.next() * 0.9 + round * 0.08;
      setLevel(0);
      setRound(round + 1);
    }, 700);
  };
  return (
    <div className="flex flex-col items-center gap-3 select-none">
      <div className="flex w-full font-bold"><span>Score: {score}</span><span className="ml-auto">Cup {Math.min(round + 1, ROUNDS)}/{ROUNDS}</span></div>
      <div className="relative w-32 h-48 border-4 border-ink rounded-b-[2.5rem] overflow-hidden bg-white" aria-label="Coffee cup">
        <div className="absolute bottom-0 left-0 right-0 bg-amber-800 transition-none" style={{ height: `${Math.min(100, level)}%` }} />
        <div className="absolute left-0 right-0 border-t-4 border-dashed border-good" style={{ bottom: `${target}%` }} />
      </div>
      <div className="h-6 font-bold">{result}</div>
      <button className="btn-primary text-xl w-full max-w-xs" onPointerDown={() => stop()} disabled={!!result}>☕ STOP!</button>
      <p className="text-xs muted">Stop the pour right on the green line. Don't overflow!</p>
    </div>
  );
}

// ------------------------------------------------------------ Email Sorter: keep or spam
const GOOD = ['Invoice paid ✅', 'Meeting moved to 3pm', 'Your order shipped 📦', 'Lunch on Friday?', 'Quarterly report attached', 'New customer review ⭐⭐⭐⭐⭐', 'Team photo 📸', 'Payroll processed', 'Supplier price list', 'Congrats on level up!'];
const SPAM = ['YOU WON 1,000,000 BITS!!!', 'Prince needs your password', 'Hot single robots near you', 'Click here for free pizza forever', 'Your account is HACKED, reply now', 'Miracle cure for slow WiFi', 'Buy cheap followers 100% real', 'URGENT: wire Bits to a duck', 'Ur computer has 9001 viruses', 'Get rich with this ONE trick'];

export function EmailSorter({ seed, onEnd }: GameProps) {
  const rng = useMemo(() => makeRng(seed), [seed]);
  const SECONDS = 30;
  const end = useOnce(onEnd);
  const scoreRef = useRef(0);
  const [score, setScore] = useState(0);
  const [mail, setMail] = useState(() => ({ spam: rng.next() < 0.5, text: '' }));
  const [flash, setFlash] = useState<'good' | 'bad' | null>(null);
  const left = useCountdown(SECONDS, () => end(scoreRef.current));
  const nextMail = () => {
    const spam = rng.next() < 0.5;
    setMail({ spam, text: spam ? rng.pick(SPAM) : rng.pick(GOOD) });
  };
  useEffect(nextMail, []);
  const sort = (asSpam: boolean) => {
    if (left <= 0) return;
    const ok = asSpam === mail.spam;
    scoreRef.current = Math.max(0, scoreRef.current + (ok ? 1 : -1));
    setScore(scoreRef.current);
    setFlash(ok ? 'good' : 'bad');
    (ok ? sfx.pop : sfx.error)();
    setTimeout(() => setFlash(null), 150);
    nextMail();
  };
  return (
    <div className="select-none">
      <HUD score={score} left={left} total={SECONDS} />
      <div className={`card text-center text-lg font-bold min-h-[110px] flex flex-col items-center justify-center transition-colors ${flash === 'good' ? '!bg-good/20' : flash === 'bad' ? '!bg-bad/20' : ''}`}>
        <div className="text-3xl">📧</div>
        {mail.text}
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <button className="btn-good text-lg py-4" onPointerDown={() => sort(false)}>📥 Keep</button>
        <button className="btn-bad text-lg py-4" onPointerDown={() => sort(true)}>🗑️ Spam</button>
      </div>
    </div>
  );
}
