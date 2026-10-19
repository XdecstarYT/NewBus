import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { useStore } from '../../lib/store';
import { sfx } from '../../lib/sound';
import { onWs } from '../../lib/ws';
import { WorkerAvatar, workerState } from '../../components/WorkerAvatar';
import { LoadingJoke, ProgressBar, Bits, Modal, useConfirm } from '../../components/ui';
import { BossByteFace } from '../../components/BossByte';
import { useBase, useCan, useGameMe } from './GameLayout';
import { WorkerCard } from './Workforce';
import { DecorStrip } from './Decor';
import { EventPopup } from './Events';

const ROLE_EMOJI: Record<string, string> = { MAKER: '🔨', SELLER: '💬', THINKER: '🧠', FIXER: '🔧', MANAGER: '📋', WILDCARD: '🃏' };

export function Office() {
  const me = useGameMe();
  const base = useBase();
  const ro = me.access.readOnly;
  const q = useApi<any>(['office'], '/game/office', { refetchInterval: 15_000 });
  const qc = useQueryClient();
  const toast = useStore((s) => s.toast);
  const float = useStore((s) => s.float);
  const say = useStore((s) => s.say);
  const shake = useStore((s) => s.shake);
  const setBalance = useStore((s) => s.setBalance);
  const confirm = useConfirm();
  const [selected, setSelected] = useState<string | null>(null);
  const [combo, setCombo] = useState(0);
  const [synergyPop, setSynergyPop] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const comboTimer = useRef<number>();
  const canDecor = useCan('decor');
  const canEvents = useCan('events');

  useEffect(() => {
    const off = onWs('tick', () => qc.invalidateQueries({ queryKey: ['office'] }));
    const off2 = onWs('worker_levelup', (m) => {
      sfx.levelUp();
      toast(`${m.name} reached level ${m.level}! 🎓`, 'good');
    });
    return () => {
      off();
      off2();
    };
  }, [qc, toast]);

  const assign = useAction((v: { workerId: string; workplaceId: string | null; desk?: number | null }) => POST('/game/workforce/assign', v), {
    invalidate: [['office']],
    onSuccess: (r) => {
      sfx.pop();
      if (r.synergy) {
        sfx.bigCoin();
        setSynergyPop(r.focus);
        setTimeout(() => setSynergyPop(null), 1600);
      }
    },
  });
  const autoAssign = useAction(() => POST('/game/workforce/auto-assign'), { invalidate: [['office']], success: (r: any) => (r.placed ? `Boss Byte seated ${r.placed} workers. Synergy first!` : 'Nobody needed a seat (or they are too tired).') });
  const upgrade = useAction((id: string) => POST(`/game/workplaces/${id}/upgrade`), {
    invalidate: [['office'], ['state']],
    onSuccess: (r) => {
      sfx.levelUp();
      useStore.getState().confetti();
      say(`Upgraded to level ${r.level}! More desks, more output, more chaos.`, 'wow');
    },
  });
  const unlock = useAction((kind: number) => POST('/game/workplaces/unlock', { kind }), {
    invalidate: [['office'], ['state']],
    onSuccess: (r) => {
      sfx.levelUp();
      useStore.getState().confetti();
      say(`🏗️ ${r.name} is open! Fill those desks.`, 'wow');
      setUnlockOpen(false);
    },
  });
  const coffeeAll = useAction(() => POST('/game/workforce/coffee-all'), { invalidate: [['office'], ['state']], success: (r: any) => `☕ Coffee for ${r.count}! Everyone is vibrating.` });

  async function tap(e: React.MouseEvent, wpId: string) {
    if (ro) return;
    const x = e.clientX - 20;
    const y = e.clientY - 20;
    try {
      const r = await POST('/game/office/boost', { workplaceId: wpId });
      setBalance(r.balance);
      if (r.capped) {
        toast("Daily boost cap reached! Your finger needs a holiday. 🏖️", 'info');
        return;
      }
      setCombo(r.combo);
      if (comboTimer.current) clearTimeout(comboTimer.current);
      comboTimer.current = window.setTimeout(() => setCombo(0), 1600);
      float({ x, y, text: `+${formatBits(r.paid, false)} BT`, big: r.big, color: r.combo >= 10 ? '#f59e0b' : '#16a34a' });
      if (r.big) {
        sfx.bigCoin();
        shake();
      } else sfx.coin();
    } catch (err: any) {
      if (err.code !== 'too_fast') toast(err.message, 'bad');
    }
  }

  if (q.isLoading || !q.data) return <LoadingJoke jokes={undefined} />;
  const d = q.data;
  const benchSelected = selected && d.unassigned.find((w: any) => w.id === selected);

  return (
    <div className="flex flex-col gap-4">
      {/* page heading for screen readers; the top bar already shows the company name */}
      <h1 className="sr-only">Office</h1>
      {canEvents && <EventPopup />}
      {/* dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <DashTile emoji="💰" label="Income / tick" value={`+${d.dashboard.incomePerTick}`} sub={`x${d.dashboard.multiplier} bonus`} />
        <DashTile emoji="🧾" label="Wages + upkeep" value={`-${Math.round((d.dashboard.wagesPerTick + d.dashboard.upkeepPerTick) * 100) / 100}`} sub={`${d.dashboard.workers} workers`} />
        <DashTile emoji={d.dashboard.profitPerTick >= 0 ? '📈' : '📉'} label="Profit / tick" value={d.dashboard.profitPerTick} good={d.dashboard.profitPerTick >= 0} />
        <DashTile emoji="✨" label="Synergies" value={`${d.dashboard.synergies}/${d.dashboard.desks}`} sub="matched roles" />
      </div>
      <div className="grid sm:grid-cols-3 gap-2">
        <div className="card !p-3"><ProgressBar value={d.dashboard.morale} max={100} label={`😊 Morale`} color="bg-good" /></div>
        <div className="card !p-3"><ProgressBar value={d.dashboard.boredom} max={100} label={`🥱 Boredom meter`} color="bg-warn" /></div>
        <div className="card !p-3"><ProgressBar value={d.dashboard.fireHazard} max={100} label={`🔥 Fire hazard (cartoon)`} color="bg-bad" /></div>
      </div>

      {/* goals: always something nearly full */}
      <div className="card">
        <div className="flex items-center gap-2 mb-2">
          <BossByteFace size={36} mood="think" />
          <h2 className="h3">Next goals</h2>
          <span className="ml-auto text-xs muted italic">"{d.industry.jokes[Math.floor(Date.now() / 20000) % d.industry.jokes.length]}"</span>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {d.goals.map((g: any) => (
            <ProgressBar key={g.id} value={g.progress} max={g.target} label={`${g.emoji} ${g.text}`} />
          ))}
        </div>
      </div>

      {canDecor && <DecorStrip />}

      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="h2 mr-auto">🏢 The office floor</h2>
        {!ro && (
          <>
            <button className="btn-ghost btn-sm" onClick={() => coffeeAll.mutate(undefined)}>☕ Coffee round</button>
            <button className="btn-ghost btn-sm" onClick={() => autoAssign.mutate(undefined)}>🪄 Auto-seat</button>
            <button className="btn-primary btn-sm" onClick={() => setUnlockOpen(true)}>🏗️ New workplace</button>
          </>
        )}
      </div>
      {selected && benchSelected && <div className="card-flat !bg-accent/10 text-sm font-bold">👆 Now tap a desk to seat <b>{benchSelected.name}</b> (or tap them again to cancel).</div>}

      <div className="grid lg:grid-cols-2 gap-4">
        {d.workplaces.map((wp: any) => (
          <div key={wp.id} className="card office-floor !p-3">
            <button
              className="w-full flex items-center gap-2 text-left rounded-2xl p-2 bg-card border-2 border-ink active:scale-[0.98] transition-transform"
              onClick={(e) => tap(e, wp.id)}
              aria-label={`Boost ${wp.name}`}
              data-testid="boost"
            >
              <span className="text-3xl" aria-hidden>{wp.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="font-display font-extrabold truncate">{wp.name} <span className="chip">Lv {wp.level}</span></div>
                <div className="text-xs muted">
                  Focus: {ROLE_EMOJI[wp.focus]} {wp.focus} · +{wp.income}/tick · upkeep {wp.upkeep}
                </div>
              </div>
              <span className="btn-pink btn-sm pointer-events-none">👆 TAP!</span>
            </button>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3">
              {wp.seats.map((w: any, i: number) => (
                <Desk
                  key={i}
                  worker={w}
                  ro={ro}
                  highlight={!!selected}
                  onDrop={(workerId) => assign.mutate({ workerId, workplaceId: wp.id, desk: i })}
                  onClick={() => {
                    if (selected) {
                      assign.mutate({ workerId: selected, workplaceId: wp.id, desk: i });
                      setSelected(null);
                    } else if (w) setDetail(w);
                  }}
                />
              ))}
            </div>
            {!ro && wp.upgradeCost != null && (
              <button className="btn-ghost btn-sm w-full mt-3" onClick={async () => (await confirm({ title: `Upgrade ${wp.name}?`, body: <>Costs <Bits n={wp.upgradeCost} />. You get more desks and +10% output.</> })) && upgrade.mutate(wp.id)}>
                ⬆️ Upgrade ({formatBits(wp.upgradeCost)})
              </button>
            )}
          </div>
        ))}
      </div>

      {/* bench */}
      <div className="card">
        <div className="flex items-center mb-2">
          <h2 className="h3 mr-auto">🪑 The bench ({d.unassigned.length})</h2>
          {d.unassigned.length > 0 && !ro && <span className="text-xs muted">Drag a worker onto a desk, or tap worker then desk</span>}
        </div>
        {d.unassigned.length === 0 ? (
          <p className="text-sm muted">
            Nobody on the bench. {d.dashboard.workers < d.dashboard.desks ? <>Empty desks are sad desks - <Link className="underline" to={`${base}/pods`}>open a Recruit Pod</Link>!</> : 'Everyone is hard at work (allegedly).'}
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {d.unassigned.map((w: any) => (
              <button
                key={w.id}
                draggable={!ro}
                onDragStart={(e) => e.dataTransfer.setData('text/worker', w.id)}
                onClick={() => (ro ? setDetail(w) : setSelected(selected === w.id ? null : w.id))}
                className={`flex flex-col items-center gap-1 p-2 rounded-2xl border-2 ${selected === w.id ? 'border-ink bg-accent/20 scale-105' : 'border-transparent'}`}
                aria-pressed={selected === w.id}
                aria-label={`${w.name}, ${w.archetypeName}, mood ${w.mood}`}
              >
                <WorkerAvatar species={w.species} color={w.appearance.color} eyes={w.appearance.eyes} accessory={w.appearance.accessory} mood={w.mood} state={workerState(w)} rarity={w.rarity} size={52} />
                <span className="text-[11px] font-bold max-w-[80px] truncate">{w.name.split(' ')[0]}</span>
                <span className="text-[10px] muted">{ROLE_EMOJI[w.role]} ⚡{Math.round(w.energy)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* combo meter + synergy pop */}
      <AnimatePresence>
        {combo > 1 && (
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0, opacity: 0 }} className="fixed left-1/2 -translate-x-1/2 top-24 z-40 card !py-1 !px-4 font-display font-extrabold text-2xl pointer-events-none" style={{ color: combo >= 10 ? '#f59e0b' : undefined }}>
            COMBO x{combo}!
          </motion.div>
        )}
        {synergyPop && (
          <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1.1, rotate: 0 }} exit={{ scale: 0, opacity: 0 }} className="fixed left-1/2 -translate-x-1/2 top-1/3 z-50 card text-center pointer-events-none !bg-accent2 text-white">
            <div className="font-display font-extrabold text-3xl">✨ SYNERGY COMBO! ✨</div>
            <div className="font-bold">{ROLE_EMOJI[synergyPop]} {synergyPop} at a {synergyPop} desk: +25% output</div>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name}>
        {detail && <WorkerCard w={detail} onDone={() => setDetail(null)} />}
      </Modal>
      <Modal open={unlockOpen} onClose={() => setUnlockOpen(false)} title="🏗️ Open a new workplace">
        <div className="flex flex-col gap-2">
          {d.unlockable.map((u: any) => {
            const lvlOk = d.company.level >= u.level;
            return (
              <div key={u.kind} className="card-flat flex items-center gap-3">
                <span className="text-3xl">{u.emoji}</span>
                <div className="flex-1">
                  <div className="font-bold">{u.name} {u.owned > 0 && <span className="chip">owned x{u.owned}</span>}</div>
                  <div className="text-xs muted">Focus {ROLE_EMOJI[u.focus]} {u.focus} · needs Lv {u.level}{!u.allowed && ' · 🔒 capped by the Owner'}</div>
                </div>
                <button className="btn-primary btn-sm" disabled={!lvlOk || !u.allowed || unlock.isPending} onClick={() => unlock.mutate(u.kind)}>
                  {formatBits(Math.max(500, u.cost * (u.owned + 1)))}
                </button>
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}

function DashTile({ emoji, label, value, sub, good }: { emoji: string; label: string; value: React.ReactNode; sub?: string; good?: boolean }) {
  return (
    <div className="card !p-3">
      <div className="text-xs font-bold muted">{emoji} {label}</div>
      <div className={`font-display font-extrabold text-xl tabular-nums ${good === false ? 'text-bad' : good ? 'text-good' : ''}`}>{value}</div>
      {sub && <div className="text-[11px] muted">{sub}</div>}
    </div>
  );
}

function Desk({ worker, onDrop, onClick, highlight, ro }: { worker: any; onDrop: (workerId: string) => void; onClick: () => void; highlight: boolean; ro: boolean }) {
  const [over, setOver] = useState(false);
  const [bubble, setBubble] = useState(false);
  useEffect(() => {
    if (!worker) return;
    const iv = setInterval(() => Math.random() < 0.15 && (setBubble(true), setTimeout(() => setBubble(false), 2500)), 6000);
    return () => clearInterval(iv);
  }, [worker]);
  return (
    <div
      onDragOver={(e) => {
        if (ro) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData('text/worker');
        if (id && !ro) onDrop(id);
      }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      aria-label={worker ? `Desk: ${worker.name}` : 'Empty desk'}
      className={`relative aspect-square rounded-2xl border-[3px] flex flex-col items-center justify-center cursor-pointer transition-colors ${
        over ? 'border-accent bg-accent/20' : worker ? (worker.synergy ? 'border-accent2 bg-accent2/10' : 'border-ink bg-card') : `border-dashed border-ink/40 ${highlight ? 'bg-accent/10 animate-pulse' : ''}`
      }`}
    >
      {worker ? (
        <>
          <div draggable={!ro} onDragStart={(e) => e.dataTransfer.setData('text/worker', worker.id)}>
            <WorkerAvatar species={worker.species} color={worker.appearance.color} eyes={worker.appearance.eyes} accessory={worker.appearance.accessory} mood={worker.mood} state={workerState(worker)} rarity={worker.rarity} size={48} />
          </div>
          <span className="text-[10px] font-bold truncate max-w-full px-1">{worker.name.split(' ')[0]}</span>
          {worker.synergy && <span className="absolute -top-2 -left-2 text-sm" title="Synergy combo!">✨</span>}
          <span className="absolute bottom-0.5 right-1 text-[9px] font-bold muted">⚡{Math.round(worker.energy)}</span>
          <AnimatePresence>
            {bubble && (
              <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap card !p-1 !px-2 !rounded-xl text-[10px] font-bold z-10 !shadow-popsm">
                {worker.line}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      ) : (
        <span className="text-2xl opacity-30" aria-hidden>🪑</span>
      )}
    </div>
  );
}
