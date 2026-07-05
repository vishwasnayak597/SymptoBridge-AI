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

type TabType = 'overview' | 'symptom-checker' | 'find-doctors' | 'appointments' | 'records' | 'prescriptions' | 'reminders' | 'reports';

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

interface Appointment {
  _id: string;
  doctor: {
    _id: string;
    firstName: string;
    lastName: string;
    specialization: string;
    consultationFee: number;
    avatar?: string;
  };
  appointmentDate: string;
  consultationType: string;
  symptoms: string;
  status: string;
  fee: number;
  videoCallLink?: string;
  createdAt: string;
}

interface MedicalRecord {
  id: string;
  date: string;
  type: 'consultation' | 'lab_test' | 'prescription' | 'checkup';
  doctorName: string;
  specialization: string;
  diagnosis: string;
  notes: string;
  attachments?: string[];
}

interface Prescription {
  id: string;
  date: string;
  doctorName: string;
  medications: {
    name: string;
    dosage: string;
    frequency: string;
    duration: string;
    instructions: string;
  }[];
  diagnosis: string;
  nextFollowUp?: string;
}

interface UploadedReport {
  id: string;
  title: string;
  fileName: string;
  type: 'blood_test' | 'xray' | 'mri' | 'ct_scan' | 'ultrasound' | 'lab_report' | 'prescription' | 'discharge_summary' | 'other';
  uploadDate: string;
  fileSize: number;
  description?: string;
  status: 'pending' | 'reviewed' | 'archived';
  mimeType: string;
  patient: string;
  uploadedBy: {
    firstName: string;
    lastName: string;
    role: string;
  };
}

interface Reminder {
  id: string;
  type: 'appointment' | 'medication' | 'checkup' | 'test';
  title: string;
  description: string;
  dueDate: string;
  priority: 'high' | 'medium' | 'low';
  completed: boolean;
}

// Dummy data
const dummyMedicalRecords: MedicalRecord[] = [
  {
    id: '1',
    date: '2025-08-15',
    type: 'consultation',
    doctorName: 'Dr. Sarah Wilson',
    specialization: 'Cardiology',
    diagnosis: 'Hypertension (High Blood Pressure)',
    notes: 'Patient shows elevated blood pressure readings. Recommended lifestyle changes and medication. Follow-up in 3 months.',
    attachments: ['ecg_report.pdf', 'blood_pressure_chart.pdf']
  },
  {
    id: '2',
    date: '2025-08-10',
    type: 'lab_test',
    doctorName: 'Dr. Michael Chen',
    specialization: 'Internal Medicine',
    diagnosis: 'Complete Blood Count - Normal',
    notes: 'All blood parameters within normal range. Hemoglobin: 14.2 g/dL, WBC: 7,200/μL, Platelets: 280,000/μL',
    attachments: ['cbc_report.pdf']
  },
  {
    id: '3',
    date: '2025-08-05',
    type: 'checkup',
    doctorName: 'Dr. Emily Rodriguez',
    specialization: 'General Practice',
    diagnosis: 'Annual Health Checkup - Good Health',
    notes: 'Overall health status is good. BMI: 24.5 (Normal). Blood pressure: 120/80 mmHg. Recommended annual follow-up.',
    attachments: ['health_summary.pdf']
  }
];

const dummyPrescriptions: Prescription[] = [
  {
    id: '1',
    date: '2025-08-15',
    doctorName: 'Dr. Sarah Wilson',
    medications: [
      {
        name: 'Lisinopril',
        dosage: '10mg',
        frequency: 'Once daily',
        duration: '3 months',
        instructions: 'Take in the morning with food. Monitor blood pressure regularly.'
      },
      {
        name: 'Aspirin',
        dosage: '81mg',
        frequency: 'Once daily',
        duration: 'Ongoing',
        instructions: 'Take with food to prevent stomach upset. Low-dose for heart protection.'
      }
    ],
    diagnosis: 'Hypertension',
    nextFollowUp: '2025-11-15'
  },
  {
    id: '2',
    date: '2025-07-20',
    doctorName: 'Dr. Michael Chen',
    medications: [
      {
        name: 'Vitamin D3',
        dosage: '2000 IU',
        frequency: 'Once daily',
        duration: '6 months',
        instructions: 'Take with largest meal of the day for better absorption.'
      }
    ],
    diagnosis: 'Vitamin D Deficiency',
    nextFollowUp: '2025-10-20'
  }
];

