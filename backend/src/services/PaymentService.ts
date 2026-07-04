import mongoose from 'mongoose';
import { Payment, IPayment, PaymentStatus, PaymentMethod } from '../models/Payment';
import { Appointment } from '../models/Appointment';
import { NotificationService } from './NotificationService';

export interface PaymentRequest {
  appointmentId: string;
  patientId: string;
  doctorId: string;
  amount: number;
  currency?: string;
  paymentMethod: PaymentMethod;
  paymentGateway: 'stripe' | 'razorpay' | 'paypal' | 'cash';
  metadata?: Record<string, any>;
}

export interface PaymentGatewayResponse {
  success: boolean;
  transactionId?: string;
  gatewayId?: string;
  status: PaymentStatus;
  message?: string;
  gatewayResponse?: Record<string, any>;
}

export interface RefundRequest {
  paymentId: string;
  amount?: number;
  reason: string;
}

export interface PaymentFilters {
  patientId?: string;
  doctorId?: string;
  appointmentId?: string;
  status?: PaymentStatus | PaymentStatus[];
  paymentMethod?: PaymentMethod;
  paymentGateway?: string;
  dateFrom?: Date;
  dateTo?: Date;
  amountFrom?: number;
  amountTo?: number;
}

export class PaymentService {
  /**
   * Get appointment details for payment processing
   */
  static async getAppointmentForPayment(appointmentId: string) {
    const appointment = await Appointment.findById(appointmentId)
      .populate('patient', '_id firstName lastName email')
      .populate('doctor', '_id firstName lastName email');
    return appointment;
  }

  /**
   * Create a new payment
   */
  static async createPayment(data: PaymentRequest): Promise<IPayment> {
    const {
      appointmentId,
      patientId,
      doctorId,
      amount,
      currency = 'INR',
      paymentMethod,
      paymentGateway,
      metadata = {}
    } = data;

    await this.validatePaymentCreation(appointmentId, patientId, doctorId, amount);

    const payment = new Payment({
      appointment: new mongoose.Types.ObjectId(appointmentId),
      patient: new mongoose.Types.ObjectId(patientId),
      doctor: new mongoose.Types.ObjectId(doctorId),
      amount,
      currency,
      paymentMethod,
      paymentGateway,
      status: 'pending',
      metadata
    });

    await payment.save();
    return payment;
  }

  /**
   * Process payment through selected gateway
   */
  static async processPayment(
    paymentId: string,
    paymentDetails: Record<string, any>
  ): Promise<PaymentGatewayResponse> {
    const payment = await Payment.findById(paymentId);
    if (!payment) {
      throw new Error('Payment not found');
    }

    if (payment.status !== 'pending') {
      throw new Error('Payment is not in pending status');
    }

    payment.status = 'processing';
    await payment.save();

    let gatewayResponse: PaymentGatewayResponse;

    try {
      switch (payment.paymentGateway) {
        case 'stripe':
          gatewayResponse = await this.processStripePayment(payment, paymentDetails);
          break;
        case 'razorpay':
          gatewayResponse = await this.processRazorpayPayment(payment, paymentDetails);
          break;
        case 'paypal':
          gatewayResponse = await this.processPayPalPayment(payment, paymentDetails);
          break;
        case 'cash':
          gatewayResponse = await this.processCashPayment(payment, paymentDetails);
          break;
        default:
          throw new Error(`Unsupported payment gateway: ${payment.paymentGateway}`);
      }

      payment.status = gatewayResponse.status;
      payment.paymentGatewayId = gatewayResponse.gatewayId;
      payment.gatewayResponse = gatewayResponse.gatewayResponse;

      if (!gatewayResponse.success) {
        payment.failureReason = gatewayResponse.message;
      }

      await payment.save();

      // Update appointment payment status
      if (gatewayResponse.success && gatewayResponse.status === 'completed') {
        await Appointment.findByIdAndUpdate(payment.appointment, {
          paymentStatus: 'paid',
          paymentId: payment._id.toString()
        });

        const { publishEvent } = await import('./EventBus');
        publishEvent({
          type: 'payment.completed',
          actorId: payment.patient?.toString(),
          entityType: 'payment',
          entityId: payment._id.toString(),
          payload: { amount: payment.amount, gateway: payment.paymentGateway, appointmentId: payment.appointment?.toString() }
        });

        // Send notifications
        await this.sendPaymentNotifications(payment, 'success');
      } else if (!gatewayResponse.success) {
        await this.sendPaymentNotifications(payment, 'failed');
      }

      return gatewayResponse;
    } catch (error) {
      payment.status = 'failed';
      payment.failureReason = error instanceof Error ? error.message : 'Unknown payment error';
      await payment.save();

      await this.sendPaymentNotifications(payment, 'failed');

      throw error;
    }
  }

