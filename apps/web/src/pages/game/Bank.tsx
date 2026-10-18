import { useState } from 'react';
import { formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST, idemKey } from '../../lib/api';
import { useStore } from '../../lib/store';
import { sfx } from '../../lib/sound';
import { LoadingJoke, Tabs, timeLeft, useNow, useConfirm, Bits, EmptyState, ProgressBar } from '../../components/ui';
import { useCan, useGameMe } from './GameLayout';

const POT_INFO: Record<string, { emoji: string; label: string; blurb: string }> = {
  main: { emoji: '👛', label: 'Main wallet', blurb: 'Spending money. Wages and purchases come from here.' },
  payroll: { emoji: '🧾', label: 'Payroll pot', blurb: 'Staff salaries come out of here first.' },
  savings: { emoji: '🐷', label: 'Savings pot', blurb: 'Earns interest every hour.' },
  investing: { emoji: '📈', label: 'Investing pot', blurb: 'Set aside for the Bit Exchange.' },
};

export function Bank() {
  const me = useGameMe();
  const ro = me.access.readOnly;
  const canTransfer = useCan('transfers');
  const q = useApi<any>(['bank'], '/game/bank', { refetchInterval: 15_000 });
  const [tab, setTab] = useState<'pots' | 'deposits' | 'transfer' | 'insurance' | 'lotto' | 'payroll' | 'history'>('pots');
  if (q.isLoading || !q.data) return <LoadingJoke />;
  const d = q.data;
  const tabs = [
    { id: 'pots' as const, label: '👛 Pots' },
    { id: 'deposits' as const, label: '🔒 Term deposits' },
    ...(canTransfer ? [{ id: 'transfer' as const, label: '🎁 Gift / transfer' }] : []),
    ...(d.insurance.enabled ? [{ id: 'insurance' as const, label: '☂️ Insurance' }] : []),
    ...(d.lotto.enabled ? [{ id: 'lotto' as const, label: '🎰 Bit Lotto' }] : []),
    ...(me.account.role === 'COMPANY_ADMIN' ? [{ id: 'payroll' as const, label: '🪪 Staff payroll' }] : []),
    { id: 'history' as const, label: '📜 History' },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="h1 mr-auto">🏦 Bit Bank</h1>
        <span className="chip">🏅 Credit score {d.creditScore}</span>
      </div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'pots' && <Pots d={d} ro={ro} />}
      {tab === 'deposits' && <Deposits d={d} ro={ro} />}
      {tab === 'transfer' && <Transfer d={d} ro={ro} />}
      {tab === 'insurance' && <Insurance d={d} ro={ro} />}
      {tab === 'lotto' && <Lotto d={d} ro={ro} />}
      {tab === 'payroll' && <Payroll ro={ro} />}
      {tab === 'history' && <History />}
    </div>
  );
}

function Pots({ d, ro }: { d: any; ro: boolean }) {
  const [from, setFrom] = useState('main');
  const [to, setTo] = useState('savings');
  const [amount, setAmount] = useState(100);
  const move = useAction(() => POST('/game/bank/pots', { from, to, amount, idempotencyKey: idemKey('pot') }), { invalidate: [['bank'], ['state']], success: 'Bits shuffled! 🐷' });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {Object.entries(POT_INFO).map(([k, p]) => (
          <div key={k} className="card !p-3">
            <div className="text-sm font-bold">{p.emoji} {p.label}</div>
            <div className="font-display font-extrabold text-2xl"><Bits n={d.pots[k] ?? 0} /></div>
            <div className="text-xs muted">{p.blurb}</div>
          </div>
        ))}
      </div>
      <p className="text-sm muted">Savings earn {(d.savingsRateBpsPerDay / 100).toFixed(2)}% per day (paid hourly, max {formatBits(d.savingsMax)} counted). Wealth tax: {(d.wealthTax.bpsPerDay / 100).toFixed(2)}%/day above {formatBits(d.wealthTax.threshold)}.</p>
      {!ro && (
        <div className="card flex flex-wrap gap-2 items-end">
          <label className="label">From<select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>{Object.keys(POT_INFO).map((p) => <option key={p}>{p}</option>)}</select></label>
          <label className="label">To<select className="input" value={to} onChange={(e) => setTo(e.target.value)}>{Object.keys(POT_INFO).map((p) => <option key={p}>{p}</option>)}</select></label>
          <label className="label">Amount<input type="number" className="input w-36" min={1} value={amount} onChange={(e) => setAmount(Math.max(1, Math.floor(Number(e.target.value))))} /></label>
          <button className="btn-primary" disabled={from === to || move.isPending} onClick={() => move.mutate(undefined)}>Move</button>
        </div>
      )}
    </div>
  );
}

