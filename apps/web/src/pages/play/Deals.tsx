import { useState } from 'react';
import { ITEMS, ITEM_IDS, type ItemId } from '@dw/shared/live';
import { POST } from '../../lib/api';
import { useApi, useAction } from '../../lib/hooks';
import { formatBits, itemLabel, lineText } from '../../lib/game';
import { sfx } from '../../lib/sound';
import { useStore } from '../../lib/store';
import { EmptyState, LoadingJoke, Modal, ProgressBar, Tabs, timeAgo, timeLeft } from '../../components/ui';
import { formatGameDuration } from '@dw/shared/live';
import { useMe2 } from '../Layout';

// ============================================================ AI customers
export function Customers() {
  const q = useApi<any>(['customers'], '/game/customers', { refetchInterval: 20_000 });
  const [haggling, setHaggling] = useState<any>(null);
  const [pitch, setPitch] = useState('');
  const [reply, setReply] = useState<any>(null);
  const fill = useAction((id: string) => POST<any>(`/game/customers/${id}/fill`), {
    invalidate: [['customers'], ['home'], ['me'], ['quests']],
    success: (r) => `🛎️ Served! +${r.paid} BT`,
    onSuccess: () => sfx.bigCoin(),
  });
  const haggle = useAction(() => POST<any>(`/game/customers/${haggling.id}/haggle`, { pitch }), {
    invalidate: [['customers']],
    onSuccess: (r) => {
      setReply(r);
      if (r.accepted) sfx.coin();
      else sfx.error();
    },
  });
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">🧑‍💼 Customers</h1>
      <p className="muted text-sm">Walk-in customers want goods and pay above the market price. First company to hand over the goods gets the money. Feeling bold? Haggle once per customer for a better price. {d.ai ? '🤖 These customers are played by the AI.' : ''}</p>
      {!d.open.length ? (
        <EmptyState emoji="🚪" title="The shop floor is quiet" body="New customers walk in through the day." />
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {d.open.map((o: any) => (
            <div key={o.id} className="card flex flex-col gap-2" data-testid={`customer-${o.id}`}>
              <div className="flex items-center gap-2">
                <span className="text-4xl">{o.emoji}</span>
                <div className="flex-1"><b>{o.name}</b>{o.persona && <div className="text-xs muted">{o.persona}</div>}</div>
                <div className="text-right"><b className="text-lg">{formatBits(o.pay)}</b><div className="text-xs muted">leaves in {timeLeft(o.expiresAt)}</div></div>
              </div>
              <div className="rounded-2xl bg-ink/5 p-2 text-sm italic">"{o.message}"</div>
              <div className="flex flex-wrap gap-1 text-xs">
                {o.lines.map((l: any) => <span key={l.item} className={`chip ${(d.have[l.item] ?? 0) >= l.qty ? '!bg-emerald-100' : '!bg-rose-100'}`}>{l.qty}× {itemLabel(l.item)} (you have {d.have[l.item] ?? 0})</span>)}
              </div>
              <div className="flex gap-2">
                <button className="btn-good flex-1" disabled={!o.canFill || fill.isPending} onClick={() => fill.mutate(o.id)} data-testid="serve">{o.canFill ? '🛎️ Serve' : 'Not enough stock'}</button>
                <button className="btn-ghost" disabled={o.haggled} onClick={() => (setHaggling(o), setPitch(''), setReply(null))}>{o.haggled ? 'Haggled' : '💬 Haggle'}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {d.served.length > 0 && (
        <div className="card">
          <div className="h3 mb-1">Recently served</div>
          {d.served.map((o: any) => <div key={o.id} className="text-sm py-0.5">{o.emoji} {o.name}: {lineText(o.lines)} · <b>{o.pay} BT</b> <span className="muted text-xs">{timeAgo(o.filledAt)}</span></div>)}
        </div>
      )}
      <Modal open={!!haggling} onClose={() => setHaggling(null)} title={haggling ? `💬 Haggle with ${haggling.emoji} ${haggling.name}` : ''}>
        {haggling && (
          <form className="flex flex-col gap-2" onSubmit={(e) => (e.preventDefault(), haggle.mutate(undefined))}>
            <p className="text-sm">They offer <b>{haggling.pay} BT</b>. Convince them to pay more. You get one try, so make it good!</p>
            <textarea className="input" rows={3} maxLength={300} value={pitch} onChange={(e) => setPitch(e.target.value)} placeholder="Our bread is baked at dawn by award-winning bakers..." aria-label="Your pitch" disabled={!!reply} />
            {reply ? (
              <div className={`card ${reply.accepted ? '!bg-emerald-50' : '!bg-rose-50'}`}>
                <div className="text-sm italic">{haggling.emoji} "{reply.reply}"</div>
                <b>{reply.accepted ? `New price: ${reply.pay} BT (was ${reply.was})` : `Still ${reply.pay} BT`}</b>
              </div>
            ) : (
              <button className="btn-primary" disabled={haggle.isPending || pitch.trim().length < 3}>{haggle.isPending ? 'They are thinking...' : 'Make my pitch'}</button>
            )}
          </form>
        )}
      </Modal>
    </div>
  );
}

// ============================================================ contracts
const STATUS: Record<string, string> = { open: '📢 Open', accepted: '🤝 Accepted', delivered: '📦 Delivered', expired: '⌛ Expired', cancelled: '🚫 Cancelled', breached: '💔 Broken' };

export function Contracts() {
  const me = useMe2();
  const q = useApi<any[]>(['contracts'], '/game/contracts', { refetchInterval: 30_000 });
  const companies = useApi<any[]>(['companies'], '/game/companies');
  const home = useApi<any>(['home'], '/game/home');
  const [tab, setTab] = useState<'board' | 'buying' | 'selling' | 'new'>('board');
  const [f, setF] = useState({ item: 'steel' as string, qty: 10, price: 200, note: '', offeredTo: '', acceptHours: 12, deliverHours: 24 });
  const inv = [['contracts'], ['home'], ['me'], ['quests']];
  const create = useAction(() => POST('/game/contracts', { ...f, offeredTo: f.offeredTo || null }), { invalidate: inv, success: '📝 Contract posted. Your Bits wait safely until delivery.', onSuccess: () => setTab('buying') });
  const act = useAction(({ id, a }: { id: string; a: string }) => POST<any>(`/game/contracts/${id}/${a}`), {
    invalidate: inv,
    success: (r) => (r?.paid !== undefined ? `📦 Delivered! +${r.paid} BT (tax ${r.tax})` : 'Done.'),
    onSuccess: (r) => (r?.paid !== undefined ? sfx.bigCoin() : sfx.click()),
  });
  if (!q.data) return <LoadingJoke />;
  const id = me.company!.id;
  const board = q.data.filter((c) => c.status === 'open' && c.buyerId !== id);
  const buying = q.data.filter((c) => c.buyerId === id);
  const selling = q.data.filter((c) => c.sellerId === id);
  const row = (c: any) => {
    const have = home.data?.inventory?.[c.item] ?? 0;
    return (
      <div key={c.id} className="card flex flex-col gap-1" data-testid={`contract-${c.id}`}>
        <div className="flex items-center gap-2">
          <span className="text-3xl">{ITEMS[c.item as ItemId]?.emoji}</span>
          <div className="flex-1">
            <b>{c.qty}× {ITEMS[c.item as ItemId]?.name}</b> for <b>{formatBits(c.price)}</b> <span className="text-xs muted">({Math.round(c.price / c.qty)} BT each)</span>
            <div className="text-xs muted">Buyer: {c.buyer?.emoji} {c.buyer?.name}{c.seller ? ` · Seller: ${c.seller.emoji} ${c.seller.name}` : ''}{c.offeredToCo && !c.seller ? ` · Offered to ${c.offeredToCo.emoji} ${c.offeredToCo.name}` : ''}</div>
          </div>
          <span className="chip text-xs">{STATUS[c.status]}</span>
        </div>
        {c.note && <div className="text-sm italic">"{c.note}"</div>}
        <div className="text-xs muted">{c.status === 'open' ? `Take it within ${timeLeft(c.acceptBy)}` : c.status === 'accepted' ? `Deliver within ${timeLeft(c.deliverBy)}` : `Updated ${timeAgo(c.doneAt ?? c.createdAt)}`}</div>
        <div className="flex gap-2">
          {c.status === 'open' && c.buyerId !== id && <button className="btn-primary btn-sm" onClick={() => act.mutate({ id: c.id, a: 'accept' })}>🤝 Accept</button>}
          {c.status === 'open' && c.buyerId === id && <button className="btn-ghost btn-sm" onClick={() => act.mutate({ id: c.id, a: 'cancel' })}>Cancel</button>}
          {c.status === 'accepted' && c.sellerId === id && <button className="btn-good btn-sm" disabled={have < c.qty} onClick={() => act.mutate({ id: c.id, a: 'deliver' })} data-testid="deliver">📦 Deliver (you have {have})</button>}
        </div>
      </div>
    );
  };
  const list = (rows: any[], empty: string) => (rows.length ? <div className="grid md:grid-cols-2 gap-3">{rows.map(row)}</div> : <EmptyState emoji="📝" title={empty} />);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">📝 Contracts</h1>
      <p className="muted text-sm">Promise goods by a deadline. The buyer's money is locked when the contract is posted; the seller is paid on delivery. Miss the deadline and the buyer gets their money back, you lose prestige, and they can take you to court.</p>
      <Tabs tabs={[{ id: 'board', label: `📢 Open (${board.length})` }, { id: 'selling', label: `📤 I'm delivering (${selling.filter((c) => c.status === 'accepted').length})` }, { id: 'buying', label: `📥 I'm buying (${buying.filter((c) => ['open', 'accepted'].includes(c.status)).length})` }, { id: 'new', label: '➕ New contract' }]} value={tab} onChange={setTab} />
      {tab === 'board' && list(board, 'No open contracts. Post one!')}
      {tab === 'selling' && list(selling, 'You have not accepted any contracts.')}
      {tab === 'buying' && list(buying, 'You have not posted any contracts.')}
      {tab === 'new' && (
        <form className="card flex flex-col gap-2 max-w-xl" onSubmit={(e) => (e.preventDefault(), create.mutate(undefined))}>
          <div className="grid grid-cols-2 gap-2">
            <label className="label">Item<select className="input" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })}>{ITEM_IDS.map((i) => <option key={i} value={i}>{itemLabel(i)}</option>)}</select></label>
            <label className="label">Quantity<input type="number" className="input" min={1} value={f.qty} onChange={(e) => setF({ ...f, qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} /></label>
            <label className="label">Total price (BT)<input type="number" className="input" min={1} value={f.price} onChange={(e) => setF({ ...f, price: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} /></label>
            <label className="label">Offer to<select className="input" value={f.offeredTo} onChange={(e) => setF({ ...f, offeredTo: e.target.value })}><option value="">Anyone</option>{(companies.data ?? []).filter((c) => c.id !== id).map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</select></label>
            <label className="label">Game hours to accept<input type="number" className="input" min={1} max={168} value={f.acceptHours} onChange={(e) => setF({ ...f, acceptHours: Number(e.target.value) || 1 })} /></label>
            <label className="label">Then game hours to deliver<input type="number" className="input" min={1} max={168} value={f.deliverHours} onChange={(e) => setF({ ...f, deliverHours: Number(e.target.value) || 1 })} /></label>
          </div>
          <label className="label">Note<input className="input" maxLength={200} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="For our new bakery opening!" /></label>
          <div className="text-sm">You lock <b>{formatBits(f.price)}</b> now ({Math.round(f.price / f.qty)} BT each). It comes back if nobody delivers.</div>
          <button className="btn-primary" disabled={create.isPending}>📝 Post contract</button>
        </form>
      )}
    </div>
  );
}

// ============================================================ quests + badges
export function Quests() {
  const q = useApi<any>(['quests'], '/game/quests', { refetchInterval: 30_000 });
  const confetti = useStore((s) => s.confetti);
  const claim = useAction((id: string) => POST<any>(`/game/quests/${id}/claim`), {
    invalidate: [['quests'], ['home'], ['me']],
    success: (r) => `🎯 Quest done: +${r.paid} BT, +${r.xp} XP`,
    onSuccess: () => (sfx.levelUp(), confetti()),
  });
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  const prev = 60 * (d.level - 1) ** 2;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">🎯 Quests & badges</h1>
      <div className="card flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="text-4xl font-black">Lv {d.level}</div>
          <div className="flex-1">
            <ProgressBar value={d.xp - prev} max={d.nextLevelXp - prev} label={`${d.xp} / ${d.nextLevelXp} XP`} />
            <div className="text-xs muted mt-1">Your skill gives <b>+{d.bonusPct}%</b> output on every shift (2% per level, up to 40%). Earn XP by working shifts, doing office jobs and finishing quests.</div>
          </div>
        </div>
      </div>
      <div className="h2">Today's quests</div>
      <div className="grid md:grid-cols-3 gap-3">
        {d.quests.map((x: any) => (
          <div key={x.questId} className={`card flex flex-col gap-2 ${x.claimed ? 'opacity-60' : ''}`} data-testid={`quest-${x.questId}`}>
            <div className="text-3xl">{x.emoji}</div>
            <b>{x.label}</b>
            <ProgressBar value={x.progress} max={x.target} label={`${x.progress} / ${x.target}`} />
            <button className="btn-good btn-sm" disabled={x.claimed || x.progress < x.target || claim.isPending} onClick={() => claim.mutate(x.questId)}>{x.claimed ? '✅ Claimed' : `Claim ${d.reward} BT`}</button>
          </div>
        ))}
      </div>
      <p className="text-xs muted">New quests every game day (every 2 real hours).</p>
      <div className="h2">🏅 Company badges ({d.badges.earned} / {d.badges.total})</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {d.badges.badges.map((b: any) => (
          <div key={b.id} className={`card !p-2 flex flex-col gap-1 text-center ${b.earned ? '!bg-amber-50' : 'opacity-60 grayscale'}`}>
            <div className="text-3xl">{b.emoji}</div>
            <div className="text-xs font-bold">{b.label}</div>
            {!b.earned && <ProgressBar value={b.progress} max={b.target} />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================ Owner requests
/** Bits or goods the Owner asked this company for. Only the admin can answer. */
export function OwnerRequests() {
  const me = useMe2();
  const q = useApi<any[]>(['requests'], '/game/requests', { refetchInterval: 30_000 });
  const answer = useAction(({ id, a }: { id: string; a: 'pay' | 'decline' }) => POST(`/game/requests/${id}/${a}`), {
    invalidate: [['requests'], ['home'], ['me']],
    success: 'Answer sent to the Owner.',
  });
  const open = (q.data ?? []).filter((r) => r.status === 'pending' && r.dueAt > Date.now());
  if (!open.length) return null;
  return (
    <div className="card !bg-amber-50 flex flex-col gap-2" data-testid="owner-requests">
      <div className="h3">📬 The Owner is asking</div>
      {open.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2 border-t border-ink/10 pt-2">
          <div className="flex-1 min-w-[12rem]">
            <b>{r.title}</b>
            {r.message && <div className="text-sm italic">"{r.message}"</div>}
            <div className="text-xs muted">{r.kind === 'bits' ? formatBits(r.amount) : `${r.qty}× ${itemLabel(r.item)}`} · answer within {formatGameDuration(r.dueAt - Date.now())} ({timeLeft(r.dueAt)})</div>
          </div>
          {me.account.role === 'ADMIN' ? (
            <>
              <button className="btn-good btn-sm" disabled={answer.isPending} onClick={() => answer.mutate({ id: r.id, a: 'pay' })}>{r.kind === 'bits' ? `💸 Pay ${r.amount} BT` : '📦 Hand over'}</button>
              <button className="btn-ghost btn-sm" disabled={answer.isPending} onClick={() => answer.mutate({ id: r.id, a: 'decline' })}>🙅 Decline</button>
            </>
          ) : (
            <span className="text-xs muted">Your company admin can answer.</span>
          )}
        </div>
      ))}
    </div>
  );
}
