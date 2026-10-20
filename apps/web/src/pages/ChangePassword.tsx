import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { POST } from '../lib/api';
import { useAction } from '../lib/hooks';
import { BossByteFace } from '../components/BossByte';
import { t } from '../i18n';
import { useStore } from '../lib/store';

export function ChangePasswordForm({ onDone, compact = false, owner = false }: { onDone?: () => void; compact?: boolean; owner?: boolean }) {
  const qc = useQueryClient();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const confetti = useStore((s) => s.confetti);
  const act = useAction((v: { current: string; next: string }) => POST('/auth/password', v), {
    success: 'Password saved! Your secret is safe with Boss Byte.',
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
      confetti();
      setCur('');
      setNext('');
      setAgain('');
      onDone?.();
    },
  });
  const mismatch = again.length > 0 && next !== again;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!mismatch) act.mutate({ current: cur, next });
      }}
    >
      {!compact && (
        <div className="flex items-center gap-3">
          <BossByteFace mood="think" size={64} />
          <div>
            <h1 className="h2">{t(owner ? 'pw.ownerTitle' : 'pw.title')}</h1>
            <p className="text-sm muted">{t(owner ? 'pw.ownerSubtitle' : 'pw.subtitle')}</p>
          </div>
        </div>
      )}
      <div>
        <label className="label" htmlFor="cur">{compact ? 'Current password' : t('pw.current')}</label>
        <input id="cur" type="password" className="input" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="new">{t('pw.new')}</label>
        <input id="new" type="password" className="input" autoComplete="new-password" minLength={6} value={next} onChange={(e) => setNext(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="again">{t('pw.confirm')}</label>
        <input id="again" type="password" className="input" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
        {mismatch && <p className="text-bad text-sm font-bold mt-1">{t('pw.mismatch')}</p>}
      </div>
      <button className="btn-primary" disabled={act.isPending || mismatch || next.length < 6}>
        🔐 {t('pw.submit')}
      </button>
    </form>
  );
}

export function ChangePasswordPage({ owner = false }: { owner?: boolean }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 office-floor">
      <div className="card w-full max-w-md">
        <ChangePasswordForm owner={owner} />
      </div>
    </div>
  );
}
