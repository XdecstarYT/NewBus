import { useEffect, useMemo, useRef, useState } from 'react';
import { sfx } from '../../../lib/sound';
import { HUD, makeRng, useCountdown, useOnce, type GameProps } from './kit';

// ------------------------------------------------------------ Meme Maker: match the meme pairs
const MEMES = ['🐸', '🐶', '🐱', '🦆', '🍕', '🚀', '🤖', '🦄', '🐙', '🌮', '👾', '🍩'];

export function MemeMaker({ seed, onEnd }: GameProps) {
  const rng = useMemo(() => makeRng(seed), [seed]);
  const SECONDS = 60;
  const PAIRS = 6;
  const end = useOnce(onEnd);
  const [cards] = useState(() => rng.shuffle(rng.shuffle(MEMES).slice(0, PAIRS).flatMap((m) => [m, m])));
  const [open, setOpen] = useState<number[]>([]);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [score, setScore] = useState(0);
  const finish = (s: number, l: number) => end(s + Math.min(4, Math.floor(l / 10)));
  const left = useCountdown(SECONDS, () => end(score));
  const flip = (i: number) => {
    if (open.length === 2 || open.includes(i) || done.has(i) || left <= 0) return;
    sfx.click();
    const now = [...open, i];
    setOpen(now);
    if (now.length === 2) {
      setTimeout(() => {
        if (cards[now[0]] === cards[now[1]]) {
          const d = new Set(done);
          d.add(now[0]);
          d.add(now[1]);
          setDone(d);
          const s = score + 2;
          setScore(s);
          sfx.coin();
          if (d.size === cards.length) finish(s, left);
        } else sfx.error();
        setOpen([]);
      }, 550);
    }
  };
  return (
    <div className="select-none">
      <HUD score={score} left={left} total={SECONDS} label="Pairs" extra={<span className="text-xs muted">Finish fast for a time bonus!</span>} />
      <div className="grid grid-cols-4 gap-2">
        {cards.map((m, i) => {
          const shown = open.includes(i) || done.has(i);
          return (
            <button key={i} onClick={() => flip(i)} className={`aspect-square rounded-2xl border-2 text-4xl flex items-center justify-center transition-all ${shown ? 'bg-white border-ink' : 'bg-accent border-accent'} ${done.has(i) ? 'opacity-60' : ''}`} aria-label={shown ? m : 'Hidden card'}>
              {shown ? m : '❔'}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ Invoice Match: repeat the invoice order (memory)
const INVOICES = [
  { c: 'bg-red-400', label: '🧾 A' },
  { c: 'bg-blue-400', label: '🧾 B' },
  { c: 'bg-green-400', label: '🧾 C' },
  { c: 'bg-yellow-300', label: '🧾 D' },
];

export function InvoiceMatch({ seed, onEnd }: GameProps) {
  const rng = useMemo(() => makeRng(seed), [seed]);
  const end = useOnce(onEnd);
  const [seq, setSeq] = useState<number[]>(() => [rng.int(4)]);
  const [showing, setShowing] = useState(true);
  const [lit, setLit] = useState<number | null>(null);
  const [pos, setPos] = useState(0);
  const [score, setScore] = useState(0);
  const [msg, setMsg] = useState('Watch the order...');
  const left = useCountdown(120, () => end(score));
  useEffect(() => {
    setShowing(true);
    setMsg('Watch the order...');
    let i = 0;
    const t = setInterval(() => {
      if (i >= seq.length) {
        clearInterval(t);
        setLit(null);
        setShowing(false);
        setMsg('Your turn!');
        return;
      }
      setLit(seq[i]);
      sfx.click();
      setTimeout(() => setLit(null), 380);
      i++;
    }, 650);
    return () => clearInterval(t);
  }, [seq]);
  const press = (k: number) => {
    if (showing) return;
    setLit(k);
    setTimeout(() => setLit(null), 150);
    if (seq[pos] !== k) {
      sfx.error();
      setMsg('❌ Wrong invoice! Filing cabinet closed.');
      setShowing(true);
      setTimeout(() => end(score), 900);
      return;
    }
    sfx.pop();
    if (pos + 1 === seq.length) {
      const s = score + seq.length;
      setScore(s);
      setPos(0);
      setMsg(`✅ Round ${seq.length} done!`);
      setShowing(true);
      setTimeout(() => setSeq([...seq, rng.int(4)]), 800);
    } else setPos(pos + 1);
  };
  return (
    <div className="select-none">
      <HUD score={score} left={left} total={120} extra={<span className="text-xs muted">Round {seq.length}</span>} />
      <p className="text-center font-bold h-6">{msg}</p>
      <div className="grid grid-cols-2 gap-3 mt-2">
        {INVOICES.map((v, k) => (
          <button key={k} onPointerDown={() => press(k)} className={`${v.c} h-24 rounded-2xl border-4 text-2xl font-extrabold transition-all ${lit === k ? 'border-ink scale-105 brightness-125' : 'border-transparent opacity-80'}`} aria-label={`Invoice ${v.label}`}>
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ Stock Sprint: up or down?
export function StockSprint({ seed, onEnd }: GameProps) {
  const rng = useMemo(() => makeRng(seed), [seed]);
  const ROUNDS = 15;
  const end = useOnce(onEnd);
  const [points, setPoints] = useState<number[]>(() => {
    let p = 50;
    return Array.from({ length: 12 }, () => (p = Math.max(10, Math.min(90, p + (rng.next() - 0.5) * 14))));
  });
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const guess = (up: boolean) => {
    if (busy) return;
    setBusy(true);
    const last = points[points.length - 1];
    // a little momentum makes trends readable without being certain
    const trend = last - points[points.length - 4];
    const move = (rng.next() - 0.5 + Math.sign(trend) * 0.12) * 18;
    const nxt = Math.max(5, Math.min(95, last + (Math.abs(move) < 1 ? (rng.next() < 0.5 ? -2 : 2) : move)));
    const right = up === nxt > last;
    setPoints([...points.slice(-14), nxt]);
    const s = score + (right ? 1 : 0);
    setScore(s);
    setMsg(right ? '📈 Nailed it!' : '📉 Nope!');
    (right ? sfx.coin : sfx.error)();
    setTimeout(() => {
      setMsg(null);
      setBusy(false);
      if (round + 1 >= ROUNDS) end(s);
      else setRound(round + 1);
    }, 1100);
  };
  const w = 300;
  const h = 140;
  const path = points.map((p, i) => `${(i / (points.length - 1)) * w},${h - (p / 100) * h}`).join(' ');
  return (
    <div className="select-none flex flex-col gap-2">
      <div className="flex font-bold"><span>Score: {score}</span><span className="ml-auto">Round {Math.min(round + 1, ROUNDS)}/{ROUNDS}</span></div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-40 bg-ink/5 rounded-2xl" aria-label="Fictional stock chart">
        <polyline points={path} fill="none" stroke="currentColor" strokeWidth="3" className="text-accent" />
        <circle cx={w} cy={h - (points[points.length - 1] / 100) * h} r="5" className="fill-accent" />
      </svg>
      <div className="h-6 text-center font-bold">{msg}</div>
      <div className="grid grid-cols-2 gap-3">
        <button className="btn-good text-xl py-4" disabled={busy} onPointerDown={() => guess(true)}>⬆️ Up</button>
        <button className="btn-bad text-xl py-4" disabled={busy} onPointerDown={() => guess(false)}>⬇️ Down</button>
      </div>
      <p className="text-xs muted text-center">$WHIM is a totally made-up stock. Trust your gut!</p>
    </div>
  );
}

// ------------------------------------------------------------ Box Stack: drop the sliding box on the tower
export function BoxStack({ onEnd }: GameProps) {
  const end = useOnce(onEnd);
  const W = 300;
  const BOX_H = 22;
  const [stack, setStack] = useState<Array<{ x: number; w: number }>>([{ x: 75, w: 150 }]);
  const [x, setX] = useState(0);
  const [over, setOver] = useState(false);
  const dir = useRef(1);
  const pos = useRef(0);
  const ready = useRef(Date.now() + 600);
  const raf = useRef(0);
  const top = stack[stack.length - 1];
  const SECONDS = 60;
  const left = useCountdown(SECONDS, () => {
    setOver(true);
    end(stack.length - 1);
  });
  useEffect(() => {
    if (over) return;
    let last = performance.now();
    const speed = 140 + stack.length * 12;
    const loop = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      pos.current += dir.current * speed * dt;
      if (pos.current < 0) [pos.current, dir.current] = [0, 1];
      if (pos.current > W - top.w) [pos.current, dir.current] = [W - top.w, -1];
      setX(pos.current);
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [stack.length, over, top.w]);
  const drop = () => {
    if (over || Date.now() < ready.current) return;
    const l = Math.max(pos.current, top.x);
    const r = Math.min(pos.current + top.w, top.x + top.w);
    const w = r - l;
    if (w <= 4) {
      sfx.error();
      setOver(true);
      setTimeout(() => end(stack.length - 1), 700);
      return;
    }
    (Math.abs(w - top.w) < 3 ? sfx.coin : sfx.pop)();
    const next = [...stack, { x: l, w: Math.abs(w - top.w) < 3 ? top.w : w }];
    setStack(next);
    pos.current = 0;
    dir.current = 1;
    ready.current = Date.now() + 550;
    if (next.length - 1 >= 40) {
      setOver(true);
      setTimeout(() => end(40), 500);
    }
  };
  const visible = stack.slice(-9);
  const shift = stack.length - visible.length;
  return (
    <div className="select-none flex flex-col items-center gap-2">
      <div className="w-full"><HUD score={stack.length - 1} left={left} total={SECONDS} label="Boxes" /></div>
      <div className="relative bg-sky-100 rounded-2xl overflow-hidden" style={{ width: W, height: BOX_H * 11 }} aria-label="Box tower" onPointerDown={drop}>
        {visible.map((b, i) => (
          <div key={i + shift} className="absolute bg-amber-600 border-2 border-amber-900 rounded-md text-center text-xs" style={{ left: b.x, width: b.w, height: BOX_H, bottom: i * BOX_H }}>📦</div>
        ))}
        {!over && <div className="absolute bg-amber-400 border-2 border-amber-900 rounded-md text-center text-xs" style={{ left: x, width: top.w, height: BOX_H, bottom: visible.length * BOX_H + 8 }}>📦</div>}
        {over && <div className="absolute inset-0 flex items-center justify-center text-2xl font-extrabold">📦💥 Timber!</div>}
      </div>
      <button className="btn-primary w-full text-lg" onPointerDown={drop} disabled={over}>📦 Drop!</button>
    </div>
  );
}
