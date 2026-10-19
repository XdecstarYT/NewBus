import { motion } from 'framer-motion';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { useStore } from '../../lib/store';
import { sfx } from '../../lib/sound';
import { LoadingJoke } from '../../components/ui';
import { useGameMe } from './GameLayout';

const EFFECT_TEXT: Record<string, (v: number) => string> = {
  income: (v) => `+${Math.round(v * 100)}% income`,
  traffic: (v) => `+${Math.round(v * 100)}% customers`,
  speed: (v) => `+${Math.round(v * 100)}% production speed`,
  quality: (v) => `+${v} quality`,
  mood: (v) => `+${v} morale`,
  research: (v) => `+${Math.round(v * 100)}% research speed`,
  wages: (v) => `-${Math.round(v * 100)}% wages`,
  minigame: (v) => `+${Math.round(v * 100)}% arcade payouts`,
  offline: (v) => `+${v}h offline earnings`,
  pity: (v) => `rare pity -${v}`,
};

/** Research tree: 5 branches, RP from THINKER workers, permanent upgrades. */
export function Research() {
  const me = useGameMe();
  const confetti = useStore((s) => s.confetti);
  const q = useApi<any>(['research'], '/game/research', { refetchInterval: 15_000 });
  const buy = useAction((key: string) => POST('/game/research/buy', { key }), {
    invalidate: [['research'], ['state', me.access.companyId]],
    success: '🔬 Eureka! Research complete.',
    onSuccess: () => {
      sfx.levelUp();
      confetti();
    },
  });
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  const t = d.totals;
  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <h1 className="h1">🔬 Research Lab</h1>
          <p className="text-sm muted">Every company thinks a little. Each 🧠 THINKER at a desk thinks a lot more. Spend Research Points on permanent upgrades.</p>
        </div>
        <div className="card !py-2 ml-auto text-center">
          <div className="text-3xl font-extrabold" data-testid="rp">{d.points} RP</div>
          <div className="text-xs muted">+{d.perMinute}/min · {d.thinkers} thinker{d.thinkers === 1 ? '' : 's'} working</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 text-xs">
        {t.income > 0 && <span className="chip">💰 +{t.income}% income</span>}
        {t.traffic > 0 && <span className="chip">📣 +{t.traffic}% customers</span>}
        {t.speed > 0 && <span className="chip">⚙️ +{t.speed}% speed</span>}
        {t.quality > 0 && <span className="chip">🥽 +{t.quality} quality</span>}
        {t.mood > 0 && <span className="chip">😊 +{t.mood} morale</span>}
        {t.wages > 0 && <span className="chip">🧾 -{t.wages}% wages</span>}
        {t.minigame > 0 && <span className="chip">🕹️ +{t.minigame}% arcade</span>}
        {t.offline > 0 && <span className="chip">😴 +{t.offline}h offline</span>}
        {t.research > 0 && <span className="chip">🧠 +{t.research}% research</span>}
        {t.pity > 0 && <span className="chip">🍀 pity -{t.pity}</span>}
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-5 gap-3">
        {d.branches.map((b: any) => (
          <div key={b.id} className="card !p-3 flex flex-col gap-2" style={{ borderColor: b.color }}>
            <div className="text-center">
              <div className="text-3xl">{b.emoji}</div>
              <div className="font-extrabold" style={{ color: b.color }}>{b.name}</div>
              <div className="text-xs muted">{b.blurb}</div>
            </div>
            {b.nodes.map((n: any, i: number) => {
              const maxed = n.level >= n.maxLevel;
              const afford = n.cost != null && d.points >= n.cost;
              return (
                <motion.div key={n.key} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className={`card-flat !p-2 flex flex-col gap-1 ${!n.unlocked ? 'opacity-45' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{n.emoji}</span>
                    <b className="text-sm leading-tight flex-1">{n.name}</b>
                  </div>
                  <div className="text-[11px] muted">{n.description}</div>
                  <div className="text-[11px] font-bold">{EFFECT_TEXT[n.effect]?.(n.perLevel) ?? n.effect} per level</div>
                  <div className="flex gap-0.5" aria-label={`Level ${n.level} of ${n.maxLevel}`}>
                    {Array.from({ length: n.maxLevel }, (_, k) => <span key={k} className="h-2 flex-1 rounded-full" style={{ background: k < n.level ? b.color : 'rgb(0 0 0 / 0.1)' }} />)}
                  </div>
                  {!n.unlocked ? (
                    <div className="text-[11px]">🔒 Needs {n.requiresName}</div>
                  ) : maxed ? (
                    <div className="text-[11px] font-bold text-good">✅ Maxed</div>
                  ) : (
                    <button className={`btn-sm ${afford ? 'btn-primary' : 'btn-ghost'}`} disabled={!afford || me.access.readOnly || buy.isPending} onClick={() => buy.mutate(n.key)} data-testid={`research-${n.key}`}>
                      {n.level ? 'Upgrade' : 'Research'} · {n.cost} RP
                    </button>
                  )}
                </motion.div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
