import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api';

const UNREAD_COUNT_KEY = ['notifications', 'unread-count'] as const;

/**
 * Unread-notification badge count, polled in the background.
 *
 * Replaces the per-dashboard fetch + setInterval: React Query dedupes the
 * request across components, pauses polling when the tab is hidden, and the
 * NotificationPanel pushes authoritative counts into the same cache entry via
 * `useSetUnreadCount`, so every badge stays in sync.
 */
export function useUnreadNotificationCount(enabled = true) {
  const { data } = useQuery({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: async () => {
      const response = await apiClient.get('/notifications/unread-count');
      return (response.data.data?.count as number) ?? 0;
    },
    enabled,
    refetchInterval: 30 * 1000,
    meta: { silent: true }, // a failed badge poll shouldn't toast
  });
  return data ?? 0;
}

/** Write-through for components that already know the fresh count. */
export function useSetUnreadCount() {
  const client = useQueryClient();
  return (count: number) => client.setQueryData(UNREAD_COUNT_KEY, count);
}
