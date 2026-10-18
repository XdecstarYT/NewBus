import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { POST } from '../../lib/api';
import { BossByteFace } from '../../components/BossByte';
import { useGameMe } from './GameLayout';
import { t } from '../../i18n';

interface Step {
  title: string;
  body: string;
  needs?: string;
}

const STEPS: Step[] = [
  { title: "Hi! I'm Boss Byte!", body: "I'm your mascot, manager, and occasional motivational speaker. Let me show you around the office. It'll take 30 seconds. Probably." },
  { title: 'Your office', body: 'Workers sit at desks and earn Bits every tick. Drag workers onto desks (or tap a worker then a desk). Match their role to the workplace focus for a ✨ SYNERGY COMBO.', needs: 'office' },
  { title: 'Tap to boost!', body: 'Tap a workplace header to boost it. Keep tapping for combos. Your finger is now a business asset.', needs: 'office' },
  { title: 'Recruit Pods', body: 'Spend Bits on Recruit Pods to hire new workers. Odds are always shown and a pity timer guarantees good pulls. Watch out for Cursed Interns!', needs: 'pods' },
  { title: 'Contracts', body: 'Sign contracts from quirky clients. Earn enough Bits before time runs out for a big reward.', needs: 'contracts' },
  { title: 'Mini-games', body: 'Play silly mini-games for extra Bits (with daily caps, so go touch grass afterwards).', needs: 'minigames' },
  { title: 'Products & customers', body: 'Make products, set your prices and serve picky NPC customers. Read their reviews. Cry a little. Improve.', needs: 'products' },
  { title: 'The Bit Exchange', body: 'Trade fictional stocks of real players. Buy low, sell high, nap in between.', needs: 'exchange' },
  { title: "That's it!", body: "Check 'Next goals' on the office floor whenever you're unsure what to do. Now go build an empire! (A small one is fine too.)" },
];

/** Interactive tutorial that adapts to the modules this login can use. Skippable & replayable. */
export function Tutorial() {
  const me = useGameMe();
  const qc = useQueryClient();
  const steps = useMemo(() => STEPS.filter((s) => !s.needs || me.access.modules[s.needs]), [me.access.modules]);
  const [i, setI] = useState(0);
  const [hidden, setHidden] = useState(false);
  if (me.account.tutorialDone || hidden) return null;
  const finish = async () => {
    setHidden(true);
    await POST('/auth/tutorial', { done: true }).catch(() => {});
    qc.invalidateQueries({ queryKey: ['me'] });
  };
  const s = steps[i];
  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-40 bg-ink/50 flex items-end sm:items-center justify-center p-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <motion.div key={i} initial={{ y: 40, scale: 0.9 }} animate={{ y: 0, scale: 1 }} className="card max-w-md w-full" role="dialog" aria-label="Tutorial">
          <div className="flex gap-3 items-start">
            <BossByteFace mood={i === 0 ? 'wow' : 'happy'} size={72} className="shrink-0 animate-bob" />
            <div>
              <div className="text-xs muted font-bold">Step {i + 1} of {steps.length}</div>
              <h2 className="h2">{s.title}</h2>
              <p className="mt-1">{s.body}</p>
            </div>
          </div>
          <div className="flex justify-between mt-4">
            <button className="btn-ghost btn-sm" onClick={finish}>{t('tutorial.skip')}</button>
            {i < steps.length - 1 ? (
              <button className="btn-primary" onClick={() => setI(i + 1)}>{t('tutorial.next')} →</button>
            ) : (
              <button className="btn-good" onClick={finish}>{t('tutorial.done')}</button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
