import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

export interface Medication {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
}

export interface Prescription {
  id: string;
  date: string;
  doctorName: string;
  medications: Medication[];
  diagnosis: string;
  nextFollowUp?: string;
}

/** The patient's prescriptions as cached server state (shared across tabs/cards). */
export function usePrescriptions(enabled = true) {
  const query = useQuery({
    queryKey: ['prescriptions', 'mine'],
    queryFn: async () => {
      const response = await apiClient.get('/prescriptions/my-prescriptions');
      return (response.data.data ?? []) as Prescription[];
    },
    enabled,
  });
  return {
    prescriptions: query.data ?? [],
    isLoading: query.isLoading,
  };
}
