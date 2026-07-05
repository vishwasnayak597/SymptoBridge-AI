import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useAuthContext } from '../../components/AuthProvider';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import NotificationPanel from '../../components/NotificationPanel';
import DoctorScheduleCalendar from '../../components/DoctorScheduleCalendar';
import { apiClient } from '../../lib/api';
import {
  UsersIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  ClockIcon,
  PhoneIcon,
  VideoCameraIcon,
  MapPinIcon,
  BellIcon,
  DocumentTextIcon,
  PlusIcon,
  PencilIcon,
  EyeIcon,
  CheckCircleIcon,
  XCircleIcon,
  StarIcon,
  ExclamationCircleIcon,
  BanknotesIcon,
  CurrencyDollarIcon,
  UserIcon,
  UserGroupIcon,
  XMarkIcon,
  CheckIcon
} from '@heroicons/react/24/outline';
import { BellIcon as BellIconSolid } from '@heroicons/react/24/solid';

interface Appointment {
  _id: string;
  patient: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
    phoneNumber: string;
  };
  doctor: {
    _id: string;
    firstName: string;
    lastName: string;
    specialization: string;
  };
  appointmentDate: string;
  timeSlot: string;
  symptoms: string;
  consultationType: 'video' | 'phone' | 'in-person';
  status: 'scheduled' | 'completed' | 'cancelled' | 'no-show';
  fee: number;
  paymentStatus: 'pending' | 'paid' | 'failed';
  notes?: string;
  prescription?: string;
  diagnosis?: string;
  createdAt: string;
  updatedAt: string;
}

interface DashboardStats {
  totalPatients: number;
  todayAppointments: number;
  monthlyRevenue: number;
  averageRating: number;
  completedAppointments: number;
  pendingAppointments: number;
}

