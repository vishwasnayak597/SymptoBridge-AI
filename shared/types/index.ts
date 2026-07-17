/**
 * Shared TypeScript type definitions for aiDoc platform
 * Used by both frontend and backend
 */

// User Types
export interface BaseUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  avatar?: string;
  isActive: boolean;
  isEmailVerified?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Dependent {
  name: string;
  relation: string;
  dateOfBirth?: Date;
}

export interface Patient extends BaseUser {
  role: 'patient';
  dateOfBirth?: Date;
  gender?: 'male' | 'female' | 'other';
  bloodGroup?: string;
  /** Family accounts: members this patient can book for. */
  dependents?: Dependent[];
  emergencyContact?: {
    name: string;
    phone: string;
    relationship: string;
  };
  medicalHistory?: string[];
  allergies?: string[];
}

export interface Doctor extends BaseUser {
  role: 'doctor';
  specialization?: string;
  licenseNumber?: string;
  experience?: number;
  qualifications?: string[];
  consultationFee?: number;
  isVerified?: boolean;
  rating?: number;
  reviewCount?: number;
  bio?: string;
  availability?: DoctorAvailability[];
  location?: DoctorLocation;
}

export interface Admin extends BaseUser {
  role: 'admin';
  permissions?: string[];
}

export type User = Patient | Doctor | Admin;

// Doctor-specific Types
export interface DoctorAvailability {
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  startTime: string; // HH:mm format
  endTime: string; // HH:mm format
  isAvailable: boolean;
}

export interface DoctorLocation {
  address: string;
  city: string;
  state: string;
  zipCode: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
}

// Appointment Types
export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  scheduledAt: Date;
  duration: number; // in minutes
  type: 'in-person' | 'video' | 'phone';
  status: 'scheduled' | 'confirmed' | 'in-progress' | 'completed' | 'cancelled' | 'no-show';
  symptoms?: string;
  notes?: string;
  prescription?: Prescription;
  paymentId?: string;
  videoRoomId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Prescription Types
export interface Prescription {
  id: string;
  appointmentId: string;
  medications: Medication[];
  instructions: string;
  validUntil?: Date;
  createdAt: Date;
}

export interface Medication {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions?: string;
}

// AI/Symptom Checker Types
export interface SymptomCheckRequest {
  symptoms: string[];
  age: number;
  gender: 'male' | 'female' | 'other';
  medicalHistory?: string[];
  currentMedications?: string[];
}

export interface SymptomCheckResponse {
  possibleConditions: PossibleCondition[];
  recommendations: Recommendation[];
  urgencyLevel: 'low' | 'medium' | 'high' | 'emergency';
  disclaimer: string;
}

export interface PossibleCondition {
  name: string;
  probability: number; // 0-100
  description: string;
  symptoms: string[];
}

export interface Recommendation {
  type: 'self-care' | 'otc-medication' | 'consult-doctor' | 'emergency';
  title: string;
  description: string;
  urgency: 'low' | 'medium' | 'high' | 'emergency';
}

// Payment Types
export interface Payment {
  id: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded';
  paymentMethod: 'stripe' | 'razorpay';
  transactionId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// Notification Types
export interface Notification {
  id: string;
  userId: string;
  type: 'appointment' | 'reminder' | 'prescription' | 'system';
  title: string;
  message: string;
  isRead: boolean;
  scheduledFor?: Date;
  createdAt: Date;
}

// Video Call Types
export interface VideoRoom {
  id: string;
  appointmentId: string;
  roomName: string;
  accessToken: string;
  status: 'created' | 'active' | 'ended';
  createdAt: Date;
}

// Common Constants
export const USER_ROLES = ['patient', 'doctor', 'admin'] as const;
export const APPOINTMENT_STATUSES = ['scheduled', 'confirmed', 'in-progress', 'completed', 'cancelled', 'no-show'] as const;
export const APPOINTMENT_TYPES = ['in-person', 'video', 'phone'] as const;
export const PAYMENT_STATUSES = ['pending', 'processing', 'completed', 'failed', 'refunded'] as const;
export const URGENCY_LEVELS = ['low', 'medium', 'high', 'emergency'] as const; 