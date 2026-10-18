import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { onWs } from '../../lib/ws';
import { LoadingJoke, EmptyState, timeAgo } from '../../components/ui';
import { BossByteFace } from '../../components/BossByte';
import { useGameMe } from './GameLayout';

const EMOTES = ['👏', '😂', '🔥', '😮', '💸', '🚀'];

/** The Daily Byte - auto-generated headlines about real in-game activity. */
export function News() {
  const me = useGameMe();
  const q = useApi<any[]>(['news'], '/game/news');
  const qc = useQueryClient();
  useEffect(() => onWs('news', () => qc.invalidateQueries({ queryKey: ['news'] })), [qc]);
  const react = useAction((v: { id: string; emoji: string }) => POST(`/game/news/${v.id}/react`, { emoji: v.emoji }), { invalidate: [['news']] });
  if (q.isLoading) return <LoadingJoke />;
  const items = q.data ?? [];
  const lead = items.find((n) => n.kind === 'headline');
  const column = items.find((n) => n.kind === 'column');
  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <div className="text-center border-b-4 border-double border-ink pb-2">
        <div className="font-display font-extrabold text-4xl tracking-tight">📰 The Daily Byte</div>
        <div className="text-xs muted uppercase tracking-widest">{new Date().toDateString()} · All the news that fits in a byte · Price: free (Bits not accepted)</div>
      </div>
      {!items.length ? (
        <EmptyState emoji="🗞️" title="Slow news day" body="Nothing has happened yet. Go make some headlines!" />
      ) : (
        <>
          {lead && (
            <div className="card">
              <div className="text-xs font-bold muted uppercase">Top story</div>
              <h2 className="font-display font-extrabold text-2xl">{lead.headline}</h2>
              <p className="italic">{lead.body}</p>
            </div>
          )}
          {column && (
            <div className="card flex gap-3">
              <BossByteFace size={56} />
              <div>
                <div className="text-xs font-bold muted uppercase">Boss Byte's weekly column</div>
                <div className="font-bold">{column.headline}</div>
                <p className="text-sm">{column.body}</p>
              </div>
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            {items.filter((n) => n !== lead && n !== column).map((n) => (
              <div key={n.id} className="card !p-3">
                <div className="text-[10px] font-bold muted uppercase">{n.kind === 'classified' ? '📌 Classified' : n.kind === 'market' ? '📈 Market report' : '🗞️ News'} · {timeAgo(n.createdAt)}</div>
                <div className="font-bold">{n.headline}</div>
                {n.body && <div className="text-sm muted">{n.body}</div>}
                <div className="flex gap-1 mt-2 flex-wrap">
                  {EMOTES.map((e) => (
                    <button key={e} className="chip" disabled={me.access.readOnly} onClick={() => react.mutate({ id: n.id, emoji: e })} aria-label={`React ${e}`}>
                      {e} {n.reactions?.[e] ?? ''}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
