import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate, useParams, Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { MODULE_INFO, MODULES, type Module, formatBits } from '@dw/shared';
import type { Me } from '../../lib/hooks';
import { useApi } from '../../lib/hooks';
import { POST, setViewAs } from '../../lib/api';
import { useStore } from '../../lib/store';
import { onWs, subscribe } from '../../lib/ws';
import { RollingNumber, Modal } from '../../components/ui';
import { BossByteFace } from '../../components/BossByte';
import { sfx } from '../../lib/sound';
import { t } from '../../i18n';
import { Tutorial } from './Tutorial';
import { NotificationBell } from './Notifications';

export const MeContext = createContext<Me | null>(null);
export function useGameMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('No game context');
  return me;
}
/** Route prefix ("" normally, "/viewas/<id>" when the owner previews a company). */
export function useBase() {
  const { companyId } = useParams();
  return companyId ? `/viewas/${companyId}` : '';
}
export function useCan(m: Module) {
  return !!useGameMe().access.modules[m];
}

interface NavItem {
  path: string;
  label: string;
  emoji: string;
}

export function navItems(me: Me): NavItem[] {
  const seen = new Set<string>();
  const out: NavItem[] = [];
  for (const m of MODULES) {
    if (!me.access.modules[m]) continue;
    const info = MODULE_INFO[m];
    if (m === 'staff') continue; // lives in Company Settings
    if (seen.has(info.path)) continue;
    seen.add(info.path);
    out.push({ path: info.path, label: info.label, emoji: info.emoji });
  }
  if (me.access.modules.exchange && !seen.has('/portfolio')) out.push({ path: '/portfolio', label: 'Portfolio', emoji: '💼' });
  out.push({ path: '/profile', label: 'Profile', emoji: '🪪' });
  if (me.account.role === 'COMPANY_ADMIN' || me.access.viewAs || me.account.role === 'OWNER') out.push({ path: '/company', label: 'Company', emoji: '⚙️' });
  out.push({ path: '/settings', label: t('nav.settings'), emoji: '🎛️' });
  return out;
}

interface GameState {
  balance: number;
  pots: Record<string, number>;
  incomePerTick: number;
  wagesPerTick: number;
  upkeepPerTick: number;
  level: number;
  xp: number;
  xpNext: number;
  away: { earned: number; minutes: number } | null;
}

