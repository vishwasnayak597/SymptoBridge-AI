import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api';

const APPOINTMENTS_KEY = ['appointments', 'mine'] as const;

/**
 * The current user's appointments as server state.
 *
 * Cached (and persisted to IndexedDB), so dashboards render the last-known
 * list instantly — including offline — while a background refetch runs.
 * Mutations (booking, rating, cancel) call `invalidate()` instead of manually
 * refetching and juggling loading flags.
 */
export function useAppointments<T = any>(enabled = true) {
  const query = useQuery({
    queryKey: APPOINTMENTS_KEY,
    queryFn: async () => {
      const response = await apiClient.get('/appointments');
      const list = response.data.data?.appointments;
      return (Array.isArray(list) ? list : []) as T[];
    },
    enabled,
  });

  return {
    appointments: query.data ?? ([] as T[]),
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

/** Invalidate + refetch the appointments list after a write. */
export function useInvalidateAppointments() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: APPOINTMENTS_KEY });
}
