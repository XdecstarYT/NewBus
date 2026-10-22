import { createContext, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { formatBits, formatGameClock, gameTime } from '@dw/shared/live';
import { POST } from '../lib/api';
import { useApi, useAction, type Me } from '../lib/hooks';
import { connectLive, disconnectLive } from '../lib/live';
import { sfx } from '../lib/sound';
import { BossByteFace } from '../components/BossByte';
import { Modal, ProgressBar, timeAgo, useNow } from '../components/ui';

export const MeContext = createContext<Me | null>(null);
export function useMe2(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('No login context');
  return me;
}

interface NavItem {
  to: string;
  label: string;
  emoji: string;
}

export function navFor(me: Me): NavItem[] {
  const play: NavItem[] = me.company
    ? [
        { to: '/office', label: 'Office', emoji: '🏢' },
        { to: '/work', label: 'Office Work', emoji: '💼' },
        { to: '/customers', label: 'Customers', emoji: '🧑‍💼' },
        { to: '/market', label: 'Market', emoji: '📈' },
        { to: '/contracts', label: 'Contracts', emoji: '📝' },
        { to: '/bank', label: 'Bank', emoji: '🏦' },
        { to: '/quests', label: 'Quests', emoji: '🎯' },
        { to: '/shops', label: 'Shops', emoji: '🛒' },
        { to: '/shop', label: 'My shop & POS', emoji: '🧾' },
        { to: '/pay', label: 'Pay', emoji: '💳' },
        { to: '/send', label: 'Send', emoji: '💸' },
        { to: '/unions', label: 'Union', emoji: '✊' },
        { to: '/townhall', label: 'Town Hall', emoji: '🏛️' },
        { to: '/court', label: 'Court', emoji: '⚖️' },
      ]
    : [];
  const owner: NavItem[] =
    me.account.role === 'OWNER'
      ? [
          { to: '/owner', label: 'Overview', emoji: '👑' },
          { to: '/owner/work', label: 'Office Work', emoji: '💼' },
          { to: '/owner/ai', label: 'AI', emoji: '🤖' },
          { to: '/owner/town', label: 'Town', emoji: '🏙️' },
          { to: '/owner/companies', label: 'Companies', emoji: '🏢' },
          { to: '/owner/economy', label: 'Economy', emoji: '💰' },
          { to: '/owner/justice', label: 'Justice & laws', emoji: '🏛️' },
          { to: '/owner/codes', label: 'QR cards', emoji: '🎁' },
        ]
      : [];
  const social: NavItem[] = [
    { to: '/town', label: 'Town', emoji: '🏙️' },
    { to: '/auctions', label: 'Auctions', emoji: '🔨' },
    { to: '/chat', label: 'Chat', emoji: '💬' },
    { to: '/news', label: 'News', emoji: '📰' },
    { to: '/leaderboard', label: 'Leaderboard', emoji: '🏆' },
  ];
  const mine: NavItem[] = me.company ? [{ to: '/team', label: 'Team', emoji: '👥' }, { to: '/redeem', label: 'Redeem card', emoji: '🎁' }] : [];
  return [...owner, ...play, ...social, ...mine, { to: '/settings', label: 'Settings', emoji: '⚙️' }];
}

/** Today's world event, linking to the Town page. */
function TodayChip() {
  const q = useApi<any>(['town', 'today'], '/game/today', { refetchInterval: 60_000 });
  const e = q.data?.event;
  if (!e || e.id === 'quiet') return null;
  return (
    <Link to="/town" className="chip text-xs whitespace-nowrap hidden md:inline-flex" title={e.blurb} data-testid="today-chip">
      {e.emoji} {e.title}
    </Link>
  );
}

/** The in-game clock: 1 real hour = 12 game hours. */
function GameClock() {
  const now = useNow(5_000);
  const hour = new Date(gameTime(now)).getUTCHours();
  return (
    <div className="chip text-xs whitespace-nowrap" title="Game time: 1 real hour = 12 game hours, so a game day lasts 2 real hours." data-testid="game-clock">
      {hour >= 6 && hour < 18 ? '☀️' : '🌙'} {formatGameClock(now)}
    </div>
  );
}

/** Subscribe to live hints for this login. */
function Live({ me }: { me: Me }) {
  const qc = useQueryClient();
  useEffect(() => {
    const topics = ['dw-all', `dw-acc-${me.account.id}`];
    if (me.company) topics.push(`dw-co-${me.company.id}`);
    connectLive(qc, topics);
    return () => disconnectLive();
  }, [qc, me.account.id, me.company?.id]);
  return null;
}

export function Layout({ me }: { me: Me }) {
  const nav = navFor(me);
  const [more, setMore] = useState(false);
  const [bell, setBell] = useState(false);
  const mobile = nav.slice(0, 4);
  return (
    <MeContext.Provider value={me}>
      <Live me={me} />
      <div className="min-h-screen pb-20 sm:pb-0 sm:pl-56">
        <a href="#main" className="sr-only-focusable fixed top-2 left-2 z-50 btn-primary btn-sm">Skip to content</a>
        <aside className="hidden sm:flex fixed left-0 top-0 bottom-0 w-56 flex-col gap-1 p-3 border-r-[3px] border-ink bg-card overflow-y-auto z-20" aria-label="Main navigation">
          <Link to="/" className="flex items-center gap-2 mb-2">
            <BossByteFace size={40} />
            <span className="font-display font-extrabold leading-tight">Digital<br />Workforce</span>
          </Link>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/owner'} onClick={() => sfx.click()} className={({ isActive }) => `flex items-center gap-2 px-3 py-2 rounded-xl font-bold text-sm ${isActive ? 'bg-accent text-white border-2 border-ink shadow-popsm' : 'hover:bg-accent/10'}`}>
              <span aria-hidden>{n.emoji}</span> {n.label}
            </NavLink>
          ))}
          <LogoutButton className="mt-auto" />
        </aside>

        <header className="sticky top-0 z-10 bg-paper/90 backdrop-blur border-b-[3px] border-ink px-3 py-2 flex items-center gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-2xl" aria-hidden>{me.company?.emoji ?? '👑'}</span>
            <div className="min-w-0">
              <div className="font-display font-extrabold truncate leading-tight">{me.company?.name ?? 'Owner Panel'}</div>
              <div className="text-xs muted truncate">{me.account.name}{me.company ? ` · Lv ${me.company.level}` : ''}</div>
            </div>
          </div>
          {me.company && (
            <div className="hidden xs:block sm:block w-32" title={`Energy refills ${me.energy.regen}/hour`}>
              <div className="text-[11px] font-bold">⚡ {me.energy.now}/{me.energy.max}</div>
              <ProgressBar value={me.energy.now} max={me.energy.max} color="bg-amber-400" />
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <TodayChip />
            <GameClock />
            {me.company && (
              <div className="text-right font-display font-extrabold text-lg leading-tight" data-testid="balance">
                {formatBits(me.company.balance)}
              </div>
            )}
            <button className="btn-ghost btn-sm relative" onClick={() => setBell(true)} aria-label={`Notifications (${me.unread} unread)`}>
              🔔{me.unread > 0 && <span className="absolute -top-1 -right-1 bg-bad text-white text-[10px] rounded-full px-1.5">{me.unread}</span>}
            </button>
          </div>
        </header>

        <main id="main" className="p-3 sm:p-5 max-w-6xl mx-auto">
          <Outlet />
        </main>

        <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-20 bg-card border-t-[3px] border-ink grid grid-cols-5" aria-label="Main navigation">
          {mobile.map((n) => (
            <NavLink key={n.to} to={n.to} end className={({ isActive }) => `flex flex-col items-center py-2 text-[11px] font-bold ${isActive ? 'text-accent' : ''}`}>
              <span className="text-xl" aria-hidden>{n.emoji}</span>
              <span className="truncate max-w-full px-1">{n.label}</span>
            </NavLink>
          ))}
          <button className="flex flex-col items-center py-2 text-[11px] font-bold" onClick={() => setMore(true)}>
            <span className="text-xl" aria-hidden>☰</span>More
          </button>
        </nav>
        <Modal open={more} onClose={() => setMore(false)} title="Everything">
          <div className="grid grid-cols-3 gap-2">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} onClick={() => setMore(false)} className="card-flat flex flex-col items-center gap-1 text-xs font-bold text-center">
                <span className="text-2xl">{n.emoji}</span>
                {n.label}
              </NavLink>
            ))}
          </div>
          <LogoutButton className="w-full mt-3" />
        </Modal>
        <Modal open={bell} onClose={() => setBell(false)} title="🔔 Notifications">
          {bell && <Notifications />}
        </Modal>
      </div>
    </MeContext.Provider>
  );
}

function Notifications() {
  const q = useApi<any[]>(['notifications'], '/game/notifications');
  const read = useAction(() => POST('/game/notifications/read'), { invalidate: [['me'], ['notifications']] });
  useEffect(() => {
    if (q.data?.some((n) => !n.read)) read.mutate(undefined);
  }, [q.data?.length]);
  if (!q.data) return <p className="muted">Loading...</p>;
  if (!q.data.length) return <p className="muted">Nothing yet. Go make some noise!</p>;
  return (
    <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
      {q.data.map((n) => (
        <div key={n.id} className={`card-flat !p-2 text-sm ${n.read ? 'opacity-70' : ''}`}>
          <div className="font-bold">{n.title}</div>
          {n.body && <div className="text-xs">{n.body}</div>}
          <div className="text-[11px] muted">{timeAgo(n.createdAt)}</div>
        </div>
      ))}
    </div>
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
      🚪 Log out
    </button>
  );
}
