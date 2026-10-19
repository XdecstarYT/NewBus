import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { onWs } from '../../lib/ws';
import { useStore } from '../../lib/store';
import { sfx } from '../../lib/sound';
import { LoadingJoke, EmptyState, ProgressBar, timeLeft, useNow } from '../../components/ui';
import { useGameMe } from './GameLayout';

/** Quests (daily + weekly), the free season pass, season standings and the Hall of Fame. */
export function Quests() {
  const me = useGameMe();
  const qc = useQueryClient();
  useNow(30_000); // re-render so countdowns tick
  const confetti = useStore((s) => s.confetti);
  const quests = useApi<any[]>(['quests'], '/game/quests', { refetchInterval: 20_000 });
  const season = useApi<any>(['season'], '/game/season', { refetchInterval: 30_000 });
  useEffect(() => onWs('achievement', () => qc.invalidateQueries({ queryKey: ['season'] })), [qc]);
  const inv = [['quests'], ['season'], ['state', me.access.companyId]];
  const claim = useAction((id: string) => POST<{ paid: number; passXp: number }>(`/game/quests/${id}/claim`), { invalidate: inv, success: (r) => `Quest done! +${r.paid} BT and +${r.passXp} pass XP`, onSuccess: () => sfx.bigCoin() });
  const claimTier = useAction((tier: number) => POST<{ reward: any }>('/game/season/claim', { tier }), { invalidate: inv, success: (r) => `Unlocked: ${r.reward.emoji} ${r.reward.label}!`, onSuccess: () => { sfx.levelUp(); confetti(); } });
  const ro = me.access.readOnly;
  if (!quests.data || !season.data) return <LoadingJoke />;
  const s = season.data;
  const groups = [
    { id: 'daily', label: '☀️ Daily quests', list: quests.data.filter((q) => q.period === 'daily') },
    { id: 'weekly', label: '📅 Weekly quests', list: quests.data.filter((q) => q.period === 'weekly') },
  ];
  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <h1 className="h1">🗺️ Quests & Season</h1>
      <div className="grid md:grid-cols-2 gap-4">
        {groups.map((g) => (
          <div key={g.id} className="card flex flex-col gap-2">
            <div className="flex items-center"><div className="h3 flex-1">{g.label}</div>{g.list[0] && <span className="text-xs muted">resets in {timeLeft(g.list[0].expiresAt)}</span>}</div>
            {g.list.map((q) => (
              <div key={q.id} className={`card-flat flex flex-col gap-1 ${q.status === 'claimed' ? 'opacity-60' : ''}`}>
                <div className="flex items-center gap-2"><span className="text-2xl">{q.emoji}</span><b className="flex-1 text-sm">{q.label}</b><span className="text-xs">💰 {formatBits(q.reward)} · ⭐ {q.passXp} XP</span></div>
                <ProgressBar value={q.progress} max={q.target} label={`${Math.min(q.progress, q.target).toLocaleString()} / ${q.target.toLocaleString()}`} color={q.done ? 'bg-good' : 'bg-accent'} />
                {q.status === 'claimed' ? <span className="text-xs font-bold text-good">✅ Claimed</span> : q.done && <button className="btn-good btn-sm self-start" disabled={ro || claim.isPending} onClick={() => claim.mutate(q.id)} data-testid="claim-quest">🎁 Claim</button>}
              </div>
            ))}
          </div>
        ))}
      </div>

      {!s.season ? (
        <EmptyState emoji="🏁" title="No season running" body="The Owner starts seasons. When one begins you get a fresh leaderboard and a free season pass full of cosmetics!" />
      ) : (
        <>
          <div className="card flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="h2 flex-1">🎫 {s.season.name} pass</div>
              <span className="chip">Ends in {timeLeft(s.season.endsAt)}</span>
              <span className="chip">Tier {s.pass.tier}/{s.pass.maxTier}</span>
            </div>
            <ProgressBar value={s.pass.xp % s.pass.xpPerTier} max={s.pass.xpPerTier} label={s.pass.tier >= s.pass.maxTier ? 'Pass complete! 🎉' : `${s.pass.xp % s.pass.xpPerTier} / ${s.pass.xpPerTier} XP to tier ${s.pass.tier + 1}`} />
            <p className="text-xs muted">Free for everyone, cosmetics only. Earn pass XP from quests, achievements and mini-games.</p>
            <div className="flex gap-2 overflow-x-auto pb-2 snap-x" role="list" aria-label="Season pass tiers">
              {s.pass.tiers.map((t: any) => {
                const reached = s.pass.tier >= t.tier;
                const claimed = s.pass.claimed.includes(t.tier);
                return (
                  <motion.div key={t.tier} role="listitem" whileHover={{ y: -3 }} className={`snap-start shrink-0 w-28 rounded-2xl border-2 p-2 flex flex-col items-center gap-1 text-center ${claimed ? 'border-good bg-good/10' : reached ? 'border-accent bg-accent/10' : 'border-ink/10 opacity-60'}`}>
                    <div className="text-[10px] font-bold muted">TIER {t.tier}</div>
                    <div className="text-3xl">{t.emoji}</div>
                    <div className="text-[11px] font-bold leading-tight min-h-[2.5em]">{t.label}</div>
                    {claimed ? <span className="text-[11px] text-good font-bold">✅</span> : reached ? <button className="btn-primary btn-sm !px-2" disabled={ro || claimTier.isPending} onClick={() => claimTier.mutate(t.tier)}>Claim</button> : <span className="text-[11px]">🔒</span>}
                  </motion.div>
                );
              })}
            </div>
          </div>
          <div className="card">
            <div className="h3 mb-2">🏆 Season standings (earnings this season)</div>
            {!s.standings.length ? <p className="text-sm muted">Nobody has earned anything yet. Be first!</p> : s.standings.map((r: any) => (
              <div key={r.companyId} className={`flex items-center gap-2 text-sm py-1 ${r.companyId === me.access.companyId ? 'font-extrabold' : ''}`}>
                <span className="w-8">{['🥇', '🥈', '🥉'][r.place - 1] ?? r.place}</span><span className="flex-1">{r.emoji} {r.name}</span><span>{formatBits(r.score)}</span>
                {s.prizes[r.place - 1] && <span className="chip !text-[10px]">prize {formatBits(s.prizes[r.place - 1])}</span>}
              </div>
            ))}
            <p className="text-xs muted mt-1">You: {formatBits(s.myScore)} this season.</p>
          </div>
        </>
      )}
      {s.hallOfFame.length > 0 && (
        <div className="card">
          <div className="h3 mb-2">🏛️ Hall of Fame</div>
          {s.hallOfFame.map((h: any) => (
            <div key={h.id} className="text-sm py-1"><b>{h.name}</b>: {(h.winners ?? []).slice(0, 3).map((w: any) => `${['🥇', '🥈', '🥉'][w.place - 1]} ${w.name}`).join('  ') || 'no winners'}</div>
          ))}
        </div>
      )}
    </div>
  );
}
