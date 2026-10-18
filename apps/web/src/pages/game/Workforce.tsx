import { useState } from 'react';
import { RARITY_INFO, formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { useStore } from '../../lib/store';
import { sfx } from '../../lib/sound';
import { WorkerAvatar, workerState } from '../../components/WorkerAvatar';
import { LoadingJoke, Modal, ProgressBar, useConfirm, EmptyState, Bits } from '../../components/ui';
import { useCan, useGameMe } from './GameLayout';

const ROLE_EMOJI: Record<string, string> = { MAKER: '🔨', SELLER: '💬', THINKER: '🧠', FIXER: '🔧', MANAGER: '📋', WILDCARD: '🃏' };

/** Full worker card with every action (train, promote, coffee, rename, bench, fire, sell). */
export function WorkerCard({ w, onDone }: { w: any; onDone?: () => void }) {
  const me = useGameMe();
  const ro = me.access.readOnly;
  const canMarket = useCan('marketplace');
  const confirm = useConfirm();
  const say = useStore((s) => s.say);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(w.name);
  const [sellOpen, setSellOpen] = useState(false);
  const [price, setPrice] = useState(500);
  const inv = [['office'], ['workforce'], ['state']];
  const train = useAction(() => POST(`/game/workforce/${w.id}/train`), {
    invalidate: inv,
    onSuccess: (r) => {
      sfx.coin();
      if (r.leveled) {
        sfx.levelUp();
        say(`${w.name} levelled up to ${r.level}! They now know which end of the stapler is which.`);
      }
    },
  });
  const promote = useAction(() => POST(`/game/workforce/${w.id}/promote`), {
    invalidate: inv,
    onSuccess: (r) => {
      sfx.levelUp();
      if (r.glowUp) {
        useStore.getState().confetti();
        say(`GLOW-UP! ${w.name} is now ${RARITY_INFO[r.rarity as keyof typeof RARITY_INFO].label}! ✨`, 'wow');
      } else say(`${w.name} got a promotion and a tiny hat.`);
    },
  });
  const coffee = useAction(() => POST(`/game/workforce/${w.id}/coffee`), { invalidate: inv, success: `☕ ${w.name} is wired!` });
  const rename = useAction(() => POST(`/game/workforce/${w.id}/rename`, { name }), { invalidate: inv, success: 'New name, new me!', onSuccess: () => setRenaming(false) });
  const bench = useAction(() => POST('/game/workforce/assign', { workerId: w.id, workplaceId: null }), { invalidate: inv, success: `${w.name} is taking a breather on the bench.`, onSuccess: onDone });
  const fire = useAction(() => POST(`/game/workforce/${w.id}/fire`), { invalidate: inv, success: `${w.name} has left to "pursue other opportunities". 👋`, onSuccess: onDone });
  const sell = useAction(() => POST('/game/market/listings', { itemType: 'worker', itemRef: w.id, buyNowPrice: price, startPrice: Math.max(1, Math.round(price / 2)), hours: 24 }), {
    invalidate: inv,
    success: 'Listed on the marketplace!',
    onSuccess: () => {
      setSellOpen(false);
      onDone?.();
    },
  });
  const r = RARITY_INFO[w.rarity as keyof typeof RARITY_INFO];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <WorkerAvatar species={w.species} color={w.appearance.color} eyes={w.appearance.eyes} accessory={w.appearance.accessory} mood={w.mood} state={workerState(w)} rarity={w.rarity} size={88} />
        <div className="min-w-0">
          {renaming ? (
            <div className="flex gap-1">
              <input className="input !min-h-[36px]" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} aria-label="New name" />
              <button className="btn-primary btn-sm" onClick={() => rename.mutate(undefined)}>OK</button>
            </div>
          ) : (
            <div className="font-display font-extrabold text-xl">{w.name}</div>
          )}
          <div className="flex flex-wrap gap-1 mt-1">
            <span className="chip" style={{ background: r.color, color: '#fff' }}>{r.label}</span>
            <span className="chip">{w.archetypeEmoji} {w.archetypeName}</span>
            <span className="chip">{ROLE_EMOJI[w.role]} {w.role}</span>
            <span className="chip">Lv {w.level}</span>
          </div>
          <div className="text-xs muted mt-1 italic">"{w.line}"</div>
        </div>
      </div>
      <p className="text-sm">{w.archetypeBio}</p>
      <div className="card-flat text-sm">
        <b>{w.quirkEmoji} {w.quirkName}:</b> {w.quirkDescription}
      </div>
      <div className="text-xs muted">{w.roleBonus}</div>
      <div className="grid grid-cols-2 gap-2">
        <ProgressBar value={w.energy} max={100} label="⚡ Energy" color="bg-warn" />
        <ProgressBar value={w.mood} max={100} label="😊 Mood" color="bg-good" />
        <ProgressBar value={w.xp} max={w.xpNext} label="🎓 XP" />
        <div className="text-xs">
          <div>🛠️ Speed {w.skills.speed} · 🎨 Craft {w.skills.craft} · 💬 Charm {w.skills.charm}</div>
          <div>💰 Output {w.baseOutput}/tick · 🧾 Wage {w.wage}/tick</div>
        </div>
      </div>
      {!ro && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <button className="btn-primary btn-sm" onClick={() => train.mutate(undefined)} disabled={train.isPending}>🎓 Train ({formatBits(w.trainCost)})</button>
          <button className="btn-pink btn-sm" onClick={async () => (await confirm({ title: `Promote ${w.name}?`, body: <>Costs <Bits n={w.promoteCost} />. +1 level, a mood boost and a 15% chance of a rarity glow-up!</> })) && promote.mutate(undefined)}>🏅 Promote</button>
          <button className="btn-ghost btn-sm" onClick={() => coffee.mutate(undefined)}>☕ Coffee</button>
          <button className="btn-ghost btn-sm" onClick={() => setRenaming(true)}>✏️ Rename</button>
          {w.workplaceId && <button className="btn-ghost btn-sm" onClick={() => bench.mutate(undefined)}>🪑 Bench</button>}
          {canMarket && <button className="btn-ghost btn-sm" onClick={() => setSellOpen(true)}>🛒 Sell</button>}
          <button className="btn-bad btn-sm" onClick={async () => (await confirm({ title: `Fire ${w.name}?`, body: "They'll pack their tiny desk plant and leave forever. No refunds.", danger: true, yes: 'You\'re fired! 👋' })) && fire.mutate(undefined)}>👋 Fire</button>
        </div>
      )}
      <Modal open={sellOpen} onClose={() => setSellOpen(false)} title={`Sell ${w.name}`}>
        <label className="label" htmlFor="price">Buy-it-now price</label>
        <input id="price" type="number" min={1} className="input mb-2" value={price} onChange={(e) => setPrice(Math.max(1, Math.floor(Number(e.target.value))))} />
        <p className="text-xs muted mb-2">Bids start at half price. The marketplace takes a small fee. Listed workers stop working until sold or cancelled.</p>
        <button className="btn-primary w-full" onClick={() => sell.mutate(undefined)}>List for 24h</button>
      </Modal>
    </div>
  );
}

