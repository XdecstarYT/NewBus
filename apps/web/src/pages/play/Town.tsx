import { useState } from 'react';
import { FACILITIES, ITEM_IDS, LOAN_LIMITS, creditLabel, formatGameDuration, type Boost, type FacilityId } from '@dw/shared/live';
import { POST } from '../../lib/api';
import { useApi, useAction } from '../../lib/hooks';
import { formatBits, item, itemLabel } from '../../lib/game';
import { sfx } from '../../lib/sound';
import { useStore } from '../../lib/store';
import { EmptyState, LoadingJoke, Modal, ProgressBar, Tabs, timeAgo, timeLeft } from '../../components/ui';
import { useMe2 } from '../Layout';

/** "+30% farm output", "customers pay +50% for lattes"... */
export function boostText(b: Boost) {
  const sign = b.pct >= 0 ? '+' : '';
  switch (b.kind) {
    case 'output':
      return `${sign}${b.pct}% output at ${b.facility ? (FACILITIES[b.facility as FacilityId]?.name ?? b.facility) : 'every facility'}`;
    case 'customers':
      return `Customers pay ${sign}${b.pct}% for ${b.item ? itemLabel(b.item) : 'everything'}`;
    case 'regen':
      return `+${b.pct} Energy/hour for everyone`;
    case 'taxfree':
      return 'No sales tax';
    case 'quests':
      return `Daily quests pay ${sign}${b.pct}%`;
  }
}

// ============================================================ town
export function Town() {
  const me = useMe2();
  const q = useApi<any>(['town'], '/game/town', { refetchInterval: 20_000 });
  const home = useApi<any>(['home'], me.company ? '/game/home' : null);
  const [giving, setGiving] = useState<any>(null);
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  const open = d.projects.filter((p: any) => p.status === 'open');
  const past = d.projects.filter((p: any) => p.status !== 'open');
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">🏙️ Town</h1>
      <div className="card flex flex-col gap-1" data-testid="today-event">
        <div className="text-xs muted">Game day {d.day} · a new event every game day (2 real hours)</div>
        {d.event ? (
          <div className="flex items-center gap-3"><span className="text-5xl">{d.event.emoji}</span><div><div className="h2">{d.event.title}</div><p className="text-sm">{d.event.blurb}</p></div></div>
        ) : (
          <div className="text-sm muted">No world event right now.</div>
        )}
      </div>
      {d.boosts.length > 0 && (
        <div className="card flex flex-col gap-1">
          <div className="h3">✨ Active boosts</div>
          {d.boosts.map((b: Boost) => <div key={b.id} className="text-sm flex gap-2"><span>{b.emoji}</span><b>{boostText(b)}</b><span className="muted flex-1">· {b.label}</span><span className="text-xs muted">{formatGameDuration(b.until - Date.now())} left</span></div>)}
        </div>
      )}
      <div className="h2">🏗️ Town projects</div>
      <p className="text-sm muted">Everyone chips in goods and Bits. When a project is finished, the whole town gets its boost. Helping earns prestige; the biggest helper makes the news. If time runs out, everything is handed back.</p>
      {!open.length && <EmptyState emoji="🏗️" title="No projects right now" body="The Owner starts new town projects." />}
      <div className="grid md:grid-cols-2 gap-3">
        {open.map((p: any) => (
          <div key={p.id} className="card flex flex-col gap-2" data-testid={`project-${p.id}`}>
            <div className="flex items-center gap-2"><span className="text-4xl">{p.emoji}</span><div className="flex-1"><div className="h3">{p.title}</div><div className="text-xs muted">{p.blurb} Lasts {p.days} game day{p.days === 1 ? '' : 's'}.</div></div></div>
            {p.needBits > 0 && <ProgressBar value={p.haveBits} max={p.needBits} label={`🪙 ${p.haveBits} / ${p.needBits} BT`} />}
            {Object.entries(p.needItems as Record<string, number>).map(([k, v]) => <ProgressBar key={k} value={p.haveItems[k] ?? 0} max={v} label={`${itemLabel(k)} ${p.haveItems[k] ?? 0} / ${v}`} color="bg-emerald-500" />)}
            <div className="text-xs muted">⏳ {formatGameDuration(p.deadline - Date.now())} left ({timeLeft(p.deadline)}){p.myPoints ? ` · your help: ${p.myPoints} points` : ''}</div>
            {p.top.length > 0 && <div className="text-xs">🏅 {p.top.map((t: any) => `${t.company?.emoji} ${t.company?.name} (${t.points})`).join(' · ')}</div>}
            {me.company && <button className="btn-primary" onClick={() => setGiving(p)} data-testid="give">🤝 Chip in</button>}
          </div>
        ))}
      </div>
      {past.length > 0 && (
        <div className="card">
          <div className="h3 mb-1">Past projects</div>
          {past.map((p: any) => <div key={p.id} className="text-sm py-0.5">{p.emoji} {p.title} · {p.status === 'done' ? '✅ built' : '⌛ not finished'} <span className="text-xs muted">{timeAgo(p.doneAt)}</span></div>)}
        </div>
      )}
      {giving && <Give p={giving} inventory={home.data?.inventory ?? {}} onClose={() => setGiving(null)} />}
    </div>
  );
}

