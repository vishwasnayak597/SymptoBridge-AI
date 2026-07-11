import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import toast from 'react-hot-toast';
import { getErrorMessage } from './errors';
import { idbStorage } from './idbStorage';

/**
 * Server state lives in React Query; this module owns the client + defaults.
 *
 * - Queries: cached 30s fresh / kept 24h so the IndexedDB persister can serve
 *   the last-known data instantly on reload or offline.
 * - Errors surface once, centrally, as toasts — individual components opt out
 *   with `meta: { silent: true }` when they render errors inline.
 * - 401s are excluded from toasts/retries: the axios interceptor already
 *   handles token refresh + redirect, so surfacing them here would double-report.
 */

function isAuthError(error: unknown): boolean {
  return (error as any)?.response?.status === 401;
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.meta?.silent || isAuthError(error)) return;
      // Only toast when there's no cached data to fall back on — a background
      // refetch failing over stale-but-visible data isn't worth interrupting for.
      if (query.state.data === undefined) {
        toast.error(getErrorMessage(error));
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.meta?.silent || isAuthError(error)) return;
      toast.error(getErrorMessage(error));
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      gcTime: 24 * 60 * 60 * 1000, // keep for the persister
      retry: (failureCount, error) => !isAuthError(error) && failureCount < 2,
      refetchOnWindowFocus: false,
    },
  },
});

/** Persists the dehydrated query cache to IndexedDB (no-op during SSR). */
export const queryPersister =
  typeof window !== 'undefined'
    ? createAsyncStoragePersister({ storage: idbStorage, key: 'sb-query-cache' })
    : undefined;