  /**
   * Get payment by ID
   */
  static async getPaymentById(paymentId: string, userId?: string): Promise<IPayment | null> {
    const query: any = { _id: paymentId };

    if (userId) {
      query.$or = [
        { patient: new mongoose.Types.ObjectId(userId) },
        { doctor: new mongoose.Types.ObjectId(userId) }
      ];
    }

    return await Payment.findOne(query)
      .populate('appointment')
      .populate('patient', 'fullName email')
      .populate('doctor', 'fullName email');
  }

  /**
   * Get payments with filters
   */
  static async getPayments(
    filters: PaymentFilters,
    page = 1,
    limit = 10
  ): Promise<{
    payments: IPayment[];
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

    if (filters.appointmentId) {
      query.appointment = new mongoose.Types.ObjectId(filters.appointmentId);
    }

    if (filters.status) {
      if (Array.isArray(filters.status)) {
        query.status = { $in: filters.status };
      } else {
        query.status = filters.status;
      }
    }

    if (filters.paymentMethod) {
      query.paymentMethod = filters.paymentMethod;
    }

    if (filters.paymentGateway) {
      query.paymentGateway = filters.paymentGateway;
    }

    if (filters.dateFrom || filters.dateTo) {
      query.createdAt = {};
      if (filters.dateFrom) {
        query.createdAt.$gte = filters.dateFrom;
      }
      if (filters.dateTo) {
        query.createdAt.$lte = filters.dateTo;
      }
    }

    if (filters.amountFrom || filters.amountTo) {
      query.amount = {};
      if (filters.amountFrom) {
        query.amount.$gte = filters.amountFrom;
      }
      if (filters.amountTo) {
        query.amount.$lte = filters.amountTo;
      }
    }

    const totalCount = await Payment.countDocuments(query);
    const totalPages = Math.ceil(totalCount / limit);
    const skip = (page - 1) * limit;

    const payments = await Payment.find(query)
      .populate('appointment')
      .populate('patient', 'fullName email')
      .populate('doctor', 'fullName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return {
      payments,
      totalCount,
      totalPages,
      currentPage: page
    };
  }

  /**
   * Refund payment
   */
  static async refundPayment(refundRequest: RefundRequest): Promise<IPayment> {
    const { paymentId, amount, reason } = refundRequest;

    const payment = await Payment.findById(paymentId);
    if (!payment) {
      throw new Error('Payment not found');
    }

    if (payment.status !== 'completed') {
      throw new Error('Can only refund completed payments');
    }

    if (payment.refundDetails) {
      throw new Error('Payment has already been refunded');
    }

    const refundAmount = amount || payment.amount;

    if (refundAmount > payment.amount) {
      throw new Error('Refund amount cannot exceed original payment amount');
    }

    let refundResponse: PaymentGatewayResponse;

    try {
      switch (payment.paymentGateway) {
        case 'stripe':
          refundResponse = await this.processStripeRefund(payment, refundAmount);
          break;
        case 'razorpay':
          refundResponse = await this.processRazorpayRefund(payment, refundAmount);
          break;
        case 'paypal':
          refundResponse = await this.processPayPalRefund(payment, refundAmount);
          break;
        case 'cash':
          refundResponse = await this.processCashRefund(payment, refundAmount);
          break;
        default:
          throw new Error(`Refund not supported for gateway: ${payment.paymentGateway}`);
      }

      if (refundResponse.success) {
        payment.status = 'refunded';
        payment.refundDetails = {
          refundId: refundResponse.gatewayId || `refund_${Date.now()}`,
          refundAmount,
          reason,
          refundedAt: new Date()
        };

        await payment.save();

        // Update appointment status
        await Appointment.findByIdAndUpdate(payment.appointment, {
          paymentStatus: 'refunded'
        });

        await this.sendPaymentNotifications(payment, 'refunded');
      }

      return payment;
    } catch (error) {
      console.error('Refund processing failed:', error);
      throw new Error('Refund processing failed');
    }
  }

