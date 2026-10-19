import { useState } from 'react';
import { useAction, useMe } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { ChangePasswordForm } from '../ChangePassword';

/** Owner's own account: change password and set up two-factor login codes. */
export function MyAccount() {
  const me = useMe();
  const [setup, setSetup] = useState<{ secret: string; url: string } | null>(null);
  const [code, setCode] = useState('');
  const inv = [['me']];
  const start = useAction(() => POST<{ secret: string; url: string }>('/owner/totp/setup'), { onSuccess: (r) => setSetup(r) });
  const enable = useAction(() => POST('/owner/totp/enable', { code }), { invalidate: inv, success: '🔐 Two-factor login is on.', onSuccess: () => { setSetup(null); setCode(''); } });
  const disable = useAction(() => POST('/owner/totp/disable', { code }), { invalidate: inv, success: 'Two-factor login is off.', onSuccess: () => setCode('') });
  const on = !!me.data?.account.totpEnabled;
  return (
    <div className="grid md:grid-cols-2 gap-4 max-w-4xl">
      <div className="card">
        <h1 className="h2 mb-1">🔑 Change your password</h1>
        <p className="text-sm muted mb-3">Owner badge <b>{me.data?.account.accountNumber}</b>. Use something long that nobody could guess (not "Diddy"!).</p>
        <ChangePasswordForm compact />
      </div>
      <div className="card flex flex-col gap-2">
        <h2 className="h2">📱 Two-factor login</h2>
        <p className="text-sm muted">Adds a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password...) to the owner login.</p>
        <p className="text-sm">Status: <b>{on ? '✅ On' : 'Off'}</b></p>
        {!on && !setup && <button className="btn-primary self-start" onClick={() => start.mutate(undefined)}>Set it up</button>}
        {setup && (
          <div className="card-flat text-sm flex flex-col gap-1">
            <div>1. In your authenticator app, add an account with this key:</div>
            <code className="font-mono break-all select-all text-base">{setup.secret}</code>
            <a className="underline text-xs break-all" href={setup.url}>or tap here on your phone</a>
            <div>2. Type the 6-digit code it shows:</div>
          </div>
        )}
        {(setup || on) && (
          <div className="flex gap-2">
            <input className="input w-36 text-center tracking-[0.3em]" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} aria-label="6-digit code" />
            {setup ? <button className="btn-good" disabled={code.length !== 6} onClick={() => enable.mutate(undefined)}>Turn on</button> : <button className="btn-bad" disabled={code.length !== 6} onClick={() => disable.mutate(undefined)}>Turn off</button>}
          </div>
        )}
      </div>
    </div>
  );
}
