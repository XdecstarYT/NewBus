import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { POST, ApiError } from '../lib/api';
import { BossByteFace } from '../components/BossByte';
import { sfx } from '../lib/sound';
import { t } from '../i18n';
import type { Me } from '../lib/hooks';

/** "Employee Badge Scanner" login: account number + password. No sign-up, ever. */
export function Login() {
  const qc = useQueryClient();
  const [accountNumber, setAccountNumber] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'denied' | 'granted'>('idle');
  const [error, setError] = useState('');
  const [welcome, setWelcome] = useState<Me | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setPhase('scanning');
    sfx.whoosh();
    try {
      const me = await POST<Me>('/auth/login', { accountNumber: accountNumber.trim(), password, totp: needTotp ? totp : undefined });
      await new Promise((r) => setTimeout(r, 700));
      setPhase('granted');
      sfx.levelUp();
      setWelcome(me);
      setTimeout(() => qc.setQueryData(['me'], me), me.company ? 2600 : 900);
    } catch (err) {
      const ex = err as ApiError;
      await new Promise((r) => setTimeout(r, 500));
      if (ex.code === 'totp_required') {
        setNeedTotp(true);
        setPhase('idle');
        return;
      }
      setPhase('denied');
      sfx.error();
      setError(ex.message);
      setTimeout(() => setPhase('idle'), 900);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 office-floor">
      <AnimatePresence mode="wait">
        {welcome?.company && phase === 'granted' ? (
          <motion.div key="welcome" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="card text-center max-w-md w-full">
            <motion.div initial={{ rotate: -20, scale: 0 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', delay: 0.2 }} className="text-7xl mb-2">
              {welcome.company.emoji}
            </motion.div>
            <h1 className="h1">Welcome to {welcome.company.name}!</h1>
            <p className="muted mt-1">
              {welcome.company.industryEmoji} {welcome.company.industryName}
            </p>
            <p className="mt-3 font-bold">Your workers have been waiting. Some of them are napping.</p>
            <BossByteFace mood="happy" size={80} className="mx-auto mt-3 animate-bob" />
          </motion.div>
        ) : (
          <motion.form
            key="badge"
            onSubmit={submit}
            className="card w-full max-w-sm relative overflow-hidden"
            animate={phase === 'denied' ? { x: [0, -12, 12, -8, 8, 0] } : { x: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="flex items-center gap-3 mb-4">
              <BossByteFace mood={phase === 'denied' ? 'sad' : phase === 'granted' ? 'wow' : 'happy'} size={64} />
              <div>
                <h1 className="h2">{t('login.title')}</h1>
                <p className="text-xs muted">{t('login.subtitle')}</p>
              </div>
            </div>

            {/* the badge */}
            <div className="rounded-2xl border-[3px] border-ink bg-gradient-to-br from-accent/20 to-accent2/20 p-4 mb-4 relative">
              <div className="flex justify-between items-center mb-3">
                <span className="font-display font-extrabold text-sm tracking-widest">EMPLOYEE BADGE</span>
                <span className="text-2xl" aria-hidden>🪪</span>
              </div>
              <label className="label" htmlFor="acc">
                {t('login.accountNumber')}
              </label>
              <input
                id="acc"
                className="input font-display text-2xl tracking-[0.3em] text-center"
                inputMode="numeric"
                autoComplete="username"
                placeholder="01"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 8))}
                required
              />
              <label className="label mt-3" htmlFor="pw">
                {t('login.password')}
              </label>
              <input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              {needTotp && (
                <>
                  <label className="label mt-3" htmlFor="totp">
                    {t('login.totp')}
                  </label>
                  <input id="totp" className="input text-center tracking-[0.4em]" inputMode="numeric" value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus />
                </>
              )}
              {phase === 'scanning' && (
                <motion.div
                  aria-hidden
                  className="absolute left-0 right-0 h-1 bg-accent2 shadow-[0_0_16px_4px_rgba(236,72,153,0.7)]"
                  initial={{ top: '5%' }}
                  animate={{ top: ['5%', '95%', '5%'] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
              )}
            </div>

            {error && (
              <p className="text-bad font-bold text-sm mb-3" role="alert">
                {error}
              </p>
            )}
            <button className="btn-primary w-full text-lg" disabled={phase === 'scanning' || !accountNumber || !password}>
              {phase === 'scanning' ? t('login.scanning') : phase === 'granted' ? '✅ ACCESS GRANTED' : `🔎 ${t('login.submit')}`}
            </button>
            <p className="text-xs muted text-center mt-3">{t('login.noSignup')}</p>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
