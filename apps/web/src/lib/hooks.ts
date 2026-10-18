import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { GET, ApiError } from './api';
import { useStore } from './store';
import { sfx } from './sound';

export interface Me {
  account: { id: string; accountNumber: string; displayName: string; role: string; jobTitle: string | null; mustChangePassword: boolean; tutorialDone: boolean; totpEnabled: boolean; settings: Record<string, unknown> };
  access: { companyId: string | null; modules: Record<string, boolean>; limits: any; readOnly: boolean; viewAs: boolean; moderatorTools: string[] };
  company: { id: string; name: string; emoji: string; color: string; slogan: string; industryId: string; industryName: string; industryEmoji: string; level: number; status: string } | null;
  flags: Record<string, boolean>;
  announcement: string | null;
  tickMs: number;
}

export function useMe() {
  return useQuery<Me, ApiError>({ queryKey: ['me'], queryFn: () => GET<Me>('/auth/me'), retry: false, staleTime: 30_000 });
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
