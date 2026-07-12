import { Router, Request, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { PaymentService, PaymentRequest, RefundRequest } from '../services/PaymentService';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idempotent } from '../middleware/idempotency';
import { createPaymentSchema } from '../../../shared/schemas';

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

const router = Router();

router.post('/', authenticate, validate(createPaymentSchema), idempotent('payment'), async (req: Request, res: Response) => {
  try {
    // Get appointment to fetch the correct patient ID
    const appointment = await PaymentService.getAppointmentForPayment(req.body.appointmentId);
    if (!appointment) {
      return res.status(404).json({ success: false, error: 'Appointment not found' });
    }

    const paymentData: PaymentRequest = {
      appointmentId: req.body.appointmentId,
      patientId: appointment.patient._id.toString(), // Use patient from appointment
      doctorId: req.body.doctorId,
      amount: req.body.amount,
      currency: req.body.currency,
      paymentMethod: req.body.paymentMethod,
      paymentGateway: req.body.paymentGateway,
      metadata: req.body.metadata
    };

    const payment = await PaymentService.createPayment(paymentData);
    res.status(201).json({ success: true, data: payment, message: 'Payment created successfully' });
  } catch (error) {
    console.error('Error creating payment:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to create payment' });
  }
});

router.post('/:id/process', [
  authenticate,
  param('id').isMongoId(),
  body('paymentDetails').isObject()
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: errors.array().map(err => err.msg).join(', ') });
    }

    const result = await PaymentService.processPayment(req.params.id, req.body.paymentDetails);
    res.json({ success: true, data: result, message: 'Payment processed successfully' });
  } catch (error) {
    console.error('Error processing payment:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to process payment' });
  }
});

router.get('/', [authenticate], async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const userRole = req.user!.role;
    const userId = req.user!._id.toString();

    const filters: any = {};
    if (userRole === 'patient') filters.patientId = userId;
    else if (userRole === 'doctor') filters.doctorId = userId;
    
    if (req.query.status) filters.status = req.query.status;
    if (req.query.paymentMethod) filters.paymentMethod = req.query.paymentMethod;
    if (req.query.dateFrom) filters.dateFrom = new Date(req.query.dateFrom as string);
    if (req.query.dateTo) filters.dateTo = new Date(req.query.dateTo as string);

    const result = await PaymentService.getPayments(filters, page, limit);
    res.json({ success: true, data: result, message: 'Payments retrieved successfully' });
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to fetch payments' });
  }
});

router.get('/stats', [authenticate], async (req: Request, res: Response) => {
  try {
    const userId = req.user!._id.toString();
    const role = req.user!.role;

    const filters: any = {};
    if (role === 'patient') filters.patientId = userId;
    else if (role === 'doctor') filters.doctorId = userId;

    const stats = await PaymentService.getPaymentStats(filters);
    res.json({ success: true, data: stats, message: 'Payment statistics retrieved successfully' });
  } catch (error) {
    console.error('Error fetching payment stats:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to fetch payment statistics' });
  }
});

router.get('/:id', [authenticate, param('id').isMongoId()], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: errors.array().map(err => err.msg).join(', ') });
    }

    const payment = await PaymentService.getPaymentById(req.params.id, req.user!._id.toString());
    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    res.json({ success: true, data: payment, message: 'Payment retrieved successfully' });
  } catch (error) {
    console.error('Error fetching payment:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to fetch payment' });
  }
});

router.post('/:id/refund', [
  authenticate,
  param('id').isMongoId(),
  body('reason').notEmpty().isLength({ min: 5, max: 500 }),
  body('amount').optional().isFloat({ min: 0 })
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: errors.array().map(err => err.msg).join(', ') });
    }

    const refundRequest: RefundRequest = {
      paymentId: req.params.id,
      amount: req.body.amount,
      reason: req.body.reason
    };

    const payment = await PaymentService.refundPayment(refundRequest);
    res.json({ success: true, data: payment, message: 'Payment refunded successfully' });
  } catch (error) {
    console.error('Error refunding payment:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to refund payment' });
  }
});

export default router; 