import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { useMe, type Me } from './lib/hooks';
import { Login } from './pages/Login';
import { ChangePasswordPage } from './pages/ChangePassword';
import { LoadingJoke, Toasts, Floaters, Confetti, ConfirmProvider } from './components/ui';
import { BossByteBubble } from './components/BossByte';
import { useStore } from './lib/store';
import { setMusic } from './lib/sound';
import { Layout } from './pages/Layout';
import { Office } from './pages/play/Office';
import { Market } from './pages/play/Market';
import { MyShop } from './pages/play/Shop';
import { Shops, Storefront, Pay } from './pages/play/Shops';
import { Send, Team, Redeem, Settings } from './pages/play/Company';
import { Chat, News, Leaderboard } from './pages/play/Social';
import { Unions, UnionPage, TownHall, Court, CaseDetail } from './pages/play/Politics';
import { WorkBoard, Workspace } from './pages/play/Work';
import { Customers, Contracts, Quests } from './pages/play/Deals';
import { OwnerWork, OwnerAI } from './pages/owner/OwnerWork';
import { OwnerOverview, OwnerCompanies, OwnerCompany, OwnerEconomy, OwnerJustice, OwnerCase, OwnerCodes } from './pages/owner/Owner';

/** Apply accessibility / theme prefs to <html>. */
function PrefsEffect() {
  const prefs = useStore((s) => s.prefs);
  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle('dark', prefs.dark);
    el.classList.toggle('reduce-motion', prefs.reducedMotion);
    el.classList.toggle('hc', prefs.highContrast);
    el.classList.toggle('cb', prefs.colorBlind);
    el.style.setProperty('--font-scale', String(prefs.textSize));
  }, [prefs]);
  useEffect(() => setMusic(prefs.music && !prefs.muted), [prefs.music, prefs.muted]);
  return null;
}

function Shell() {
  const q = useMe();
  if (q.isLoading) return <LoadingJoke />;
  const me = q.data as Me | undefined;
  if (q.error && q.error.status !== 401 && !me) return <ServerDown message={q.error.message} />;
  if (!me?.account) return <Login />;
  if (me.account.mustChangePassword) return <ChangePasswordPage owner={me.account.role === 'OWNER'} />;
  const owner = me.account.role === 'OWNER';
  const home = me.company ? '/office' : '/owner';
  return (
    <Routes>
      <Route element={<Layout me={me} />}>
        {me.company && (
          <>
            <Route path="/office" element={<Office />} />
            <Route path="/work" element={<WorkBoard />} />
            <Route path="/work/:id" element={<Workspace />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/contracts" element={<Contracts />} />
            <Route path="/quests" element={<Quests />} />
            <Route path="/market" element={<Market />} />
            <Route path="/market/:item" element={<Market />} />
            <Route path="/shop" element={<MyShop />} />
            <Route path="/shops" element={<Shops />} />
            <Route path="/shops/:id" element={<Storefront />} />
            <Route path="/pay" element={<Pay />} />
            <Route path="/pay/:code" element={<Pay />} />
            <Route path="/send" element={<Send />} />
            <Route path="/team" element={<Team />} />
            <Route path="/redeem" element={<Redeem />} />
            <Route path="/redeem/:code" element={<Redeem />} />
            <Route path="/unions" element={<Unions />} />
            <Route path="/unions/:id" element={<UnionPage />} />
            <Route path="/townhall" element={<TownHall />} />
            <Route path="/court" element={<Court />} />
            <Route path="/court/:id" element={<CaseDetail />} />
          </>
        )}
        {owner && (
          <>
            <Route path="/owner" element={<OwnerOverview />} />
            <Route path="/owner/companies" element={<OwnerCompanies />} />
            <Route path="/owner/companies/:id" element={<OwnerCompany />} />
            <Route path="/owner/economy" element={<OwnerEconomy />} />
            <Route path="/owner/justice" element={<OwnerJustice />} />
            <Route path="/owner/justice/cases/:id" element={<OwnerCase />} />
            <Route path="/owner/codes" element={<OwnerCodes />} />
            <Route path="/owner/work" element={<OwnerWork />} />
            <Route path="/owner/ai" element={<OwnerAI />} />
          </>
        )}
        <Route path="/chat" element={<Chat />} />
        <Route path="/news" element={<News />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}

function ServerDown({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 office-floor">
      <div className="card max-w-md text-center flex flex-col gap-2">
        <div className="text-5xl">🔌</div>
        <h1 className="h2">Can't reach the game</h1>
        <p className="text-sm font-bold" data-testid="server-problem">{message}</p>
        <p className="text-xs muted">
          Owner: open <a className="underline" href="/api/health" target="_blank" rel="noreferrer">/api/health</a> on this site to see what is wrong. If that page shows "Page not found", Netlify did not deploy the game's API (check the deploy log and that the site builds this branch).
        </p>
        <button className="btn-primary" onClick={() => window.location.reload()}>Try again</button>
      </div>
    </div>
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