export function GameLayout() {
  const me = useGameMe();
  const base = useBase();
  const nav = useMemo(() => navItems(me), [me]);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const balance = useStore((s) => s.balance);
  const setBalance = useStore((s) => s.setBalance);
  const income = useStore((s) => s.incomePerTick);
  const setIncome = useStore((s) => s.setIncome);
  const shakeKey = useStore((s) => s.shakeKey);
  const reduce = useStore((s) => s.prefs.reducedMotion);
  const [moreOpen, setMoreOpen] = useState(false);
  const [away, setAway] = useState<GameState['away']>(null);
  const state = useApi<GameState>(['state', me.access.companyId], '/game/state', { refetchInterval: 60_000 });

  useEffect(() => {
    if (state.data) {
      setBalance(state.data.balance);
      setIncome(state.data.incomePerTick);
      if (state.data.away && state.data.away.earned > 0) setAway(state.data.away);
    }
  }, [state.data, setBalance, setIncome]);

  // live balance from ticks
  useEffect(() => {
    if (me.access.companyId) subscribe(`company:${me.access.companyId}`);
    const off = onWs('tick', (m) => {
      if (m.channel !== `company:${me.access.companyId}`) return;
      setBalance(m.balance);
      setIncome(m.incomePerTick);
    });
    const off2 = onWs('balance', () => qc.invalidateQueries({ queryKey: ['state'] }));
    const off3 = onWs('levelup', (m) => {
      if (m.channel !== `company:${me.access.companyId}`) return;
      sfx.levelUp();
      useStore.getState().confetti();
      useStore.getState().say(`LEVEL ${m.level}! Your company is moving up in the world. New stuff unlocked!`, 'wow');
      qc.invalidateQueries();
    });
    return () => {
      off();
      off2();
      off3();
    };
  }, [me.access.companyId, setBalance, setIncome, qc]);

  const mobileMain = nav.slice(0, 4);
  const tickSecs = me.tickMs / 1000;

  return (
    <motion.div key={shakeKey} animate={shakeKey && !reduce ? { x: [0, -6, 6, -4, 4, 0] } : {}} transition={{ duration: 0.35 }} className="min-h-screen pb-20 sm:pb-0 sm:pl-56">
      <a href="#main" className="sr-only-focusable fixed top-2 left-2 z-50 btn-primary btn-sm">Skip to content</a>
      {/* banners */}
      {me.access.viewAs && (
        <div className="sticky top-0 z-30 bg-warn text-white font-bold text-sm px-3 py-2 flex items-center justify-between gap-2 border-b-[3px] border-ink">
          <span>👀 {t('viewas.banner', { name: me.company?.name ?? '' })}</span>
          <button
            className="btn-ghost btn-sm !text-ink"
            onClick={() => {
              setViewAs(null);
              navigate('/owner/companies');
            }}
          >
            {t('viewas.exit')}
          </button>
        </div>
      )}
      {!me.access.viewAs && me.flags.maintenance && <div className="bg-warn/90 text-white font-bold text-sm px-3 py-2 text-center">🛠️ {t('maintenance.banner')}</div>}
      {me.announcement && <div className="bg-accent text-white font-bold text-sm px-3 py-2 text-center">📣 {String(me.announcement)}</div>}

      {/* desktop sidebar */}
      <aside className="hidden sm:flex fixed left-0 top-0 bottom-0 w-56 flex-col gap-1 p-3 border-r-[3px] border-ink bg-card overflow-y-auto z-20" aria-label="Main navigation">
        <Link to={`${base}/office`} className="flex items-center gap-2 mb-2">
          <BossByteFace size={40} />
          <span className="font-display font-extrabold leading-tight">Digital<br />Workforce</span>
        </Link>
        {nav.map((n) => (
          <NavLink
            key={n.path}
            to={`${base}${n.path}`}
            className={({ isActive }) => `flex items-center gap-2 px-3 py-2 rounded-xl font-bold text-sm ${isActive ? 'bg-accent text-white border-2 border-ink shadow-popsm' : 'hover:bg-accent/10'}`}
            onClick={() => sfx.click()}
          >
            <span aria-hidden>{n.emoji}</span> {n.label}
          </NavLink>
        ))}
        {!me.access.viewAs && <LogoutButton className="mt-auto" />}
      </aside>

      {/* top bar */}
      <header className="sticky top-0 z-10 bg-paper/90 backdrop-blur border-b-[3px] border-ink px-3 py-2 flex items-center gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-2xl" aria-hidden>{me.company?.emoji}</span>
          <div className="min-w-0">
            <div className="font-display font-extrabold truncate leading-tight">{me.company?.name}</div>
            <div className="text-xs muted truncate">
              {me.company?.industryEmoji} {me.company?.industryName} · Lv {state.data?.level ?? me.company?.level}
            </div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="text-right" aria-live="off">
            <div className="font-display font-extrabold text-lg leading-tight" data-testid="balance">
              <RollingNumber value={balance ?? 0} />
            </div>
            <div className="text-[11px] muted leading-tight">
              +{formatBits(Math.round(income), false)}/{tickSecs}s
            </div>
          </div>
          {me.access.companyId && <NotificationBell />}
        </div>
      </header>

      <main id="main" className="p-3 sm:p-5 max-w-6xl mx-auto">
        <Outlet />
      </main>

      {/* mobile bottom bar */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-20 bg-card border-t-[3px] border-ink grid grid-cols-5" aria-label="Main navigation">
        {mobileMain.map((n) => (
          <NavLink key={n.path} to={`${base}${n.path}`} className={({ isActive }) => `flex flex-col items-center py-2 text-[11px] font-bold ${isActive ? 'text-accent' : ''}`}>
            <span className="text-xl" aria-hidden>{n.emoji}</span>
            <span className="truncate max-w-full px-1">{n.label}</span>
          </NavLink>
        ))}
        <button className="flex flex-col items-center py-2 text-[11px] font-bold" onClick={() => setMoreOpen(true)}>
          <span className="text-xl" aria-hidden>☰</span>
          {t('nav.more')}
        </button>
      </nav>
      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Everything">
        <div className="grid grid-cols-3 gap-2">
          {nav.map((n) => (
            <NavLink key={n.path} to={`${base}${n.path}`} onClick={() => setMoreOpen(false)} className="card-flat flex flex-col items-center gap-1 text-xs font-bold text-center">
              <span className="text-2xl">{n.emoji}</span>
              {n.label}
            </NavLink>
          ))}
        </div>
        {!me.access.viewAs && <LogoutButton className="w-full mt-3" />}
      </Modal>

      <Modal open={!!away} onClose={() => setAway(null)} title={`💤 ${t('offline.title')}`}>
        <div className="flex items-center gap-3">
          <BossByteFace mood="wow" size={72} />
          <div>
            <p className="font-bold">{t('offline.body', { amount: formatBits(away?.earned ?? 0) })}</p>
            <p className="text-sm muted">You were gone for {away?.minutes ?? 0} minutes. Idle earnings are capped, so don't vanish forever!</p>
          </div>
        </div>
        <button
          className="btn-good w-full mt-4"
          onClick={() => {
            sfx.bigCoin();
            useStore.getState().confetti();
            setAway(null);
          }}
        >
          {t('offline.claim')}
        </button>
      </Modal>
      {!me.access.viewAs && <Tutorial />}
    </motion.div>
  );
}

function LogoutButton({ className = '' }: { className?: string }) {
  const qc = useQueryClient();
  return (
    <button
      className={`btn-ghost btn-sm ${className}`}
      onClick={async () => {
        await POST('/auth/logout').catch(() => {});
        qc.clear();
        window.location.href = '/';
      }}
    >
      🚪 {t('nav.logout')}
    </button>
  );
}