  /**
   * Get payment statistics
   */
  static async getPaymentStats(filters: { doctorId?: string; patientId?: string } = {}): Promise<{
    totalRevenue: number;
    totalTransactions: number;
    successfulPayments: number;
    failedPayments: number;
    refundedPayments: number;
    averageTransactionValue: number;
    monthlyRevenue: Array<{ month: string; revenue: number; transactions: number }>;
  }> {
    const query: any = {};

    if (filters.doctorId) {
      query.doctor = new mongoose.Types.ObjectId(filters.doctorId);
    }

    if (filters.patientId) {
      query.patient = new mongoose.Types.ObjectId(filters.patientId);
    }

    const [stats, monthlyStats] = await Promise.all([
      Payment.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$amount', 0] } },
            totalTransactions: { $sum: 1 },
            successfulPayments: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
            failedPayments: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
            refundedPayments: { $sum: { $cond: [{ $eq: ['$status', 'refunded'] }, 1, 0] } },
            averageTransactionValue: { $avg: '$amount' }
          }
        }
      ]),
      Payment.aggregate([
        { $match: { ...query, status: 'completed' } },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' }
            },
            revenue: { $sum: '$amount' },
            transactions: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': -1, '_id.month': -1 } },
        { $limit: 12 }
      ])
    ]);

    const result = stats[0] || {
      totalRevenue: 0,
      totalTransactions: 0,
      successfulPayments: 0,
      failedPayments: 0,
      refundedPayments: 0,
      averageTransactionValue: 0
    };

    const monthlyRevenue = monthlyStats.map(stat => ({
      month: `${stat._id.year}-${stat._id.month.toString().padStart(2, '0')}`,
      revenue: stat.revenue,
      transactions: stat.transactions
    }));

    return { ...result, monthlyRevenue };
  }

  // Payment Gateway Implementations
  private static async processStripePayment(
    payment: IPayment,
    paymentDetails: Record<string, any>
  ): Promise<PaymentGatewayResponse> {
    // Mock Stripe payment processing

    // Simulate success/failure based on amount (for testing)
    const success = payment.amount < 10000; // Fail if amount >= 10000

    if (success) {
      return {
        success: true,
        transactionId: `stripe_${Date.now()}`,
        gatewayId: `pi_${Math.random().toString(36).substr(2, 24)}`,
        status: 'completed',
        gatewayResponse: {
          id: `pi_${Math.random().toString(36).substr(2, 24)}`,
          status: 'succeeded',
          amount: payment.amount * 100, // Stripe uses cents
          currency: payment.currency.toLowerCase(),
          created: Math.floor(Date.now() / 1000)
        }
      };
    } else {
      return {
        success: false,
        status: 'failed',
        message: 'Your card was declined. Please try a different payment method.'
      };
    }
  }

  private static async processRazorpayPayment(
    payment: IPayment,
    paymentDetails: Record<string, any>
  ): Promise<PaymentGatewayResponse> {
    
    return {
      success: true,
      transactionId: `razorpay_${Date.now()}`,
      gatewayId: `pay_${Math.random().toString(36).substr(2, 14)}`,
      status: 'completed',
      gatewayResponse: {
        id: `pay_${Math.random().toString(36).substr(2, 14)}`,
        status: 'captured',
        amount: payment.amount * 100,
        currency: payment.currency
      }
    };
  }

  private static async processPayPalPayment(
    payment: IPayment,
    paymentDetails: Record<string, any>
  ): Promise<PaymentGatewayResponse> {
    
    return {
      success: true,
      transactionId: `paypal_${Date.now()}`,
      gatewayId: `PAYID-${Math.random().toString(36).substr(2, 14).toUpperCase()}`,
      status: 'completed'
    };
  }

  private static async processCashPayment(
    payment: IPayment,
    paymentDetails: Record<string, any>
  ): Promise<PaymentGatewayResponse> {
    
    return {
      success: true,
      transactionId: `cash_${Date.now()}`,
      gatewayId: `cash_${payment._id}`,
      status: 'completed'
    };
  }

  // Refund implementations
  private static async processStripeRefund(payment: IPayment, amount: number): Promise<PaymentGatewayResponse> {
    
    return {
      success: true,
      gatewayId: `re_${Math.random().toString(36).substr(2, 24)}`,
      status: 'refunded'
    };
  }

  private static async processRazorpayRefund(payment: IPayment, amount: number): Promise<PaymentGatewayResponse> {
    
    return {
      success: true,
      gatewayId: `rfnd_${Math.random().toString(36).substr(2, 14)}`,
      status: 'refunded'
    };
  }

  private static async processPayPalRefund(payment: IPayment, amount: number): Promise<PaymentGatewayResponse> {
    
    return {
      success: true,
      gatewayId: `REFUND-${Math.random().toString(36).substr(2, 14).toUpperCase()}`,
      status: 'refunded'
    };
  }

  private static async processCashRefund(payment: IPayment, amount: number): Promise<PaymentGatewayResponse> {
    
    return {
      success: true,
      gatewayId: `cash_refund_${payment._id}`,
      status: 'refunded'
    };
  }

  /**
   * Send payment notifications
   */
  private static async sendPaymentNotifications(
    payment: IPayment,
    type: 'success' | 'failed' | 'refunded'
  ): Promise<void> {
    const patient = payment.patient as any;
    const doctor = payment.doctor as any;

    switch (type) {
      case 'success':
        await NotificationService.createNotification({
          recipient: payment.patient._id.toString(),
          type: 'payment_received',
          title: 'Payment Successful',
          message: `Your payment of ${payment.currency} ${payment.amount} has been processed successfully.`,
          data: { paymentId: payment._id.toString() }
        });

        await NotificationService.createNotification({
          recipient: payment.doctor._id.toString(),
          type: 'payment_received',
          title: 'Payment Received',
          message: `Payment of ${payment.currency} ${payment.amount} received from ${patient?.fullName}.`,
          data: { paymentId: payment._id.toString() }
        });
        break;

      case 'failed':
        await NotificationService.createNotification({
          recipient: payment.patient._id.toString(),
          type: 'payment_failed',
          title: 'Payment Failed',
          message: `Your payment of ${payment.currency} ${payment.amount} could not be processed. Please try again.`,
          data: { paymentId: payment._id.toString() },
          channels: ['in_app', 'email']
        });
        break;

      case 'refunded':
        await NotificationService.createNotification({
          recipient: payment.patient._id.toString(),
          type: 'payment_received',
          title: 'Refund Processed',
          message: `Your refund of ${payment.currency} ${payment.refundDetails?.refundAmount} has been processed.`,
          data: { paymentId: payment._id.toString() }
        });
        break;
    }
  }

  /**
   * Validate payment creation
   */
  private static async validatePaymentCreation(
    appointmentId: string,
    patientId: string,
    doctorId: string,
    amount: number
  ): Promise<void> {
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      throw new Error('Appointment not found');
    }

    if (appointment.patient._id.toString() !== patientId) {
      throw new Error('Patient ID mismatch');
    }

    if (appointment.doctor._id.toString() !== doctorId) {
      throw new Error('Doctor ID mismatch');
    }

    if (appointment.fee !== amount) {
      throw new Error('Payment amount does not match appointment fee');
    }

    const existingPayment = await Payment.findOne({
      appointment: appointment._id,
      status: { $in: ['completed', 'processing'] }
    });

    if (existingPayment) {
      throw new Error('Payment already exists for this appointment');
    }
  }
} 