export function Workforce() {
  const q = useApi<any[]>(['workforce'], '/game/workforce');
  const [sort, setSort] = useState<'level' | 'rarity' | 'mood' | 'energy'>('level');
  const [filter, setFilter] = useState('');
  const [detail, setDetail] = useState<any>(null);
  if (q.isLoading) return <LoadingJoke />;
  const order = { LEGENDARY: 0, EPIC: 1, RARE: 2, COMMON: 3, CURSED: 4 } as Record<string, number>;
  const list = (q.data ?? [])
    .filter((w) => !filter || w.rarity === filter)
    .sort((a, b) => (sort === 'rarity' ? order[a.rarity] - order[b.rarity] : sort === 'level' ? b.level - a.level : b[sort] - a[sort]));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="h1 mr-auto">🤖 Workforce ({q.data?.length ?? 0})</h1>
        <select className="input w-auto" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter rarity">
          <option value="">All rarities</option>
          {Object.entries(RARITY_INFO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value as any)} aria-label="Sort">
          <option value="level">Sort: level</option>
          <option value="rarity">Sort: rarity</option>
          <option value="mood">Sort: mood</option>
          <option value="energy">Sort: energy</option>
        </select>
      </div>
      {!list.length ? (
        <EmptyState emoji="🥚" title="No workers yet" body="Your office is suspiciously quiet. Open a Recruit Pod to hire your first blob!" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {list.map((w) => (
            <button key={w.id} className="card !p-3 text-left flex flex-col items-center gap-1 hover:-translate-y-0.5 transition-transform" onClick={() => setDetail(w)}>
              <WorkerAvatar species={w.species} color={w.appearance.color} eyes={w.appearance.eyes} accessory={w.appearance.accessory} mood={w.mood} state={workerState(w)} rarity={w.rarity} size={64} />
              <div className="font-bold text-sm text-center leading-tight">{w.name}</div>
              <div className="flex gap-1 flex-wrap justify-center">
                <span className="chip" style={{ background: RARITY_INFO[w.rarity as keyof typeof RARITY_INFO].color, color: '#fff' }}>{RARITY_INFO[w.rarity as keyof typeof RARITY_INFO].label}</span>
                <span className="chip">Lv {w.level}</span>
              </div>
              <div className="text-[11px] muted">{w.quirkEmoji} {w.quirkName} · {w.workplaceId ? '💼 working' : w.listed ? '🛒 for sale' : '🪑 bench'}</div>
            </button>
          ))}
        </div>
      )}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name}>
        {detail && <WorkerCard w={detail} onDone={() => setDetail(null)} />}
      </Modal>
    </div>
  );
}
