import { useApi } from '../../lib/hooks';
import { LoadingJoke } from '../../components/ui';
import { useGameMe } from './GameLayout';

export function Profile() {
  const me = useGameMe();
  const q = useApi<any>(['office'], '/game/office');
  if (!q.data) return <LoadingJoke />;
  const c = q.data.company;
  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4">
      <div className="card text-center" style={{ borderColor: c.color }}>
        <div className="text-7xl">{c.emoji}</div>
        <h1 className="h1" style={{ color: c.color }}>{c.name}</h1>
        <p className="muted">{q.data.industry.emoji} {q.data.industry.name} · Level {c.level}</p>
        <p className="italic">{me.company?.slogan}</p>
        <div className="flex justify-center gap-2 mt-2 flex-wrap">
          <span className="chip">⭐ Reputation {(c.reputation / 100).toFixed(1)}</span>
          <span className="chip">🏦 Credit {c.creditScore}</span>
          <span className="chip">🔥 Streak {c.streak}</span>
          <span className="chip">🚀 Prestige pts {c.prestigePoints}</span>
        </div>
      </div>
      <div className="card text-sm">
        <div><b>You:</b> {me.account.displayName} ({me.account.role === 'COMPANY_ADMIN' ? 'CEO' : me.account.jobTitle ?? me.account.role}) · badge {me.account.accountNumber}</div>
      </div>
    </div>
  );
}
