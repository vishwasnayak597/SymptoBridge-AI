import React, { useState, useEffect, useRef } from 'react';
import {
  XMarkIcon,
  CalendarDaysIcon,
  ClockIcon,
  VideoCameraIcon,
  BuildingOffice2Icon,
  UserIcon,
  PhoneIcon,
  CreditCardIcon,
  ChevronLeftIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { apiClient } from '../lib/api';
import { newIdempotencyKey } from '../lib/idempotency';
import { useAuthContext } from './AuthProvider';
import PaymentProcessor from './PaymentProcessor';

interface Doctor {
  id: string;
  name: string;
  specialization: string;
  consultationFee: number;
  avatar?: string;
  location?: {
    address: string;
    city: string;
  };
  availability?: {
    timeSlots: string[];
  };
}

interface AppointmentBookingProps {
  doctor: Doctor;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (appointmentData: any) => void;
}

const APPOINTMENT_TYPES = [
  { id: 'video', name: 'Video Consultation', icon: VideoCameraIcon, price: 0 },
  { id: 'in-person', name: 'Clinic Visit', icon: BuildingOffice2Icon, price: 0 },
  { id: 'phone', name: 'Phone Consultation', icon: PhoneIcon, price: 0 }
];

const TIME_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
  '17:00', '17:30'
];

// Helper function to generate available dates for appointment booking
const generateDate = () => {
  const dates = [];
  const today = new Date();
  
  // Generate next 14 days (2 weeks) for appointment booking
  for (let i = 0; i < 14; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    
    // Format the date for display
    const options: Intl.DateTimeFormatOptions = { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric' 
    };
    const label = date.toLocaleDateString('en-US', options);
    
    // Generate value in YYYY-MM-DD format
    const value = date.toISOString().split('T')[0];
    
    dates.push({
      value,
      label,
      isToday: i === 0
    });
  }
  
  return dates;
};

// Helper function to format time for display
const formatTimeForDisplay = (time: string): string => {
  const [hours, minutes] = time.split(':');
  const hour24 = parseInt(hours);
  const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
  const ampm = hour24 >= 12 ? 'PM' : 'AM';
  return `${hour12.toString().padStart(2, '0')}:${minutes} ${ampm}`;
};

