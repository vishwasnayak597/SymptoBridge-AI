import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { getSocket } from '../../lib/socket';

export const WAITLIST_KEY = ['waitlist', 'mine'] as const;

export interface WaitlistItem {
  _id: string;
  /** Clinic calendar day, YYYY-MM-DD. */
  date: string;
  status: 'waiting' | 'offered';
  doctor: {
    _id: string;
    firstName: string;
    lastName: string;
    specialization?: string;
    consultationFee?: number;
  };
  /** Place in line while waiting; null once offered. */
  position: number | null;
  /** The instant held for this patient, once offered. */
  offeredSlot: string | null;
  offerExpiresAt: string | null;
}

/**
 * The patient's waitlist entries. Refreshes the moment an offer is made (socket push
 * from WaitlistService.offerNext), and polls while an offer is live so an expiry or
 * a cascade shows up without a reload.
 */
export function useWaitlist(enabled = true) {
  const client = useQueryClient();

  const query = useQuery({
    queryKey: WAITLIST_KEY,
    queryFn: async () => {
      const response = await apiClient.get('/appointments/waitlist/mine');
      return (response.data.data ?? []) as WaitlistItem[];
    },
    enabled,
    refetchInterval: (q) =>
      (q.state.data as WaitlistItem[] | undefined)?.some((item) => item.status === 'offered') ? 30000 : false,
  });

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onOffer = () => client.invalidateQueries({ queryKey: WAITLIST_KEY });
    socket.on('waitlist:offer', onOffer);
    return () => {
      socket.off('waitlist:offer', onOffer);
    };
  }, [client]);

  return {
    items: query.data ?? [],
    isLoading: query.isLoading,
    refresh: () => client.invalidateQueries({ queryKey: WAITLIST_KEY }),
  };
}