const dummyUploadedReports: UploadedReport[] = [
  {
    id: '1',
    title: 'Blood Test Results - CBC',
    fileName: 'cbc_report.pdf',
    type: 'blood_test',
    uploadDate: '2025-08-10',
    fileSize: 2100000,
    description: 'Complete blood count report for August 2025',
    status: 'reviewed',
    mimeType: 'application/pdf',
    patient: 'patient123',
    uploadedBy: { firstName: 'John', lastName: 'Doe', role: 'patient' }
  },
  {
    id: '2',
    title: 'Chest X-Ray',
    fileName: 'chest_xray.jpg',
    type: 'xray',
    uploadDate: '2025-07-25',
    fileSize: 5800000,
    description: 'Chest X-Ray for suspected pneumonia',
    status: 'pending',
    mimeType: 'image/jpeg',
    patient: 'patient123',
    uploadedBy: { firstName: 'Jane', lastName: 'Smith', role: 'patient' }
  },
  {
    id: '3',
    title: 'ECG Report',
    fileName: 'ecg_report.pdf',
    type: 'other',
    uploadDate: '2025-08-15',
    fileSize: 1300000,
    description: 'Electrocardiogram report for patient monitoring',
    status: 'archived',
    mimeType: 'application/pdf',
    patient: 'patient123',
    uploadedBy: { firstName: 'John', lastName: 'Doe', role: 'patient' }
  }
];

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
const PatientDashboard: React.FC = () => {
  const { user, logout } = useAuthContext();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [lastBookedAppointment, setLastBookedAppointment] = useState<any>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  
  // New state for enhanced features
  const [medicalRecords, setMedicalRecords] = useState<MedicalRecord[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [uploadedReports, setUploadedReports] = useState<UploadedReport[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>(dummyReminders);
  const [uploadingReport, setUploadingReport] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  
  // State for reports upload form (moved from renderReports to fix hooks rule violation)
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    title: '',
    type: 'blood_test',
    description: '',
    reportDate: ''
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [recommendedSpecializations, setRecommendedSpecializations] = useState<string[]>([]);

  // Add state for active video call notifications
  const [activeVideoCallInvitation, setActiveVideoCallInvitation] = useState<any>(null);
  const videoCallTimeoutRef = useRef<NodeJS.Timeout | null>(null);


  // Fetch real data from APIs (wrapped in useCallback to prevent unnecessary re-renders)
  const fetchMedicalData = useCallback(async () => {
    if (!user) return;
    
    try {
      setLoadingData(true);
      
      // Fetch medical records, prescriptions, and reports in parallel
      const [recordsRes, prescriptionsRes, reportsRes] = await Promise.all([
        apiClient.get('/medical-records/my-records'),
        apiClient.get('/prescriptions/my-prescriptions'),
        apiClient.get('/reports/my-reports')
      ]);

      if (recordsRes.data.success) {
        setMedicalRecords(recordsRes.data.data);
      }

      if (prescriptionsRes.data.success) {
        setPrescriptions(prescriptionsRes.data.data);
      }

      if (reportsRes.data.success) {
        setUploadedReports(reportsRes.data.data);
      }
    } catch (error) {
      console.error('Error fetching medical data:', error);
    } finally {
      setLoadingData(false);
    }
  }, [user]);

  // Add new report upload function with real file upload
  const handleUploadReport = async (file: File, reportData: {
    title: string;
    type: string;
    description?: string;
    reportDate?: string;
  }) => {
    try {
      setUploadingReport(true);
      

      
      const formData = new FormData();
      formData.append('report', file);
      formData.append('title', reportData.title);
      formData.append('type', reportData.type);
      if (reportData.description) {
        formData.append('description', reportData.description);
      }
      if (reportData.reportDate) {
        formData.append('reportDate', reportData.reportDate);
      }


      
      const response = await apiClient.post('/reports/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });



      if (response.data.success) {
        // Add the new report to the list
        setUploadedReports(prev => [response.data.data, ...prev]);
        return { success: true, data: response.data.data };
      } else {
        throw new Error(response.data.message || 'Upload failed');
      }
    } catch (error) {
      console.error('❌ Error uploading report:', error);
      console.error('📊 Error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        statusText: error.response?.statusText,
        config: error.config
      });
      
      if (error.response?.data?.message) {
        throw new Error(error.response.data.message);
      } else if (error.response?.status === 401) {
        throw new Error('Authentication failed. Please log in again.');
      } else if (error.response?.status === 413) {
        throw new Error('File too large. Maximum size is 10MB.');
      } else if (error.message.includes('Invalid file type')) {
        throw new Error('Invalid file type. Only images, PDFs, and documents are allowed.');
      } else if (error.code === 'NETWORK_ERROR') {
        throw new Error('Network error. Please check your connection and try again.');
      }
      throw error;
    } finally {
      setUploadingReport(false);
    }
  };

  // Download a report through the authenticated API client (window.open cannot send auth headers)
  const handleDownloadReport = async (reportId: string, fileName: string) => {
    try {
      const response = await apiClient.get(`/reports/${reportId}/download`, {
        responseType: 'blob',
      });

      const url = window.URL.createObjectURL(new Blob([response.data as unknown as BlobPart]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', fileName || 'report');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading report:', error);
      alert('Failed to download report. Please try again.');
    }
  };

  // Remove report function
  const handleRemoveReport = async (reportId: string) => {
    try {
      const response = await apiClient.delete(`/reports/${reportId}`);
      
      if (response.data.success) {
        setUploadedReports(prev => prev.filter(report => report.id !== reportId));
      }
    } catch (error) {
      console.error('Error removing report:', error);
    }
  };

  // Fetch appointments (wrapped in useCallback to prevent unnecessary re-renders)
  const fetchAppointments = useCallback(async () => {
    try {
      setLoading(true);
      const response = await apiClient.get('/appointments');
      if (response.data.success && response.data.data) {
        const appointmentsData = response.data.data.appointments;
        setAppointments(Array.isArray(appointmentsData) ? appointmentsData : []);
      } else {
        console.warn('Failed to fetch appointments:', response.data.message);
        setAppointments([]);
      }
    } catch (error) {
      console.error('Error fetching appointments:', error);
      setAppointments([]); // Ensure appointments is always an array
    } finally {
      setLoading(false);
    }
  }, []);

  // Consolidated useEffect with proper dependencies to prevent multiple calls
  useEffect(() => {
    if (user) {
      fetchAppointments();
      fetchMedicalData();
    }
  }, [user, fetchAppointments, fetchMedicalData]);

  // Only fetch specific data when tab changes (to avoid redundant calls)
  useEffect(() => {
    if (!user) return;
    
    if (activeTab === 'appointments' || activeTab === 'overview') {
      // Only refetch if we don't have data or if explicitly needed
      if (appointments.length === 0) {
        fetchAppointments();
      }
    }
    
    if (activeTab === 'records' || activeTab === 'prescriptions' || activeTab === 'reports') {
      // Only refetch if we don't have data or if explicitly needed
      if (medicalRecords.length === 0 && prescriptions.length === 0 && uploadedReports.length === 0) {
        fetchMedicalData();
      }
    }
  }, [activeTab, user, appointments.length, medicalRecords.length, prescriptions.length, uploadedReports.length, fetchAppointments, fetchMedicalData]);

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
    fetchAppointments();
    
    // Show success message for a few seconds then hide
    setTimeout(() => setBookingSuccess(false), 5000);
  };

  const handleCloseBookingModal = () => {
    setShowBookingModal(false);
    setSelectedDoctor(null);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusColor = (status: string) => {
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
  };

  const canJoinVideoCall = (appointment: Appointment) => {
    const appointmentTime = new Date(appointment.appointmentDate);
    const now = new Date();
    const timeDiff = appointmentTime.getTime() - now.getTime();
    const minutesDiff = Math.floor(timeDiff / (1000 * 60));
    
    // Allow joining 10 minutes before appointment time and until 30 minutes after
    return minutesDiff <= 10 && minutesDiff >= -30 && appointment.status === 'confirmed';
  };

  const handleJoinVideoCall = (appointment: Appointment) => {
    if (appointment.videoCallLink) {
      window.location.href = appointment.videoCallLink;
    } else {
      // Generate video call link if not exists (using URL parameters)
      const callLink = `/video-call?id=${appointment._id}`;
      window.location.href = callLink;
    }
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
              <p className="text-sm font-medium text-gray-600">Medical Records</p>
              <p className="text-2xl font-bold text-gray-900">{medicalRecords.length}</p>
            </div>
            <div className="p-2 bg-green-100 rounded-lg">
              <DocumentTextIcon className="h-6 w-6 text-green-600" />
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
                            {formatDate(appointment.appointmentDate).split(',')[0]}
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

  const renderAppointments = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">My Appointments</h2>
        <button
          onClick={() => setActiveTab('find-doctors')}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <PlusIcon className="h-4 w-4 inline mr-2" />
          Book New Appointment
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : appointments.length === 0 ? (
        <div className="text-center py-12">
          <CalendarDaysIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">No appointments yet</h3>
          <p className="mt-2 text-gray-500">Book your first appointment with a doctor</p>
          <button
            onClick={() => setActiveTab('find-doctors')}
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
                    </div>
                  </div>
                  
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-medium text-gray-700">Date & Time</p>
                      <p className="text-sm text-gray-600">{formatDate(appointment.appointmentDate)}</p>
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
                      onClick={() => handleJoinVideoCall(appointment)}
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
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderHistory = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Medical History</h2>
          <p className="text-gray-600">Your complete medical records and consultation history</p>
        </div>
        <button
          onClick={() => setActiveTab('reports')}
          className="btn-primary flex items-center"
        >
          <DocumentArrowUpIcon className="h-4 w-4 mr-2" />
          Upload Reports
        </button>
      </div>

      {loadingData ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : medicalRecords.length === 0 ? (
        <div className="text-center py-12">
          <DocumentTextIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-900 mb-2">No medical history yet</h3>
          <p className="text-gray-600 mb-6">
            Your consultation history and medical records will appear here
          </p>
          <button
            onClick={() => setActiveTab('symptom-checker')}
            className="btn-primary flex items-center mx-auto"
          >
            <SparklesIcon className="h-4 w-4 mr-2" />
            Start Symptom Check
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {medicalRecords.map((record) => (
            <div key={record.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-3">
                    <div className={`p-2 rounded-lg ${
                      (record.type || 'consultation') === 'consultation' ? 'bg-blue-100 text-blue-600' :
                      (record.type || 'consultation') === 'lab_test' ? 'bg-green-100 text-green-600' :
                      (record.type || 'consultation') === 'prescription' ? 'bg-purple-100 text-purple-600' :
                      'bg-orange-100 text-orange-600'
                    }`}>
                      {(record.type || 'consultation') === 'consultation' ? <ChatBubbleLeftRightIcon className="h-5 w-5" /> :
                       (record.type || 'consultation') === 'lab_test' ? <BeakerIcon className="h-5 w-5" /> :
                       (record.type || 'consultation') === 'prescription' ? <DocumentTextIcon className="h-5 w-5" /> :
                       <ShieldCheckIcon className="h-5 w-5" />}
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{record.diagnosis}</h3>
                      <p className="text-sm text-gray-600">{record.doctorName} • {record.specialization}</p>
                    </div>
                  </div>
                  
                  <p className="text-gray-700 mb-4">{record.notes}</p>
                  
                  {record.attachments && record.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {record.attachments.map((attachment, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center px-3 py-1 bg-gray-100 text-gray-700 text-sm rounded-full"
                        >
                          <DocumentTextIcon className="h-4 w-4 mr-1" />
                          {attachment}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-900">{new Date(record.date).toLocaleDateString()}</p>
                  <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full mt-1 ${
                    (record.type || 'consultation') === 'consultation' ? 'bg-blue-100 text-blue-800' :
                    (record.type || 'consultation') === 'lab_test' ? 'bg-green-100 text-green-800' :
                    (record.type || 'consultation') === 'prescription' ? 'bg-purple-100 text-purple-800' :
                    'bg-orange-100 text-orange-800'
                  }`}>
                    {(record.type || 'consultation').replace('_', ' ').toUpperCase()}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderPrescriptions = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Prescriptions</h2>
          <p className="text-gray-600">Your current and past prescriptions</p>
        </div>
        <button
          onClick={() => setActiveTab('find-doctors')}
          className="btn-primary flex items-center"
        >
          <PlusIcon className="h-4 w-4 mr-2" />
          Get New Prescription
        </button>
      </div>

      {prescriptions.length === 0 ? (
        <div className="text-center py-12">
          <DocumentTextIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-900 mb-2">No prescriptions yet</h3>
          <p className="text-gray-600 mb-6">
            Your prescriptions from consultations will appear here
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {prescriptions.map((prescription) => (
            <div key={prescription.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{prescription.diagnosis}</h3>
                  <p className="text-sm text-gray-600">Prescribed by {prescription.doctorName}</p>
                  <p className="text-sm text-gray-500">Date: {new Date(prescription.date).toLocaleDateString()}</p>
                </div>
                <div className="text-right">
                  {prescription.nextFollowUp && (
                    <div className="text-sm text-orange-600 bg-orange-50 px-3 py-1 rounded-full">
                      Follow-up: {new Date(prescription.nextFollowUp).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                {prescription.medications.map((medication, index) => (
                  <div key={index} className="border-l-4 border-blue-200 bg-blue-50 p-4 rounded-r-lg">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-900 text-lg">{medication.name}</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2 text-sm">
                          <div>
                            <span className="font-medium text-gray-700">Dosage:</span>
                            <span className="ml-2 text-gray-900">{medication.dosage}</span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">Frequency:</span>
                            <span className="ml-2 text-gray-900">{medication.frequency}</span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">Duration:</span>
                            <span className="ml-2 text-gray-900">{medication.duration}</span>
                          </div>
                        </div>
                        <div className="mt-3">
                          <span className="font-medium text-gray-700">Instructions:</span>
                          <p className="text-gray-900 mt-1">{medication.instructions}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderReports = () => {
    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        // Check file size (10MB limit)
        if (file.size > 10 * 1024 * 1024) {
          alert('File size must be less than 10MB');
          return;
        }
        
        // Check file type
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'application/pdf'];
        if (!allowedTypes.includes(file.type)) {
          alert('Invalid file type. Only images and PDFs are allowed.');
          return;
        }
        
        setSelectedFile(file);
        setUploadForm(prev => ({
          ...prev,
          title: prev.title || file.name.split('.')[0]
        }));
      }
    };

    const handleUploadSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      
      if (!selectedFile) {
        alert('Please select a file');
        return;
      }

      if (!uploadForm.title.trim()) {
        alert('Please enter a title');
        return;
      }

      try {
        await handleUploadReport(selectedFile, uploadForm);
        
        // Reset form
        setSelectedFile(null);
        setUploadForm({
          title: '',
          type: 'blood_test',
          description: '',
          reportDate: ''
        });
        setShowUploadForm(false);
        
        alert('Report uploaded successfully!');
      } catch (error) {
        alert('Failed to upload report. Please try again.');
      }
    };

    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Medical Reports</h2>
            <p className="text-gray-600">Upload and manage your medical reports and test results</p>
          </div>
          <button
            onClick={() => setShowUploadForm(!showUploadForm)}
            className="btn-primary flex items-center"
            disabled={uploadingReport}
          >
            <DocumentArrowUpIcon className="h-4 w-4 mr-2" />
            {uploadingReport ? 'Uploading...' : 'Upload Report'}
          </button>
        </div>

        {/* Upload Form */}
        {showUploadForm && (
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-200">
            <form onSubmit={handleUploadSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select File *
                </label>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.gif"
                  onChange={handleFileSelect}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  required
                />
                {selectedFile && (
                  <p className="text-sm text-green-600 mt-1">
                    Selected: {selectedFile.name} ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Report Title *
                  </label>
                  <input
                    type="text"
                    value={uploadForm.title}
                    onChange={(e) => setUploadForm(prev => ({ ...prev, title: e.target.value }))}
                    className="input-field"
                    placeholder="e.g., Blood Test Report"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Report Type *
                  </label>
                  <select
                    value={uploadForm.type}
                    onChange={(e) => setUploadForm(prev => ({ ...prev, type: e.target.value }))}
                    className="input-field"
                    required
                  >
                    <option value="blood_test">Blood Test</option>
                    <option value="xray">X-Ray</option>
                    <option value="mri">MRI Scan</option>
                    <option value="ct_scan">CT Scan</option>
                    <option value="ultrasound">Ultrasound</option>
                    <option value="lab_report">Lab Report</option>
                    <option value="prescription">Prescription</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Report Date
                </label>
                <input
                  type="date"
                  value={uploadForm.reportDate}
                  onChange={(e) => setUploadForm(prev => ({ ...prev, reportDate: e.target.value }))}
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  value={uploadForm.description}
                  onChange={(e) => setUploadForm(prev => ({ ...prev, description: e.target.value }))}
                  className="input-field"
                  rows={3}
                  placeholder="Optional notes about this report"
                />
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowUploadForm(false);
                    setSelectedFile(null);
                    setUploadForm({
                      title: '',
                      type: 'blood_test',
                      description: '',
                      reportDate: ''
                    });
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploadingReport || !selectedFile}
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploadingReport ? 'Uploading...' : 'Upload Report'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Uploaded Reports */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Uploaded Reports ({uploadedReports.length})
            {loadingData && <span className="text-sm text-gray-500 ml-2">(Loading...)</span>}
          </h3>
          
          {loadingData ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
              <p className="text-gray-600 mt-2">Loading reports...</p>
            </div>
          ) : uploadedReports.length === 0 ? (
            <div className="text-center py-8">
              <PhotoIcon className="h-12 w-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600">No reports uploaded yet</p>
              <button
                onClick={() => setShowUploadForm(true)}
                className="text-blue-600 hover:text-blue-800 text-sm mt-2"
              >
                Upload your first report
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {uploadedReports.map((report) => (
                <div key={report.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-3">
                    <div className={`p-2 rounded-lg ${
                      report.type === 'blood_test' ? 'bg-red-100 text-red-600' :
                      report.type === 'xray' ? 'bg-blue-100 text-blue-600' :
                      report.type === 'mri' ? 'bg-purple-100 text-purple-600' :
                      report.type === 'ct_scan' ? 'bg-green-100 text-green-600' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {report.type === 'blood_test' ? <BeakerIcon className="h-5 w-5" /> :
                       report.type === 'xray' ? <PhotoIcon className="h-5 w-5" /> :
                       <DocumentTextIcon className="h-5 w-5" />}
                    </div>
                    <div className="flex space-x-2">
                      <button 
                        onClick={() => handleDownloadReport(report.id, report.fileName)}
                        className="p-1 text-gray-400 hover:text-green-600 transition-colors"
                        title="Download"
                      >
                        <ArrowDownTrayIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleRemoveReport(report.id)}
                        className="p-1 text-red-400 hover:text-red-600 transition-colors"
                        title="Delete"
                      >
                        <ExclamationTriangleIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  
                  <h4 className="font-medium text-gray-900 text-sm mb-1">
                    {report.title || report.fileName}
                  </h4>
                  <p className="text-xs text-gray-600 mb-2">
                    {new Date(report.uploadDate).toLocaleDateString()}
                  </p>
                  <p className="text-xs text-gray-500">
                    {((report.fileSize || 0) / (1024 * 1024)).toFixed(2)} MB
                  </p>
                  
                  <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full mt-2 ${
                    (report.type || 'general') === 'blood_test' ? 'bg-red-100 text-red-800' :
                    (report.type || 'general') === 'xray' ? 'bg-blue-100 text-blue-800' :
                    (report.type || 'general') === 'mri' ? 'bg-purple-100 text-purple-800' :
                    (report.type || 'general') === 'ct_scan' ? 'bg-green-100 text-green-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {(report.type || 'general').replace('_', ' ').toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const toggleReminder = (id: string) => {
    setReminders(prev => prev.map(reminder => 
      reminder.id === id ? { ...reminder, completed: !reminder.completed } : reminder
    ));
  };

  const renderReminders = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Appointment Reminders</h2>
          <p className="text-gray-600">Stay on top of your health appointments and medication schedules</p>
        </div>
        <button
          onClick={() => setActiveTab('appointments')}
          className="btn-primary flex items-center"
        >
          <CalendarDaysIcon className="h-4 w-4 mr-2" />
          View Appointments
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Urgent Reminders */}
        <div className="lg:col-span-2">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Upcoming Reminders</h3>
          <div className="space-y-3">
            {reminders.filter(r => !r.completed).map((reminder) => (
              <div key={reminder.id} className={`p-4 rounded-lg border-l-4 ${
                reminder.priority === 'high' ? 'border-red-400 bg-red-50' :
                reminder.priority === 'medium' ? 'border-yellow-400 bg-yellow-50' :
                'border-green-400 bg-green-50'
              }`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <div className={`p-1 rounded-full ${
                        reminder.type === 'appointment' ? 'bg-blue-100 text-blue-600' :
                        reminder.type === 'medication' ? 'bg-purple-100 text-purple-600' :
                        reminder.type === 'test' ? 'bg-green-100 text-green-600' :
                        'bg-orange-100 text-orange-600'
                      }`}>
                        {reminder.type === 'appointment' ? <CalendarDaysIcon className="h-4 w-4" /> :
                         reminder.type === 'medication' ? <DocumentTextIcon className="h-4 w-4" /> :
                         reminder.type === 'test' ? <BeakerIcon className="h-4 w-4" /> :
                         <ClockIcon className="h-4 w-4" />}
                      </div>
                      <h4 className="font-semibold text-gray-900">{reminder.title}</h4>
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        reminder.priority === 'high' ? 'bg-red-100 text-red-800' :
                        reminder.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-green-100 text-green-800'
                      }`}>
                        {reminder.priority.toUpperCase()}
                      </span>
                    </div>
                    
                    <p className="text-gray-700 text-sm mb-2">{reminder.description}</p>
                    <p className="text-sm font-medium text-gray-900">
                      Due: {new Date(reminder.dueDate).toLocaleDateString()}
                    </p>
                  </div>
                  
                  <button
                    onClick={() => toggleReminder(reminder.id)}
                    className="ml-4 p-2 text-gray-400 hover:text-green-600 transition-colors"
                  >
                    <CheckCircleIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Completed Reminders */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Completed ({reminders.filter(r => r.completed).length})
          </h3>
          <div className="space-y-2">
            {reminders.filter(r => r.completed).map((reminder) => (
              <div key={reminder.id} className="p-3 bg-gray-50 rounded-lg border border-gray-200 opacity-75">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-gray-900 text-sm line-through">{reminder.title}</h4>
                    <p className="text-gray-600 text-xs">{new Date(reminder.dueDate).toLocaleDateString()}</p>
                  </div>
                  <CheckCircleIcon className="h-5 w-5 text-green-600" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Health Tips */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-200">
        <div className="flex items-start space-x-4">
          <div className="p-2 bg-blue-100 rounded-lg">
            <SparklesIcon className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Health Tip of the Day</h3>
            <p className="text-gray-700">
              Regular monitoring of blood pressure is crucial for cardiovascular health. 
              Keep track of your readings and share them with your doctor during consultations.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

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
        <nav className="bg-white border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex space-x-8 overflow-x-auto">
              {[
                { id: 'overview', label: 'Overview', icon: HeartIcon },
                { id: 'symptom-checker', label: 'AI Symptom Checker', icon: SparklesIcon },
                { id: 'find-doctors', label: 'Find Doctors', icon: MapPinIcon },
                { id: 'appointments', label: 'Appointments', icon: CalendarDaysIcon },
                { id: 'records', label: 'Medical History', icon: DocumentTextIcon },
                { id: 'prescriptions', label: 'Prescriptions', icon: DocumentTextIcon },
                { id: 'reports', label: 'Upload Reports', icon: DocumentArrowUpIcon },
                { id: 'reminders', label: 'Reminders', icon: BellIcon }
              ].map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as TabType)}
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
          {activeTab === 'appointments' && renderAppointments()}
          {activeTab === 'records' && renderHistory()}
          {activeTab === 'prescriptions' && renderPrescriptions()}
          {activeTab === 'reports' && renderReports()}
          {activeTab === 'reminders' && renderReminders()}
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