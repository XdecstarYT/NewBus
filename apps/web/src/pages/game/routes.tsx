import type { ReactNode } from 'react';
import type { Module } from '@dw/shared';
import { LockedScreen } from '../../components/ui';
import { useGameMe } from './GameLayout';
import { Office } from './Office';
import { Workforce } from './Workforce';
import { Pods } from './Pods';
import { Contracts } from './Contracts';
import { Shop, Prestige } from './Decor';
import { SettingsPage } from './Settings';
import { CompanySettings } from './CompanySettings';
import { Profile } from './Profile';
import { News } from './News';
import { Bank, Loans } from './Bank';
import { Products } from './Products';
import { SupplyChain, Marketplace, Property } from './Trade';
import { Exchange, Portfolio } from './Exchange';
import { ChatPage } from './Chat';
import { Guilds } from './Guilds';
import { Wars } from './Wars';
import { Leaderboard, PublicProfile } from './Leaderboard';
import { Packages } from './Packages';
import { Arcade } from './Arcade';
import { Research } from './Research';
import { Achievements } from './Achievements';
import { Quests } from './Quests';

/** Renders the page only if the module is enabled for this login; otherwise a funny lock screen. */
function Guard({ module, children }: { module?: Module; children: ReactNode }) {
  const me = useGameMe();
  if (module && !me.access.modules[module]) return <LockedScreen module={module} />;
  return <>{children}</>;
}

const g = (module: Module | undefined, el: ReactNode) => <Guard module={module}>{el}</Guard>;

export const gameRoutes: Array<{ path: string; element: ReactNode }> = [
  { path: '/office', element: g('office', <Office />) },
  { path: '/workforce', element: g('workforce', <Workforce />) },
  { path: '/pods', element: g('pods', <Pods />) },
  { path: '/contracts', element: g('contracts', <Contracts />) },
  { path: '/shop', element: g('decor', <Shop />) },
  { path: '/prestige', element: g('prestige', <Prestige />) },
  { path: '/news', element: g('news', <News />) },
  { path: '/bank', element: g('bank', <Bank />) },
  { path: '/loans', element: g('loans', <Loans />) },
  { path: '/products', element: g('products', <Products />) },
  { path: '/supply', element: g('supplychain', <SupplyChain />) },
  { path: '/marketplace', element: g('marketplace', <Marketplace />) },
  { path: '/property', element: g('property', <Property />) },
  { path: '/exchange', element: g('exchange', <Exchange />) },
  { path: '/portfolio', element: g('exchange', <Portfolio />) },
  { path: '/chat', element: g('chat', <ChatPage />) },
  { path: '/guilds', element: g('guilds', <Guilds />) },
  { path: '/wars', element: g('wars', <Wars />) },
  { path: '/leaderboard', element: g('leaderboard', <Leaderboard />) },
  { path: '/profiles/:id', element: g(undefined, <PublicProfile />) },
  { path: '/minigames', element: g('minigames', <Arcade />) },
  { path: '/research', element: g('research', <Research />) },
  { path: '/achievements', element: g('achievements', <Achievements />) },
  { path: '/quests', element: g(undefined, <Quests />) },
  { path: '/packages', element: g(undefined, <Packages />) },
  { path: '/redeem/:code', element: g(undefined, <Packages />) },
  { path: '/profile', element: g(undefined, <Profile />) },
  { path: '/company', element: g(undefined, <CompanySettings />) },
  { path: '/settings', element: g(undefined, <SettingsPage />) },
];
