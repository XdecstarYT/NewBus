import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { GET, ApiError } from './api';
import { useStore } from './store';
import { sfx } from './sound';

export interface Me {
  account: { id: string; number: string; name: string; role: 'OWNER' | 'ADMIN' | 'STAFF'; mustChangePassword: boolean; xp: number };
  company: { id: string; name: string; emoji: string; color: string; slogan: string; industry: string; status: string; prestige: number; installs: Record<string, number>; toolUses: number; xp: number; level: number; balance: number } | null;
  energy: { now: number; max: number; regen: number };
  unread: number;
}

export function useMe() {
  return useQuery<Me | { account: null; company: null }, ApiError>({ queryKey: ['me'], queryFn: () => GET('/auth/me'), retry: false, staleTime: 15_000, refetchInterval: 30_000 });
}

/** GET query helper. */
export function useApi<T = any>(key: QueryKey, url: string | null, opts: { refetchInterval?: number; enabled?: boolean } = {}) {
  return useQuery<T, ApiError>({ queryKey: key, queryFn: () => GET<T>(url!), enabled: !!url && opts.enabled !== false, refetchInterval: opts.refetchInterval, staleTime: 5_000 });
}

/** Mutation helper: toasts errors with a sad trombone, invalidates keys on success. */
export function useAction<V = any, R = any>(fn: (v: V) => Promise<R>, opts: { invalidate?: QueryKey[]; success?: string | ((r: R) => string | undefined); onSuccess?: (r: R, v: V) => void } = {}) {
  const qc = useQueryClient();
  const toast = useStore((s) => s.toast);
  return useMutation<R, ApiError, V>({
    mutationFn: fn,
    onSuccess: (r, v) => {
      for (const k of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: k });
      const msg = typeof opts.success === 'function' ? opts.success(r) : opts.success;
      if (msg) toast(msg, 'good');
      opts.onSuccess?.(r, v);
    },
    onError: (e) => {
      sfx.error();
      toast(e.message, 'bad');
    },
  });
}
