import mongoose from 'mongoose';
import { Appointment, IAppointment, AppointmentStatus, ConsultationType } from '../models/Appointment';
import User from '../models/User';
import { NotificationService } from './NotificationService';
import { VideoCallService } from './VideoCallService';
import { publishEvent } from './EventBus';
import { scheduleAppointmentReminders, cancelAppointmentReminders } from './JobQueueService';
import { WaitlistService } from './WaitlistService';

/** Calendar day of a date as YYYY-MM-DD (waitlist entries key on this). */
function dayOf(date: Date): string {
  return new Date(date).toISOString().slice(0, 10);
}

export interface CreateAppointmentRequest {
  patientId: string;
  doctorId: string;
  appointmentDate: Date;
  duration?: number;
  consultationType: ConsultationType;
  symptoms: string;
  specialization: string;
  fee: number;
  forDependent?: { name: string; relation: string };
}

export interface UpdateAppointmentRequest {
  appointmentDate?: Date;
  duration?: number;
  consultationType?: ConsultationType;
  symptoms?: string;
  status?: AppointmentStatus;
}

export interface AppointmentFilters {
  patientId?: string;
  doctorId?: string;
  status?: AppointmentStatus | AppointmentStatus[];
  consultationType?: ConsultationType;
  dateFrom?: Date;
  dateTo?: Date;
  specialization?: string;
}

export interface PrescriptionData {
  medications: Array<{
    name: string;
    dosage: string;
    frequency: string;
    duration: string;
    instructions?: string;
  }>;
  diagnosis: string;
  notes?: string;
}

export interface RatingData {
  rating: number;
  review?: string;
}

export class AppointmentService {
  /**
   * Create a new appointment
   */
  static async createAppointment(data: CreateAppointmentRequest): Promise<IAppointment> {
    const { patientId, doctorId, appointmentDate, symptoms, specialization, fee, consultationType, duration = 30, forDependent } = data;

    await this.validateAppointmentCreation(patientId, doctorId, appointmentDate);

    const appointment = new Appointment({
      patient: new mongoose.Types.ObjectId(patientId),
      doctor: new mongoose.Types.ObjectId(doctorId),
      appointmentDate,
      duration,
      consultationType,
      symptoms,
      specialization,
      fee,
      ...(forDependent ? { forDependent } : {}),
      status: 'scheduled'
    });

    await appointment.save();
    await appointment.populate('patient', 'firstName lastName email phoneNumber');
    await appointment.populate('doctor', 'firstName lastName email phoneNumber specialization');

    publishEvent({
      type: 'appointment.booked',
      actorId: patientId,
      entityType: 'appointment',
      entityId: appointment._id.toString(),
      payload: { doctorId, consultationType, specialization, fee, appointmentDate: appointmentDate.toISOString() }
    });

    // Delayed T-24h / T-1h reminder jobs; best-effort by design.
    await scheduleAppointmentReminders(appointment._id.toString(), appointmentDate);

    // If this patient was waiting for this doctor/day, their wait is over.
    await WaitlistService.markFulfilled(patientId, doctorId, dayOf(appointmentDate)).catch(() => {});

    await NotificationService.createNotification({
      recipient: doctorId,
      type: 'appointment_scheduled',
      title: 'New Appointment Scheduled',
      message: `A new appointment has been scheduled for ${appointmentDate.toDateString()}`,
      data: { appointmentId: appointment._id.toString() },
      actionUrl: `/doctor/appointments/${appointment._id}`,
      actionText: 'View Appointment'
    });

    await NotificationService.createNotification({
      recipient: patientId,
      type: 'appointment_scheduled',
      title: 'Appointment Scheduled Successfully',
      message: `Your appointment with Dr. ${(appointment.doctor as any).fullName} is scheduled for ${appointmentDate.toDateString()}`,
      data: { appointmentId: appointment._id.toString() },
      actionUrl: `/patient/appointments/${appointment._id}`,
      actionText: 'View Appointment'
    });

    return appointment;
  }

