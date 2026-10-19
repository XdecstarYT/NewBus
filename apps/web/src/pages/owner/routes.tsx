import type { ReactNode } from 'react';
import { Overview } from './Overview';
import { CompanyBuilder } from './CompanyBuilder';
import { CompanyList, CompanyDetail } from './Companies';
import { Templates, Accounts, Flags, AuditLog, Ledger } from './Admin';
import { EconomyHealth } from './Economy';
import { CatalogManager } from './Catalog';
import { MarketAdmin } from './Market';
import { SocialAdmin } from './Social';
import { ModerationCenter } from './Moderation';
import { MyAccount } from './MyAccount';
import { PackagesAdmin } from './Packages';
import { ChaosControls } from './Chaos';
import { Backups, AntiCheat, Analytics } from './Ops';
import { JusticeAdmin, OwnerCase } from './Justice';

export const ownerRoutes: Array<{ path: string; label?: string; element: ReactNode }> = [
  { path: '', label: '🏠 Overview', element: <Overview /> },
  { path: 'builder', label: '🧱 Company Builder', element: <CompanyBuilder /> },
  { path: 'companies', label: '🏢 Companies', element: <CompanyList /> },
  { path: 'companies/:id', element: <CompanyDetail /> },
  { path: 'economy', label: '📊 Economy', element: <EconomyHealth /> },
  { path: 'market', label: '📈 Market', element: <MarketAdmin /> },
  { path: 'social', label: '🤝 Social', element: <SocialAdmin /> },
  { path: 'justice', label: '🏛️ Justice & Politics', element: <JusticeAdmin /> },
  { path: 'justice/cases/:id', element: <OwnerCase /> },
  { path: 'chaos', label: '🌪️ Chaos & Seasons', element: <ChaosControls /> },
  { path: 'analytics', label: '🧮 Analytics', element: <Analytics /> },
  { path: 'anticheat', label: '🕵️ Anti-cheat', element: <AntiCheat /> },
  { path: 'backups', label: '💾 Backups', element: <Backups /> },
  { path: 'packages', label: '📦 Packages', element: <PackagesAdmin /> },
  { path: 'moderation', label: '🛡️ Moderation', element: <ModerationCenter /> },
  { path: 'catalog', label: '📚 Catalog', element: <CatalogManager /> },
  { path: 'templates', label: '📋 Templates', element: <Templates /> },
  { path: 'accounts', label: '🪪 Accounts', element: <Accounts /> },
  { path: 'flags', label: '🎚️ Flags & settings', element: <Flags /> },
  { path: 'ledger', label: '📒 Ledger', element: <Ledger /> },
  { path: 'audit', label: '📝 Audit', element: <AuditLog /> },
  { path: 'account', label: '🔑 My account', element: <MyAccount /> },
];
