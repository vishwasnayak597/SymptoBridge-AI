import React from 'react';
import { ArrowDownTrayIcon, CalendarDaysIcon, PlusIcon, VideoCameraIcon } from '@heroicons/react/24/outline';
import { apiClient } from '../../lib/api';
import { googleCalendarUrl, downloadIcs, CalendarEvent } from '../../lib/calendar';
import { useInvalidateAppointments } from '../../hooks/useAppointments';
import { Appointment } from './types';
import { AppointmentRating } from './AppointmentRating';
import { formatAppointmentDate, getStatusColor, canJoinVideoCall, joinVideoCall } from './utils';

function toCalendarEvent(appointment: Appointment): CalendarEvent {
  const doctorName = `Dr. ${appointment.doctor?.firstName ?? ''} ${appointment.doctor?.lastName ?? ''}`.trim();
  return {
    title: `Consultation with ${doctorName} — SymptoBridge`,
    description: `${appointment.consultationType} consultation (${appointment.doctor?.specialization ?? 'General'})`,
    startsAt: new Date(appointment.appointmentDate),
    durationMinutes: 30,
  };
}

/** Upcoming (not cancelled/completed) appointments are worth calendaring. */
function isUpcoming(appointment: Appointment): boolean {
  return (
    ['scheduled', 'confirmed', 'pending'].includes(appointment.status) &&
    new Date(appointment.appointmentDate).getTime() > Date.now()
  );
}

interface AppointmentsListProps {
  appointments: Appointment[];
  loading: boolean;
  /** Navigate the user to doctor search to start a new booking. */
  onBookNew: () => void;
}

/**
 * The patient's appointment history: list, status, video-call entry point,
 * and post-consultation rating. Owns the rating write (invalidates the shared
 * appointments query on success) so the page doesn't need to know about it.
 */
export default function AppointmentsList({ appointments, loading, onBookNew }: AppointmentsListProps) {
  const invalidateAppointments = useInvalidateAppointments();

  const submitRating = async (appointmentId: string, rating: number, review: string) => {
    await apiClient.post(`/appointments/${appointmentId}/rating`, { rating, review });
    await invalidateAppointments();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">My Appointments</h2>
        <button
          onClick={onBookNew}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <PlusIcon className="h-4 w-4 inline mr-2" />
          Book New Appointment
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8" role="status" aria-label="Loading appointments">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : appointments.length === 0 ? (
        <div className="text-center py-12">
          <CalendarDaysIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">No appointments yet</h3>
          <p className="mt-2 text-gray-500">Book your first appointment with a doctor</p>
          <button
            onClick={onBookNew}
            className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Find Doctors
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {appointments.map((appointment) => (
            <div key={appointment._id} className="bg-white rounded-lg shadow border p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3">
                    <div className="flex-shrink-0">
                      <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                        <span className="text-blue-600 font-medium">
                          {appointment.doctor?.firstName?.charAt(0) || 'D'}{appointment.doctor?.lastName?.charAt(0) || 'R'}
                        </span>
                      </div>
                    </div>
                    <div>
                      <h3 className="text-lg font-medium text-gray-900">
                        Dr. {appointment.doctor?.firstName || 'Unknown'} {appointment.doctor?.lastName || 'Doctor'}
                      </h3>
                      <p className="text-sm text-gray-500">{appointment.doctor?.specialization || 'General Medicine'}</p>
                      {appointment.forDependent && (
                        <span className="inline-block mt-1 px-2 py-0.5 bg-purple-50 text-purple-700 text-xs font-medium rounded-full">
                          For: {appointment.forDependent.name} ({appointment.forDependent.relation})
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-medium text-gray-700">Date & Time</p>
                      <p className="text-sm text-gray-600">{formatAppointmentDate(appointment.appointmentDate)}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700">Consultation Type</p>
                      <p className="text-sm text-gray-600 capitalize">{appointment.consultationType}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700">Symptoms</p>
                      <p className="text-sm text-gray-600">{appointment.symptoms}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700">Fee</p>
                      <p className="text-sm text-gray-600">₹{appointment.fee}</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end space-y-2">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(appointment.status)}`}>
                    {appointment.status.charAt(0).toUpperCase() + appointment.status.slice(1)}
                  </span>

                  {appointment.consultationType === 'video' && canJoinVideoCall(appointment) && (
                    <button
                      onClick={() => joinVideoCall(appointment)}
                      className="px-3 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-1"
                    >
                      <VideoCameraIcon className="h-4 w-4" />
                      <span>Join Call</span>
                    </button>
                  )}

                  {appointment.consultationType === 'video' && !canJoinVideoCall(appointment) && appointment.status === 'confirmed' && (
                    <p className="text-xs text-gray-500">Call available 10 min before</p>
                  )}
                </div>
              </div>

              {isUpcoming(appointment) && (
                <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-gray-500">Add to calendar:</span>
                  <a
                    href={googleCalendarUrl(toCalendarEvent(appointment))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-blue-600 hover:text-blue-800"
                  >
                    <CalendarDaysIcon className="h-4 w-4 mr-1" />
                    Google Calendar
                  </a>
                  <button
                    type="button"
                    onClick={() => downloadIcs(toCalendarEvent(appointment))}
                    className="inline-flex items-center text-blue-600 hover:text-blue-800"
                  >
                    <ArrowDownTrayIcon className="h-4 w-4 mr-1" />
                    Download invite (.ics)
                  </button>
                </div>
              )}

              {appointment.status === 'completed' && (
                <AppointmentRating appointment={appointment} onSubmit={submitRating} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