function Give({ p, inventory, onClose }: { p: any; inventory: Record<string, number>; onClose: () => void }) {
  const confetti = useStore((s) => s.confetti);
  const [bits, setBits] = useState(0);
  const give = useAction((v: { bits?: number; item?: string; qty?: number }) => POST<any>(`/game/projects/${p.id}/give`, v), {
    invalidate: [['town'], ['home'], ['me']],
    success: (r) => (r.done ? `🎉 Project finished! Thanks for helping.` : `Thanks! +${r.points} points.`),
    onSuccess: (r) => (r.done ? (sfx.levelUp(), confetti()) : sfx.coin(), onClose()),
  });
  return (
    <Modal open onClose={onClose} title={`🤝 Chip in: ${p.emoji} ${p.title}`}>
      <div className="flex flex-col gap-3">
        {Object.entries(p.needItems as Record<string, number>).map(([k, v]) => {
          const left = v - (p.haveItems[k] ?? 0);
          const have = inventory[k] ?? 0;
          const n = Math.min(left, have);
          return (
            <div key={k} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{itemLabel(k)}: still needs {left}, you have {have}</span>
              <button className="btn-good btn-sm" disabled={n < 1 || give.isPending} onClick={() => give.mutate({ item: k, qty: n })}>Give {n}</button>
            </div>
          );
        })}
        {p.needBits > p.haveBits && (
          <form className="flex items-center gap-2" onSubmit={(e) => (e.preventDefault(), give.mutate({ bits }))}>
            <input type="number" className="input flex-1" min={1} value={bits || ''} placeholder={`Bits (still needs ${p.needBits - p.haveBits})`} onChange={(e) => setBits(Math.max(0, Math.floor(Number(e.target.value) || 0)))} aria-label="Bits to give" />
            <button className="btn-good btn-sm" disabled={bits < 1 || give.isPending}>Give Bits</button>
          </form>
        )}
      </div>
    </Modal>
  );
}

// ============================================================ bank
const LOAN_STATUS: Record<string, string> = { open: '📢 Open', active: '⏳ Running', repaid: '✅ Repaid', defaulted: '💔 Defaulted', cancelled: '🚫 Withdrawn', expired: '⌛ Nobody took it' };

