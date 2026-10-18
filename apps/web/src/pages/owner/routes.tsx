import type { ReactNode } from 'react';
import { Overview } from './Overview';
import { CompanyBuilder } from './CompanyBuilder';
import { CompanyList, CompanyDetail } from './Companies';
import { Templates, Accounts, Flags, AuditLog, Ledger } from './Admin';
import { EconomyHealth } from './Economy';
import { CatalogManager } from './Catalog';
import { MarketAdmin } from './Market';

export const ownerRoutes: Array<{ path: string; label?: string; element: ReactNode }> = [
  { path: '', label: '🏠 Overview', element: <Overview /> },
  { path: 'builder', label: '🧱 Company Builder', element: <CompanyBuilder /> },
  { path: 'companies', label: '🏢 Companies', element: <CompanyList /> },
  { path: 'companies/:id', element: <CompanyDetail /> },
  { path: 'economy', label: '📊 Economy', element: <EconomyHealth /> },
  { path: 'market', label: '📈 Market', element: <MarketAdmin /> },
  { path: 'catalog', label: '📚 Catalog', element: <CatalogManager /> },
  { path: 'templates', label: '📋 Templates', element: <Templates /> },
  { path: 'accounts', label: '🪪 Accounts', element: <Accounts /> },
  { path: 'flags', label: '🎚️ Flags & settings', element: <Flags /> },
  { path: 'ledger', label: '📒 Ledger', element: <Ledger /> },
  { path: 'audit', label: '📝 Audit', element: <AuditLog /> },
];