function Deposits({ d, ro }: { d: any; ro: boolean }) {
  const [amount, setAmount] = useState(500);
  useNow(1000);
  const open = useAction((hours: number) => POST('/game/bank/deposits', { amount, hours }), { invalidate: [['bank'], ['state']], success: (r: any) => `Locked! You'll get +${r.interest} BT interest.` });
  return (
    <div className="flex flex-col gap-3">
      {!ro && (
        <div className="card">
          <div className="flex gap-2 items-end flex-wrap">
            <label className="label">Amount to lock<input type="number" className="input w-40" min={10} value={amount} onChange={(e) => setAmount(Math.max(10, Math.floor(Number(e.target.value))))} /></label>
            {d.termOptions.map((o: any) => (
              <button key={o.hours} className="btn-ghost" onClick={() => open.mutate(o.hours)}>
                {o.hours}h → +{(o.rateBps / 100).toFixed(1)}% (+{Math.floor((amount * o.rateBps) / 10000)} BT)
              </button>
            ))}
          </div>
          <p className="text-xs muted mt-2">Locked Bits can't be spent until the term ends. Longer locks pay more.</p>
        </div>
      )}
      {!d.deposits.length ? <EmptyState emoji="🔒" title="No deposits yet" body="Lock some Bits away and watch them grow (slowly, like a houseplant)." /> : d.deposits.map((x: any) => (
        <div key={x.id} className="card-flat flex items-center gap-2 text-sm">
          <span className="font-bold"><Bits n={x.amount} /></span>
          <span>@ {(x.rateBps / 100).toFixed(1)}%</span>
          <span className="ml-auto chip">{x.status === 'active' ? `⏳ ${timeLeft(x.maturesAt)}` : '✅ paid'}</span>
        </div>
      ))}
    </div>
  );
}