export function Bank() {
  const me = useMe2();
  const q = useApi<any>(['bank'], '/game/bank', { refetchInterval: 30_000 });
  const companies = useApi<any[]>(['companies'], '/game/companies');
  const [tab, setTab] = useState<'board' | 'mine' | 'new'>('board');
  const [f, setF] = useState({ side: 'offer' as 'offer' | 'request', amount: 500, interestPct: 10, days: 3, note: '', offeredTo: '' });
  const [pay, setPay] = useState<Record<string, number>>({});
  const inv = [['bank'], ['home'], ['me']];
  const create = useAction(() => POST('/game/loans', { ...f, offeredTo: f.offeredTo || null }), { invalidate: inv, success: '🏦 Posted!', onSuccess: () => setTab('mine') });
  const act = useAction(({ id, a, amount }: { id: string; a: string; amount?: number }) => POST<any>(`/game/loans/${id}/${a}`, amount ? { amount } : {}), {
    invalidate: inv,
    success: (r) => (r?.owed ? `🤝 Deal! ${r.owed} BT to pay back.` : r?.done ? '✅ Loan repaid in full!' : r?.paid ? `Paid ${r.paid} BT. ${r.left} BT to go.` : 'Done.'),
    onSuccess: () => sfx.coin(),
  });
  if (!q.data) return <LoadingJoke />;
  const id = me.company!.id;
  const board = q.data.loans.filter((l: any) => l.status === 'open' && l.lenderId !== id && l.borrowerId !== id);
  const mine = q.data.loans.filter((l: any) => l.lenderId === id || l.borrowerId === id);
  const c = q.data.myCredit;
  const row = (l: any) => {
    const iBorrow = l.borrowerId === id;
    return (
      <div key={l.id} className="card flex flex-col gap-1" data-testid={`loan-${l.id}`}>
        <div className="flex items-center gap-2">
          <span className="text-3xl">{l.side === 'offer' ? '💰' : '🙏'}</span>
          <div className="flex-1">
            <b>{formatBits(l.amount)}</b> at <b>{l.interestPct}%</b> for {l.days} game day{l.days === 1 ? '' : 's'} → pay back <b>{formatBits(l.owed)}</b>
            <div className="text-xs muted">{l.lender ? `Lender: ${l.lender.emoji} ${l.lender.name}` : 'Looking for a lender'} · {l.borrower ? `Borrower: ${l.borrower.emoji} ${l.borrower.name}${l.borrowerCredit ? ` (credit ${l.borrowerCredit.score}, ${l.borrowerCredit.label})` : ''}` : 'Looking for a borrower'}</div>
          </div>
          <span className="chip text-xs">{LOAN_STATUS[l.status]}</span>
        </div>
        {l.note && <div className="text-sm italic">"{l.note}"</div>}
        {l.status === 'active' && <ProgressBar value={l.repaid} max={l.owed} label={`Repaid ${l.repaid} / ${l.owed} BT · due in ${formatGameDuration(l.dueAt - Date.now())}`} />}
        <div className="flex flex-wrap gap-2">
          {l.status === 'open' && l.lenderId !== id && l.borrowerId !== id && <button className="btn-primary btn-sm" onClick={() => act.mutate({ id: l.id, a: 'accept' })}>{l.side === 'offer' ? '🤝 Borrow this' : `💸 Lend ${l.amount} BT`}</button>}
          {l.status === 'open' && (l.lenderId === id || l.borrowerId === id) && <button className="btn-ghost btn-sm" onClick={() => act.mutate({ id: l.id, a: 'cancel' })}>Withdraw</button>}
          {l.status === 'active' && iBorrow && (
            <>
              <input type="number" className="input !w-28" min={1} value={pay[l.id] ?? l.owed - l.repaid} onChange={(e) => setPay({ ...pay, [l.id]: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} aria-label="Amount to repay" />
              <button className="btn-good btn-sm" onClick={() => act.mutate({ id: l.id, a: 'repay', amount: pay[l.id] ?? l.owed - l.repaid })}>💸 Repay</button>
            </>
          )}
        </div>
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">🏦 Bank</h1>
      <p className="text-sm muted">Lend Bits to other players for interest, or borrow to grow faster. Loans are due after a number of game days. Overdue loans are collected automatically from whatever the borrower has; anything missing is a default, which hurts their credit and lets the lender sue.</p>
      <div className="card flex items-center gap-3">
        <div className="text-4xl font-black">{c.score}</div>
        <div><b>Your credit: {creditLabel(c.score)}</b><div className="text-xs muted">{c.repaid} loan{c.repaid === 1 ? '' : 's'} repaid · {c.defaulted} default{c.defaulted === 1 ? '' : 's'}</div></div>
      </div>
      <Tabs tabs={[{ id: 'board', label: `📢 Loan board (${board.length})` }, { id: 'mine', label: `📒 My loans (${mine.filter((l: any) => ['open', 'active'].includes(l.status)).length})` }, { id: 'new', label: '➕ New' }]} value={tab} onChange={setTab} />
      {tab === 'board' && (board.length ? <div className="grid md:grid-cols-2 gap-3">{board.map(row)}</div> : <EmptyState emoji="🏦" title="No loans on offer" body="Post an offer or ask for a loan." />)}
      {tab === 'mine' && (mine.length ? <div className="grid md:grid-cols-2 gap-3">{mine.map(row)}</div> : <EmptyState emoji="📒" title="No loans yet" />)}
      {tab === 'new' && (
        <form className="card flex flex-col gap-2 max-w-xl" onSubmit={(e) => (e.preventDefault(), create.mutate(undefined))}>
          <div className="flex gap-2">
            <button type="button" className={f.side === 'offer' ? 'btn-primary flex-1' : 'btn-ghost flex-1'} onClick={() => setF({ ...f, side: 'offer' })} aria-pressed={f.side === 'offer'}>💰 I want to lend</button>
            <button type="button" className={f.side === 'request' ? 'btn-primary flex-1' : 'btn-ghost flex-1'} onClick={() => setF({ ...f, side: 'request' })} aria-pressed={f.side === 'request'}>🙏 I want to borrow</button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="label">Amount (BT)<input type="number" className="input" min={1} max={LOAN_LIMITS.maxAmount} value={f.amount} onChange={(e) => setF({ ...f, amount: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} /></label>
            <label className="label">Interest %<input type="number" className="input" min={0} max={LOAN_LIMITS.maxInterestPct} value={f.interestPct} onChange={(e) => setF({ ...f, interestPct: Math.max(0, Math.min(100, Math.floor(Number(e.target.value) || 0))) })} /></label>
            <label className="label">Game days<input type="number" className="input" min={1} max={30} value={f.days} onChange={(e) => setF({ ...f, days: Math.max(1, Math.min(30, Math.floor(Number(e.target.value) || 1))) })} /></label>
          </div>
          <label className="label">Only for<select className="input" value={f.offeredTo} onChange={(e) => setF({ ...f, offeredTo: e.target.value })}><option value="">Anyone</option>{(companies.data ?? []).filter((x) => x.id !== id).map((x) => <option key={x.id} value={x.id}>{x.emoji} {x.name}</option>)}</select></label>
          <label className="label">Note<input className="input" maxLength={200} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={f.side === 'offer' ? 'Fair rates, friendly lender!' : 'Need it for a new sawmill'} /></label>
          <div className="text-sm">Pay back: <b>{formatBits(f.amount + Math.round((f.amount * f.interestPct) / 100))}</b> within {f.days} game day{f.days === 1 ? '' : 's'} ({f.days * 2} real hours). {f.side === 'offer' ? 'Your Bits wait in the bank until someone borrows them.' : 'You get the Bits when a lender accepts.'}</div>
          <button className="btn-primary" disabled={create.isPending}>{f.side === 'offer' ? '💰 Post loan offer' : '🙏 Ask for a loan'}</button>
        </form>
      )}
    </div>
  );
}

// ============================================================ auctions
export function Auctions() {
  const me = useMe2();
  const q = useApi<any[]>(['auctions'], '/game/auctions', { refetchInterval: 15_000 });
  const home = useApi<any>(['home'], me.company ? '/game/home' : null);
  const [bids, setBids] = useState<Record<string, number>>({});
  const [f, setF] = useState({ item: 'steel', qty: 10, startPrice: 100, hours: 6, note: '' });
  const [creating, setCreating] = useState(false);
  const inv = [['auctions'], ['home'], ['me']];
  const bid = useAction(({ id, amount }: { id: string; amount: number }) => POST<any>(`/game/auctions/${id}/bid`, { amount }), {
    invalidate: inv,
    success: (r) => (r.extended ? '🔨 Top bid! (Late bid: the clock got extra time.)' : '🔨 You have the top bid!'),
    onSuccess: () => sfx.coin(),
  });
  const create = useAction(() => POST('/game/auctions', f), { invalidate: inv, success: '🔨 Auction started!', onSuccess: () => setCreating(false) });
  const cancel = useAction((id: string) => POST(`/game/auctions/${id}/cancel`), { invalidate: inv, success: 'Auction cancelled; your goods are back.' });
  if (!q.data) return <LoadingJoke />;
  const open = q.data.filter((a) => a.status === 'open' && a.endsAt > Date.now());
  const done = q.data.filter((a) => !(a.status === 'open' && a.endsAt > Date.now()));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2"><h1 className="h1 flex-1">🔨 Auctions</h1>{me.company && <button className="btn-primary" onClick={() => setCreating(true)} data-testid="new-auction">➕ Sell by auction</button>}</div>
      <p className="text-sm muted">Highest bid wins when the clock runs out. Your bid is held until someone outbids you, then it comes straight back. A bid in the last 30 game minutes adds time, so no sniping!</p>
      {!open.length && <EmptyState emoji="🔨" title="No auctions running" body="Put something up for auction!" />}
      <div className="grid md:grid-cols-2 gap-3">
        {open.map((a) => (
          <div key={a.id} className={`card flex flex-col gap-2 ${a.leading ? '!bg-emerald-50' : ''}`} data-testid={`auction-${a.id}`}>
            <div className="flex items-center gap-2">
              <span className="text-4xl">{item(a.item).emoji}</span>
              <div className="flex-1"><b>{a.qty}× {item(a.item).name}</b><div className="text-xs muted">by {a.seller ? `${a.seller.emoji} ${a.seller.name}` : '👑 The Owner'} · ends in {formatGameDuration(a.endsAt - Date.now())} ({timeLeft(a.endsAt)})</div></div>
              <div className="text-right"><b className="text-lg">{formatBits(a.topBid ?? a.startPrice)}</b><div className="text-xs muted">{a.topBid ? `${a.bids} bid${a.bids === 1 ? '' : 's'} · ${a.topBidder?.emoji} ${a.topBidder?.name}` : 'starting price'}</div></div>
            </div>
            {a.note && <div className="text-sm italic">"{a.note}"</div>}
            {a.leading && <div className="text-sm font-bold text-emerald-700">🏆 You're winning!</div>}
            {me.company && !a.mine && !a.leading && (
              <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), bid.mutate({ id: a.id, amount: bids[a.id] ?? a.minBid }))}>
                <input type="number" className="input flex-1" min={a.minBid} value={bids[a.id] ?? a.minBid} onChange={(e) => setBids({ ...bids, [a.id]: Math.floor(Number(e.target.value) || 0) })} aria-label="Your bid" />
                <button className="btn-primary btn-sm" disabled={bid.isPending} data-testid="bid">🔨 Bid</button>
              </form>
            )}
            {a.mine && !a.topBid && <button className="btn-ghost btn-sm self-start" onClick={() => cancel.mutate(a.id)}>Cancel auction</button>}
          </div>
        ))}
      </div>
      {done.length > 0 && (
        <div className="card">
          <div className="h3 mb-1">Recently ended</div>
          {done.map((a) => <div key={a.id} className="text-sm py-0.5">{item(a.item).emoji} {a.qty}× {item(a.item).name} · {a.status === 'sold' || (a.status === 'open' && a.topBid) ? `${formatBits(a.topBid)} to ${a.topBidder?.emoji} ${a.topBidder?.name}` : a.status === 'cancelled' ? 'cancelled' : 'no bids'}</div>)}
        </div>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="🔨 Sell by auction">
        <form className="flex flex-col gap-2" onSubmit={(e) => (e.preventDefault(), create.mutate(undefined))}>
          <div className="grid grid-cols-2 gap-2">
            <label className="label">Item<select className="input" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })}>{ITEM_IDS.map((i) => <option key={i} value={i}>{itemLabel(i)} (you have {home.data?.inventory?.[i] ?? 0})</option>)}</select></label>
            <label className="label">How many<input type="number" className="input" min={1} value={f.qty} onChange={(e) => setF({ ...f, qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} /></label>
            <label className="label">Starting price (whole lot)<input type="number" className="input" min={1} value={f.startPrice} onChange={(e) => setF({ ...f, startPrice: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} /></label>
            <label className="label">Runs for (game hours)<input type="number" className="input" min={1} max={72} value={f.hours} onChange={(e) => setF({ ...f, hours: Math.max(1, Math.min(72, Number(e.target.value) || 1)) })} /></label>
          </div>
          <label className="label">Note<input className="input" maxLength={200} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Top quality, fresh from the foundry" /></label>
          <div className="text-xs muted">The goods leave your warehouse now and come back if nobody bids. You pay the usual sales tax on the winning bid.</div>
          <button className="btn-primary" disabled={create.isPending || (home.data?.inventory?.[f.item] ?? 0) < f.qty}>🔨 Start auction</button>
        </form>
      </Modal>
    </div>
  );
}
