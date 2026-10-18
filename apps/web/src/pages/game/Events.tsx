import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { onWs } from '../../lib/ws';
import { useStore } from '../../lib/store';
import { sfx } from '../../lib/sound';
import { Modal } from '../../components/ui';
import { BossByteFace } from '../../components/BossByte';
import { useGameMe } from './GameLayout';

/** Pops up whenever a random office event is waiting for a decision. */
export function EventPopup() {
  const me = useGameMe();
  const q = useApi<any>(['events'], '/game/events');
  const qc = useQueryClient();
  const say = useStore((s) => s.say);
  const [outcome, setOutcome] = useState<any>(null);
  useEffect(
    () =>
      onWs('event', () => {
        sfx.whoosh();
        qc.invalidateQueries({ queryKey: ['events'] });
      }),
    [qc],
  );
  const resolve = useAction((v: { id: string; choice: number }) => POST(`/game/events/${v.id}/resolve`, { choice: v.choice }), {
    invalidate: [['events'], ['office'], ['state']],
    onSuccess: (r) => {
      setOutcome(r);
      if ((r.bits ?? 0) > 0) sfx.bigCoin();
      else if ((r.bits ?? 0) < 0) sfx.error();
      else sfx.pop();
      say(r.text, r.success ? 'happy' : 'sad');
    },
  });
  const ev = q.data?.pending;
  return (
    <>
      <Modal open={!!ev && !outcome} onClose={() => {}} title={ev ? `${ev.data.emoji} ${ev.data.title}` : ''}>
        {ev && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-3 items-start">
              <motion.div animate={{ rotate: [0, -8, 8, 0] }} transition={{ repeat: Infinity, duration: 1.2 }}>
                <BossByteFace mood={ev.data.bad ? 'wow' : 'happy'} size={64} />
              </motion.div>
              <p className="font-bold">{ev.data.text}</p>
            </div>
            {ev.data.insurable && <p className="text-xs muted">☂️ Insurance can cover losses from this kind of event.</p>}
            {ev.data.choices.map((c: any, i: number) => (
              <button key={i} className="btn-ghost text-left justify-start" disabled={me.access.readOnly || resolve.isPending} onClick={() => resolve.mutate({ id: ev.id, choice: i })}>
                {c.label}
              </button>
            ))}
          </div>
        )}
      </Modal>
      <Modal open={!!outcome} onClose={() => setOutcome(null)} title={outcome?.success ? '✅ It worked!' : '😬 Well...'}>
        {outcome && (
          <div className="flex flex-col gap-2">
            <p className="font-bold">{outcome.text}</p>
            <ul className="text-sm">
              {outcome.bits != null && <li>{outcome.bits >= 0 ? '💰 +' : '💸 '}{formatBits(outcome.bits)}</li>}
              {outcome.insured && <li>☂️ Insurance covered {formatBits(outcome.insured)}!</li>}
              {outcome.mood && <li>😊 Mood {outcome.mood > 0 ? '+' : ''}{outcome.mood}</li>}
              {outcome.energy && <li>⚡ Energy {outcome.energy > 0 ? '+' : ''}{outcome.energy}</li>}
              {outcome.incomeMult && <li>📈 Income x{outcome.incomeMult} for {outcome.minutes} min</li>}
            </ul>
            <button className="btn-primary" onClick={() => setOutcome(null)}>Back to work</button>
          </div>
        )}
      </Modal>
    </>
  );
}
