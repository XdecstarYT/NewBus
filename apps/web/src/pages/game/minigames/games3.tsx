import { useEffect, useMemo, useRef, useState } from 'react';
import { sfx } from '../../../lib/sound';
import { HUD, makeRng, useCountdown, useOnce, type GameProps } from './kit';

// ------------------------------------------------------------ Pizza Rush: build the order
const TOPPINGS = ['🍅', '🧀', '🍄', '🌶️', '🫒', '🥓', '🍍', '🌿'];

export function PizzaRush({ seed, onEnd }: GameProps) {
  const rng = useMemo(() => makeRng(seed), [seed]);
  const SECONDS = 45;
  const end = useOnce(onEnd);
  const scoreRef = useRef(0);
  const [score, setScore] = useState(0);
  const newOrder = () => rng.shuffle(TOPPINGS).slice(0, 3 + (rng.next() < 0.35 ? 1 : 0));
  const [order, setOrder] = useState<string[]>(newOrder);
  const [placed, setPlaced] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const left = useCountdown(SECONDS, () => end(scoreRef.current));
  const add = (t: string) => {
    if (msg || left <= 0 || placed.includes(t)) return;
    if (!order.includes(t)) {
      sfx.error();
      setMsg('😭 Wrong topping! The customer cries.');
      setTimeout(() => {
        setMsg(null);
        setPlaced([]);
        setOrder(newOrder());
      }, 700);
      return;
    }
    sfx.pop();
    const p = [...placed, t];
    setPlaced(p);
    if (p.length === order.length) {
      scoreRef.current += 2;
      setScore(scoreRef.current);
      sfx.coin();
      setMsg('🍕 Order up! +2');
      setTimeout(() => {
        setMsg(null);
        setPlaced([]);
        setOrder(newOrder());
      }, 600);
    }
  };
  return (
    <div className="select-none">
      <HUD score={score} left={left} total={SECONDS} />
      <div className="card-flat text-center">
        <div className="text-xs font-bold muted uppercase">Order ticket</div>
        <div className="text-4xl tracking-widest">{order.join(' ')}</div>
      </div>
      <div className="relative mx-auto my-3 w-40 h-40 rounded-full bg-amber-300 border-8 border-amber-600 flex flex-wrap items-center justify-center gap-1 text-3xl p-4" aria-label="Pizza">
        {placed.map((t) => <span key={t}>{t}</span>)}
        {msg && <div className="absolute inset-0 flex items-center justify-center text-center text-sm font-extrabold bg-white/80 rounded-full p-2">{msg}</div>}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {TOPPINGS.map((t) => (
          <button key={t} onPointerDown={() => add(t)} className={`text-3xl h-14 rounded-2xl border-2 ${placed.includes(t) ? 'bg-good/20 border-good' : 'bg-ink/5 border-ink/10'}`} aria-label={`Add ${t}`}>{t}</button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ Parking Panic: park in a free spot
export function ParkingPanic({ seed, onEnd }: GameProps) {
  const rng = useMemo(() => makeRng(seed), [seed]);
  const SECONDS = 40;
  const SPOTS = 6;
  const end = useOnce(onEnd);
  const scoreRef = useRef(0);
  const [score, setScore] = useState(0);
  const makeLot = () => {
    const lot = Array.from({ length: SPOTS }, () => rng.next() < 0.55);
    if (lot.every(Boolean)) lot[rng.int(SPOTS)] = false;
    return lot;
  };
  const [lot, setLot] = useState<boolean[]>(makeLot);
  const [carX, setCarX] = useState(0); // 0..100 (% of the lot width)
  const [msg, setMsg] = useState<string | null>(null);
  const pos = useRef(0);
  const speed = useRef(28);
  const raf = useRef(0);
  const paused = useRef(false);
  const left = useCountdown(SECONDS, () => end(scoreRef.current));
  useEffect(() => {
    let last = performance.now();
    const loop = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      if (!paused.current) {
        pos.current += speed.current * dt;
        if (pos.current > 100) pos.current = 0;
        setCarX(pos.current);
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, []);
  const park = () => {
    if (paused.current || left <= 0) return;
    const spotW = 100 / SPOTS;
    const idx = Math.floor(pos.current / spotW);
    const centre = idx * spotW + spotW / 2;
    const ok = idx < SPOTS && !lot[idx] && Math.abs(pos.current - centre) < spotW * 0.3;
    paused.current = true;
    if (ok) {
      scoreRef.current += 1;
      setScore(scoreRef.current);
      sfx.coin();
      setMsg('🅿️ Perfect park!');
      setLot((l) => l.map((x, i) => (i === idx ? true : x)));
    } else {
      sfx.error();
      setMsg(idx < SPOTS && lot[idx] ? '💥 Crunch! That spot was taken.' : '😬 Crooked! Try again.');
    }
    setTimeout(() => {
      setMsg(null);
      setLot(makeLot());
      pos.current = 0;
      speed.current = Math.min(70, speed.current + 3);
      paused.current = false;
    }, 800);
  };
  return (
    <div className="select-none" onPointerDown={park}>
      <HUD score={score} left={left} total={SECONDS} extra={<span className="text-xs muted">Tap when the car is over a free spot</span>} />
      <div className="relative h-36 bg-slate-600 rounded-2xl overflow-hidden" aria-label="Parking lot">
        <div className="absolute bottom-0 left-0 right-0 h-20 flex">
          {lot.map((taken, i) => (
            <div key={i} className="flex-1 border-x-2 border-white/80 flex items-end justify-center text-3xl pb-1">{taken ? '🚙' : <span className="text-white/70 text-sm font-bold mb-2">P</span>}</div>
          ))}
        </div>
        <div className="absolute top-2 text-4xl transition-none" style={{ left: `calc(${carX}% - 20px)` }}>🚗</div>
        {msg && <div className="absolute inset-0 flex items-center justify-center text-white text-lg font-extrabold bg-black/40">{msg}</div>}
      </div>
      <button className="btn-primary w-full mt-3 text-lg">🅿️ Park!</button>
    </div>
  );
}

// ------------------------------------------------------------ Cable Untangle: plug each cable into its port
const COLORS = [
  { name: 'red', c: 'bg-red-500' },
  { name: 'blue', c: 'bg-blue-500' },
  { name: 'green', c: 'bg-green-500' },
  { name: 'yellow', c: 'bg-yellow-400' },
  { name: 'purple', c: 'bg-purple-500' },
];

export function CableUntangle({ seed, onEnd }: GameProps) {
  const rng = useMemo(() => makeRng(seed), [seed]);
  const SECONDS = 40;
  const end = useOnce(onEnd);
  const scoreRef = useRef(0);
  const [score, setScore] = useState(0);
  const [ports, setPorts] = useState(() => rng.shuffle([0, 1, 2, 3, 4]));
  const [plugs, setPlugs] = useState(() => rng.shuffle([0, 1, 2, 3, 4]));
  const [picked, setPicked] = useState<number | null>(null);
  const [linked, setLinked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const left = useCountdown(SECONDS, () => end(scoreRef.current));
  const pickPort = (colorIdx: number) => {
    if (picked === null || busy || linked.has(colorIdx)) return;
    if (colorIdx !== picked) {
      sfx.error();
      setPicked(null);
      return;
    }
    sfx.pop();
    const l = new Set(linked);
    l.add(colorIdx);
    setLinked(l);
    setPicked(null);
    scoreRef.current += 1;
    setScore(scoreRef.current);
    if (l.size === COLORS.length) {
      sfx.coin();
      setBusy(true);
      setTimeout(() => {
        setLinked(new Set());
        setPorts(rng.shuffle([0, 1, 2, 3, 4]));
        setPlugs(rng.shuffle([0, 1, 2, 3, 4]));
        setBusy(false);
      }, 700);
    }
  };
  return (
    <div className="select-none">
      <HUD score={score} left={left} total={SECONDS} extra={<span className="text-xs muted">Tap a plug, then its port</span>} />
      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
        <div className="flex flex-col gap-2">
          {plugs.map((k) => (
            <button key={k} onPointerDown={() => !linked.has(k) && !busy && setPicked(k)} className={`h-11 rounded-xl ${COLORS[k].c} border-4 ${picked === k ? 'border-ink scale-105' : 'border-transparent'} ${linked.has(k) ? 'opacity-30' : ''} font-bold text-white`} aria-label={`${COLORS[k].name} plug`}>🔌</button>
          ))}
        </div>
        <div className="text-3xl">{busy ? '✨' : '➡️'}</div>
        <div className="flex flex-col gap-2">
          {ports.map((k) => (
            <button key={k} onPointerDown={() => pickPort(k)} className={`h-11 rounded-xl border-4 ${COLORS[k].c.replace('bg-', 'border-')} ${linked.has(k) ? COLORS[k].c : 'bg-white'} font-bold`} aria-label={`${COLORS[k].name} port`}>{linked.has(k) ? '✅' : '⚪'}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ Quiz Show: graded on the server
export function QuizShow({ questions = [], onEnd }: GameProps) {
  const end = useOnce(onEnd);
  const PER_Q = 12;
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const answer = (k: number) => {
    if (chosen !== null) return;
    setChosen(k);
    sfx.click();
    const next = [...answers, k];
    setTimeout(() => {
      setAnswers(next);
      setChosen(null);
      if (i + 1 >= questions.length) end(0, next);
      else setI(i + 1);
    }, 450);
  };
  const left = useCountdownKeyed(PER_Q, i, () => answer(-1));
  const q = questions[i];
  if (!q) return null;
  return (
    <div className="select-none flex flex-col gap-3">
      <HUD score={i + 1} left={left} total={PER_Q} label={`Question ${i + 1}/${questions.length}`} />
      <div className="card text-center text-lg font-bold">🎤 {q.q}</div>
      <div className="grid sm:grid-cols-2 gap-2">
        {q.options.map((o, k) => (
          <button key={k} onClick={() => answer(k)} className={`btn-ghost text-left justify-start min-h-[52px] ${chosen === k ? '!bg-accent !text-white' : ''}`}>
            <b className="mr-2">{'ABCD'[k]}</b> {o}
          </button>
        ))}
      </div>
      <p className="text-xs muted text-center">Boss Byte reveals the answers at the end. No peeking!</p>
    </div>
  );
}

/** Per-question countdown that restarts when `key` changes. */
function useCountdownKeyed(seconds: number, key: number, onZero: () => void) {
  const [left, setLeft] = useState(seconds);
  const cb = useRef(onZero);
  cb.current = onZero;
  useEffect(() => {
    const start = Date.now();
    setLeft(seconds);
    let fired = false;
    const t = setInterval(() => {
      const l = Math.max(0, seconds - (Date.now() - start) / 1000);
      setLeft(l);
      if (l <= 0 && !fired) {
        fired = true;
        clearInterval(t);
        cb.current();
      }
    }, 100);
    return () => clearInterval(t);
  }, [key, seconds]);
  return left;
}
