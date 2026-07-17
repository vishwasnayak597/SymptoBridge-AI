import mongoose, { Schema, Document } from 'mongoose';

/**
 * A patient waiting for a slot with a doctor on a given day.
 *
 * Lifecycle: waiting -> offered (a cancellation freed a slot; 15-min window)
 *            offered -> fulfilled (they booked) | expired (window passed -> next in line)
 *            waiting -> cancelled (patient left the list)
 */
export interface IWaitlistEntry extends Document {
  doctor: mongoose.Types.ObjectId;
  patient: mongoose.Types.ObjectId;
  /** Calendar day being waited on, normalized to YYYY-MM-DD. */
  date: string;
  status: 'waiting' | 'offered' | 'fulfilled' | 'expired' | 'cancelled';
  offeredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const waitlistEntrySchema = new Schema<IWaitlistEntry>(
  {
    doctor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    patient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    status: {
      type: String,
      enum: ['waiting', 'offered', 'fulfilled', 'expired', 'cancelled'],
      default: 'waiting',
    },
    offeredAt: Date,
  },
  { timestamps: true }
);

// FIFO scan per doctor/day; one index serves offerNext and duplicate checks.
waitlistEntrySchema.index({ doctor: 1, date: 1, status: 1, createdAt: 1 });

export const WaitlistEntry = mongoose.model<IWaitlistEntry>('WaitlistEntry', waitlistEntrySchema);