  /**
   * Get appointment by ID
   */
  static async getAppointmentById(appointmentId: string, userId: string): Promise<IAppointment | null> {
    const appointment = await Appointment.findById(appointmentId)
      .populate('patient', 'firstName lastName email phoneNumber')
      .populate('doctor', 'firstName lastName email phoneNumber specialization');

    if (!appointment) {
      return null;
    }

    const isAuthorized = appointment.patient._id.toString() === userId || 
                        appointment.doctor._id.toString() === userId;

    if (!isAuthorized) {
      throw new Error('Unauthorized access to appointment');
    }

    return appointment;
  }

  /**
   * Get appointments with filters
   */
  static async getAppointments(filters: AppointmentFilters, page = 1, limit = 10): Promise<{
    appointments: IAppointment[];
    totalCount: number;
    totalPages: number;
    currentPage: number;
  }> {
    const query: any = {};

    if (filters.patientId) {
      query.patient = new mongoose.Types.ObjectId(filters.patientId);
    }

    if (filters.doctorId) {
      query.doctor = new mongoose.Types.ObjectId(filters.doctorId);
    }

    if (filters.status) {
      if (Array.isArray(filters.status)) {
        query.status = { $in: filters.status };
      } else {
        query.status = filters.status;
      }
    }

    if (filters.consultationType) {
      query.consultationType = filters.consultationType;
    }

    if (filters.specialization) {
      query.specialization = new RegExp(filters.specialization, 'i');
    }

    if (filters.dateFrom || filters.dateTo) {
      query.appointmentDate = {};
      if (filters.dateFrom) {
        query.appointmentDate.$gte = filters.dateFrom;
      }
      if (filters.dateTo) {
        query.appointmentDate.$lte = filters.dateTo;
      }
    }

    const totalCount = await Appointment.countDocuments(query);
    const totalPages = Math.ceil(totalCount / limit);
    const skip = (page - 1) * limit;

    const appointments = await Appointment.find(query)
              .populate('patient', 'firstName lastName email phoneNumber')
        .populate('doctor', 'firstName lastName email phoneNumber specialization')
      .sort({ appointmentDate: -1 })
      .skip(skip)
      .limit(limit);

    return {
      appointments,
      totalCount,
      totalPages,
      currentPage: page
    };
  }

  /**
   * Update appointment status
   */
  static async updateAppointmentStatus(appointmentId: string, status: AppointmentStatus, userId: string): Promise<IAppointment> {
    const appointment = await this.getAppointmentById(appointmentId, userId);
    if (!appointment) {
      throw new Error('Appointment not found');
    }

    const oldStatus = appointment.status;
    appointment.status = status;

    if (oldStatus !== status) {
      publishEvent({
        type: 'appointment.status_changed',
        actorId: userId,
        entityType: 'appointment',
        entityId: appointmentId,
        payload: { from: oldStatus, to: status }
      });
    }

    if (status === 'confirmed' && appointment.consultationType === 'video') {
      const videoCallData = await VideoCallService.createVideoCall(appointmentId);
      appointment.videoCallId = videoCallData.callId;
      appointment.videoCallUrl = videoCallData.callUrl;
    }

    await appointment.save();

    if (oldStatus !== status) {
      const isDoctor = appointment.doctor._id.toString() === userId;
      const recipient = isDoctor ? appointment.patient._id.toString() : appointment.doctor._id.toString();
      const recipientName = isDoctor ? (appointment.patient as any).fullName : (appointment.doctor as any).fullName;

      await NotificationService.createNotification({
        recipient,
        type: 'appointment_confirmed',
        title: 'Appointment Status Updated',
        message: `Your appointment with ${recipientName} has been ${status}`,
        data: { appointmentId: appointment._id.toString() },
        actionUrl: `/${isDoctor ? 'patient' : 'doctor'}/appointments/${appointment._id}`,
        actionText: 'View Appointment'
      });
    }

    return appointment;
  }

  /**
   * Update appointment notes
   */
  static async updateAppointmentNotes(appointmentId: string, notes: string, userId: string): Promise<IAppointment> {
    const appointment = await this.getAppointmentById(appointmentId, userId);
    if (!appointment) {
      throw new Error('Appointment not found');
    }

    // Only doctors can update notes
    if (appointment.doctor._id.toString() !== userId) {
      throw new Error('Only the assigned doctor can update appointment notes');
    }

    appointment.notes = notes;
    await appointment.save();

    return appointment;
  }