const AppointmentBooking: React.FC<AppointmentBookingProps> = ({
  doctor,
  isOpen,
  onClose,
  onSuccess
}) => {
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [selectedType, setSelectedType] = useState('video');
  const [symptoms, setSymptoms] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPayment, setShowPayment] = useState(false);
  const [appointmentData, setAppointmentData] = useState<any>(null);
  const [createdAppointmentId, setCreatedAppointmentId] = useState<string>('');
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  // Family accounts: who this appointment is for ('self' or a dependent index).
  const { user, refreshUser } = useAuthContext();
  const dependents = ((user as any)?.dependents ?? []) as Array<{ name: string; relation: string }>;
  const [forWhom, setForWhom] = useState<'self' | number>('self');
  const [showAddDependent, setShowAddDependent] = useState(false);
  const [newDependent, setNewDependent] = useState({ name: '', relation: '' });
  const [joiningWaitlist, setJoiningWaitlist] = useState(false);

  const handleAddDependent = async () => {
    if (!newDependent.name.trim() || !newDependent.relation.trim()) {
      toast.error('Please enter a name and relation');
      return;
    }
    try {
      await apiClient.put('/users/dependents', {
        dependents: [...dependents, { name: newDependent.name.trim(), relation: newDependent.relation.trim() }],
      });
      await refreshUser();
      setForWhom(dependents.length); // select the newly added member
      setNewDependent({ name: '', relation: '' });
      setShowAddDependent(false);
      toast.success('Family member added');
    } catch {
      toast.error('Could not add family member');
    }
  };

  const handleJoinWaitlist = async () => {
    try {
      setJoiningWaitlist(true);
      await apiClient.post('/appointments/waitlist', { doctorId: doctor.id, date: selectedDate });
      toast.success("You're on the waitlist — we'll notify you if a slot frees up.");
    } catch {
      toast.error('Could not join the waitlist. Please try again.');
    } finally {
      setJoiningWaitlist(false);
    }
  };

  // Fetch available time slots when date is selected
  const fetchAvailableSlots = async (date: string) => {
    if (!date || !doctor.id) return;
    
    try {
      setSlotsLoading(true);
      const response = await apiClient.get(`/appointments/availability/${doctor.id}/${date}`);
      
      if (response.data.success) {
        setAvailableSlots(response.data.data.availableSlots);
      }
    } catch (error) {
      console.error('Error fetching available slots:', error);
      setAvailableSlots(TIME_SLOTS); // Fallback to all slots
    } finally {
      setSlotsLoading(false);
    }
  };

  // Update available slots when date changes
  useEffect(() => {
    if (selectedDate) {
      fetchAvailableSlots(selectedDate);
      setSelectedTime(''); // Reset selected time when date changes
    }
  }, [selectedDate, doctor.id]);

  // One idempotency key per logical booking: retries (double-click, network
  // timeout) replay the same booking server-side instead of creating a second
  // appointment. Regenerated only after a booking succeeds.
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!selectedDate || !selectedTime || !symptoms.trim()) {
      setError('Please fill in all fields');
      return;
    }

    if (symptoms.trim().length < 10) {
      setError('Symptoms must be at least 10 characters long');
      return;
    }

    try {
      setLoading(true);

      // Create appointment date
      const appointmentDate = new Date(`${selectedDate}T${selectedTime}`);
      
      const appointmentPayload = {
        doctorId: doctor.id,
        appointmentDate: appointmentDate.toISOString(),
        duration: 30,
        consultationType: selectedType,
        symptoms: symptoms.trim(),
        specialization: doctor.specialization,
        fee: doctor.consultationFee,
        paymentStatus: 'pending',
        ...(forWhom !== 'self' && dependents[forWhom]
          ? { forDependent: { name: dependents[forWhom].name, relation: dependents[forWhom].relation } }
          : {})
      };

      
      // First create the appointment to get real ID
      const response = await apiClient.post('/appointments', appointmentPayload, {
        headers: { 'Idempotency-Key': idempotencyKeyRef.current },
      });

      if (response.data.success) {
        const createdAppointment = response.data.data;
        idempotencyKeyRef.current = newIdempotencyKey();

        setAppointmentData(appointmentPayload);
        setCreatedAppointmentId(createdAppointment._id || createdAppointment.id);
        setShowPayment(true);
      } else {
        setError(response.data.message || 'Failed to create appointment');
      }
    } catch (error: any) {
      console.error('Error creating appointment:', error);
      if (error.response?.data?.message) {
        setError(error.response.data.message);
      } else {
        setError('Failed to create appointment. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentSuccess = async (paymentId: string) => {
    try {
      setLoading(true);
      
      // Update appointment with payment information
      const response =         await apiClient.put(`/appointments/${createdAppointmentId}`, {
          paymentId,
          paymentStatus: 'paid'
        });

      if (response.data.success) {
        onSuccess({
          ...response.data.data,
          doctor: doctor
        });
        onClose();
      } else {
        setError(response.data.message || 'Failed to update appointment payment');
        setShowPayment(false);
      }
    } catch (error: any) {
      console.error('Error updating appointment payment:', error);
      if (error.response?.data?.message) {
        setError(error.response.data.message);
      } else {
        setError('Failed to update appointment payment. Please try again.');
      }
      setShowPayment(false);
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentFailure = (error: string) => {
    setError(`Payment failed: ${error}`);
    setShowPayment(false);
  };

  const handlePaymentCancel = () => {
    setShowPayment(false);
  };

  if (!isOpen) return null;

  const dates = generateDate();
  const totalFee = doctor.consultationFee;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {!showPayment ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center">
                  <span className="text-white font-semibold">
                    {doctor.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </span>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Book Appointment</h2>
                  <p className="text-gray-600">{doctor.name} • {doctor.specialization}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <XMarkIcon className="h-6 w-6 text-gray-400" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              {/* Error Message */}
              {error && (
                <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
                  {error}
                </div>
              )}

              {/* Appointment Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Consultation Type
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {APPOINTMENT_TYPES.map((type) => {
                    const Icon = type.icon;
                    return (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => setSelectedType(type.id)}
                        className={`p-4 border-2 rounded-lg text-left transition-colors ${
                          selectedType === type.id
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <Icon className="h-6 w-6 text-blue-600 mb-2" />
                        <div className="font-medium text-gray-900">{type.name}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Date Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Select Date
                </label>
                <div className="grid grid-cols-7 gap-2">
                  {dates.map((date) => (
                    <button
                      key={date.value}
                      type="button"
                      onClick={() => setSelectedDate(date.value)}
                      className={`p-3 text-center border rounded-lg transition-colors ${
                        selectedDate === date.value
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 hover:border-gray-300'
                      } ${date.isToday ? 'font-semibold' : ''}`}
                    >
                      <div className="text-xs text-gray-500">
                        {date.label.split(' ')[0]}
                      </div>
                      <div className="text-sm font-medium">
                        {date.label.split(' ')[2]}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Time Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Select Time {selectedDate && (
                    <span className="text-sm text-gray-500">
                      (Available slots for {new Date(selectedDate).toLocaleDateString()})
                    </span>
                  )}
                </label>
                {!selectedDate ? (
                  <div className="p-4 text-center text-gray-500 border-2 border-dashed border-gray-200 rounded-lg">
                    Please select a date first
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {slotsLoading ? (
                      // Loading state
                      TIME_SLOTS.map((time) => (
                        <div
                          key={time}
                          className="p-2 text-sm border rounded-lg text-center text-gray-400 bg-gray-50 animate-pulse"
                        >
                          Loading...
                        </div>
                      ))
                    ) : (
                      // Show all time slots, but disable unavailable ones
                      TIME_SLOTS.map((time) => {
                        const isAvailable = availableSlots.includes(time);
                        const isSelected = selectedTime === time;
                        
                        return (
                          <button
                            key={time}
                            type="button"
                            onClick={() => isAvailable && setSelectedTime(time)}
                            disabled={!isAvailable}
                            className={`p-2 text-sm border rounded-lg transition-all duration-200 ${
                              isSelected && isAvailable
                                ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                                : isAvailable
                                ? 'border-gray-200 hover:border-blue-300 hover:bg-blue-50 text-gray-900'
                                : 'border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed opacity-50 relative'
                            }`}
                            title={isAvailable ? 'Available' : 'Already booked'}
                          >
                            {formatTimeForDisplay(time)}
                            {!isAvailable && (
                              <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-full h-0.5 bg-red-400 transform rotate-12"></div>
                              </div>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
                {selectedDate && !slotsLoading && availableSlots.length === 0 && (
                  <div className="mt-2 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-center">
                    <p className="font-medium">No available slots</p>
                    <p className="text-sm mb-2">Pick another date — or join the waitlist and we&rsquo;ll notify you if a slot frees up.</p>
                    <button
                      type="button"
                      onClick={handleJoinWaitlist}
                      disabled={joiningWaitlist}
                      className="px-4 py-2 bg-white border border-red-300 text-red-700 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors disabled:opacity-50"
                    >
                      {joiningWaitlist ? 'Joining…' : 'Join waitlist for this day'}
                    </button>
                  </div>
                )}
              </div>

              {/* Family accounts: who is this appointment for? */}
              <div>
                <label htmlFor="for-whom" className="block text-sm font-medium text-gray-700 mb-2">
                  Who is this appointment for?
                </label>
                <select
                  id="for-whom"
                  value={forWhom === 'self' ? 'self' : String(forWhom)}
                  onChange={(e) => {
                    if (e.target.value === 'add') {
                      setShowAddDependent(true);
                    } else {
                      setForWhom(e.target.value === 'self' ? 'self' : Number(e.target.value));
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="self">Myself</option>
                  {dependents.map((d, i) => (
                    <option key={`${d.name}-${i}`} value={i}>
                      {d.name} ({d.relation})
                    </option>
                  ))}
                  <option value="add">➕ Add a family member…</option>
                </select>

                {showAddDependent && (
                  <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={newDependent.name}
                        onChange={(e) => setNewDependent((p) => ({ ...p, name: e.target.value }))}
                        placeholder="Name"
                        aria-label="Family member name"
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                      <input
                        type="text"
                        value={newDependent.relation}
                        onChange={(e) => setNewDependent((p) => ({ ...p, relation: e.target.value }))}
                        placeholder="Relation (e.g. daughter)"
                        aria-label="Relation"
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={handleAddDependent} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                        Save
                      </button>
                      <button type="button" onClick={() => setShowAddDependent(false)} className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Symptoms/Reason */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Symptoms / Reason for Visit *
                </label>
                <textarea
                  value={symptoms}
                  onChange={(e) => setSymptoms(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  rows={3}
                  placeholder="Please describe your symptoms or reason for the consultation..."
                  required
                />
              </div>

              {/* Fee Summary */}
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <CreditCardIcon className="h-5 w-5 text-gray-400" />
                    <span className="font-medium text-gray-900">Consultation Fee</span>
                  </div>
                  <span className="text-xl font-bold text-gray-900">₹{totalFee}</span>
                </div>
              </div>

              {/* Submit Button */}
              <div className="flex space-x-4 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !selectedDate || !selectedTime}
                  className="flex-1 px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors flex items-center justify-center space-x-2"
                >
                  {loading ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  ) : (
                    <>
                      <CreditCardIcon className="h-5 w-5" />
                      <span>Proceed to Payment</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            {/* Payment Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div className="flex items-center space-x-4">
                <button
                  onClick={handlePaymentCancel}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <ChevronLeftIcon className="h-6 w-6 text-gray-400" />
                </button>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Payment</h2>
                  <p className="text-gray-600">Complete payment to confirm appointment</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <XMarkIcon className="h-6 w-6 text-gray-400" />
              </button>
            </div>

            {/* Appointment Summary */}
            <div className="p-6 border-b border-gray-200 bg-gray-50">
              <h3 className="font-semibold text-gray-900 mb-3">Appointment Summary</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Doctor:</span>
                  <span className="font-medium">{doctor.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Date & Time:</span>
                  <span className="font-medium">
                    {selectedDate} at {formatTimeForDisplay(selectedTime)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Type:</span>
                  <span className="font-medium capitalize">{selectedType.replace('-', ' ')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Duration:</span>
                  <span className="font-medium">30 minutes</span>
                </div>
              </div>
            </div>

            {/* Payment Component */}
            <PaymentProcessor
              appointmentId={createdAppointmentId || "temp"}
              doctorId={doctor.id}
              amount={doctor.consultationFee}
              consultationType={selectedType}
              onPaymentSuccess={handlePaymentSuccess}
              onPaymentFailure={handlePaymentFailure}
              onCancel={handlePaymentCancel}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default AppointmentBooking; 