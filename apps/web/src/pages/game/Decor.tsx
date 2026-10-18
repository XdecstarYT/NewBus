import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router';
import { formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { useStore } from '../../lib/store';
import { sfx } from '../../lib/sound';
import { LoadingJoke, Modal, Tabs } from '../../components/ui';
import { useBase, useGameMe } from './GameLayout';

/** Equipped decor + pets shown on the office floor, plus the daily wheel. */
export function DecorStrip() {
  const base = useBase();
  const q = useApi<any>(['shop'], '/game/shop');
  const equipped = (q.data?.owned ?? []).filter((o: any) => o.equipped && o.def);
  return (
    <div className="card !p-3 flex items-center gap-2 flex-wrap">
      <span className="text-sm font-bold mr-1">🏠 Your office vibes:</span>
      {equipped.length === 0 ? (
        <span className="text-sm muted">Bare walls. Sad. <Link to={`${base}/shop`} className="underline">Visit the shop</Link>.</span>
      ) : (
        equipped.map((o: any, i: number) => (
          <motion.span key={o.id} className="text-2xl" title={`${o.def.name}: ${o.def.description}`} animate={{ y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: 2 + (i % 3), delay: i * 0.2 }}>
            {o.def.emoji}
          </motion.span>
        ))
      )}
      <StreakWheelButton />
    </div>
  );
}

function StreakWheelButton() {
  const me = useGameMe();
  const q = useApi<any>(['streak'], '/game/streak');
  const [open, setOpen] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [angle, setAngle] = useState(0);
  const [result, setResult] = useState<any>(null);
  const confetti = useStore((s) => s.confetti);
  const say = useStore((s) => s.say);
  const spin = useAction(() => POST('/game/streak/spin'), {
    invalidate: [['streak'], ['state'], ['office']],
    onSuccess: (r) => {
      const segs = q.data.wheel.length;
      const per = 360 / segs;
      setSpinning(true);
      sfx.drumroll(2.4);
      // land the pointer (top) in the middle of the winning segment
      const target = 360 * 6 + (360 - (r.index * per + per / 2));
      setAngle(target);
      setTimeout(() => {
        setSpinning(false);
        setResult(r);
        sfx.bigCoin();
        confetti();
        say(`Day ${r.streak} streak! You won: ${r.label}`, 'wow');
      }, 2600);
    },
  });
  if (!q.data) return null;
  const segs = q.data.wheel;
  const colors = ['#f472b6', '#facc15', '#4ade80', '#38bdf8', '#a78bfa', '#fb923c', '#f87171', '#2dd4bf'];
  const per = 360 / segs.length;
  return (
    <>
      <button className={`ml-auto btn-sm ${q.data.canClaim ? 'btn-pink animate-wiggle' : 'btn-ghost'}`} onClick={() => setOpen(true)} data-testid="streak-button">
        🎡 {q.data.canClaim ? 'Daily spin!' : `Streak ${q.data.streak}🔥`}
      </button>
      <Modal open={open} onClose={() => !spinning && setOpen(false)} title={`🎡 Daily Lucky Wheel · streak ${q.data.streak}🔥`}>
        <div className="flex flex-col items-center gap-3">
          <div className="relative w-64 h-64">
            <div className="absolute left-1/2 -translate-x-1/2 -top-1 z-10 text-3xl" aria-hidden>🔻</div>
            <motion.svg viewBox="-110 -110 220 220" className="w-full h-full" animate={{ rotate: angle }} transition={{ duration: 2.5, ease: [0.2, 0.8, 0.2, 1] }}>
              {segs.map((s: any, i: number) => {
                const a0 = ((i * per - 90) * Math.PI) / 180;
                const a1 = (((i + 1) * per - 90) * Math.PI) / 180;
                const am = (((i + 0.5) * per - 90) * Math.PI) / 180;
                return (
                  <g key={i}>
                    <path d={`M0 0 L${100 * Math.cos(a0)} ${100 * Math.sin(a0)} A100 100 0 0 1 ${100 * Math.cos(a1)} ${100 * Math.sin(a1)} Z`} fill={colors[i % colors.length]} stroke="#1e1b4b" strokeWidth="3" />
                    <text x={62 * Math.cos(am)} y={62 * Math.sin(am)} fontSize="9" fontWeight="800" textAnchor="middle" dominantBaseline="middle" fill="#1e1b4b" transform={`rotate(${(i + 0.5) * per} ${62 * Math.cos(am)} ${62 * Math.sin(am)})`}>
                      {s.label}
                    </text>
                  </g>
                );
              })}
              <circle r="14" fill="#7c3aed" stroke="#1e1b4b" strokeWidth="4" />
            </motion.svg>
          </div>
          <p className="text-xs muted text-center">Odds: {segs.map((s: any) => `${s.label} ${Math.round(s.chance * 100)}%`).join(' · ')}. Streak bonus: +{q.data.bonusPct}% on Bits prizes.</p>
          {result ? (
            <div className="font-display font-extrabold text-xl">🎉 {result.label}{result.bits ? ` (+${formatBits(result.bits)})` : ''}</div>
          ) : (
            <button className="btn-pink w-full text-lg" disabled={!q.data.canClaim || spinning || me.access.readOnly} onClick={() => spin.mutate(undefined)}>
              {q.data.canClaim ? 'SPIN!' : 'Come back tomorrow 🌙'}
            </button>
          )}
        </div>
      </Modal>
    </>
  );
}

export function Shop() {
  const me = useGameMe();
  const ro = me.access.readOnly;
  const q = useApi<any>(['shop'], '/game/shop');
  const [tab, setTab] = useState<'decor' | 'pet' | 'cosmetic' | 'owned'>('decor');
  const setPrefs = useStore((s) => s.setPrefs);
  const buy = useAction((key: string) => POST('/game/shop/buy', { key }), {
    invalidate: [['shop'], ['state'], ['office']],
    onSuccess: (r) => {
      sfx.coin();
      useStore.getState().say(`${r.item.emoji} ${r.item.name} delivered! ${r.item.description}`);
      const theme = r.item.key.match(/^wallpaper-(candy|ocean|retro|forest)$/)?.[1];
      if (theme) setPrefs({ theme: theme as any });
    },
  });
  const equip = useAction((v: { itemId: string; on: boolean }) => POST('/game/shop/equip', v), { invalidate: [['shop'], ['office']] });
  if (q.isLoading || !q.data) return <LoadingJoke />;
  const d = q.data;
  const items = tab === 'owned' ? [] : d.items.filter((i: any) => i.kind === tab);
  return (
    <div className="flex flex-col gap-3">
      <h1 className="h1">🪴 Decor & Pets</h1>
      <div className="card !p-3 text-sm flex flex-wrap gap-3">
        <span>😊 Mood +{d.perks.mood}</span>
        <span>💰 Income +{Math.round(d.perks.income * 100)}%</span>
        <span>🚶 Traffic +{Math.round(d.perks.traffic * 100)}%</span>
        <span>🔬 Research +{Math.round(d.perks.research * 100)}%</span>
        <span className="muted">Slots: {d.maxEquipped} decor · {d.maxPets} pets</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {d.sets.map((s: any) => (
          <span key={s.id} className={`chip ${s.complete ? '!bg-good/30' : ''}`} title="Equip every item in a set for a bonus">
            {s.emoji} {s.name} {s.have}/{s.total} {s.complete ? '✅' : ''}
          </span>
        ))}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'decor', label: '🖼️ Decor' }, { id: 'pet', label: '🐾 Pets' }, { id: 'cosmetic', label: '🎨 Cosmetics' }, { id: 'owned', label: `📦 Owned (${d.owned.length})` }]} />
      {tab === 'owned' ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {d.owned.map((o: any) => (
            <div key={o.id} className="card !p-3 text-center">
              <div className="text-4xl">{o.def?.emoji}</div>
              <div className="font-bold text-sm">{o.def?.name}</div>
              {o.kind !== 'cosmetic' && !ro && (
                <button className={`btn-sm mt-2 ${o.equipped ? 'btn-good' : 'btn-ghost'}`} onClick={() => equip.mutate({ itemId: o.id, on: !o.equipped })}>
                  {o.equipped ? '✅ Placed' : 'Place'}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map((i: any) => (
            <div key={i.key} className={`card !p-3 flex flex-col items-center text-center gap-1 ${!i.unlocked ? 'opacity-50' : ''}`}>
              <motion.div className="text-5xl" whileHover={{ scale: 1.2, rotate: 8 }}>{i.emoji}</motion.div>
              <div className="font-bold">{i.name}</div>
              <div className="text-xs muted">{i.description}</div>
              <div className="text-xs">{Object.entries(i.perk).map(([k, v]: any) => `${k} +${k === 'mood' || k === 'quality' ? v : `${Math.round(v * 100)}%`}`).join(' · ') || 'cosmetic'}</div>
              {i.owned > 0 && <span className="chip">owned x{i.owned}</span>}
              {!ro && (
                <button className="btn-primary btn-sm w-full mt-auto" disabled={!i.unlocked || buy.isPending || (i.kind === 'cosmetic' && i.owned > 0)} onClick={() => buy.mutate(i.key)}>
                  {i.unlocked ? formatBits(i.cost) : `🔒 Lv ${i.minLevel}`}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Prestige() {
  const me = useGameMe();
  const q = useApi<any>(['prestige'], '/game/prestige');
  const confetti = useStore((s) => s.confetti);
  const say = useStore((s) => s.say);
  const go = useAction(() => POST('/game/prestige'), {
    invalidate: [['prestige'], ['office'], ['state'], ['workforce']],
    onSuccess: (r) => {
      sfx.levelUp();
      confetti();
      setTimeout(confetti, 600);
      say(`🔔 DING DING! You went public! +${r.pointsGained} prestige points. Everything is ${Math.round(r.newMult * 100 - 100)}% better forever.`, 'wow');
    },
  });
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4">
      <h1 className="h1">🚀 IPO Prestige ("Go Public")</h1>
      <div className="card">
        <p>Ring the big bell, start fresh, and keep a <b>permanent income multiplier</b> plus a shiny trophy. You keep bank pots, decor, research, achievements and your stock listing. You lose: Bits in your main wallet above the starter amount, workers, workplaces and company level.</p>
        <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
          <div className="card-flat">This run earned<br /><b className="text-lg">{formatBits(d.runEarned)}</b></div>
          <div className="card-flat">Needed<br /><b className="text-lg">{formatBits(d.minRunEarned)}</b></div>
          <div className="card-flat">Points you'd gain<br /><b className="text-lg">+{d.pointsGained}</b></div>
          <div className="card-flat">Multiplier<br /><b className="text-lg">x{d.currentMult.toFixed(2)} → x{d.newMult.toFixed(2)}</b></div>
        </div>
        <button className="btn-pink w-full mt-4 text-lg" disabled={!d.eligible || me.access.readOnly || go.isPending} onClick={() => window.confirm('Go public and reset this run? There is no undo!') && go.mutate(undefined)}>
          {d.eligible ? '🔔 Ring the bell!' : `Earn ${formatBits(d.minRunEarned - d.runEarned)} more first`}
        </button>
      </div>
      <div className="card">
        <h2 className="h3 mb-2">🏆 Trophy cabinet ({d.count} IPOs)</h2>
        {d.trophies.length ? d.trophies.map((t: string, i: number) => <div key={i} className="chip mr-1 mb-1">{t}</div>) : <p className="muted text-sm">Empty. For now.</p>}
      </div>
    </div>
  );
}
