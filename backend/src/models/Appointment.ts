import mongoose, { Document, Schema } from 'mongoose';
import User from './User';
import { encryptPhi, decryptPhi } from '../utils/phiCrypto';

const APPOINTMENT_STATUS_VALUES = ['scheduled', 'confirmed', 'in-progress', 'completed', 'cancelled', 'no-show'] as const;
const CONSULTATION_TYPE_VALUES = ['in-person', 'video', 'phone'] as const;

export type AppointmentStatus = typeof APPOINTMENT_STATUS_VALUES[number];
export type ConsultationType = typeof CONSULTATION_TYPE_VALUES[number];

export interface IAppointment extends Document {
  _id: mongoose.Types.ObjectId;
  patient: mongoose.Types.ObjectId;
  doctor: mongoose.Types.ObjectId;
  appointmentDate: Date;
  duration: number;
  consultationType: ConsultationType;
  status: AppointmentStatus;
  symptoms: string;
  specialization: string;
  fee: number;
  paymentStatus: 'pending' | 'paid' | 'refunded';
  paymentId?: string;
  videoCallId?: string;
  videoCallUrl?: string;
  prescription?: {
    medications: Array<{
      name: string;
      dosage: string;
      frequency: string;
      duration: string;
      instructions?: string;
    }>;
    diagnosis: string;
    notes?: string;
  };
  rating?: {
    patientRating?: number;
    doctorRating?: number;
    patientReview?: string;
    doctorReview?: string;
  };
  notes?: string; // General doctor notes about the appointment
  createdAt: Date;
  updatedAt: Date;
  // Virtuals
  appointmentDuration: number;
  isUpcoming: boolean;
  canBeCancelled: boolean;
}

const appointmentSchema = new Schema<IAppointment>({
  patient: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Patient ID is required'],
    validate: {
      validator: async function(patientId: mongoose.Types.ObjectId) {
        const patient = await User.findById(patientId);
        return patient && patient.role === 'patient';
      },
      message: 'Invalid patient ID'
    }
  },
  doctor: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Doctor ID is required'],
    validate: {
      validator: async function(doctorId: mongoose.Types.ObjectId) {
        const doctor = await User.findById(doctorId);
        return doctor && doctor.role === 'doctor';
      },
      message: 'Invalid doctor ID'
    }
  },
  appointmentDate: {
    type: Date,
    required: [true, 'Appointment date is required'],
    validate: {
      validator: function(date: Date) {
        if (this.isNew) { return date > new Date(); } return true;
      },
      message: 'Appointment date must be in the future'
    }
  },
  duration: {
    type: Number,
    required: [true, 'Duration is required'],
    min: [15, 'Minimum duration is 15 minutes'],
    max: [120, 'Maximum duration is 120 minutes'],
    default: 30
  },
  consultationType: {
    type: String,
    enum: {
      values: CONSULTATION_TYPE_VALUES,
      message: 'Invalid consultation type'
    },
    required: [true, 'Consultation type is required']
  },
  status: {
    type: String,
    enum: {
      values: APPOINTMENT_STATUS_VALUES,
      message: 'Invalid appointment status'
    },
    default: 'scheduled'
  },
  symptoms: {
    type: String,
    required: [true, 'Symptoms description is required'],
    // PHI: encrypted at rest (AES-256-GCM). The setter runs before validators,
    // so length limits apply to the CIPHERTEXT — the patient-facing 10..1000
    // rule is enforced by the shared zod schema at the API edge instead.
    // maxlength is sized for ciphertext overhead (base64 + iv + tag).
    set: encryptPhi,
    get: decryptPhi,
    maxlength: [4096, 'Symptoms payload too large']
  },
  specialization: {
    type: String,
    required: [true, 'Specialization is required']
  },
  fee: {
    type: Number,
    required: [true, 'Consultation fee is required'],
    min: [0, 'Fee cannot be negative']
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'refunded'],
    default: 'pending'
  },
  paymentId: {
    type: String,
    sparse: true
  },
  videoCallId: {
    type: String,
    sparse: true
  },
  videoCallUrl: {
    type: String,
    sparse: true
  },
  prescription: {
    medications: [{
      name: {
        type: String,
        required: true
      },
      dosage: {
        type: String,
        required: true
      },
      frequency: {
        type: String,
        required: true
      },
      duration: {
        type: String,
        required: true
      },
      instructions: String
    }],
    diagnosis: {
      type: String,
      required: false  // Prescription is added after appointment, not during creation
    },
    notes: String
  },
  rating: {
    patientRating: {
      type: Number,
      min: 1,
      max: 5
    },
    doctorRating: {
      type: Number,
      min: 1,
      max: 5
    },
    patientReview: String,
    doctorReview: String
  },
  // PHI: doctor's clinical notes, encrypted at rest like symptoms.
  notes: { type: String, set: encryptPhi, get: decryptPhi }
}, {
  timestamps: true,
  // getters:true so decryption applies when documents are serialized for API responses
  toJSON: { virtuals: true, getters: true },
  toObject: { virtuals: true, getters: true }
});

appointmentSchema.index({ patient: 1, appointmentDate: 1 });
appointmentSchema.index({ doctor: 1, appointmentDate: 1 });
appointmentSchema.index({ status: 1 });
appointmentSchema.index({ appointmentDate: 1 });

appointmentSchema.virtual('appointmentDuration').get(function() {
  return this.duration;
});

appointmentSchema.virtual('isUpcoming').get(function() {
  return this.appointmentDate > new Date() && ['scheduled', 'confirmed'].includes(this.status);
});

appointmentSchema.virtual('canBeCancelled').get(function() {
  const now = new Date();
  const hoursUntilAppointment = (this.appointmentDate.getTime() - now.getTime()) / (1000 * 60 * 60);
  return hoursUntilAppointment > 24 && ['scheduled', 'confirmed'].includes(this.status);
});

export const Appointment = mongoose.model<IAppointment>('Appointment', appointmentSchema); 