/**
 * Live updates through Supabase Realtime. The API sends tiny "something changed"
 * hints (never game data) on a few topics; we refetch the matching queries.
 */
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import type { QueryClient } from '@tanstack/react-query';

// Public values: the project URL and its publishable key are meant to be in the browser.
const URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://rkrxszigtrjmboesxvhn.supabase.co';
const KEY = import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_BDms-cXmjZ4Be6N5MHlQ5w_DpEdzcDh';

type Hint = { t: string; [k: string]: unknown };
const listeners = new Set<(topic: string, h: Hint) => void>();
export const onHint = (fn: (topic: string, h: Hint) => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** What each hint should refresh. */
const REFRESH: Record<string, string[][]> = {
  stock: [['home'], ['me'], ['shop']],
  company: [['home'], ['me']],
  notify: [['me'], ['notifications'], ['requests']],
  news: [['news']],
  market: [['market']],
  shops: [['shops'], ['storefront']],
  union: [['unions'], ['union']],
  law: [['laws']],
  court: [['court'], ['case']],
  chat: [['chat']],
  pos: [['shop'], ['home'], ['me']],
  jobs: [['work'], ['owner', 'work']],
  customers: [['customers']],
  contracts: [['contracts']],
};

let client: ReturnType<typeof createClient> | null = null;
let channels: RealtimeChannel[] = [];

export function connectLive(qc: QueryClient, topics: string[]) {
  disconnectLive();
  if (!URL || !KEY) return;
  client ??= createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  channels = topics.map((topic) =>
    client!
      .channel(topic)
      .on('broadcast', { event: 'hint' }, ({ payload }) => {
        const h = payload as Hint;
        for (const key of REFRESH[h.t] ?? []) qc.invalidateQueries({ queryKey: key });
        for (const l of listeners) l(topic, h);
      })
      .subscribe(),
  );
}

export function disconnectLive() {
  for (const ch of channels) client?.removeChannel(ch);
  channels = [];
}