  /**
   * Update appointment payment information
   */
  static async updateAppointmentPayment(
    appointmentId: string, 
    userId: string, 
    paymentId?: string, 
    paymentStatus?: string
  ): Promise<IAppointment> {
    const appointment = await this.getAppointmentById(appointmentId, userId);
    if (!appointment) {
      throw new Error('Appointment not found');
    }

    // Update payment information if provided
    if (paymentId) {
      appointment.paymentId = paymentId;
    }
    
    if (paymentStatus) {
      appointment.paymentStatus = paymentStatus as any;
    }

    await appointment.save();

    // Send notification if payment is paid
    if (paymentStatus === 'paid') {
      const isDoctor = appointment.doctor._id.toString() === userId;
      const recipient = isDoctor ? appointment.patient._id.toString() : appointment.doctor._id.toString();
      const recipientName = isDoctor ? (appointment.patient as any).fullName : (appointment.doctor as any).fullName;

      await NotificationService.createNotification({
        recipient,
        type: 'payment_received',
        title: 'Payment Completed',
        message: `Payment for your appointment with ${recipientName} has been completed`,
        data: { appointmentId: appointment._id.toString(), paymentId },
        actionUrl: `/${isDoctor ? 'patient' : 'doctor'}/appointments/${appointment._id}`,
        actionText: 'View Appointment'
      });
    }

    return appointment;
  }

  /**
   * Cancel appointment
   */
  static async cancelAppointment(appointmentId: string, userId: string, reason?: string): Promise<IAppointment> {
    const appointment = await this.getAppointmentById(appointmentId, userId);
    if (!appointment) {
      throw new Error('Appointment not found');
    }

    if (!appointment.canBeCancelled) {
      throw new Error('Appointment cannot be cancelled (less than 24 hours remaining)');
    }

    appointment.status = 'cancelled';
    await appointment.save();

    publishEvent({
      type: 'appointment.cancelled',
      actorId: userId,
      entityType: 'appointment',
      entityId: appointmentId,
      payload: { reason }
    });

    // Drop the pending reminder jobs and offer the freed slot to the waitlist.
    await cancelAppointmentReminders(appointmentId);
    await WaitlistService.offerNext(
      appointment.doctor._id.toString(),
      dayOf(appointment.appointmentDate)
    ).catch(() => {});

    const isDoctor = appointment.doctor._id.toString() === userId;
    const recipient = isDoctor ? appointment.patient._id.toString() : appointment.doctor._id.toString();
    const recipientName = isDoctor ? (appointment.patient as any).fullName : (appointment.doctor as any).fullName;

    await NotificationService.createNotification({
      recipient,
      type: 'appointment_cancelled',
      title: 'Appointment Cancelled',
      message: `Your appointment with ${recipientName} has been cancelled. ${reason ? `Reason: ${reason}` : ''}`,
      data: { 
        appointmentId: appointment._id.toString(),
        reason 
      },
      actionUrl: `/${isDoctor ? 'patient' : 'doctor'}/appointments`,
      actionText: 'View Appointments'
    });

    return appointment;
  }

  /**
   * Add prescription to appointment
   */
  static async addPrescription(appointmentId: string, prescriptionData: PrescriptionData, doctorId: string): Promise<IAppointment> {
    const appointment = await this.getAppointmentById(appointmentId, doctorId);
    if (!appointment) {
      throw new Error('Appointment not found');
    }

    if (appointment.doctor._id.toString() !== doctorId) {
      throw new Error('Only the assigned doctor can add prescriptions');
    }

    appointment.prescription = prescriptionData;
    await appointment.save();

    await NotificationService.createNotification({
      recipient: appointment.patient._id.toString(),
      type: 'prescription_ready',
      title: 'Prescription Ready',
      message: `Your prescription from Dr. ${(appointment.doctor as any).fullName} is ready`,
      data: { appointmentId: appointment._id.toString() },
      actionUrl: `/patient/appointments/${appointment._id}`,
      actionText: 'View Prescription'
    });

    return appointment;
  }

