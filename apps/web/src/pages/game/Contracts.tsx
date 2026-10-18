import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { useStore } from '../../lib/store';
import { sfx } from '../../lib/sound';
import { onWs } from '../../lib/ws';
import { LoadingJoke, ProgressBar, EmptyState, timeLeft, useNow } from '../../components/ui';
import { useGameMe } from './GameLayout';

export function Contracts() {
  const me = useGameMe();
  const ro = me.access.readOnly;
  const q = useApi<any>(['contracts'], '/game/contracts', { refetchInterval: 10_000 });
  const qc = useQueryClient();
  const confetti = useStore((s) => s.confetti);
  const say = useStore((s) => s.say);
  useNow(1000);
  useEffect(() => onWs('contract_done', () => {
    sfx.levelUp();
    qc.invalidateQueries({ queryKey: ['contracts'] });
  }), [qc]);
  const accept = useAction((id: string) => POST(`/game/contracts/${id}/accept`), { invalidate: [['contracts']], success: 'Contract signed! The clock is ticking. ⏱️' });
  const claim = useAction((id: string) => POST(`/game/contracts/${id}/claim`), {
    invalidate: [['contracts'], ['state']],
    onSuccess: (r) => {
      sfx.bigCoin();
      confetti();
      say(`Contract paid out ${formatBits(r.paid)}${r.bonus ? ' WITH the speed bonus' : ''}! The client left a 5-star review (in crayon).`, 'wow');
    },
  });
  const abandon = useAction((id: string) => POST(`/game/contracts/${id}/abandon`), { invalidate: [['contracts']], success: 'Contract abandoned. Reputation took a tiny hit.' });
  if (q.isLoading || !q.data) return <LoadingJoke />;
  const { offered, mine, maxActive } = q.data;
  const active = mine.filter((c: any) => c.status === 'active');
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">📜 Contracts board</h1>
      <p className="muted text-sm">Clients pay a bonus for getting work done. Progress counts every Bit you earn while a contract runs. Finish in the first half of the time for a speed bonus! (Max {maxActive} at once.)</p>
      {mine.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="h2">Your contracts</h2>
          {mine.map((c: any) => (
            <div key={c.id} className="card">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-3xl">{c.data.clientEmoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="h3">{c.data.title}</div>
                  <div className="text-xs muted">for {c.data.client} ({c.data.personality})</div>
                </div>
                <span className={`chip ${c.status === 'success' ? '!bg-good/20' : c.status === 'failed' ? '!bg-bad/20' : ''}`}>{c.status === 'active' ? `⏱️ ${timeLeft(c.endsAt)}` : c.status}</span>
              </div>
              <ProgressBar className="mt-2" value={c.progress} max={c.target} label={`Progress ${formatBits(c.progress)} / ${formatBits(c.target)}`} color={c.status === 'failed' ? 'bg-bad' : 'bg-good'} />
              <div className="flex items-center gap-2 mt-2 text-sm">
                <span>💰 Reward {formatBits(c.reward)} {c.data.speedBonus ? `+ ⚡ ${formatBits(c.bonusReward)} speed bonus` : `(+${formatBits(c.bonusReward)} if done fast)`}</span>
                {!ro && c.status === 'success' && <button className="btn-good btn-sm ml-auto" onClick={() => claim.mutate(c.id)} data-testid="claim-contract">🎁 Claim</button>}
                {!ro && c.status === 'active' && <button className="btn-ghost btn-sm ml-auto" onClick={() => abandon.mutate(c.id)}>Abandon</button>}
              </div>
            </div>
          ))}
        </div>
      )}
      <h2 className="h2">Open offers</h2>
      {!offered.length ? (
        <EmptyState emoji="📭" title="No offers right now" body="Clients are thinking. Check back soon!" />
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {offered.map((c: any) => (
            <div key={c.id} className="card flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-4xl">{c.data.clientEmoji}</span>
                <div>
                  <div className="h3">{c.data.title}</div>
                  <div className="text-xs muted">{c.data.client} · {c.data.personality}</div>
                </div>
              </div>
              <p className="text-sm italic">"{c.data.blurb}"</p>
              <div className="text-sm grid grid-cols-2 gap-1">
                <span>🎯 Earn {formatBits(c.target)}</span>
                <span>⏱️ {Math.round(c.durationMs / 60000)} min</span>
                <span>💰 {formatBits(c.reward)}</span>
                <span>⚡ +{formatBits(c.bonusReward)} if fast</span>
              </div>
              {!ro && (
                <button className="btn-primary" disabled={active.length >= maxActive} onClick={() => accept.mutate(c.id)} data-testid="accept-contract">
                  ✍️ Sign it
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
