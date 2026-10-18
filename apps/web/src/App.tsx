import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useMe, type Me } from './lib/hooks';
import { GET, setViewAs } from './lib/api';
import { Login } from './pages/Login';
import { ChangePasswordPage } from './pages/ChangePassword';
import { LoadingJoke, Toasts, Floaters, Confetti, ConfirmProvider } from './components/ui';
import { BossByteBubble } from './components/BossByte';
import { useStore } from './lib/store';
import { connectWs, disconnectWs, onWs } from './lib/ws';
import { setMusic } from './lib/sound';
import { GameLayout, MeContext } from './pages/game/GameLayout';
import { gameRoutes } from './pages/game/routes';
import { OwnerLayout } from './pages/owner/OwnerLayout';
import { ownerRoutes } from './pages/owner/routes';
import { ModeratorHome } from './pages/ModeratorHome';

/** Apply accessibility / theme prefs to <html>. */
function PrefsEffect() {
  const prefs = useStore((s) => s.prefs);
  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle('dark', prefs.dark);
    el.classList.toggle('reduce-motion', prefs.reducedMotion);
    el.classList.toggle('hc', prefs.highContrast);
    el.classList.toggle('cb', prefs.colorBlind);
    for (const th of ['candy', 'ocean', 'retro', 'forest']) el.classList.toggle(`theme-${th}`, prefs.theme === th);
    el.style.setProperty('--font-scale', String(prefs.textSize));
  }, [prefs]);
  useEffect(() => setMusic(prefs.music && !prefs.muted), [prefs.music, prefs.muted]);
  return null;
}

/** Live socket wiring shared by every logged-in screen. */
function LiveEffect() {
  const qc = useQueryClient();
  const say = useStore((s) => s.say);
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    connectWs();
    const offs = [
      onWs('perms', () => {
        qc.invalidateQueries({ queryKey: ['me'] });
        qc.invalidateQueries({ queryKey: ['me-viewas'] });
      }),
      onWs('company', () => qc.invalidateQueries()),
      onWs('logout', () => window.location.reload()),
      onWs('boss', (m) => say(m.text, m.mood ?? 'wow')),
      onWs('broadcast', (m) => {
        say(`📣 ${m.text}`, 'wow');
        toast(m.text, 'info', '📣');
      }),
    ];
    return () => {
      offs.forEach((o) => o());
      disconnectWs();
    };
  }, [qc, say, toast]);
  return null;
}

function ViewAsGame({ children }: { children: ReactNode }) {
  const { companyId } = useParams();
  setViewAs(companyId ?? null);
  useEffect(() => () => setViewAs(null), []);
  const q = useQuery<Me>({ queryKey: ['me-viewas', companyId], queryFn: () => GET<Me>('/auth/me'), staleTime: 10_000 });
  if (!q.data) return <LoadingJoke />;
  return <MeContext.Provider value={q.data}>{children}</MeContext.Provider>;
}

function Shell() {
  const me = useMe();
  if (me.isLoading) return <LoadingJoke />;
  if (me.error || !me.data) return <Login />;
  const data = me.data;
  if (data.account.mustChangePassword) return <ChangePasswordPage />;
  const role = data.account.role;
  const home = role === 'OWNER' ? '/owner' : role === 'MODERATOR' ? '/mod' : '/office';
  return (
    <>
      <LiveEffect />
      <Routes>
        {role === 'OWNER' && (
          <>
            <Route path="/owner" element={<OwnerLayout />}>
              {ownerRoutes.map((r) => (
                <Route key={r.path} index={r.path === ''} path={r.path || undefined} element={r.element} />
              ))}
            </Route>
            <Route
              path="/viewas/:companyId"
              element={
                <ViewAsGame>
                  <GameLayout />
                </ViewAsGame>
              }
            >
              {gameRoutes.map((r) => (
                <Route key={r.path} path={r.path.replace(/^\//, '')} element={r.element} />
              ))}
              <Route index element={<Navigate to="office" replace />} />
            </Route>
          </>
        )}
        {role === 'MODERATOR' && <Route path="/mod/*" element={<ModeratorHome />} />}
        {(role === 'COMPANY_ADMIN' || role === 'STAFF' || (role === 'OWNER' && data.access.companyId)) && (
          <Route
            element={
              <MeContext.Provider value={data}>
                <GameLayout />
              </MeContext.Provider>
            }
          >
            {gameRoutes.map((r) => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
          </Route>
        )}
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ConfirmProvider>
        <PrefsEffect />
        <Shell />
        <Toasts />
        <Floaters />
        <Confetti />
        <BossByteBubble />
      </ConfirmProvider>
    </BrowserRouter>
  );
}