function Transfer({ d, ro }: { d: any; ro: boolean }) {
  const rec = useApi<any[]>(['recipients'], '/game/transfers/recipients');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState(100);
  const [memo, setMemo] = useState('');
  const confirm = useConfirm();
  const send = useAction(() => POST('/game/transfers', { toCompanyId: to, amount, memo, idempotencyKey: idemKey('gift') }), {
    invalidate: [['bank'], ['state']],
    onSuccess: (r) => {
      sfx.coin();
      useStore.getState().say(`Gift sent! (Fee: ${r.fee} BT to the Treasury.) Generosity looks good on you.`);
    },
  });
  const fee = Math.max(1, Math.floor((amount * d.transfer.feeBps) / 10000));
  return (
    <div className="card flex flex-col gap-2 max-w-lg">
      <p className="text-sm muted">Allowed recipients: <b>{d.transfer.recipients}</b> · Daily limit: <b>{d.transfer.maxPerDay == null ? '∞' : formatBits(d.transfer.maxPerDay)}</b> · Sent today: {formatBits(d.transfer.sentToday)} · Fee {(d.transfer.feeBps / 100).toFixed(1)}%</p>
      <select className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Recipient">
        <option value="">Pick a company</option>
        {(rec.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
      </select>
      <input type="number" className="input" min={1} value={amount} onChange={(e) => setAmount(Math.max(1, Math.floor(Number(e.target.value))))} aria-label="Amount" />
      <input className="input" placeholder="Memo (optional)" maxLength={120} value={memo} onChange={(e) => setMemo(e.target.value)} />
      <button className="btn-pink" disabled={ro || !to || send.isPending} onClick={async () => (amount < 1000 || (await confirm({ title: 'Send a big gift?', body: <>Send <Bits n={amount} /> (+{fee} BT fee)?</> }))) && send.mutate(undefined)}>
        🎁 Send {formatBits(amount)} (+{fee} fee)
      </button>
    </div>
  );
}

function Insurance({ d, ro }: { d: any; ro: boolean }) {
  useNow(5000);
  const buy = useAction((kind: string) => POST('/game/bank/insurance', { kind }), { invalidate: [['bank'], ['state']], success: (r: any) => (r.extended ? 'Policy extended! ☂️' : 'You are covered! ☂️') });
  return (
    <div className="grid sm:grid-cols-3 gap-3">
      {Object.entries(d.insurance.kinds).map(([k, v]: any) => {
        const active = d.insurance.policies.find((p: any) => p.kind === k && p.activeUntil > Date.now());
        return (
          <div key={k} className="card flex flex-col gap-1">
            <div className="h3">☂️ {v.name}</div>
            <div className="text-sm">Covers: {v.covers.join(', ')}</div>
            <div className="text-sm">Pays {Math.round(d.insurance.payoutRatio * 100)}% of the loss</div>
            <div className="font-bold">{formatBits(v.premium)} / {d.insurance.durationMs / 3600000}h</div>
            {active && <span className="chip !bg-good/20">Active · {timeLeft(active.activeUntil)} · {active.claims} claims</span>}
            {!ro && <button className="btn-primary btn-sm mt-auto" onClick={() => buy.mutate(k)}>{active ? 'Extend' : 'Buy cover'}</button>}
          </div>
        );
      })}
    </div>
  );
}

function Lotto({ d, ro }: { d: any; ro: boolean }) {
  const [last, setLast] = useState<number | null>(null);
  const buy = useAction(() => POST('/game/bank/lotto'), {
    invalidate: [['bank'], ['state']],
    onSuccess: (r) => {
      setLast(r.won);
      if (r.won) {
        sfx.bigCoin();
        useStore.getState().confetti();
      } else sfx.error();
    },
  });
  return (
    <div className="card max-w-md flex flex-col gap-2 text-center">
      <div className="text-6xl">🎰</div>
      <div className="h2">Bit Lotto</div>
      <p className="text-sm">Ticket: {formatBits(d.lotto.ticketCost)} · Max {d.lotto.maxTicketsPerDay}/day · Bought today: {d.lotto.boughtToday}</p>
      <table className="table-clean text-sm">
        <tbody>{d.lotto.prizes.map((p: any) => <tr key={p.bits}><td>{formatBits(p.bits)}</td><td className="text-right">{(p.chance * 100).toFixed(1)}%</td></tr>)}</tbody>
      </table>
      <p className="text-xs muted">Fictional Bits only. The house (the Treasury) always wins on average. Odds shown openly.</p>
      {last !== null && <div className="font-display font-extrabold text-xl">{last ? `🎉 You won ${formatBits(last)}!` : '😅 No luck this time.'}</div>}
      <button className="btn-pink" disabled={ro || d.lotto.boughtToday >= d.lotto.maxTicketsPerDay || buy.isPending} onClick={() => buy.mutate(undefined)}>Buy a ticket</button>
    </div>
  );
}

function Payroll({ ro }: { ro: boolean }) {
  const q = useApi<any[]>(['staff-wallets'], '/game/bank/staff');
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const pay = useAction((id: string) => POST(`/game/bank/staff/${id}/pay`, { amount: amounts[id] ?? 100, memo: 'Salary', idempotencyKey: idemKey('pay') }), { invalidate: [['staff-wallets'], ['bank'], ['state']], success: 'Paid! 💸' });
  if (!q.data) return <LoadingJoke />;
  if (!q.data.length) return <EmptyState emoji="🪪" title="No staff logins" body="Create staff logins in Company Settings, then pay them salaries here." />;
  return (
    <div className="flex flex-col gap-2">
      {q.data.map((s) => (
        <div key={s.id} className="card-flat flex items-center gap-2 flex-wrap">
          <span className="font-bold">{s.displayName}</span><span className="chip">{s.jobTitle}</span>
          <span className="text-sm">wallet <Bits n={s.balance} /></span>
          {!ro && (
            <span className="ml-auto flex gap-2">
              <input type="number" min={1} className="input w-28 !min-h-[36px]" value={amounts[s.id] ?? 100} onChange={(e) => setAmounts({ ...amounts, [s.id]: Math.max(1, Math.floor(Number(e.target.value))) })} aria-label="Amount" />
              <button className="btn-good btn-sm" onClick={() => pay.mutate(s.id)}>Pay</button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function History() {
  const [kind, setKind] = useState('');
  const q = useApi<any[]>(['bank-history', kind], `/game/bank/history?limit=200${kind ? `&kind=${kind}` : ''}`);
  return (
    <div className="flex flex-col gap-2">
      <select className="input w-auto self-start" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filter">
        <option value="">All movements</option>
        <option value="income">💰 Income</option>
        <option value="spend">🛍️ Spending</option>
        <option value="cost">🧾 Wages & costs</option>
        <option value="reward">🎁 Rewards</option>
        <option value="transfer">🤝 Transfers</option>
        <option value="sale">📦 Sales</option>
        <option value="trade">📈 Trades</option>
        <option value="loan">💸 Loans</option>
      </select>
      <div className="card !p-0 overflow-x-auto">
        <table className="table-clean text-sm">
          <thead><tr><th>When</th><th>What</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {(q.data ?? []).map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap text-xs">{new Date(e.createdAt).toLocaleTimeString()}</td>
                <td>{e.kind}</td>
                <td className={`text-right font-bold tabular-nums ${e.direction === 'in' ? 'text-good' : e.direction === 'out' ? 'text-bad' : 'muted'}`}>{e.direction === 'in' ? '+' : e.direction === 'out' ? '-' : '↔'}{e.amount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Loans() {
  const me = useGameMe();
  const ro = me.access.readOnly;
  const q = useApi<any>(['loans'], '/game/loans', { refetchInterval: 20_000 });
  const [amount, setAmount] = useState(500);
  const [peer, setPeer] = useState({ amount: 1000, rate: 500 });
  const confirm = useConfirm();
  useNow(5000);
  const take = useAction(() => POST('/game/loans', { amount }), { invalidate: [['loans'], ['state'], ['bank']], success: 'Loan approved! Spend it wisely. 💸' });
  const repay = useAction((id: string) => POST(`/game/loans/${id}/repay`, { amount: 'all' }), { invalidate: [['loans'], ['state']], success: 'Paid off! Credit score +' });
  const offer = useAction(() => POST('/game/loans/peer', { amount: peer.amount, rateBps: peer.rate }), { invalidate: [['loans'], ['state']], success: 'Loan offer posted!' });
  const accept = useAction((id: string) => POST(`/game/loans/peer/${id}/accept`), { invalidate: [['loans'], ['state']], success: 'Borrowed from a fellow player!' });
  const cancel = useAction((id: string) => POST(`/game/loans/peer/${id}/cancel`), { invalidate: [['loans'], ['state']] });
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="h1">💸 Loans</h1>
      <div className="card">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <div className="text-sm font-bold">🏅 Credit score</div>
            <div className="font-display font-extrabold text-3xl">{d.offer.creditScore}</div>
          </div>
          <ProgressBar className="flex-1 min-w-[160px]" value={d.offer.creditScore - 300} max={550} label="300 ... 850" color="bg-good" />
        </div>
        <p className="text-sm mt-2">The Treasury will lend you up to <b>{formatBits(d.offer.max)}</b> at <b>{(d.offer.rateBps / 100).toFixed(1)}%</b> flat interest, repaid in {d.offer.installments} installments every {d.offer.installmentMinutes} min. Missed payments add late fees; {3} misses = default (ouch).</p>
        {!ro && (
          <div className="flex gap-2 mt-2">
            <input type="number" className="input w-40" min={10} max={d.offer.max} value={amount} onChange={(e) => setAmount(Math.max(10, Math.floor(Number(e.target.value))))} aria-label="Loan amount" />
            <button className="btn-primary" disabled={amount > d.offer.max || take.isPending} onClick={async () => (await confirm({ title: `Borrow ${formatBits(amount)}?`, body: `You'll repay ${formatBits(Math.ceil(amount * (1 + d.offer.rateBps / 10000)))} in total.` })) && take.mutate(undefined)}>Borrow</button>
          </div>
        )}
      </div>
      <h2 className="h2">Your loans</h2>
      {!d.borrowed.length ? <EmptyState emoji="🧾" title="Debt free!" body="Boss Byte is proud of you. Or you haven't needed money yet." /> : d.borrowed.map((l: any) => (
        <div key={l.id} className="card-flat flex items-center gap-2 flex-wrap text-sm">
          <span className="chip">{l.lenderType === 'treasury' ? '🏦 Treasury' : '🤝 Peer'}</span>
          <span>Borrowed <Bits n={l.principal} /></span>
          <span>Owed <Bits n={l.outstanding} /></span>
          <span className="chip">{l.status}{l.status === 'active' ? ` · next ${timeLeft(l.nextDueAt)}` : ''}</span>
          {l.missed > 0 && <span className="chip !bg-bad/20">missed {l.missed}</span>}
          {!ro && l.status === 'active' && <button className="btn-good btn-sm ml-auto" onClick={() => repay.mutate(l.id)}>Repay all</button>}
        </div>
      ))}
      {me.flags.peerLending && (
        <div className="card">
          <h2 className="h2 mb-2">🤝 Peer lending</h2>
          {!ro && (
            <div className="flex gap-2 flex-wrap items-end mb-3">
              <label className="label">Lend<input type="number" className="input w-32" value={peer.amount} onChange={(e) => setPeer({ ...peer, amount: Math.max(10, Math.floor(Number(e.target.value))) })} /></label>
              <label className="label">Interest %<input type="number" className="input w-24" value={peer.rate / 100} onChange={(e) => setPeer({ ...peer, rate: Math.max(0, Math.min(3000, Math.round(Number(e.target.value) * 100))) })} /></label>
              <button className="btn-ghost" onClick={() => offer.mutate(undefined)}>Post offer</button>
            </div>
          )}
          <div className="text-sm font-bold mb-1">Offers from other players</div>
          {!d.offers.length ? <p className="text-sm muted">No offers right now.</p> : d.offers.map((l: any) => (
            <div key={l.id} className="card-flat flex items-center gap-2 text-sm mb-1">
              <Bits n={l.principal} /> at {(l.rateBps / 100).toFixed(1)}% <button className="btn-primary btn-sm ml-auto" disabled={ro} onClick={() => accept.mutate(l.id)}>Borrow</button>
            </div>
          ))}
          <div className="text-sm font-bold mt-2 mb-1">Your lending</div>
          {d.lent.map((l: any) => (
            <div key={l.id} className="card-flat flex items-center gap-2 text-sm mb-1">
              <Bits n={l.principal} /> at {(l.rateBps / 100).toFixed(1)}% · {l.status} · owed <Bits n={l.outstanding} />
              {l.status === 'offered' && !ro && <button className="btn-ghost btn-sm ml-auto" onClick={() => cancel.mutate(l.id)}>Cancel</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
