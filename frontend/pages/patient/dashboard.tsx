import React, { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useAuthContext } from '../../components/AuthProvider';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import SymptomChecker from '../../components/SymptomChecker';
import DoctorSearch from '../../components/DoctorSearch';
import AppointmentBooking from '../../components/AppointmentBooking';
import { apiClient } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { useAppointments, useInvalidateAppointments } from '../../hooks/useAppointments';
import AppointmentsList from '../../features/appointments/AppointmentsList';
import { Appointment } from '../../features/appointments/types';
import { formatAppointmentDate, getStatusColor } from '../../features/appointments/utils';
import PrescriptionsList from '../../features/prescriptions/PrescriptionsList';
import { usePrescriptions } from '../../features/prescriptions/usePrescriptions';
import ReportsPanel from '../../features/reports/ReportsPanel';
import { useReports } from '../../features/reports/useReports';
import RemindersList, { Reminder } from '../../features/reminders/RemindersList';
import {
  HeartIcon,
  MapPinIcon,
  CalendarDaysIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  DocumentTextIcon,
  ShieldCheckIcon,
  PlusIcon,
  BellIcon,
  CreditCardIcon,
  VideoCameraIcon,
  StarIcon,
  ArrowRightIcon,
  SparklesIcon,
  CheckCircleIcon,
  DocumentArrowUpIcon,
  ExclamationTriangleIcon,
  ArrowDownTrayIcon,
  EyeIcon,
  PhotoIcon,
  BeakerIcon,
  ChartBarIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';

type TabType = 'overview' | 'symptom-checker' | 'find-doctors' | 'appointments' | 'prescriptions' | 'reminders' | 'reports';

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


// Dummy data
const dummyReminders: Reminder[] = [
  {
    id: '1',
    type: 'appointment',
    title: 'Cardiology Follow-up',
    description: 'Follow-up appointment with Dr. Sarah Wilson for blood pressure monitoring',
    dueDate: '2025-08-20',
    priority: 'high',
    completed: false
  },
  {
    id: '2',
    type: 'medication',
    title: 'Lisinopril Refill',
    description: 'Prescription refill needed for blood pressure medication',
    dueDate: '2025-08-25',
    priority: 'high',
    completed: false
  },
  {
    id: '3',
    type: 'test',
    title: 'Annual Blood Work',
    description: 'Time for annual comprehensive metabolic panel and lipid profile',
    dueDate: '2025-09-01',
    priority: 'medium',
    completed: false
  }
];

/**
 * Patient Dashboard with AI Symptom Checker and Doctor Search
 */
/** Interactive 1–5 star selector; read-only when `onChange` is omitted. */

const PatientDashboard: React.FC = () => {
  const { user, logout } = useAuthContext();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [lastBookedAppointment, setLastBookedAppointment] = useState<any>(null);

  // Appointments are server state: cached, persisted to IndexedDB, and
  // refreshed by invalidation after writes (booking, rating) instead of
  // manual refetch + loading-flag juggling.
  const { appointments, isLoading: loading } = useAppointments<Appointment>(!!user);
  const invalidateAppointments = useInvalidateAppointments();
  
  // Prescriptions and reports are owned by their feature hooks; the overview
  // only needs counts/previews, and React Query dedupes with the tab panels.
  const { prescriptions } = usePrescriptions(!!user);
  const { reports: uploadedReports } = useReports(!!user);
  const [reminders, setReminders] = useState<Reminder[]>(dummyReminders);
  const [recommendedSpecializations, setRecommendedSpecializations] = useState<string[]>([]);

  // Add state for active video call notifications
  const [activeVideoCallInvitation, setActiveVideoCallInvitation] = useState<any>(null);
  const videoCallTimeoutRef = useRef<NodeJS.Timeout | null>(null);




  // Check for active video call invitations
  const isCheckingRef = useRef(false);
  const pollErrorCountRef = useRef(0);
  
  const checkForActiveVideoCalls = useCallback(async (): Promise<void> => {
    if (!user || isCheckingRef.current) return;

    try {
      isCheckingRef.current = true;
      const response = await apiClient.get('/video-calls/active');
      
      if (response.data.success && response.data.data) {
        const activeCall = response.data.data;
        setActiveVideoCallInvitation(activeCall);
        
        // Clear any existing timeout
        if (videoCallTimeoutRef.current) {
          clearTimeout(videoCallTimeoutRef.current);
        }
        
        // Set 5-minute timeout to auto-dismiss popup
        videoCallTimeoutRef.current = setTimeout(() => {
          setActiveVideoCallInvitation(null);
          videoCallTimeoutRef.current = null;
        }, 5 * 60 * 1000); // 5 minutes in milliseconds
        
        pollErrorCountRef.current = 0; // Reset error count on success
      } else {
        setActiveVideoCallInvitation(null);
        pollErrorCountRef.current = 0; // Reset error count on successful response (just no active calls)
      }
    } catch (error) {
      console.error('Error checking for active video calls:', error);
      setActiveVideoCallInvitation(null);
      pollErrorCountRef.current += 1;
      
      // Stop polling after 3 consecutive errors to prevent spam
      if (pollErrorCountRef.current >= 3) {
        console.warn('🚫 Stopping video call polling due to consecutive errors');
        return;
      }
    } finally {
      isCheckingRef.current = false;
    }
  }, [user]);

  // Instant ring via socket push (polling below remains as a fallback)
  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    if (!socket) return;

    const onRing = (call: any) => {
      setActiveVideoCallInvitation({
        appointmentId: call.appointmentId,
        doctorName: call.doctorName,
        appointmentDate: call.appointmentDate
          ? new Date(call.appointmentDate).toLocaleString()
          : 'Now',
      });
      if (videoCallTimeoutRef.current) clearTimeout(videoCallTimeoutRef.current);
      videoCallTimeoutRef.current = setTimeout(() => {
        setActiveVideoCallInvitation(null);
        videoCallTimeoutRef.current = null;
      }, 5 * 60 * 1000);
    };

    const onCallEnded = () => {
      if (videoCallTimeoutRef.current) {
        clearTimeout(videoCallTimeoutRef.current);
        videoCallTimeoutRef.current = null;
      }
      setActiveVideoCallInvitation(null);
    };

    socket.on('call:ring', onRing);
    socket.on('call:ended', onCallEnded);
    return () => {
      socket.off('call:ring', onRing);
      socket.off('call:ended', onCallEnded);
    };
  }, [user]);

  // Poll for active video calls every 15 seconds (reduced frequency)
  useEffect(() => {
    if (!user) return;

    // Reset error count when user changes
    pollErrorCountRef.current = 0;

    // Check immediately when component mounts
    checkForActiveVideoCalls();

    // Set up polling every 15 seconds (less aggressive)
    const pollInterval = setInterval(() => {
      // Stop polling if too many errors occurred
      if (pollErrorCountRef.current >= 3) {
        console.warn('🚫 Video call polling stopped due to errors');
        clearInterval(pollInterval);
        return;
      }
      checkForActiveVideoCalls();
    }, 15000);

    // Cleanup on unmount
    return () => {
      clearInterval(pollInterval);
      pollErrorCountRef.current = 0;
    };
  }, [user, checkForActiveVideoCalls]);

  const handleLogout = async () => {
    await logout();
  };

  const handleFindDoctors = (symptoms: string, specializations?: string[]) => {
    if (specializations && specializations.length > 0) {
      setRecommendedSpecializations(specializations);
    }
    setActiveTab('find-doctors');
  };

  const handleBookAppointment = (doctor: any) => {
    setSelectedDoctor({
      id: doctor._id || doctor.id,
      name: `${doctor.firstName} ${doctor.lastName}`,
      specialization: doctor.specialization,
      consultationFee: doctor.consultationFee,
      avatar: doctor.avatar,
      location: {
        address: doctor.clinicAddress || 'Not specified',
        city: doctor.city || 'Not specified'
      }
    });
    setShowBookingModal(true);
  };

  const handleDoctorBooking = (doctor: Doctor) => {
    setSelectedDoctor(doctor);
    setShowBookingModal(true);
  };

  const handleBookingSuccess = (appointmentData: any) => {
    setLastBookedAppointment(appointmentData);
    setBookingSuccess(true);
    setActiveTab('appointments');

    // Refresh appointments list
    invalidateAppointments();
    
    // Show success message for a few seconds then hide
    setTimeout(() => setBookingSuccess(false), 5000);
  };

  const handleCloseBookingModal = () => {
    setShowBookingModal(false);
    setSelectedDoctor(null);
  };


  const renderOverview = () => (
    <div className="space-y-8">
      {/* Welcome Section */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-8 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">
              Welcome back, {user?.firstName}! 👋
            </h1>
            <p className="text-blue-100 text-lg">
              Your health journey starts here. How can we help you today?
            </p>
          </div>
          <div className="hidden md:block">
            <div className="w-32 h-32 bg-white/20 rounded-full flex items-center justify-center">
              <HeartIcon className="h-16 w-16 text-white" />
            </div>
          </div>
        </div>
      </div>

      {/* Health Stats Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Appointments</p>
              <p className="text-2xl font-bold text-gray-900">{appointments.length}</p>
            </div>
            <div className="p-2 bg-blue-100 rounded-lg">
              <CalendarDaysIcon className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Uploaded Reports</p>
              <p className="text-2xl font-bold text-gray-900">{uploadedReports.length}</p>
            </div>
            <div className="p-2 bg-green-100 rounded-lg">
              <DocumentArrowUpIcon className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Active Prescriptions</p>
              <p className="text-2xl font-bold text-gray-900">{prescriptions.length}</p>
            </div>
            <div className="p-2 bg-purple-100 rounded-lg">
              <DocumentTextIcon className="h-6 w-6 text-purple-600" />
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Pending Reminders</p>
              <p className="text-2xl font-bold text-red-600">{reminders.filter(r => !r.completed).length}</p>
            </div>
            <div className="p-2 bg-red-100 rounded-lg">
              <BellIcon className="h-6 w-6 text-red-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions - Enhanced */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          onClick={() => setActiveTab('symptom-checker')}
          className="card hover-lift p-6 text-left transition-all duration-200 hover:shadow-xl group"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
              <SparklesIcon className="h-6 w-6 text-white" />
            </div>
            <ArrowRightIcon className="h-5 w-5 text-gray-400 group-hover:text-blue-600 transition-colors" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">AI Symptom Checker</h3>
          <p className="text-gray-600 text-sm">
            Get AI-powered health insights
          </p>
        </button>

        <button
          onClick={() => setActiveTab('find-doctors')}
          className="card hover-lift p-6 text-left transition-all duration-200 hover:shadow-xl group"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-green-600 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
              <MapPinIcon className="h-6 w-6 text-white" />
            </div>
            <ArrowRightIcon className="h-5 w-5 text-gray-400 group-hover:text-green-600 transition-colors" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Find Doctors</h3>
          <p className="text-gray-600 text-sm">
            Search healthcare providers
          </p>
        </button>

        <button
          onClick={() => setActiveTab('prescriptions')}
          className="card hover-lift p-6 text-left transition-all duration-200 hover:shadow-xl group"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
              <DocumentTextIcon className="h-6 w-6 text-white" />
            </div>
            <ArrowRightIcon className="h-5 w-5 text-gray-400 group-hover:text-purple-600 transition-colors" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Prescriptions</h3>
          <p className="text-gray-600 text-sm">
            View active medications
          </p>
        </button>

        <button
          onClick={() => setActiveTab('reports')}
          className="card hover-lift p-6 text-left transition-all duration-200 hover:shadow-xl group"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
              <DocumentArrowUpIcon className="h-6 w-6 text-white" />
            </div>
            <ArrowRightIcon className="h-5 w-5 text-gray-400 group-hover:text-orange-600 transition-colors" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Upload Reports</h3>
          <p className="text-gray-600 text-sm">
            Manage medical documents
          </p>
        </button>
      </div>

      {/* Dashboard Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <div className="lg:col-span-2">
          <div className="card">
            <div className="card-body">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <ClockIcon className="h-5 w-5 mr-2 text-blue-600" />
                Recent Activity
              </h3>
              <div className="space-y-4">
                {appointments.length > 0 ? (
                  <>
                    {appointments.slice(0, 3).map((appointment) => (
                      <div key={appointment._id} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                        <div className={`w-2 h-2 rounded-full ${
                          appointment.status === 'confirmed' ? 'bg-green-500' :
                          appointment.status === 'pending' ? 'bg-yellow-500' :
                          appointment.status === 'completed' ? 'bg-blue-500' : 'bg-gray-500'
                        }`}></div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">
                            Appointment with Dr. {appointment.doctor?.firstName || 'Unknown'} {appointment.doctor?.lastName || 'Doctor'}
                          </p>
                          <p className="text-xs text-gray-600">
                            {appointment.doctor?.specialization || 'General'} • {appointment.consultationType}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(appointment.status)}`}>
                            {appointment.status}
                          </span>
                          <p className="text-xs text-gray-500 mt-1">
                            {formatAppointmentDate(appointment.appointmentDate).split(',')[0]}
                          </p>
                        </div>
                      </div>
                    ))}
                    {appointments.length > 3 && (
                      <button
                        onClick={() => setActiveTab('appointments')}
                        className="w-full text-center text-sm text-blue-600 hover:text-blue-700 py-2"
                      >
                        View all {appointments.length} appointments →
                      </button>
                    )}
                  </>
                ) : (
                  <div className="text-center py-8">
                    <CalendarDaysIcon className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-600 mb-4">No appointments yet</p>
                    <button
                      onClick={() => setActiveTab('find-doctors')}
                      className="btn-primary"
                    >
                      Book Your First Appointment
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Urgent Reminders & Health Summary */}
        <div className="space-y-6">
          {/* Urgent Reminders */}
          <div className="card">
            <div className="card-body">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                  <BellIcon className="h-5 w-5 mr-2 text-red-600" />
                  Urgent Reminders
                </h3>
                <button
                  onClick={() => setActiveTab('reminders')}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  View All
                </button>
              </div>
              <div className="space-y-3">
                {reminders.filter(r => !r.completed && r.priority === 'high').slice(0, 3).map((reminder) => (
                  <div key={reminder.id} className="p-3 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-gray-900">{reminder.title}</h4>
                        <p className="text-xs text-gray-600 mt-1">{reminder.description}</p>
                        <p className="text-xs text-red-600 font-medium mt-1">
                          Due: {new Date(reminder.dueDate).toLocaleDateString()}
                        </p>
                      </div>
                      <div className={`p-1 rounded-full ${
                        reminder.type === 'appointment' ? 'bg-blue-100 text-blue-600' :
                        reminder.type === 'medication' ? 'bg-purple-100 text-purple-600' :
                        'bg-green-100 text-green-600'
                      }`}>
                        {reminder.type === 'appointment' ? <CalendarDaysIcon className="h-4 w-4" /> :
                         reminder.type === 'medication' ? <DocumentTextIcon className="h-4 w-4" /> :
                         <BeakerIcon className="h-4 w-4" />}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Current Prescriptions */}
          <div className="card">
            <div className="card-body">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                  <DocumentTextIcon className="h-5 w-5 mr-2 text-purple-600" />
                  Current Medications
                </h3>
                <button
                  onClick={() => setActiveTab('prescriptions')}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  View All
                </button>
              </div>
              <div className="space-y-3">
                {prescriptions.slice(0, 2).map((prescription) => (
                  <div key={prescription.id} className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                    <h4 className="text-sm font-medium text-gray-900 mb-2">{prescription.diagnosis}</h4>
                    <div className="space-y-1">
                      {prescription.medications.slice(0, 2).map((med, index) => (
                        <div key={index} className="flex justify-between text-xs">
                          <span className="text-gray-700">{med.name}</span>
                          <span className="text-gray-600">{med.dosage} - {med.frequency}</span>
                        </div>
                      ))}
                    </div>
                    {prescription.nextFollowUp && (
                      <p className="text-xs text-orange-600 mt-2">
                        Next follow-up: {new Date(prescription.nextFollowUp).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );



  const toggleReminder = (id: string) => {
    setReminders(prev => prev.map(reminder => 
      reminder.id === id ? { ...reminder, completed: !reminder.completed } : reminder
    ));
  };


  // Video Call Invitation Banner
  const renderVideoCallInvitation = () => {
    if (!activeVideoCallInvitation) return null;

    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-green-500 to-blue-600 text-white shadow-lg border-b-4 border-green-400">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="animate-pulse">
                <VideoCameraIcon className="h-8 w-8 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-bold">
                  🎥 Dr. {activeVideoCallInvitation.doctorName} is calling you!
                </h3>
                <p className="text-sm opacity-90">
                  Appointment: {activeVideoCallInvitation.appointmentDate} • Join now
                </p>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              <button
                onClick={() => handleJoinActiveVideoCall(activeVideoCallInvitation)}
                className="bg-white text-green-600 px-6 py-2 rounded-lg font-semibold hover:bg-gray-100 transition-colors animate-bounce"
              >
                🎥 Join Call Now
              </button>
              <button
                onClick={() => {
                  // Clear timeout when manually dismissing
                  if (videoCallTimeoutRef.current) {
                    clearTimeout(videoCallTimeoutRef.current);
                    videoCallTimeoutRef.current = null;
                  }
                  setActiveVideoCallInvitation(null);
                }}
                className="text-white opacity-75 hover:opacity-100 transition-opacity"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Handle joining active video call
  const handleJoinActiveVideoCall = (callData: any) => {
    const callLink = `/video-call?id=${callData.appointmentId}`;
    window.location.href = callLink;
    
    // Clear timeout when joining call
    if (videoCallTimeoutRef.current) {
      clearTimeout(videoCallTimeoutRef.current);
      videoCallTimeoutRef.current = null;
    }
    
    // Clear the notification immediately since we're navigating away
    setActiveVideoCallInvitation(null);
  };

  return (
    <ProtectedRoute allowedRoles={['patient']}>
      <Head>
        <title>Patient Dashboard - SymptoBridge AI</title>
        <meta name="description" content="AI-powered healthcare dashboard for patients" />
      </Head>

      {/* Video Call Invitation Banner - Always at the very top */}
      {renderVideoCallInvitation()}

      <div className="min-h-screen bg-gray-50" style={{ paddingTop: activeVideoCallInvitation ? '80px' : '0' }}>
        {/* Header */}
        <header className="bg-white shadow-sm border-b sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-4">
              <Link
                href="/"
                aria-label="Go to SymptoBridge home"
                className="flex items-center space-x-4 group focus:outline-none focus-visible:ring-2 focus-visible:ring-coral-500 rounded-lg"
              >
                <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center transition-transform group-hover:scale-105">
                  <span className="text-white font-bold text-lg">S</span>
                </div>
                <div>
                  <span className="text-xl font-bold gradient-text">SymptoBridge</span>
                  <span className="text-sm text-gray-600 ml-2">Patient Portal</span>
                </div>
              </Link>
              
              <div className="flex items-center space-x-4">
                <div className="hidden md:flex items-center space-x-2">
                  <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-white font-semibold text-sm">
                    {user?.firstName?.[0]}{user?.lastName?.[0]}
                  </div>
                  <span className="text-gray-700">Welcome, {user?.firstName}!</span>
                </div>
                <button
                  onClick={handleLogout}
                  className="btn-secondary text-sm"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Navigation Tabs */}
        <nav className="bg-white border-b" aria-label="Dashboard sections">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex space-x-8 overflow-x-auto">
              {[
                { id: 'overview', label: 'Overview', icon: HeartIcon },
                { id: 'symptom-checker', label: 'AI Symptom Checker', icon: SparklesIcon },
                { id: 'find-doctors', label: 'Find Doctors', icon: MapPinIcon },
                { id: 'appointments', label: 'Appointments', icon: CalendarDaysIcon },
                { id: 'prescriptions', label: 'Prescriptions', icon: DocumentTextIcon },
                { id: 'reports', label: 'Upload Reports', icon: DocumentArrowUpIcon },
                { id: 'reminders', label: 'Reminders', icon: BellIcon }
              ].map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as TabType)}
                    aria-current={activeTab === tab.id ? 'page' : undefined}
                    className={`flex items-center space-x-2 py-4 px-2 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
                      activeTab === tab.id
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </nav>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {activeTab === 'overview' && renderOverview()}
          {activeTab === 'symptom-checker' && (
            <SymptomChecker 
              onFindDoctors={handleFindDoctors}
              onBookAppointment={handleBookAppointment}
            />
          )}
          {activeTab === 'find-doctors' && (
            <DoctorSearch 
              onBookAppointment={handleDoctorBooking} 
              recommendedSpecializations={recommendedSpecializations}
            />
          )}
          {activeTab === 'appointments' && (
            <AppointmentsList
              appointments={appointments}
              loading={loading}
              onBookNew={() => setActiveTab('find-doctors')}
            />
          )}
          {activeTab === 'prescriptions' && (
            <PrescriptionsList
              prescriptions={prescriptions}
              onRequestNew={() => setActiveTab('find-doctors')}
            />
          )}
          {activeTab === 'reports' && <ReportsPanel />}
          {activeTab === 'reminders' && (
            <RemindersList
              reminders={reminders}
              onToggle={toggleReminder}
              onViewAppointments={() => setActiveTab('appointments')}
            />
          )}
        </main>
      </div>

             {/* Appointment Booking Modal */}
       {showBookingModal && selectedDoctor && (
         <AppointmentBooking
           doctor={selectedDoctor}
           isOpen={showBookingModal}
           onSuccess={handleBookingSuccess}
           onClose={handleCloseBookingModal}
         />
       )}

      {/* Success Message */}
      {bookingSuccess && lastBookedAppointment && (
        <div className="fixed bottom-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-50">
          <div className="flex items-center">
            <CheckCircleIcon className="h-5 w-5 mr-2" />
            <span>Appointment booked successfully!</span>
          </div>
        </div>
      )}
    </ProtectedRoute>
  );
};

export default PatientDashboard; 