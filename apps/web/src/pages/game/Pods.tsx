import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RARITY_INFO, formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { useStore } from '../../lib/store';
import { sfx } from '../../lib/sound';
import { WorkerAvatar } from '../../components/WorkerAvatar';
import { LoadingJoke, ProgressBar, Modal } from '../../components/ui';
import { BossByteFace } from '../../components/BossByte';
import { useGameMe } from './GameLayout';

const REACTIONS: Record<string, string[]> = {
  COMMON: ['A solid hire! Every empire needs reliable blobs.', 'Common, but with uncommon enthusiasm.', 'They brought their own mug. Promising.'],
  RARE: ['Ooh, a Rare one! They know keyboard shortcuts.', 'Rare find! They can fold a fitted sheet.', 'Fancy! This one reads the manual.'],
  EPIC: ['EPIC! This worker has a podcast. And it is GOOD.', 'Epic hire! Productivity just did a backflip.', 'Whoa. An Epic! Act cool.'],
  LEGENDARY: ['LEGENDARY!!! Boss Byte is crying happy oil tears!', 'A LEGEND walks among us! Clear the corner office!', 'LEGENDARY! The other companies are going to be SO jealous.'],
  CURSED: ['Oh no... a Cursed Intern. They microwaved fish. Twice.', 'Cursed! They might do nothing. Or EVERYTHING. Nobody knows.', 'This intern came with their own ominous fog.'],
};

