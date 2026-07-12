import { Appointment } from './types';

export function formatAppointmentDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'scheduled':
    case 'confirmed':
      return 'bg-blue-100 text-blue-800';
    case 'completed':
      return 'bg-green-100 text-green-800';
    case 'cancelled':
      return 'bg-red-100 text-red-800';
    case 'pending':
      return 'bg-yellow-100 text-yellow-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

/** Joinable from 10 minutes before the slot until 30 minutes after, once confirmed. */
export function canJoinVideoCall(appointment: Appointment): boolean {
  const minutesUntil = Math.floor(
    (new Date(appointment.appointmentDate).getTime() - Date.now()) / (1000 * 60)
  );
  return minutesUntil <= 10 && minutesUntil >= -30 && appointment.status === 'confirmed';
}

export function joinVideoCall(appointment: Appointment): void {
  window.location.href = appointment.videoCallLink || `/video-call?id=${appointment._id}`;
}
