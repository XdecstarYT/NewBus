import { useState } from 'react';
import { Link } from 'react-router';
import { formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST, PATCH } from '../../lib/api';
import { LoadingJoke, EmptyState, ProgressBar, Tabs, Toggle, useConfirm } from '../../components/ui';
import { useGameMe, useBase } from './GameLayout';

const ROLE_BADGE: Record<string, string> = { leader: '👑 Leader', officer: '⭐ Officer', member: '🙂 Member' };

/** Guilds: your guild (treasury, perk, quest, party, members) or browse/create; plus mentorship. */
export function Guilds() {
  const [tab, setTab] = useState<'guild' | 'browse' | 'mentor'>('guild');
  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-4">
      <h1 className="h1">🛡️ Guilds & Friends</h1>
      <Tabs tabs={[{ id: 'guild', label: 'My guild' }, { id: 'browse', label: 'Browse guilds' }, { id: 'mentor', label: '🎓 Mentorship' }]} value={tab} onChange={setTab} />
      {tab === 'guild' && <MyGuild onBrowse={() => setTab('browse')} />}
      {tab === 'browse' && <BrowseGuilds />}
      {tab === 'mentor' && <Mentorship />}
    </div>
  );
}

function MyGuild({ onBrowse }: { onBrowse: () => void }) {
  const me = useGameMe();
  const base = useBase();
  const confirm = useConfirm();
  const q = useApi<any>(['guild'], '/game/guilds');
  const inv = [['guild'], ['guild-list'], ['state', me.access.companyId]];
  const [form, setForm] = useState({ name: '', emoji: '🛡️', motto: '' });
  const [amount, setAmount] = useState(500);
  const create = useAction(() => POST('/game/guilds', form), { invalidate: inv, success: '🛡️ Guild founded! Invite your friends.' });
  const deposit = useAction(() => POST('/game/guilds/deposit', { amount }), { invalidate: inv, success: 'Deposited! The guild grows stronger. 💪' });
  const leave = useAction(() => POST('/game/guilds/leave'), { invalidate: inv, success: 'You left the guild.' });
  const party = useAction(() => POST('/game/guilds/party'), { invalidate: inv, success: '🎉 PARTY! Everyone earns more for a while.' });
  const act = useAction((v: { url: string; body?: any }) => POST(v.url, v.body ?? {}), { invalidate: inv, success: 'Done.' });
  const patch = useAction((v: any) => PATCH('/game/guilds', v), { invalidate: inv });
  if (!q.data) return <LoadingJoke />;
  const ro = me.access.readOnly;
  if (!q.data.guild) {
    return (
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card flex flex-col gap-2">
          <h2 className="h2">Found a guild</h2>
          <p className="text-sm muted">Costs {formatBits(q.data.createCost)}. Members share a treasury, quests and an income perk that grows with the guild level.</p>
          <div className="flex gap-2">
            <input className="input w-16 text-center" value={form.emoji} maxLength={4} onChange={(e) => setForm({ ...form, emoji: e.target.value })} aria-label="Guild emoji" />
            <input className="input flex-1" placeholder="Guild name" value={form.name} maxLength={32} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <input className="input" placeholder="Motto" value={form.motto} maxLength={120} onChange={(e) => setForm({ ...form, motto: e.target.value })} />
          <button className="btn-primary" disabled={ro || form.name.trim().length < 3 || create.isPending} onClick={() => create.mutate(undefined)} data-testid="create-guild">Found guild</button>
        </div>
        <div className="card flex flex-col gap-2 items-start">
          <h2 className="h2">...or join one</h2>
          <p className="text-sm muted">Open guilds accept anyone. Find one with a motto you like!</p>
          <button className="btn-ghost" onClick={onBrowse}>Browse guilds →</button>
        </div>
      </div>
    );
  }
  const g = q.data.guild;
  const lead = q.data.myRole === 'leader';
  const officer = lead || q.data.myRole === 'officer';
  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-wrap items-center gap-4">
        <div className="text-6xl">{g.emoji}</div>
        <div className="flex-1 min-w-[200px]">
          <h2 className="h2">{g.name} <span className="chip">Lv {g.level}</span></h2>
          <p className="italic muted">{g.motto || 'No motto yet.'}</p>
          <ProgressBar value={g.xp} max={g.nextLevelXp} label={`XP ${g.xp} / ${g.nextLevelXp}`} className="mt-2" />
        </div>
        <div className="text-right">
          <div className="text-xs muted">Treasury</div>
          <div className="text-2xl font-extrabold">{formatBits(g.treasury)}</div>
          <div className="chip">📈 +{g.perkPct}% income for all members</div>
        </div>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        <div className="card flex flex-col gap-2">
          <div className="h3">🏆 Daily guild quest</div>
          <p className="text-sm">Together, earn {formatBits(g.quest.target)} today.</p>
          <ProgressBar value={Math.min(g.quest.progress, g.quest.target)} max={g.quest.target} color="bg-good" />
          <p className="text-xs muted">{g.quest.done ? '✅ Done! Come back tomorrow.' : `Reward: ${formatBits(g.quest.reward)} to the treasury + XP`}</p>
        </div>
        <div className="card flex flex-col gap-2">
          <div className="h3">💰 Deposit</div>
          <input type="number" className="input" min={1} value={amount} onChange={(e) => setAmount(Math.max(1, Math.floor(Number(e.target.value))))} aria-label="Deposit amount" />
          <button className="btn-primary" disabled={ro || deposit.isPending} onClick={() => deposit.mutate(undefined)}>Deposit to treasury</button>
          <p className="text-xs muted">Deposits give the guild XP (and count as generosity on the leaderboard).</p>
        </div>
        <div className="card flex flex-col gap-2">
          <div className="h3">🎉 Guild party</div>
          <p className="text-sm">Treasury pays {formatBits(g.partyCost)} to boost every member's income.</p>
          <button className="btn-good" disabled={ro || !officer || g.treasury < g.partyCost} onClick={() => party.mutate(undefined)}>Throw a party</button>
          {!officer && <p className="text-xs muted">Leaders and officers can throw parties.</p>}
        </div>
      </div>
      <div className="card !p-0 overflow-x-auto">
        <div className="flex items-center gap-2 p-3">
          <div className="h3 mr-auto">👥 Members ({q.data.members.length}/{g.maxMembers})</div>
          {lead && <Toggle checked={g.open} onChange={(v) => patch.mutate({ open: v })} label="Open to anyone" disabled={ro} />}
          <Link className="btn-ghost btn-sm" to={`${base}/chat`}>💬 Guild chat</Link>
        </div>
        <table className="table-clean text-sm">
          <thead><tr><th>Company</th><th>Role</th><th>Lv</th><th>Earned today</th><th>Deposited</th><th></th></tr></thead>
          <tbody>
            {q.data.members.map((m: any) => (
              <tr key={m.companyId}>
                <td><Link className="underline" to={`${base}/profiles/${m.companyId}`}>{m.emoji} {m.name}</Link></td>
                <td>{ROLE_BADGE[m.role]}</td>
                <td>{m.level}</td>
                <td>{formatBits(m.earnedToday)}</td>
                <td>{formatBits(m.deposits)}</td>
                <td className="whitespace-nowrap">
                  {lead && m.companyId !== me.access.companyId && (
                    <>
                      <button className="btn-ghost btn-sm" disabled={ro} onClick={() => { const a = window.prompt(`Pay ${m.name} from the treasury (max ${g.maxPayoutPerDay}/day):`, '100'); if (a) act.mutate({ url: '/game/guilds/payout', body: { companyId: m.companyId, amount: Math.floor(Number(a)) } }); }}>💸</button>
                      <button className="btn-ghost btn-sm" disabled={ro} onClick={() => act.mutate({ url: '/game/guilds/role', body: { companyId: m.companyId, role: m.role === 'officer' ? 'member' : 'officer' } })}>{m.role === 'officer' ? '⬇️' : '⭐'}</button>
                      <button className="btn-ghost btn-sm" disabled={ro} onClick={async () => (await confirm({ title: `Make ${m.name} the leader?`, body: 'You will become an officer.' })) && act.mutate({ url: '/game/guilds/role', body: { companyId: m.companyId, role: 'leader' } })}>👑</button>
                    </>
                  )}
                  {officer && m.role !== 'leader' && m.companyId !== me.access.companyId && (
                    <button className="btn-bad btn-sm" disabled={ro} onClick={async () => (await confirm({ title: `Kick ${m.name}?`, danger: true })) && act.mutate({ url: '/game/guilds/kick', body: { companyId: m.companyId } })}>Kick</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn-ghost self-start" disabled={ro} onClick={async () => (await confirm({ title: 'Leave the guild?', body: q.data.members.length === 1 ? 'You are the last member: the guild disbands and the treasury comes back to you.' : 'You can join another one any time.', danger: true })) && leave.mutate(undefined)}>🚪 Leave guild</button>
    </div>
  );
}

function BrowseGuilds() {
  const me = useGameMe();
  const q = useApi<any[]>(['guild-list'], '/game/guilds/list');
  const mine = useApi<any>(['guild'], '/game/guilds');
  const join = useAction((id: string) => POST(`/game/guilds/${id}/join`), { invalidate: [['guild'], ['guild-list']], success: '🎉 Welcome to the guild!' });
  if (!q.data) return <LoadingJoke />;
  if (!q.data.length) return <EmptyState emoji="🏰" title="No guilds yet" body="Be the first to found one!" />;
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {q.data.map((g) => (
        <div key={g.id} className="card flex flex-col gap-1">
          <div className="flex items-center gap-2"><span className="text-3xl">{g.emoji}</span><b className="flex-1">{g.name}</b><span className="chip">Lv {g.level}</span></div>
          <p className="italic text-sm muted">{g.motto}</p>
          <p className="text-xs">👑 {g.leader} · 👥 {g.members} · 💰 {formatBits(g.treasury)}</p>
          {!mine.data?.guild && <button className="btn-primary btn-sm self-start" disabled={me.access.readOnly || !g.open} onClick={() => join.mutate(g.id)}>{g.open ? 'Join' : '🔒 Invite only'}</button>}
        </div>
      ))}
    </div>
  );
}

function Mentorship() {
  const me = useGameMe();
  const q = useApi<any>(['mentorship'], '/game/guilds/mentorship');
  const act = useAction((v: { url: string; body?: any }) => POST(v.url, v.body ?? {}), { invalidate: [['mentorship']], success: 'Done!' });
  if (!q.data) return <LoadingJoke />;
  const d = q.data;
  if (!d.enabled) return <EmptyState emoji="🎓" title="Mentorship is off" body="The Owner has switched mentorship off for now." />;
  const ro = me.access.readOnly;
  return (
    <div className="flex flex-col gap-4">
      <div className="card text-sm">
        🎓 Veterans (level {d.config.minMentorLevel}+) can mentor newcomers (level {d.config.maxMenteeLevel} or below). Every level the mentee gains pays you both a little; graduating at level {d.config.graduateLevel} pays {formatBits(d.config.graduationReward)} each!
      </div>
      {d.current.length > 0 && (
        <div className="card flex flex-col gap-2">
          <div className="h3">Current</div>
          {d.current.map((m: any) => (
            <div key={m.id} className="card-flat flex items-center gap-2 text-sm flex-wrap">
              <span>{m.role === 'mentor' ? 'You mentor' : 'Your mentor:'} <b>{m.other?.emoji} {m.other?.name}</b> (Lv {m.other?.level})</span>
              <span className="chip">{m.status}</span>
              <span className="ml-auto flex gap-1">
                {m.status === 'pending' && m.role === 'mentee' && <><button className="btn-good btn-sm" disabled={ro} onClick={() => act.mutate({ url: `/game/guilds/mentorship/${m.id}/respond`, body: { accept: true } })}>Accept</button><button className="btn-ghost btn-sm" disabled={ro} onClick={() => act.mutate({ url: `/game/guilds/mentorship/${m.id}/respond`, body: { accept: false } })}>Decline</button></>}
                <button className="btn-ghost btn-sm" disabled={ro} onClick={() => act.mutate({ url: `/game/guilds/mentorship/${m.id}/end` })}>End</button>
              </span>
            </div>
          ))}
        </div>
      )}
      {d.canMentor ? (
        <div className="card flex flex-col gap-2">
          <div className="h3">Newcomers looking for a mentor</div>
          {!d.newcomers.length ? <p className="text-sm muted">Nobody right now.</p> : d.newcomers.map((n: any) => (
            <div key={n.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{n.emoji} {n.name} · Lv {n.level}</span>
              <button className="btn-primary btn-sm" disabled={ro} onClick={() => act.mutate({ url: '/game/guilds/mentorship/offer', body: { companyId: n.id } })}>Offer to mentor</button>
            </div>
          ))}
        </div>
      ) : !d.canBeMentored ? <p className="text-sm muted">Reach level {d.config.minMentorLevel} to become a mentor.</p> : !d.current.length && <p className="text-sm muted">A veteran may offer to mentor you - watch your notifications!</p>}
      {d.past.length > 0 && <p className="text-sm">🎓 Graduates: {d.past.map((m: any) => `${m.other?.emoji} ${m.other?.name}`).join(', ')}</p>}
    </div>
  );
}