export function Pods() {
  const me = useGameMe();
  const ro = me.access.readOnly;
  const q = useApi<any>(['pods'], '/game/pods');
  const [phase, setPhase] = useState<'idle' | 'shaking' | 'reveal'>('idle');
  const [result, setResult] = useState<any>(null);
  const [oddsOpen, setOddsOpen] = useState<any>(null);
  const confetti = useStore((s) => s.confetti);
  const say = useStore((s) => s.say);
  const shake = useStore((s) => s.shake);
  const setBalance = useStore((s) => s.setBalance);
  const open = useAction((type: string) => POST('/game/pods/open', { type }), {
    invalidate: [['pods'], ['office'], ['workforce'], ['state']],
    onSuccess: (r) => {
      setResult(r);
      setPhase('shaking');
      sfx.drumroll(1.3);
      setTimeout(() => {
        setPhase('reveal');
        sfx.reveal(r.rarity);
        if (r.rarity === 'LEGENDARY' || r.rarity === 'EPIC') {
          confetti();
          shake();
        }
        const lines = REACTIONS[r.rarity];
        say(lines[Math.floor(Math.random() * lines.length)], r.rarity === 'CURSED' ? 'sad' : 'wow');
      }, 1400);
    },
  });
  if (q.isLoading || !q.data) return <LoadingJoke />;
  const d = q.data;
  const color = result ? RARITY_INFO[result.rarity as keyof typeof RARITY_INFO] : null;
  void setBalance;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <BossByteFace mood="wow" size={56} />
        <div>
          <h1 className="h1">🥚 Recruit Pods</h1>
          <p className="muted text-sm">Bits only, odds always shown. Pity timer guarantees an Epic every {d.pity.epicAt} pulls and a Legendary every {d.pity.legendaryAt}.</p>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <ProgressBar value={d.pity.epic} max={d.pity.epicAt - 1} label={`💜 Epic pity (${d.pity.epic}/${d.pity.epicAt - 1})`} color="bg-[#a855f7]" />
        <ProgressBar value={d.pity.legendary} max={d.pity.legendaryAt - 1} label={`🧡 Legendary pity (${d.pity.legendary}/${d.pity.legendaryAt - 1})`} color="bg-[#f59e0b]" />
      </div>
      <div className="grid sm:grid-cols-3 gap-4">
        {d.pods.map((p: any) => (
          <div key={p.id} className={`card flex flex-col items-center text-center gap-2 ${!p.unlocked ? 'opacity-60' : ''}`}>
            <motion.div className="text-7xl" animate={{ rotate: [0, -6, 6, 0] }} transition={{ repeat: Infinity, duration: 2.5, delay: Math.random() }}>
              {p.emoji}
            </motion.div>
            <div className="h2">{p.name}</div>
            <div className="font-display font-extrabold text-xl">{formatBits(p.cost)}</div>
            <button className="text-xs underline" onClick={() => setOddsOpen(p)}>📊 See odds</button>
            <div className="flex flex-wrap gap-1 justify-center">
              {Object.entries(p.odds).map(([r, v]) => (
                <span key={r} className="chip" style={{ background: RARITY_INFO[r as keyof typeof RARITY_INFO].color, color: '#fff' }}>
                  {RARITY_INFO[r as keyof typeof RARITY_INFO].label} {Math.round((v as number) * 1000) / 10}%
                </span>
              ))}
            </div>
            {p.unlocked ? (
              <button className="btn-pink w-full text-lg" disabled={ro || open.isPending || phase === 'shaking'} onClick={() => open.mutate(p.id)} data-testid={`open-pod-${p.id}`}>
                Open!
              </button>
            ) : (
              <div className="chip">🔒 Company level {p.minLevel}</div>
            )}
          </div>
        ))}
      </div>

      <AnimatePresence>
        {phase !== 'idle' && result && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {phase === 'shaking' ? (
              <motion.div className="text-[9rem]" animate={{ rotate: [0, -15, 15, -20, 20, -25, 25, 0], scale: [1, 1.05, 1.1, 1.15, 1.2] }} transition={{ duration: 1.3 }}>
                🥚
              </motion.div>
            ) : (
              <motion.div initial={{ scale: 0.2, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 12 }} className="card max-w-sm w-full text-center relative overflow-hidden" data-testid="pod-reveal">
                <div className="absolute inset-0 opacity-40" style={{ background: `radial-gradient(circle, ${color!.glow} 0%, transparent 70%)` }} aria-hidden />
                <motion.div className="absolute inset-0" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 8, ease: 'linear' }} style={{ background: `conic-gradient(from 0deg, transparent, ${color!.glow}55, transparent 30%)` }} aria-hidden />
                <div className="relative">
                  <div className="font-display font-extrabold text-2xl tracking-widest" style={{ color: color!.color }}>
                    {color!.label.toUpperCase()}!{result.pityHit ? ' (pity!)' : ''}
                  </div>
                  <div className="flex justify-center my-3">
                    <WorkerAvatar species={result.worker.species} color={result.worker.appearance.color} eyes={result.worker.appearance.eyes} accessory={result.worker.appearance.accessory} mood={90} state="happy" rarity={result.rarity} size={140} />
                  </div>
                  <div className="h2">{result.worker.name}</div>
                  <div className="text-sm font-bold">{result.worker.archetypeEmoji} {result.worker.archetypeName} · {result.worker.role}</div>
                  <div className="text-sm italic muted my-1">{result.worker.archetypeBio}</div>
                  <div className="card-flat text-sm my-2">{result.worker.quirkEmoji} <b>{result.worker.quirkName}</b>: {result.worker.quirkDescription}</div>
                  <button
                    className="btn-primary w-full"
                    onClick={() => {
                      setPhase('idle');
                      setResult(null);
                    }}
                  >
                    Welcome aboard! 👋
                  </button>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <Modal open={!!oddsOpen} onClose={() => setOddsOpen(null)} title={`📊 ${oddsOpen?.name} odds`}>
        {oddsOpen && (
          <table className="table-clean">
            <tbody>
              {Object.entries(oddsOpen.odds).map(([r, v]) => (
                <tr key={r}>
                  <td>{RARITY_INFO[r as keyof typeof RARITY_INFO].label}</td>
                  <td className="text-right font-bold">{Math.round((v as number) * 10000) / 100}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs muted mt-2">Pity timers count every pod type. Bits only - no real money, ever.</p>
      </Modal>
    </div>
  );
}