interface TimeSlot {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
}

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DoctorDashboard: React.FC = () => {
  const { user, logout } = useAuthContext();
  const [activeTab, setActiveTab] = useState<'overview' | 'appointments' | 'schedule' | 'patients' | 'profile'>('overview');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    totalPatients: 0,
    todayAppointments: 0,
    monthlyRevenue: 0,
    averageRating: 0,
    completedAppointments: 0,
    pendingAppointments: 0
  });
  const [loading, setLoading] = useState(true);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [showAppointmentModal, setShowAppointmentModal] = useState(false);
  const [modalType, setModalType] = useState<'details' | 'notes'>('details');
  const [appointmentNotes, setAppointmentNotes] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const [patients, setPatients] = useState<any[]>([]);
  const [patientMedicalRecords, setPatientMedicalRecords] = useState<any>({});
  const [patientPrescriptions, setPatientPrescriptions] = useState<any>({});
  const [patientReports, setPatientReports] = useState<any>({});
  const [loadingPatientData, setLoadingPatientData] = useState(false);

  // Profile management states
  const [profileData, setProfileData] = useState<any>({});
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [consultationFee, setConsultationFee] = useState<number>(0);
  const [availability, setAvailability] = useState<TimeSlot[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  
  // Appointment filtering and prescription states
  const [appointmentFilter, setAppointmentFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [showPrescriptionModal, setShowPrescriptionModal] = useState(false);
  const [prescriptionData, setPrescriptionData] = useState({
    medications: '',
    dosage: '',
    instructions: '',
    duration: ''
  });
  const [selectedAppointmentForPrescription, setSelectedAppointmentForPrescription] = useState<Appointment | null>(null);

  // Fetch appointments with useCallback to prevent re-creation
  const fetchAppointments = useCallback(async (): Promise<void> => {
    if (!user) {
      return;
    }


    try {
      setLoading(true);
      
      const response = await apiClient.get('/appointments');

      // Fix: The appointments are nested in response.data.data.appointments
      const appointmentsData = response.data.success 
        ? response.data.data.appointments  // ← Fixed: Extract the appointments array
        : (response.data || []);


      const finalAppointments = Array.isArray(appointmentsData) 
        ? appointmentsData 
        : [];


      setAppointments(finalAppointments);
    } catch (error) {
      console.error('❌ Error fetching appointments:', error);
      console.error('❌ Error details:', error.response?.data);
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Fetch patients with useCallback to prevent re-creation
  const fetchPatients = useCallback(async (): Promise<void> => {
    if (!user) return;
    
    try {
      setLoadingPatientData(true);
      const response = await apiClient.get('/medical-records/my-patients');
      
      if (response.data.success) {
        setPatients(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching patients:', error);
    } finally {
      setLoadingPatientData(false);
    }
  }, [user]);

  // Fetch notification count with useCallback
  const fetchNotificationCount = useCallback(async (): Promise<void> => {
    if (!user) return;
    
    try {
      const response = await apiClient.get('/notifications/unread-count');
      if (response.data.success) {
        setNotificationCount(response.data.data?.count || 0);
      }
    } catch (error) {
      console.error('Error fetching notification count:', error);
    }
  }, [user]);

  // Fetch patient medical data with useCallback
  const fetchPatientMedicalData = useCallback(async (patientId: string): Promise<void> => {
    if (!patientId) return;
    
    try {
      const [recordsRes, prescriptionsRes, reportsRes] = await Promise.all([
        apiClient.get(`/medical-records/patient/${patientId}`),
        apiClient.get(`/prescriptions/patient/${patientId}`),
        apiClient.get(`/reports/patient/${patientId}`)
      ]);

      if (recordsRes.data.success) {
        setPatientMedicalRecords(prev => ({
          ...prev,
          [patientId]: recordsRes.data.data
        }));
      }

      if (prescriptionsRes.data.success) {
        setPatientPrescriptions(prev => ({
          ...prev,
          [patientId]: prescriptionsRes.data.data
        }));
      }

      if (reportsRes.data.success) {
        setPatientReports(prev => ({
          ...prev,
          [patientId]: reportsRes.data.data
        }));
      }
    } catch (error) {
      console.error('Error fetching patient medical data:', error);
    }
  }, []);

  // Fetch profile data and availability
  const fetchProfile = useCallback(async (): Promise<void> => {
    if (!user) return;
    
    try {
      setProfileLoading(true);
      const response = await apiClient.get('/users/profile');
      
      if (response.data.success) {
        const profile = response.data.data;
        setProfileData(profile);
        setConsultationFee(profile.consultationFee || 0);
        
        // Set availability from profile or create default
        if (profile.availability && Array.isArray(profile.availability)) {
          // Map existing availability to match our format
          const existingAvailability = profile.availability.reduce((acc: any, slot: any) => {
            acc[slot.dayOfWeek] = slot;
            return acc;
          }, {});
          
          // Create availability array for all days
          const fullAvailability = DAYS_OF_WEEK.map((day, index) => {
            return existingAvailability[index] || {
              dayOfWeek: index,
              startTime: '09:00',
              endTime: '17:00',
              isAvailable: false
            };
          });
          setAvailability(fullAvailability);
        } else {
          // Create default availability for all days
          const defaultAvailability = DAYS_OF_WEEK.map((day, index) => ({
            dayOfWeek: index,
            startTime: '09:00',
            endTime: '17:00',
            isAvailable: false
          }));
          setAvailability(defaultAvailability);
        }
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
      setProfileError('Failed to load profile data');
    } finally {
      setProfileLoading(false);
    }
  }, [user]);

  // Update consultation fee
  const updateConsultationFee = async (newFee: number): Promise<void> => {
    try {
      setProfileLoading(true);
      setProfileError('');
      setProfileSuccess('');
      
      const response = await apiClient.put('/users/profile', {
        consultationFee: newFee
      });
      
      if (response.data.success) {
        setConsultationFee(newFee);
        setProfileData(prev => ({ ...prev, consultationFee: newFee }));
        setProfileSuccess('Consultation fee updated successfully!');
        
        // Clear success message after 3 seconds
        setTimeout(() => setProfileSuccess(''), 3000);
      }
    } catch (error) {
      console.error('Error updating consultation fee:', error);
      setProfileError('Failed to update consultation fee');
    } finally {
      setProfileLoading(false);
    }
  };

  // Save availability (called from the schedule calendar editor)
  const saveAvailability = async (newAvailability: TimeSlot[]): Promise<void> => {
    try {
      setAvailabilityLoading(true);
      setProfileError('');
      setProfileSuccess('');

      // Update local state immediately so the calendar reflects the change
      setAvailability(newAvailability);

      // Only persist days that are available, in the backend's format
      const availabilityData = newAvailability
        .filter(slot => slot.isAvailable)
        .map(slot => ({
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
          endTime: slot.endTime,
          isAvailable: true
        }));

      const response = await apiClient.put('/users/profile', {
        availability: availabilityData
      });

      if (response.data.success) {
        setProfileSuccess('Availability updated successfully!');
        setTimeout(() => setProfileSuccess(''), 3000);
      }
    } catch (error) {
      console.error('Error updating availability:', error);
      setProfileError('Failed to update availability');
    } finally {
      setAvailabilityLoading(false);
    }
  };

  // Add/Update appointment notes
  const handleAddNotes = async (): Promise<void> => {
    if (!selectedAppointment || !appointmentNotes.trim()) return;
    
    try {
      const response = await apiClient.patch(`/appointments/${selectedAppointment._id}/notes`, {
        notes: appointmentNotes
      });
      
      if (response.data.success) {
        // Update the appointment in the list
        setAppointments(prev => prev.map(apt => 
          apt._id === selectedAppointment._id 
            ? { ...apt, notes: appointmentNotes }
            : apt
        ));
        
        setShowAppointmentModal(false);
        setSelectedAppointment(null);
        setAppointmentNotes('');
        setProfileSuccess('Notes added successfully!');
        setTimeout(() => setProfileSuccess(''), 3000);
      }
    } catch (error) {
      console.error('Error adding notes:', error);
      setProfileError('Failed to add notes');
      setTimeout(() => setProfileError(''), 3000);
    }
  };

  // View appointment details
  const handleViewDetails = (appointment: Appointment) => {
    setSelectedAppointment(appointment);
    setModalType('details');
    setShowAppointmentModal(true);
  };

  // Add notes to appointment
  const handleAddNotesModal = (appointment: Appointment) => {
    setSelectedAppointment(appointment);
    setAppointmentNotes(appointment.notes || '');
    setModalType('notes');
    setShowAppointmentModal(true);
  };

  // Complete appointment
  const handleCompleteAppointment = async (appointmentId: string) => {
    try {
      const response = await apiClient.patch(`/appointments/${appointmentId}/status`, { 
        status: 'completed' 
      });

      if (response.data.success) {
        // Update the appointment in the list
        setAppointments(prev => prev.map(apt => 
          apt._id === appointmentId 
            ? { ...apt, status: 'completed' as const }
            : apt
        ));
        setProfileSuccess('Appointment marked as completed!');
        setTimeout(() => setProfileSuccess(''), 3000);
      }
    } catch (error) {
      console.error('Error completing appointment:', error);
      setProfileError('Failed to complete appointment');
      setTimeout(() => setProfileError(''), 3000);
    }
  };

  // Updated getPatientData function using real data
  const getPatientData = () => {
    return patients.map(patientData => ({
      ...patientData.patient,
      lastAppointment: patientData.lastAppointment,
      totalAppointments: patientData.totalAppointments,
      medicalRecords: patientMedicalRecords[patientData.patient._id] || [],
      prescriptions: patientPrescriptions[patientData.patient._id] || [],
      reports: patientReports[patientData.patient._id] || []
    }));
  };

  // Filter and sort appointments
  const getFilteredAndSortedAppointments = () => {
    let filtered = [...appointments];
    
    // Apply filter
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    switch (appointmentFilter) {
      case 'today':
        filtered = appointments.filter(apt => {
          const aptDate = new Date(apt.appointmentDate);
          return aptDate.toDateString() === today.toDateString();
        });
        break;
      case 'week':
        filtered = appointments.filter(apt => {
          const aptDate = new Date(apt.appointmentDate);
          return aptDate >= startOfWeek;
        });
        break;
      case 'month':
        filtered = appointments.filter(apt => {
          const aptDate = new Date(apt.appointmentDate);
          return aptDate >= startOfMonth;
        });
        break;
      default:
        filtered = appointments;
    }
    
    // Sort: completed appointments at bottom, then by latest appointment time
    return filtered.sort((a, b) => {
      // First, sort by status (scheduled first, completed last)
      if (a.status === 'completed' && b.status !== 'completed') return 1;
      if (a.status !== 'completed' && b.status === 'completed') return -1;
      
      // Then sort by appointment date/time (latest first)
      const dateA = new Date(a.appointmentDate);
      const dateB = new Date(b.appointmentDate);
      return dateB.getTime() - dateA.getTime();
    });
  };

  // Handle prescription creation
  const handleCreatePrescription = async () => {
    if (!selectedAppointmentForPrescription) return;
    
    try {
      setProfileLoading(true);
      
      // Parse medications from text input
      const medicationsArray = prescriptionData.medications
        .split('\n')
        .filter(med => med.trim())
        .map(med => ({
          name: med.trim(),
          dosage: prescriptionData.dosage,
          frequency: 'As prescribed',
          duration: prescriptionData.duration,
          instructions: prescriptionData.instructions
        }));
      
      const response = await apiClient.post('/prescriptions', {
        patient: selectedAppointmentForPrescription.patient._id,
        appointment: selectedAppointmentForPrescription._id,
        medications: medicationsArray,
        generalInstructions: prescriptionData.instructions
      });
      
      if (response.data.success) {
        setProfileSuccess('Prescription created successfully!');
        setShowPrescriptionModal(false);
        setPrescriptionData({
          medications: '',
          dosage: '',
          instructions: '',
          duration: ''
        });
        // Refresh appointments to get updated data
        await fetchAppointments();
      }
    } catch (error) {
      console.error('Error creating prescription:', error);
      setProfileError('Failed to create prescription');
    } finally {
      setProfileLoading(false);
    }
  };

  // Handle opening prescription modal
  const handleOpenPrescriptionModal = (appointment: Appointment) => {
    setSelectedAppointmentForPrescription(appointment);
    setShowPrescriptionModal(true);
    setPrescriptionData({
      medications: '',
      dosage: '',
      instructions: '',
      duration: ''
    });
  };

  // Fixed useEffect with proper dependencies to prevent multiple calls
  useEffect(() => {
    if (user) {
      fetchAppointments();
      fetchPatients();
      fetchNotificationCount();
      fetchProfile();
    }
  }, [user, fetchAppointments, fetchPatients, fetchNotificationCount, fetchProfile]);

  // Add useEffect to fetch patient medical data when a patient is selected
  useEffect(() => {
    if (selectedPatient && selectedPatient._id) {
      fetchPatientMedicalData(selectedPatient._id);
    }
  }, [selectedPatient, fetchPatientMedicalData]);

  // Derive dashboard stats from the loaded appointments (real numbers, not mocks)
  useEffect(() => {
    if (!Array.isArray(appointments)) return;

    const now = new Date();
    const isSameDay = (d: Date) =>
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const isSameMonth = (d: Date) =>
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();

    const uniquePatients = new Set<string>();
    let todayAppointments = 0;
    let monthlyRevenue = 0;
    let completedAppointments = 0;
    let pendingAppointments = 0;
    let ratingSum = 0;
    let ratingCount = 0;

    appointments.forEach((apt: any) => {
      const date = new Date(apt.appointmentDate);
      const patientId = apt.patient?._id || apt.patient;
      if (patientId) uniquePatients.add(String(patientId));

      if (isSameDay(date)) todayAppointments += 1;
      if (apt.status === 'completed') completedAppointments += 1;
      if (apt.status === 'scheduled' || apt.status === 'confirmed') pendingAppointments += 1;

      // Revenue: paid appointments in the current month
      if (apt.paymentStatus === 'paid' && isSameMonth(date)) {
        monthlyRevenue += Number(apt.fee) || 0;
      }

      const patientRating = apt.rating?.patientRating;
      if (typeof patientRating === 'number') {
        ratingSum += patientRating;
        ratingCount += 1;
      }
    });

    setStats({
      totalPatients: uniquePatients.size,
      todayAppointments,
      monthlyRevenue,
      averageRating: ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : 0,
      completedAppointments,
      pendingAppointments
    });
  }, [appointments]);

  // Fetch dashboard data
  const fetchDashboardData = async (): Promise<void> => {
    try {      
  
      setLoading(true);
      
      // Fetch appointments first
      await fetchAppointments();
      
      // Fetch patients
      await fetchPatients();

      // Stats are derived from the loaded appointments (see useEffect below),
      // so no separate stats fetch is needed here.

    } catch (error) {
      console.error('❌ Error fetching dashboard data:', error);
      setAppointments([]); // Ensure appointments is always an array
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
  };

  const startVideoCall = async (appointmentId: string) => {
    try {
      // Creates the call record + rings the patient (socket push), then joins the room.
      const response = await apiClient.post('/video-calls', { appointmentId });

      if (response.data.success) {
        window.location.href = `/video-call?id=${appointmentId}`;
      }
    } catch (error) {
      console.error('Error starting video call:', error);
    }
  };



  const updateAppointmentStatus = async (appointmentId: string, status: string) => {
    try {
      const response = await apiClient.patch(`/appointments/${appointmentId}/status`, { status });

      if (response.data.success) {
        // Refresh appointments
        fetchDashboardData();
      }
    } catch (error) {
      console.error('Error updating appointment status:', error);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR'
    }).format(amount);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-600 bg-green-100';
      case 'confirmed': return 'text-blue-600 bg-blue-100';
      case 'scheduled': return 'text-yellow-600 bg-yellow-100';
      case 'cancelled': return 'text-red-600 bg-red-100';
      case 'in-progress': return 'text-purple-600 bg-purple-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Today's Appointments</p>
                <p className="text-3xl font-bold text-gray-900">{stats.todayAppointments}</p>
              </div>
              <CalendarDaysIcon className="h-12 w-12 text-blue-500" />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Patients</p>
                <p className="text-3xl font-bold text-gray-900">{stats.totalPatients}</p>
              </div>
              <UsersIcon className="h-12 w-12 text-green-500" />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Monthly Revenue</p>
                <p className="text-3xl font-bold text-gray-900">{formatCurrency(stats.monthlyRevenue)}</p>
              </div>
              <CurrencyDollarIcon className="h-12 w-12 text-purple-500" />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Average Rating</p>
                <p className="text-3xl font-bold text-gray-900">{stats.averageRating}</p>
              </div>
              <StarIcon className="h-12 w-12 text-yellow-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Recent Appointments */}
      <div className="card">
        <div className="card-header">
          <h3 className="text-lg font-semibold text-gray-900">Recent Appointments</h3>
        </div>
        <div className="card-body">
          <div className="space-y-4">
            {appointments.slice(0, 5).map((appointment) => (
              <div key={appointment._id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-4">
                  <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center">
                    <span className="text-white font-semibold">
                      {appointment.patient?.firstName?.charAt(0) || 'P'}{appointment.patient?.lastName?.charAt(0) || 'A'}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">
                      {appointment.patient?.firstName || 'Unknown'} {appointment.patient?.lastName || 'Patient'}
                    </p>
                    <p className="text-sm text-gray-600">{formatDate(appointment.appointmentDate)}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(appointment.status)}`}>
                    {appointment.status}
                  </span>
                  {appointment.consultationType === 'video' && (
                    <>
                      <button
                        onClick={() => startVideoCall(appointment._id)}
                        className="btn-primary text-sm"
                      >
                        Start Call
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const renderAppointments = () => {
    const filteredAppointments = getFilteredAndSortedAppointments();
    
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-gray-900">Appointments</h2>
          <div className="flex space-x-3">
            <select 
              className="input-field"
              value={appointmentFilter}
              onChange={(e) => setAppointmentFilter(e.target.value as 'all' | 'today' | 'week' | 'month')}
            >
              <option value="all">All Appointments</option>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
            </select>
          </div>
        </div>

        <div className="grid gap-6">
          {filteredAppointments.length === 0 ? (
            <div className="text-center py-12">
              <CalendarDaysIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No Appointments Found</h3>
              <p className="text-gray-600">
                {appointmentFilter === 'all' ? 
                  "You don't have any appointments scheduled yet." :
                  `No appointments found for ${appointmentFilter === 'today' ? 'today' : appointmentFilter === 'week' ? 'this week' : 'this month'}.`
                }
              </p>
            </div>
          ) : (
            filteredAppointments.map((appointment) => {
              return (
                <div key={appointment._id} className="card">
                  <div className="card-body">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center">
                          <span className="text-white font-semibold text-lg">
                            {appointment.patient?.firstName?.charAt(0) || 'P'}{appointment.patient?.lastName?.charAt(0) || 'A'}
                          </span>
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">
                            {appointment.patient?.firstName || 'Unknown'} {appointment.patient?.lastName || 'Patient'}
                          </h3>
                          <div className="flex items-center space-x-4 text-sm text-gray-600">
                            <div className="flex items-center space-x-1">
                              <ClockIcon className="h-4 w-4" />
                              <span>{formatDate(appointment.appointmentDate)}</span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <PhoneIcon className="h-4 w-4" />
                              <span>{appointment.patient?.phoneNumber || 'N/A'}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-3">
                        <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(appointment.status)}`}>
                          {appointment.status}
                        </span>
                        <span className="text-lg font-semibold text-gray-900">{formatCurrency(appointment.fee)}</span>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <h4 className="font-medium text-gray-900 mb-2">Symptoms</h4>
                        <p className="text-gray-700 text-sm">{appointment.symptoms}</p>
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900 mb-2">Consultation Type</h4>
                        <div className="flex items-center space-x-2">
                          {appointment.consultationType === 'video' && <VideoCameraIcon className="h-4 w-4 text-blue-500" />}
                          {appointment.consultationType === 'phone' && <PhoneIcon className="h-4 w-4 text-green-500" />}
                          {appointment.consultationType === 'in-person' && <MapPinIcon className="h-4 w-4 text-purple-500" />}
                          <span className="text-sm capitalize">{appointment.consultationType}</span>
                        </div>
                      </div>
                    </div>

                    {appointment.notes && (
                      <div className="mt-4">
                        <h4 className="font-medium text-gray-900 mb-2">Notes</h4>
                        <p className="text-gray-700 text-sm bg-yellow-50 p-3 rounded-lg">{appointment.notes}</p>
                      </div>
                    )}

                    <div className="mt-4 flex justify-between items-center">
                      <div className="flex space-x-3">
                        <button 
                          onClick={() => handleViewDetails(appointment)}
                          className="btn-secondary text-sm flex items-center space-x-1"
                        >
                          <EyeIcon className="h-4 w-4" />
                          <span>View Details</span>
                        </button>
                        <button 
                          onClick={() => handleAddNotesModal(appointment)}
                          className="btn-secondary text-sm flex items-center space-x-1"
                        >
                          <PencilIcon className="h-4 w-4" />
                          <span>Add Notes</span>
                        </button>
                        <button 
                          onClick={() => handleOpenPrescriptionModal(appointment)}
                          className="btn-secondary text-sm flex items-center space-x-1"
                        >
                          <DocumentTextIcon className="h-4 w-4" />
                          <span>Prescription</span>
                        </button>
                      </div>
                      
                      <div className="flex space-x-3">
                        {appointment.status === 'scheduled' && (
                          <>
                            <button
                              onClick={() => handleCompleteAppointment(appointment._id)}
                              className="btn-primary text-sm flex items-center space-x-1"
                            >
                              <CheckIcon className="h-4 w-4" />
                              <span>Complete</span>
                            </button>
                            {appointment.consultationType === 'video' && (
                              <>
                                <button
                                  onClick={() => startVideoCall(appointment._id)}
                                  className="btn-primary text-sm flex items-center space-x-1"
                                >
                                  <VideoCameraIcon className="h-4 w-4" />
                                  <span>Start Call</span>
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  };

  const renderPatients = () => {
    const patients = getPatientData();
    
    if (!selectedPatient) {
      return (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-gray-900">Patient Records</h2>
            <div className="text-sm text-gray-600">
              {patients.length} patient{patients.length !== 1 ? 's' : ''}
            </div>
          </div>

          {loadingPatientData ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading patient data...</p>
            </div>
          ) : (
            <div className="grid gap-6">
              {patients.length === 0 ? (
                <div className="text-center py-12">
                  <UserGroupIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">No Patients Yet</h3>
                  <p className="text-gray-600">Patients you have appointments with will appear here.</p>
                </div>
              ) : (
                patients.map((patient: any) => (
                  <div key={patient._id} className="card cursor-pointer hover:shadow-lg transition-shadow" 
                       onClick={() => {
                         setSelectedPatient(patient);
                         fetchPatientMedicalData(patient._id);
                       }}>
                    <div className="card-body">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                          <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full flex items-center justify-center">
                            <span className="text-white font-semibold text-lg">
                              {patient.firstName?.charAt(0)}{patient.lastName?.charAt(0)}
                            </span>
                          </div>
                          <div>
                            <h3 className="text-lg font-semibold text-gray-900">
                              {patient.firstName} {patient.lastName}
                            </h3>
                            <div className="flex items-center space-x-4 text-sm text-gray-600">
                              <span>{patient.email}</span>
                              <span>{patient.phoneNumber}</span>
                            </div>
                          </div>
                        </div>
                        
                        <div className="text-right">
                          <div className="text-sm text-gray-600">
                            {patient.totalAppointments} appointment{patient.totalAppointments !== 1 ? 's' : ''}
                          </div>
                          <div className="text-xs text-gray-500">
                            Last visit: {new Date(patient.lastAppointment).toLocaleDateString()}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-3 gap-4">
                        <div className="text-center p-3 bg-blue-50 rounded-lg">
                          <DocumentTextIcon className="h-6 w-6 text-blue-600 mx-auto mb-1" />
                          <div className="text-sm font-medium text-gray-900">{patient.medicalRecords.length}</div>
                          <div className="text-xs text-gray-600">Records</div>
                        </div>
                        <div className="text-center p-3 bg-green-50 rounded-lg">
                          <DocumentTextIcon className="h-6 w-6 text-green-600 mx-auto mb-1" />
                          <div className="text-sm font-medium text-gray-900">{patient.prescriptions.length}</div>
                          <div className="text-xs text-gray-600">Prescriptions</div>
                        </div>
                        <div className="text-center p-3 bg-purple-50 rounded-lg">
                          <DocumentTextIcon className="h-6 w-6 text-purple-600 mx-auto mb-1" />
                          <div className="text-sm font-medium text-gray-900">{patient.reports.length}</div>
                          <div className="text-xs text-gray-600">Reports</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      );
    }

    // Selected patient detail view
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-4">
          <button 
            onClick={() => setSelectedPatient(null)}
            className="p-2 text-gray-400 hover:text-gray-600"
          >
            ←
          </button>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {selectedPatient.firstName} {selectedPatient.lastName}
            </h2>
            <p className="text-gray-600">{selectedPatient.email}</p>
          </div>
        </div>

        {/* Medical Records */}
        <div className="card">
          <div className="card-body">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Medical Records</h3>
            <div className="space-y-4">
              {patientMedicalRecords[selectedPatient._id]?.length > 0 ? (
                patientMedicalRecords[selectedPatient._id].map((record: any) => (
                  <div key={record.id || record._id} className="border-l-4 border-blue-500 bg-blue-50 p-4 rounded-r-lg">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-semibold text-gray-900">{record.diagnosis || 'No diagnosis specified'}</h4>
                      <span className="text-sm text-gray-600">
                        {record.date ? new Date(record.date).toLocaleDateString() : 'No date'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 mb-2"><strong>Symptoms:</strong> {record.symptoms || 'N/A'}</p>
                    <p className="text-sm text-gray-700 mb-2"><strong>Treatment:</strong> {record.treatment || 'N/A'}</p>
                    <p className="text-sm text-gray-700 mb-2"><strong>Notes:</strong> {record.doctorNotes || 'N/A'}</p>
                    {record.nextFollowUp && (
                      <p className="text-sm text-blue-600">
                        <strong>Next Follow-up:</strong> {new Date(record.nextFollowUp).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center py-6">
                  <p className="text-gray-500">No medical records found for this patient</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Prescriptions */}
        <div className="card">
          <div className="card-body">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Prescriptions</h3>
            <div className="space-y-4">
              {patientPrescriptions[selectedPatient._id]?.length > 0 ? (
                patientPrescriptions[selectedPatient._id].map((prescription: any) => (
                  <div key={prescription.id || prescription._id} className="border-l-4 border-green-500 bg-green-50 p-4 rounded-r-lg">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-semibold text-gray-900">{prescription.diagnosis || 'No diagnosis specified'}</h4>
                      <span className="text-sm text-gray-600">
                        {prescription.date ? new Date(prescription.date).toLocaleDateString() : 'No date'}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {prescription.medications && Array.isArray(prescription.medications) && prescription.medications.length > 0 ? (
                        prescription.medications.map((medication: any, index: number) => (
                          <div key={index} className="bg-white p-3 rounded border">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                              <div><strong>Medication:</strong> {medication.name || 'N/A'}</div>
                              <div><strong>Dosage:</strong> {medication.dosage || 'N/A'}</div>
                              <div><strong>Frequency:</strong> {medication.frequency || 'N/A'}</div>
                              <div><strong>Duration:</strong> {medication.duration || 'N/A'}</div>
                              {medication.instructions && (
                                <div className="col-span-full"><strong>Instructions:</strong> {medication.instructions}</div>
                              )}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="bg-white p-3 rounded border">
                          <p className="text-gray-500 text-sm">No medications prescribed</p>
                        </div>
                      )}
                    </div>
                    {prescription.nextFollowUp && (
                      <p className="text-sm text-green-600 mt-2">
                        <strong>Next Follow-up:</strong> {new Date(prescription.nextFollowUp).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center py-6">
                  <p className="text-gray-500">No prescriptions found for this patient</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Reports */}
        <div className="card">
          <div className="card-body">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Medical Reports</h3>
            <div className="space-y-4">
              {patientReports[selectedPatient._id]?.length > 0 ? (
                patientReports[selectedPatient._id].map((report: any) => (
                  <div key={report.id || report._id} className="border-l-4 border-purple-500 bg-purple-50 p-4 rounded-r-lg">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-semibold text-gray-900">{report.name || 'Unnamed Report'}</h4>
                        <p className="text-sm text-gray-600">
                          {report.type ? report.type.replace('_', ' ').toUpperCase() : 'Unknown Type'} • 
                          {report.fileSize || 'Unknown Size'} • 
                          {report.uploadDate ? new Date(report.uploadDate).toLocaleDateString() : 'No date'}
                        </p>
                        {report.results && (
                          <p className="text-sm text-gray-700 mt-2"><strong>Results:</strong> {report.results}</p>
                        )}
                      </div>
                      <button className="text-purple-600 hover:text-purple-800">
                        <EyeIcon className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-6">
                  <p className="text-gray-500">No medical reports found for this patient</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Schedule tab — week/month calendar of availability + appointments
  const renderSchedule = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Schedule</h2>
          <p className="text-sm text-gray-600 mt-1">
            Your availability and booked appointments. Switch between week and month, browse other dates,
            and click any day to set your available hours.
          </p>
        </div>

        {profileError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-600">{profileError}</p>
          </div>
        )}
        {profileSuccess && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
            <p className="text-sm text-green-600">{profileSuccess}</p>
          </div>
        )}

        <DoctorScheduleCalendar
          availability={availability}
          appointments={appointments}
          onSave={saveAvailability}
          saving={availabilityLoading}
        />
      </div>
    </div>
  );

  // Profile management component
  const renderProfile = () => {
    const handleFeeSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (consultationFee >= 0) {
        updateConsultationFee(consultationFee);
      }
    };

    return (
      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Profile Settings</h2>
          
          {/* Error/Success Messages */}
          {profileError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">{profileError}</p>
            </div>
          )}
          
          {profileSuccess && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
              <p className="text-sm text-green-600">{profileSuccess}</p>
            </div>
          )}
          
          {/* Consultation Fee Management */}
          <div className="border-b border-gray-200 pb-6 mb-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Consultation Fee</h3>
            
            <form onSubmit={handleFeeSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Consultation Fee (₹)
                </label>
                <div className="flex items-center space-x-4">
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <CurrencyDollarIcon className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={consultationFee}
                      onChange={(e) => setConsultationFee(Number(e.target.value))}
                      className="pl-10 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter consultation fee"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={profileLoading}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    {profileLoading ? 'Updating...' : 'Update Fee'}
                  </button>
                </div>
                <p className="text-sm text-gray-500 mt-2">
                  This fee will be shown to patients when they book appointments with you.
                </p>
              </div>
            </form>
          </div>

          {/* Availability is now managed in the Schedule tab */}
          <div className="border-b border-gray-200 pb-6 mb-6">
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              <ClockIcon className="inline h-5 w-5 mr-2" />
              Availability Schedule
            </h3>
            <p className="text-sm text-gray-600">
              Set your weekly availability in the{' '}
              <button
                type="button"
                onClick={() => setActiveTab('schedule')}
                className="text-blue-600 hover:text-blue-700 font-medium underline"
              >
                Schedule tab
              </button>{' '}
              — click any day to choose your hours or mark yourself unavailable.
            </p>
          </div>

          {/* Basic Profile Information */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Profile Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <p className="text-gray-900">{profileData.firstName} {profileData.lastName}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <p className="text-gray-900">{profileData.email}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Specialization</label>
                <p className="text-gray-900">{profileData.specialization || 'Not specified'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Experience</label>
                <p className="text-gray-900">{profileData.experience || 0} years</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">License Number</label>
                <p className="text-gray-900">{profileData.licenseNumber || 'Not specified'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <p className="text-gray-900">{profileData.phone || 'Not specified'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <ProtectedRoute allowedRoles={['doctor']}>
      <Head>
        <title>Doctor Dashboard - SymptoBridge AI</title>
        <meta name="description" content="Doctor dashboard for managing patients and appointments" />
      </Head>

      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-4">
              <Link
                href="/"
                aria-label="Go to SymptoBridge home"
                className="flex items-center space-x-2 group focus:outline-none focus-visible:ring-2 focus-visible:ring-coral-500 rounded-lg"
              >
                <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center transition-transform group-hover:scale-105">
                  <span className="text-white font-bold text-lg">S</span>
                </div>
                <span className="text-xl font-bold gradient-text">SymptoBridge</span>
              </Link>
              <div className="flex items-center space-x-2 sm:space-x-4">
                <button
                  onClick={() => setShowNotifications(true)}
                  className="relative p-2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {notificationCount > 0 ? <BellIconSolid className="h-6 w-6" /> : <BellIcon className="h-6 w-6" />}
                  {notificationCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                      {notificationCount}
                    </span>
                  )}
                </button>

                <span className="hidden sm:inline text-gray-700 whitespace-nowrap">Dr. {user?.firstName} {user?.lastName}</span>
                <button onClick={handleLogout} className="btn-secondary text-sm whitespace-nowrap">
                  Logout
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Navigation */}
        <nav className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex space-x-8">
              {[
                { id: 'overview', label: 'Overview', icon: ChartBarIcon },
                { id: 'appointments', label: 'Appointments', icon: CalendarDaysIcon },
                { id: 'schedule', label: 'Schedule', icon: ClockIcon },
                { id: 'patients', label: 'Patients', icon: UsersIcon },
                { id: 'profile', label: 'Profile', icon: UserIcon }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center space-x-2 py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <tab.icon className="h-5 w-5" />
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>
        </nav>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {activeTab === 'overview' && renderOverview()}
          {activeTab === 'appointments' && renderAppointments()}
          {activeTab === 'schedule' && renderSchedule()}
          {activeTab === 'patients' && renderPatients()}
          {activeTab === 'profile' && renderProfile()}
        </main>
      </div>

      {/* Notification Panel */}
      <NotificationPanel
        isOpen={showNotifications}
        onClose={() => setShowNotifications(false)}
        onUnreadCountChange={setNotificationCount}
        onNotificationClick={(notification) => {
          // Handle notification click
        }}
      />

      {/* Payment Processor Modal */}
      {/* This modal is removed as per the edit hint to remove payments/analytics tabs */}

      {/* Appointment Modal (Details or Notes) */}
      {showAppointmentModal && selectedAppointment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full mx-4 p-6 max-h-[90vh] overflow-y-auto">
             
             {modalType === 'details' ? (
               // Patient Details View
               <>
                 <div className="flex justify-between items-center mb-6">
                   <h3 className="text-xl font-semibold text-gray-900">Appointment Details</h3>
                   <button
                     onClick={() => setShowAppointmentModal(false)}
                     className="p-2 text-gray-400 hover:text-gray-600"
                   >
                     <XMarkIcon className="h-6 w-6" />
                   </button>
                 </div>

                 {/* Patient Information */}
                 <div className="bg-blue-50 rounded-lg p-4 mb-6">
                   <h4 className="text-lg font-medium text-gray-900 mb-3 flex items-center">
                     <UserIcon className="h-5 w-5 mr-2" />
                     Patient Information
                   </h4>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div>
                       <label className="block text-sm font-medium text-gray-700">Name</label>
                       <p className="text-gray-900">{selectedAppointment.patient?.firstName} {selectedAppointment.patient?.lastName}</p>
                     </div>
                     <div>
                       <label className="block text-sm font-medium text-gray-700">Email</label>
                       <p className="text-gray-900">{selectedAppointment.patient?.email}</p>
                     </div>
                     <div>
                       <label className="block text-sm font-medium text-gray-700">Phone</label>
                       <p className="text-gray-900">{selectedAppointment.patient?.phoneNumber || 'N/A'}</p>
                     </div>
                     <div>
                       <label className="block text-sm font-medium text-gray-700">Patient ID</label>
                       <p className="text-gray-900 text-sm font-mono">{selectedAppointment.patient?._id}</p>
                     </div>
                   </div>
                 </div>

                 {/* Appointment Information */}
                 <div className="bg-green-50 rounded-lg p-4 mb-6">
                   <h4 className="text-lg font-medium text-gray-900 mb-3 flex items-center">
                     <CalendarDaysIcon className="h-5 w-5 mr-2" />
                     Appointment Information
                   </h4>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div>
                       <label className="block text-sm font-medium text-gray-700">Date & Time</label>
                       <p className="text-gray-900">{formatDate(selectedAppointment.appointmentDate)}</p>
                     </div>
                     <div>
                       <label className="block text-sm font-medium text-gray-700">Time Slot</label>
                       <p className="text-gray-900">{selectedAppointment.timeSlot}</p>
                     </div>
                     <div>
                       <label className="block text-sm font-medium text-gray-700">Consultation Type</label>
                       <div className="flex items-center space-x-2">
                         {selectedAppointment.consultationType === 'video' && <VideoCameraIcon className="h-4 w-4 text-blue-500" />}
                         {selectedAppointment.consultationType === 'phone' && <PhoneIcon className="h-4 w-4 text-green-500" />}
                         {selectedAppointment.consultationType === 'in-person' && <MapPinIcon className="h-4 w-4 text-purple-500" />}
                         <span className="capitalize">{selectedAppointment.consultationType}</span>
                       </div>
                     </div>
                     <div>
                       <label className="block text-sm font-medium text-gray-700">Status</label>
                       <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(selectedAppointment.status)}`}>
                         {selectedAppointment.status}
                       </span>
                     </div>
                     <div>
                       <label className="block text-sm font-medium text-gray-700">Fee</label>
                       <p className="text-gray-900 font-semibold">{formatCurrency(selectedAppointment.fee)}</p>
                     </div>
                     <div>
                       <label className="block text-sm font-medium text-gray-700">Payment Status</label>
                       <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                         selectedAppointment.paymentStatus === 'paid' ? 'text-green-600 bg-green-100' :
                         selectedAppointment.paymentStatus === 'pending' ? 'text-yellow-600 bg-yellow-100' :
                         'text-red-600 bg-red-100'
                       }`}>
                         {selectedAppointment.paymentStatus}
                       </span>
                     </div>
                   </div>
                 </div>

                 {/* Symptoms & Medical Information */}
                 <div className="bg-yellow-50 rounded-lg p-4 mb-6">
                   <h4 className="text-lg font-medium text-gray-900 mb-3 flex items-center">
                     <DocumentTextIcon className="h-5 w-5 mr-2" />
                     Medical Information
                   </h4>
                   <div>
                     <label className="block text-sm font-medium text-gray-700 mb-2">Symptoms</label>
                     <p className="text-gray-900 whitespace-pre-wrap">
                       {typeof selectedAppointment.symptoms === 'string' 
                         ? selectedAppointment.symptoms 
                         : selectedAppointment.symptoms 
                           ? JSON.stringify(selectedAppointment.symptoms) 
                           : 'No symptoms recorded'
                       }
                     </p>
                   </div>
                   
                   {selectedAppointment.diagnosis && (
                     <div className="mt-4">
                       <label className="block text-sm font-medium text-gray-700 mb-2">Diagnosis</label>
                       <p className="text-gray-900 whitespace-pre-wrap">
                         {typeof selectedAppointment.diagnosis === 'string' 
                           ? selectedAppointment.diagnosis 
                           : JSON.stringify(selectedAppointment.diagnosis)
                         }
                       </p>
                     </div>
                   )}
                   
                   {selectedAppointment.prescription && (
                     <div className="mt-4">
                       <label className="block text-sm font-medium text-gray-700 mb-2">Prescription</label>
                       <p className="text-gray-900 whitespace-pre-wrap">
                         {typeof selectedAppointment.prescription === 'string' 
                           ? selectedAppointment.prescription 
                           : JSON.stringify(selectedAppointment.prescription)
                         }
                       </p>
                     </div>
                   )}
                   
                   {selectedAppointment.notes && (
                     <div className="mt-4">
                       <label className="block text-sm font-medium text-gray-700 mb-2">Doctor Notes</label>
                       <p className="text-gray-900 whitespace-pre-wrap bg-white p-3 rounded border">
                         {typeof selectedAppointment.notes === 'string' 
                           ? selectedAppointment.notes 
                           : JSON.stringify(selectedAppointment.notes)
                         }
                       </p>
                     </div>
                   )}
                 </div>

                 <div className="flex justify-end space-x-3">
                   <button
                     onClick={() => setShowAppointmentModal(false)}
                     className="btn-secondary"
                   >
                     Close
                   </button>
                   <button
                     onClick={() => {
                       setModalType('notes');
                       setAppointmentNotes(selectedAppointment.notes || '');
                     }}
                     className="btn-primary flex items-center space-x-2"
                   >
                     <PencilIcon className="h-4 w-4" />
                     <span>Add/Edit Notes</span>
                   </button>
                   {selectedAppointment.status === 'scheduled' && (
                     <button
                       onClick={() => {
                         handleCompleteAppointment(selectedAppointment._id);
                         setShowAppointmentModal(false);
                       }}
                       className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 flex items-center space-x-2"
                     >
                       <CheckIcon className="h-4 w-4" />
                       <span>Complete</span>
                     </button>
                   )}
                 </div>
               </>
             ) : (
               // Notes Editing View
               <>
                 <div className="flex justify-between items-center mb-4">
                   <h3 className="text-lg font-semibold text-gray-900">Appointment Notes</h3>
                   <button
                     onClick={() => setShowAppointmentModal(false)}
                     className="p-2 text-gray-400 hover:text-gray-600"
                   >
                     <XMarkIcon className="h-6 w-6" />
                   </button>
                 </div>
                 
                 <div className="mb-4">
                   <p className="text-sm text-gray-600">
                     Patient: <strong>{selectedAppointment.patient?.firstName} {selectedAppointment.patient?.lastName}</strong>
                   </p>
                   <p className="text-sm text-gray-600">
                     Date: <strong>{formatDate(selectedAppointment.appointmentDate)}</strong>
                   </p>
                 </div>
                 
                 <textarea
                   className="w-full border border-gray-300 rounded-md p-3 mb-4 focus:ring-blue-500 focus:border-blue-500"
                   rows={6}
                   value={appointmentNotes}
                   onChange={(e) => setAppointmentNotes(e.target.value)}
                   placeholder="Add notes for this appointment..."
                 ></textarea>
                 
                 <div className="flex justify-end space-x-2">
                   <button
                     onClick={() => setModalType('details')}
                     className="btn-secondary"
                   >
                     Back to Details
                   </button>
                   <button
                     onClick={handleAddNotes}
                     disabled={profileLoading}
                     className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                   >
                     {profileLoading ? 'Saving...' : 'Save Notes'}
                   </button>
                 </div>
               </>
             )}
           </div>
         </div>
       )}

       {/* Prescription Modal */}
       {showPrescriptionModal && selectedAppointmentForPrescription && (
         <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
           <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
             <div className="flex justify-between items-center mb-4">
               <h3 className="text-lg font-semibold text-gray-900">Create Prescription</h3>
               <button
                 onClick={() => setShowPrescriptionModal(false)}
                 className="p-2 text-gray-400 hover:text-gray-600"
               >
                 <XMarkIcon className="h-6 w-6" />
               </button>
             </div>
             
             <div className="mb-4">
               <p className="text-sm text-gray-600">
                 Patient: <strong>{selectedAppointmentForPrescription.patient?.firstName} {selectedAppointmentForPrescription.patient?.lastName}</strong>
               </p>
               <p className="text-sm text-gray-600">
                 Date: <strong>{formatDate(selectedAppointmentForPrescription.appointmentDate)}</strong>
               </p>
             </div>
             
             <div className="space-y-4">
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-2">Medications</label>
                 <textarea
                   className="w-full border border-gray-300 rounded-md p-3 focus:ring-blue-500 focus:border-blue-500"
                   rows={3}
                   value={prescriptionData.medications}
                   onChange={(e) => setPrescriptionData(prev => ({ ...prev, medications: e.target.value }))}
                   placeholder="Enter medication names..."
                 ></textarea>
               </div>
               
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-2">Dosage</label>
                 <input
                   type="text"
                   className="w-full border border-gray-300 rounded-md p-3 focus:ring-blue-500 focus:border-blue-500"
                   value={prescriptionData.dosage}
                   onChange={(e) => setPrescriptionData(prev => ({ ...prev, dosage: e.target.value }))}
                   placeholder="e.g., 500mg twice daily"
                 />
               </div>
               
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-2">Instructions</label>
                 <textarea
                   className="w-full border border-gray-300 rounded-md p-3 focus:ring-blue-500 focus:border-blue-500"
                   rows={3}
                   value={prescriptionData.instructions}
                   onChange={(e) => setPrescriptionData(prev => ({ ...prev, instructions: e.target.value }))}
                   placeholder="Special instructions for the patient..."
                 ></textarea>
               </div>
               
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-2">Duration</label>
                 <input
                   type="text"
                   className="w-full border border-gray-300 rounded-md p-3 focus:ring-blue-500 focus:border-blue-500"
                   value={prescriptionData.duration}
                   onChange={(e) => setPrescriptionData(prev => ({ ...prev, duration: e.target.value }))}
                   placeholder="e.g., 7 days, 2 weeks"
                 />
               </div>
             </div>
             
             <div className="flex justify-end space-x-3 mt-6">
               <button
                 onClick={() => setShowPrescriptionModal(false)}
                 className="btn-secondary"
               >
                 Cancel
               </button>
               <button
                 onClick={handleCreatePrescription}
                 disabled={profileLoading || !prescriptionData.medications}
                 className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50"
               >
                 {profileLoading ? 'Creating...' : 'Create Prescription'}
               </button>
             </div>
           </div>
         </div>
       )}

       {/* Prescription Modal */}
       {showPrescriptionModal && selectedAppointmentForPrescription && (
         <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
           <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
             <div className="flex justify-between items-center mb-4">
               <h3 className="text-lg font-semibold text-gray-900">Create Prescription</h3>
               <button
                 onClick={() => setShowPrescriptionModal(false)}
                 className="p-2 text-gray-400 hover:text-gray-600"
               >
                 <XMarkIcon className="h-6 w-6" />
               </button>
             </div>
             
             <div className="mb-4">
               <p className="text-sm text-gray-600">
                 Patient: <strong>{selectedAppointmentForPrescription.patient?.firstName} {selectedAppointmentForPrescription.patient?.lastName}</strong>
               </p>
               <p className="text-sm text-gray-600">
                 Date: <strong>{formatDate(selectedAppointmentForPrescription.appointmentDate)}</strong>
               </p>
             </div>
             
             <div className="space-y-4">
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-2">Medications</label>
                 <textarea
                   className="w-full border border-gray-300 rounded-md p-3 focus:ring-blue-500 focus:border-blue-500"
                   rows={3}
                   value={prescriptionData.medications}
                   onChange={(e) => setPrescriptionData(prev => ({ ...prev, medications: e.target.value }))}
                   placeholder="Enter medication names..."
                 ></textarea>
               </div>
               
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-2">Dosage</label>
                 <input
                   type="text"
                   className="w-full border border-gray-300 rounded-md p-3 focus:ring-blue-500 focus:border-blue-500"
                   value={prescriptionData.dosage}
                   onChange={(e) => setPrescriptionData(prev => ({ ...prev, dosage: e.target.value }))}
                   placeholder="e.g., 500mg twice daily"
                 />
               </div>
               
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-2">Instructions</label>
                 <textarea
                   className="w-full border border-gray-300 rounded-md p-3 focus:ring-blue-500 focus:border-blue-500"
                   rows={3}
                   value={prescriptionData.instructions}
                   onChange={(e) => setPrescriptionData(prev => ({ ...prev, instructions: e.target.value }))}
                   placeholder="Special instructions for the patient..."
                 ></textarea>
               </div>
               
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-2">Duration</label>
                 <input
                   type="text"
                   className="w-full border border-gray-300 rounded-md p-3 focus:ring-blue-500 focus:border-blue-500"
                   value={prescriptionData.duration}
                   onChange={(e) => setPrescriptionData(prev => ({ ...prev, duration: e.target.value }))}
                   placeholder="e.g., 7 days, 2 weeks"
                 />
               </div>
             </div>
             
             <div className="flex justify-end space-x-3 mt-6">
               <button
                 onClick={() => setShowPrescriptionModal(false)}
                 className="btn-secondary"
               >
                 Cancel
               </button>
               <button
                 onClick={handleCreatePrescription}
                 disabled={profileLoading || !prescriptionData.medications}
                 className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50"
               >
                 {profileLoading ? 'Creating...' : 'Create Prescription'}
               </button>
             </div>
           </div>
         </div>
       )}
    </ProtectedRoute>
  );
};

export default DoctorDashboard; 