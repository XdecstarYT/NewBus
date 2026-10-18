import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApi, useAction } from '../../lib/hooks';
import { POST } from '../../lib/api';
import { onWs, subscribe, unsubscribe } from '../../lib/ws';
import { LoadingJoke, EmptyState, Modal, timeAgo } from '../../components/ui';
import { sfx } from '../../lib/sound';
import { useGameMe } from './GameLayout';

const EMOTES = ['😀', '😂', '🔥', '👏', '🚀', '💸', '🤖', '🦆', '🍕', '❤️', '😮', '🎉'];

interface Msg {
  id: string;
  channel: string;
  accountId: string;
  senderName: string;
  text: string;
  createdAt: number;
}

/** Shared chat panel: channel list, live messages, emotes, report/block/DM, moderator delete. */
export function ChatPanel({ accountId, readOnly, canModerate }: { accountId: string; readOnly: boolean; canModerate: boolean }) {
  const qc = useQueryClient();
  const channels = useApi<{ channels: Array<{ id: string; label: string }>; killSwitch: boolean }>(['chat-channels'], '/chat/channels', { refetchInterval: 30_000 });
  const [channel, setChannel] = useState('global');
  const history = useApi<Msg[]>(['chat', channel], `/chat/history?channel=${encodeURIComponent(channel)}`);
  const [text, setText] = useState('');
  const [menu, setMenu] = useState<Msg | null>(null);
  const [reason, setReason] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = channels.data?.channels ?? [];
    if (list.length && !list.some((c) => c.id === channel)) setChannel(list[0].id);
  }, [channels.data, channel]);

  useEffect(() => {
    const ch = `chat:${channel}`;
    subscribe(ch);
    const off1 = onWs('chat', (m) => {
      if (m.message?.channel !== channel) {
        if (m.message?.channel?.startsWith('dm:')) qc.invalidateQueries({ queryKey: ['chat-channels'] });
        return;
      }
      qc.setQueryData<Msg[]>(['chat', channel], (old) => (old && !old.some((x) => x.id === m.message.id) ? [...old, m.message].slice(-200) : old));
      if (m.message.accountId !== accountId) sfx.click();
    });
    const off2 = onWs('chat_delete', (m) => qc.setQueryData<Msg[]>(['chat', channel], (old) => old?.filter((x) => x.id !== m.id)));
    return () => {
      off1();
      off2();
      unsubscribe(ch);
    };
  }, [channel, qc, accountId]);

  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [history.data?.length]);

  const send = useAction((t: string) => POST('/chat/send', { channel, text: t }), { onSuccess: (m: any) => qc.setQueryData<Msg[]>(['chat', channel], (old) => (old && !old.some((x) => x.id === m.id) ? [...old, m] : old)) });
  const dm = useAction((id: string) => POST<{ channel: string }>('/chat/dm', { accountId: id }), { onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['chat-channels'] }); setChannel(r.channel); setMenu(null); } });
  const block = useAction((id: string) => POST('/chat/block', { accountId: id, on: true }), { success: 'Blocked. You will not see their messages any more.', invalidate: [['chat', channel]], onSuccess: () => setMenu(null) });
  const report = useAction((v: { id: string; reason: string }) => POST('/chat/report', { targetType: 'message', targetId: v.id, reason: v.reason }), { success: 'Reported. A moderator will take a look. 🛡️', onSuccess: () => { setMenu(null); setReason(''); } });
  const del = useAction((id: string) => POST(`/mod/messages/${id}/delete`), { success: 'Message removed.', onSuccess: () => setMenu(null) });

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    send.mutate(t);
    setText('');
  };

  if (!channels.data) return <LoadingJoke />;
  return (
    <div className="flex flex-col md:flex-row gap-3 h-[calc(100vh-180px)] min-h-[420px]">
      <div className="card !p-2 md:w-56 flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto shrink-0" role="tablist" aria-label="Chat channels">
        {channels.data.channels.map((c) => (
          <button key={c.id} role="tab" aria-selected={c.id === channel} className={`btn-sm justify-start whitespace-nowrap ${c.id === channel ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setChannel(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="card !p-0 flex-1 flex flex-col min-h-0">
        {channels.data.killSwitch && <div className="bg-bad/20 text-sm p-2 text-center font-bold">🔇 Chat is switched off by the Owner right now.</div>}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2" aria-live="polite">
          {history.isLoading ? <LoadingJoke /> : history.error ? <EmptyState emoji="🔒" title="Can not read this channel" body={history.error.message} /> : !history.data?.length ? <EmptyState emoji="🦗" title="So quiet..." body="Be the first to say hi!" /> : null}
          {history.data?.map((m) => {
            const mine = m.accountId === accountId;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <button className={`text-left max-w-[80%] rounded-2xl px-3 py-2 ${mine ? 'bg-accent/20' : 'bg-ink/5'}`} onClick={() => !mine && m.accountId !== 'system' && setMenu(m)} aria-label={`Message from ${m.senderName}`}>
                  <div className="text-[11px] font-bold muted">{m.senderName} · {timeAgo(m.createdAt)}</div>
                  <div className="break-words whitespace-pre-wrap">{m.text}</div>
                </button>
              </div>
            );
          })}
          <div ref={bottom} />
        </div>
        <div className="border-t border-ink/10 p-2 flex flex-col gap-1">
          <div className="flex gap-1 flex-wrap">
            {EMOTES.map((e) => (
              <button key={e} className="chip" onClick={() => setText((t) => (t + e).slice(0, 400))} aria-label={`Add ${e}`} disabled={readOnly}>{e}</button>
            ))}
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <input className="input flex-1" maxLength={400} value={text} onChange={(e) => setText(e.target.value)} placeholder={readOnly ? 'Read-only' : 'Say something nice... (@badge to mention)'} disabled={readOnly} aria-label="Message" data-testid="chat-input" />
            <button className="btn-primary" disabled={readOnly || !text.trim() || send.isPending} data-testid="chat-send">Send</button>
          </form>
        </div>
      </div>
      <Modal open={!!menu} onClose={() => setMenu(null)} title={menu?.senderName}>
        {menu && (
          <div className="flex flex-col gap-2">
            <p className="italic text-sm">"{menu.text}"</p>
            {!readOnly && <button className="btn-ghost" onClick={() => dm.mutate(menu.accountId)}>✉️ Send a direct message</button>}
            {!readOnly && <button className="btn-ghost" onClick={() => block.mutate(menu.accountId)}>🚫 Block this player</button>}
            <label className="label">Report reason<input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="What is wrong with this message?" /></label>
            <button className="btn-bad" disabled={reason.trim().length < 2} onClick={() => report.mutate({ id: menu.id, reason })}>🚩 Report</button>
            {canModerate && <button className="btn-bad" onClick={() => del.mutate(menu.id)}>🗑️ Delete message (moderator)</button>}
          </div>
        )}
      </Modal>
    </div>
  );
}

export function ChatPage() {
  const me = useGameMe();
  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-3">
      <h1 className="h1">💬 Chat</h1>
      <ChatPanel accountId={me.account.id} readOnly={me.access.readOnly} canModerate={false} />
    </div>
  );
}
