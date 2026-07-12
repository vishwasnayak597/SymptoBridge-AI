/**
 * Single source of truth for input contracts, shared by the API (request
 * validation middleware) and the frontend (form resolvers). One schema per
 * write endpoint: change it here and both sides move together — the backend
 * can never accept a shape the frontend doesn't send, and vice versa.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Please enter a valid email address'),
    password: z.string().min(7, 'Password must be at least 7 characters'),
    firstName: z.string().trim().min(1, 'First name is required').max(50),
    lastName: z.string().trim().min(1, 'Last name is required').max(50),
    phone: z.string().trim().optional(),
    role: z.enum(['patient', 'doctor'], { errorMap: () => ({ message: 'Please select a valid role' }) }),
    // doctor-only fields
    specialization: z.string().trim().optional(),
    licenseNumber: z.string().trim().optional(),
    experience: z.coerce.number().int().min(0).optional(),
    consultationFee: z.coerce.number().min(0).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === 'doctor') {
      if (!data.specialization) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['specialization'], message: 'Specialization is required for doctors' });
      }
      if (!data.licenseNumber) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['licenseNumber'], message: 'License number is required for doctors' });
      }
    }
  });

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const createAppointmentSchema = z.object({
  doctorId: objectId,
  appointmentDate: z.string().datetime({ offset: true, message: 'Invalid appointment date' })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'Invalid appointment date')),
  duration: z.coerce.number().int().min(15).max(120).optional(),
  consultationType: z.enum(['in-person', 'video', 'phone']),
  symptoms: z.string().trim()
    .min(10, 'Symptoms must be at least 10 characters')
    .max(1000, 'Symptoms must be less than 1000 characters'),
  specialization: z.string().trim().min(1, 'Specialization is required'),
  fee: z.coerce.number().min(0, 'Fee cannot be negative'),
});

export const appointmentRatingSchema = z.object({
  rating: z.coerce.number().int().min(1, 'Rating must be 1-5').max(5, 'Rating must be 1-5'),
  review: z.string().trim().max(500, 'Review must be under 500 characters').optional(),
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const createPaymentSchema = z.object({
  appointmentId: objectId,
  doctorId: objectId,
  amount: z.coerce.number().min(0, 'Amount cannot be negative'),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  paymentMethod: z.enum(['credit_card', 'debit_card', 'upi', 'wallet', 'net_banking', 'cash']),
  paymentGateway: z.enum(['stripe', 'razorpay', 'paypal', 'cash']),
  metadata: z.record(z.any()).optional(),
});

// ---------------------------------------------------------------------------
// Inferred DTO types — import these instead of redeclaring interfaces.
// ---------------------------------------------------------------------------

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type AppointmentRatingInput = z.infer<typeof appointmentRatingSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
