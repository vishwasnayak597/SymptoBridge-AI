import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

export interface Medication {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions?: string;
}

export interface Prescription {
  id: string;
  prescriptionNumber?: string;
  date: string;
  doctorName: string;
  doctorSpecialization?: string;
  medications: Medication[];
  generalInstructions?: string;
  status: 'active' | 'completed' | 'cancelled';
  validTill?: string;
}

/**
 * `doctor` comes back populated ({ firstName, lastName, specialization }) from the
 * prescription routes, or as a bare ObjectId when a route forgets to populate it.
 * Reading `.doctorName` off the raw document — which is what this file used to do —
 * always yielded undefined, so the card rendered "Prescribed by " with nothing after it.
 */
export function doctorDisplayName(doctor: unknown): string {
  if (!doctor || typeof doctor !== 'object') return 'Your doctor';
  const { firstName, lastName } = doctor as { firstName?: string; lastName?: string };
  const name = [firstName, lastName].filter(Boolean).join(' ').trim();
  return name ? `Dr. ${name}` : 'Your doctor';
}

/** Normalises a prescription document from the API into the shape the UI renders. */
export function toPrescription(raw: any): Prescription {
  return {
    id: String(raw?.id ?? raw?._id ?? raw?.prescriptionNumber ?? ''),
    prescriptionNumber: raw?.prescriptionNumber,
    date: raw?.date ?? raw?.createdAt,
    doctorName: doctorDisplayName(raw?.doctor),
    doctorSpecialization:
      raw?.doctor && typeof raw.doctor === 'object' ? raw.doctor.specialization : undefined,
    medications: Array.isArray(raw?.medications) ? raw.medications : [],
    generalInstructions: raw?.generalInstructions || undefined,
    status: raw?.status ?? 'active',
    validTill: raw?.validTill || undefined,
  };
}

/** The patient's prescriptions as cached server state (shared across tabs/cards). */
export function usePrescriptions(enabled = true) {
  const query = useQuery({
    queryKey: ['prescriptions', 'mine'],
    queryFn: async () => {
      const response = await apiClient.get('/prescriptions/my-prescriptions');
      const rows = (response.data.data ?? []) as any[];
      return rows.map(toPrescription);
    },
    enabled,
  });
  return {
    prescriptions: query.data ?? [],
    isLoading: query.isLoading,
  };
}