  /**
   * Add rating and review
   */
  static async addRating(appointmentId: string, ratingData: RatingData, userId: string): Promise<IAppointment> {
    const appointment = await this.getAppointmentById(appointmentId, userId);
    if (!appointment) {
      throw new Error('Appointment not found');
    }

    if (appointment.status !== 'completed') {
      throw new Error('Can only rate completed appointments');
    }

    const isPatient = appointment.patient._id.toString() === userId;

    if (!appointment.rating) {
      appointment.rating = {};
    }

    if (isPatient) {
      appointment.rating.patientRating = ratingData.rating;
      appointment.rating.patientReview = ratingData.review;
    } else {
      appointment.rating.doctorRating = ratingData.rating;
      appointment.rating.doctorReview = ratingData.review;
    }

    await appointment.save();
    return appointment;
  }

  /**
   * Get upcoming appointments for reminders
   */
  static async getUpcomingAppointments(hours = 24): Promise<IAppointment[]> {
    const now = new Date();
    const reminderTime = new Date(now.getTime() + (hours * 60 * 60 * 1000));

    return await Appointment.find({
      appointmentDate: {
        $gte: now,
        $lte: reminderTime
      },
      status: { $in: ['scheduled', 'confirmed'] }
    }).populate(['patient', 'doctor']);
  }

  /**
   * Send appointment reminders
   */
  static async sendAppointmentReminders(): Promise<void> {
    const upcomingAppointments = await this.getUpcomingAppointments(24);

    for (const appointment of upcomingAppointments) {
      await NotificationService.createNotification({
        recipient: appointment.patient._id.toString(),
        type: 'appointment_reminder',
        title: 'Appointment Reminder',
        message: `You have an appointment with Dr. ${(appointment.doctor as any).fullName} tomorrow at ${appointment.appointmentDate.toLocaleTimeString()}`,
        data: { appointmentId: appointment._id.toString() },
        actionUrl: `/patient/appointments/${appointment._id}`,
        actionText: 'View Appointment',
        channels: ['in_app', 'email', 'sms']
      });

      await NotificationService.createNotification({
        recipient: appointment.doctor._id.toString(),
        type: 'appointment_reminder',
        title: 'Appointment Reminder',
        message: `You have an appointment with ${(appointment.patient as any).fullName} tomorrow at ${appointment.appointmentDate.toLocaleTimeString()}`,
        data: { appointmentId: appointment._id.toString() },
        actionUrl: `/doctor/appointments/${appointment._id}`,
        actionText: 'View Appointment',
        channels: ['in_app', 'email']
      });
    }
  }

  /**
   * Validate appointment creation
   */
  private static async validateAppointmentCreation(patientId: string, doctorId: string, appointmentDate: Date): Promise<void> {
    const [patient, doctor] = await Promise.all([
      User.findById(patientId),
      User.findById(doctorId)
    ]);

    if (!patient || patient.role !== 'patient') {
      throw new Error('Invalid patient ID');
    }

    if (!doctor || doctor.role !== 'doctor') {
      throw new Error('Invalid doctor ID');
    }

    if (appointmentDate <= new Date()) {
      throw new Error('Appointment date must be in the future');
    }

    const existingAppointment = await Appointment.findOne({
      doctor: new mongoose.Types.ObjectId(doctorId),
      appointmentDate: {
        $gte: new Date(appointmentDate.getTime() - 30 * 60 * 1000),
        $lte: new Date(appointmentDate.getTime() + 30 * 60 * 1000)
      },
      status: { $in: ['scheduled', 'confirmed'] }
    });

    if (existingAppointment) {
      throw new Error('Doctor is not available at this time slot');
    }
  }

  /**
   * Get appointment statistics for dashboard
   */
  static async getAppointmentStats(userId: string, role: 'patient' | 'doctor'): Promise<{
    total: number;
    upcoming: number;
    completed: number;
    cancelled: number;
  }> {
    const query = role === 'patient' 
      ? { patient: new mongoose.Types.ObjectId(userId) }
      : { doctor: new mongoose.Types.ObjectId(userId) };

    const [total, upcoming, completed, cancelled] = await Promise.all([
      Appointment.countDocuments(query),
      Appointment.countDocuments({ ...query, status: { $in: ['scheduled', 'confirmed'] } }),
      Appointment.countDocuments({ ...query, status: 'completed' }),
      Appointment.countDocuments({ ...query, status: 'cancelled' })
    ]);

    return { total, upcoming, completed, cancelled };
  }
} 