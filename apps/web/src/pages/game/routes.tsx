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
  { path: '/profile', element: g(undefined, <Profile />) },
  { path: '/company', element: g(undefined, <CompanySettings />) },
  { path: '/settings', element: g(undefined, <SettingsPage />) },
];
