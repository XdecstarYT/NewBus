import { NavLink, Outlet } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { POST } from '../../lib/api';
import { BossByteFace } from '../../components/BossByte';
import { ownerRoutes } from './routes';
import { useEffect } from 'react';
import { onWs, subscribe } from '../../lib/ws';

export function OwnerLayout() {
  const qc = useQueryClient();
  useEffect(() => {
    subscribe('owner');
    const off = onWs('owner_refresh', () => qc.invalidateQueries());
    return off;
  }, [qc]);
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 bg-paper/95 backdrop-blur border-b-[3px] border-ink">
        <div className="max-w-7xl mx-auto px-3 py-2 flex items-center gap-3">
          <BossByteFace size={40} />
          <div>
            <div className="font-display font-extrabold leading-tight">Owner Control Panel</div>
            <div className="text-xs muted">You run the whole show. Boss Byte salutes you. 🫡</div>
          </div>
          <button
            className="btn-ghost btn-sm ml-auto"
            onClick={async () => {
              await POST('/auth/logout').catch(() => {});
              qc.clear();
              window.location.href = '/';
            }}
          >
            🚪 Clock out
          </button>
        </div>
        <nav className="max-w-7xl mx-auto px-3 pb-2 flex gap-1 overflow-x-auto no-scrollbar" aria-label="Owner sections">
          {ownerRoutes
            .filter((r) => r.label)
            .map((r) => (
              <NavLink
                key={r.path}
                end={r.path === ''}
                to={`/owner${r.path ? `/${r.path}` : ''}`}
                className={({ isActive }) => `btn-sm whitespace-nowrap ${isActive ? 'btn-primary' : 'btn-ghost'}`}
              >
                {r.label}
              </NavLink>
            ))}
        </nav>
      </header>
      <main className="max-w-7xl mx-auto p-3 sm:p-5">
        <Outlet />
      </main>
    </div>
  );
}
