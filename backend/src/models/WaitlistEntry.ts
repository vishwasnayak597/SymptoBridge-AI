import mongoose, { Schema, Document } from 'mongoose';

/**
 * A patient waiting for a slot with a doctor on a given day.
 *
 * Lifecycle: waiting -> offered (a cancellation freed a slot; 15-min HOLD on it)
 *            offered -> fulfilled (they claimed it) | expired (window passed -> next in line)
 *            waiting -> cancelled (patient left the list)
 *
 * An offer is a hold on one specific slot (`offeredSlot`) until `offerExpiresAt`.
 * While it's live, availability shows that slot as taken and createAppointment
 * rejects it for everyone except this patient. Without the hold the offer was only a
 * notification: anyone could book the freed slot during the patient's 15 minutes.
 */
export interface IWaitlistEntry extends Document {
  doctor: mongoose.Types.ObjectId;
  patient: mongoose.Types.ObjectId;
  /** Clinic calendar day being waited on, YYYY-MM-DD. */
  date: string;
  status: 'waiting' | 'offered' | 'fulfilled' | 'expired' | 'cancelled';
  offeredAt?: Date;
  /** The instant of the slot being held for this patient. */
  offeredSlot?: Date;
  /** When the hold lapses and the slot passes down the line. */
  offerExpiresAt?: Date;
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
    offeredSlot: Date,
    offerExpiresAt: Date,
  },
  { timestamps: true }
);

// FIFO scan per doctor/day; one index serves offerNext and duplicate checks.
waitlistEntrySchema.index({ doctor: 1, date: 1, status: 1, createdAt: 1 });
// Live holds, read by every availability query and every booking.
waitlistEntrySchema.index({ doctor: 1, status: 1, offeredSlot: 1 });

export const WaitlistEntry = mongoose.model<IWaitlistEntry>('WaitlistEntry', waitlistEntrySchema);
