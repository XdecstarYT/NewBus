import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatBits } from '@dw/shared';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { onWs } from '../../lib/ws';
import { useStore } from '../../lib/store';
import { sfx } from '../../lib/sound';
import { Modal, timeAgo, EmptyState } from '../../components/ui';
import { useGameMe } from './GameLayout';

/** Bell with unread badge + notification centre (claimable rewards, alerts). */
export function NotificationBell() {
  const me = useGameMe();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useApi<any>(['notifications'], '/game/notifications', { refetchInterval: 60_000 });
  const toast = useStore((s) => s.toast);
  useEffect(
    () =>
      onWs('notification', (m) => {
        qc.invalidateQueries({ queryKey: ['notifications'] });
        toast(m.item.title, 'info', '🔔');
        if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification(m.item.title, { body: m.item.body, icon: '/icon.svg' });
      }),
    [qc, toast],
  );
  const read = useAction(() => POST('/game/notifications/read'), { invalidate: [['notifications']] });
  const claim = useAction((id: string) => POST(`/game/notifications/${id}/claim`), {
    invalidate: [['notifications'], ['state']],
    onSuccess: (r) => {
      sfx.bigCoin();
      useStore.getState().confetti();
      toast(`Claimed ${formatBits(r.paid)}!`, 'good');
    },
  });
  const unread = q.data?.unread ?? 0;
  return (
    <>
      <button className="btn-ghost btn-sm relative" onClick={() => { setOpen(true); if (unread && !me.access.readOnly) read.mutate(undefined); }} aria-label={`Notifications (${unread} unread)`}>
        🔔
        {unread > 0 && <span className="absolute -top-2 -right-2 bg-bad text-white text-[10px] font-bold rounded-full min-w-[20px] h-5 px-1 flex items-center justify-center border-2 border-ink">{unread > 99 ? '99+' : unread}</span>}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="🔔 Notifications">
        {'Notification' in window && Notification.permission === 'default' && (
          <button className="btn-ghost btn-sm mb-2" onClick={() => Notification.requestPermission()}>📲 Enable push notifications</button>
        )}
        {!q.data?.items?.length ? (
          <EmptyState emoji="📭" title="All caught up!" body="No news is good news. Probably." />
        ) : (
          <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
            {q.data.items.map((n: any) => (
              <div key={n.id} className={`card-flat text-sm ${!n.read ? '!border-accent' : ''}`}>
                <div className="font-bold">{n.title}</div>
                {n.body && <div className="muted">{n.body}</div>}
                <div className="flex items-center mt-1">
                  <span className="text-xs muted">{timeAgo(n.createdAt)}</span>
                  {n.reward && !n.claimed && !me.access.readOnly && (
                    <button className="btn-good btn-sm ml-auto" onClick={() => claim.mutate(n.id)}>🎁 Claim {formatBits(n.reward)}</button>
                  )}
                  {n.reward && n.claimed && <span className="chip ml-auto">claimed ✅</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
