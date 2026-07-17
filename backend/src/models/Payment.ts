import mongoose, { Document, Schema } from 'mongoose';

const PAYMENT_STATUS_VALUES = ['pending', 'processing', 'completed', 'failed', 'refunded', 'cancelled'] as const;
const PAYMENT_METHOD_VALUES = ['credit_card', 'debit_card', 'upi', 'wallet', 'net_banking', 'cash'] as const;

export type PaymentStatus = typeof PAYMENT_STATUS_VALUES[number];
export type PaymentMethod = typeof PAYMENT_METHOD_VALUES[number];

export interface IPayment extends Document {
  _id: mongoose.Types.ObjectId;
  appointment: mongoose.Types.ObjectId;
  patient: mongoose.Types.ObjectId;
  doctor: mongoose.Types.ObjectId;
  amount: number;
  currency: string;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  transactionId?: string;
  paymentGatewayId?: string;
  paymentGateway: 'stripe' | 'razorpay' | 'paypal' | 'cash';
  gatewayResponse?: {
    id?: string;
    status?: string;
    method?: string;
    amount?: number;
    currency?: string;
    created?: Date;
    description?: string;
    metadata?: Record<string, any>;
  };
  refundDetails?: {
    refundId: string;
    refundAmount: number;
    reason: string;
    refundedAt: Date;
  };
  failureReason?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>({
  appointment: {
    type: Schema.Types.ObjectId,
    ref: 'Appointment',
    required: [true, 'Appointment ID is required']
  },
  patient: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Patient ID is required']
  },
  doctor: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Doctor ID is required']
  },
  amount: {
    type: Number,
    required: [true, 'Payment amount is required'],
    min: [0, 'Amount cannot be negative']
  },
  currency: {
    type: String,
    required: [true, 'Currency is required'],
    default: 'INR',
    uppercase: true
  },
  paymentMethod: {
    type: String,
    enum: {
      values: PAYMENT_METHOD_VALUES,
      message: 'Invalid payment method'
    },
    required: [true, 'Payment method is required']
  },
  status: {
    type: String,
    enum: {
      values: PAYMENT_STATUS_VALUES,
      message: 'Invalid payment status'
    },
    default: 'pending'
  },
  transactionId: {
    type: String,
    unique: true,
    sparse: true
  },
  paymentGatewayId: {
    type: String,
    sparse: true
  },
  paymentGateway: {
    type: String,
    enum: ['stripe', 'razorpay', 'paypal', 'cash'],
    required: [true, 'Payment gateway is required']
  },
  gatewayResponse: {
    id: String,
    status: String,
    method: String,
    amount: Number,
    currency: String,
    created: Date,
    description: String,
    metadata: Schema.Types.Mixed
  },
  refundDetails: {
    refundId: {
      type: String,
      required: function() {
        return this.status === 'refunded';
      }
    },
    refundAmount: {
      type: Number,
      required: function() {
        return this.status === 'refunded';
      },
      min: [0, 'Refund amount cannot be negative']
    },
    reason: {
      type: String,
      required: function() {
        return this.status === 'refunded';
      }
    },
    refundedAt: {
      type: Date,
      required: function() {
        return this.status === 'refunded';
      }
    }
  },
  failureReason: {
    type: String,
    required: function() {
      return this.status === 'failed';
    }
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

paymentSchema.index({ appointment: 1 });
paymentSchema.index({ patient: 1, createdAt: -1 });
paymentSchema.index({ doctor: 1, createdAt: -1 });
paymentSchema.index({ status: 1 });
// transactionId (unique+sparse) and paymentGatewayId (sparse) already create
// their indexes at the field level — re-declaring them here duplicated them.

paymentSchema.virtual('isSuccessful').get(function() {
  return this.status === 'completed';
});

paymentSchema.virtual('canBeRefunded').get(function() {
  return this.status === 'completed' && !this.refundDetails;
});

paymentSchema.virtual('formattedAmount').get(function() {
  return `${this.currency} ${this.amount.toFixed(2)}`;
});

paymentSchema.pre('save', function(next) {
  if (this.isNew) {
    this.transactionId = this.transactionId || `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  next();
});

export const Payment = mongoose.model<IPayment>('Payment', paymentSchema); 