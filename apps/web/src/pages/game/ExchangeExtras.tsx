import { useState } from 'react';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { useGameMe } from './GameLayout';

/** Company Settings card: request an IPO on the Bit Exchange (the owner approves). */
export function IpoRequestCard() {
  const me = useGameMe();
  const q = useApi<any>(['exchange'], '/game/exchange');
  const [f, setF] = useState({ shares: 10000, price: 25, founderPct: 60, pitch: '' });
  const req = useAction(() => POST('/game/exchange/ipo', f), { invalidate: [['exchange']], success: 'IPO request sent to the Owner! 🔔' });
  const sug = useApi<{ price: number }>(['ipo-suggestion', f.shares], `/game/exchange/ipo-suggestion?shares=${f.shares}`);
  if (!q.data) return null;
  const status = q.data.ipoStatus;
  return (
    <div className="card">
      <h2 className="h2 mb-2">🔔 Go public on the Bit Exchange</h2>
      {status === 'listed' && q.data.myStock && <p>You're listed as <b>${q.data.myStock.symbol}</b> at {q.data.myStock.price} BT. Check the Exchange!</p>}
      {status === 'requested' && <p>⏳ Your IPO request is waiting for the Owner's approval.</p>}
      {(status === 'none' || status === 'rejected') && (
        <div className="flex flex-col gap-2">
          {status === 'rejected' && <p className="text-sm text-bad font-bold">Your last request was declined. You can try again.</p>}
          <p className="text-sm muted">Players will be able to buy your shares; the IPO proceeds come to you. Your stock price follows how well your company really does.</p>
          <div className="grid sm:grid-cols-3 gap-2">
            <label className="label">Shares<input type="number" className="input" value={f.shares} min={100} onChange={(e) => setF({ ...f, shares: Math.max(100, Math.floor(Number(e.target.value))) })} /></label>
            <label className="label">Price (BT)<input type="number" className="input" value={f.price} min={1} onChange={(e) => setF({ ...f, price: Math.max(1, Math.floor(Number(e.target.value))) })} /></label>
            <label className="label">Founder keeps %<input type="number" className="input" value={f.founderPct} min={20} max={95} onChange={(e) => setF({ ...f, founderPct: Math.max(20, Math.min(95, Math.floor(Number(e.target.value)))) })} /></label>
          </div>
          {sug.data && (
            <p className="text-xs">
              🤖 Boss Byte's fair price from your fundamentals: <b>{sug.data.price} BT</b>.{' '}
              <button className="underline" onClick={() => setF({ ...f, price: sug.data!.price })}>Use it</button> (price far above this will slide toward it after listing).
            </p>
          )}
          <textarea className="input min-h-[60px]" placeholder="Your pitch to the Owner (why should you list?)" maxLength={300} value={f.pitch} onChange={(e) => setF({ ...f, pitch: e.target.value })} />
          <button className="btn-primary" disabled={me.access.readOnly || req.isPending} onClick={() => req.mutate(undefined)} data-testid="request-ipo">Request IPO</button>
        </div>
      )}
    </div>
  );
}
