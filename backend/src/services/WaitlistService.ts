import { WaitlistEntry, IWaitlistEntry } from '../models/WaitlistEntry';
import { NotificationService } from './NotificationService';
import { scheduleWaitlistExpiry } from './JobQueueService';
import logger from '../utils/logger';

/**
 * Waitlist: when a doctor's day is full, patients queue up; a cancellation
 * offers the freed slot to the first person in line with a 15-minute window
 * (enforced by a delayed job), then falls through to the next.
 */
export class WaitlistService {
  /** Join the list (idempotent: one live entry per patient/doctor/day). */
  static async join(patientId: string, doctorId: string, date: string): Promise<IWaitlistEntry> {
    const existing = await WaitlistEntry.findOne({
      patient: patientId,
      doctor: doctorId,
      date,
      status: { $in: ['waiting', 'offered'] },
    });
    if (existing) return existing;

    return WaitlistEntry.create({ patient: patientId, doctor: doctorId, date, status: 'waiting' });
  }

  /** Leave the list. */
  static async leave(patientId: string, entryId: string): Promise<void> {
    await WaitlistEntry.updateOne(
      { _id: entryId, patient: patientId, status: { $in: ['waiting', 'offered'] } },
      { $set: { status: 'cancelled' } }
    );
  }

  /** The patient's active waitlist entries (to render "you're in line" chips). */
  static async listForPatient(patientId: string): Promise<IWaitlistEntry[]> {
    return WaitlistEntry.find({ patient: patientId, status: { $in: ['waiting', 'offered'] } })
      .populate('doctor', 'firstName lastName specialization')
      .sort({ date: 1 })
      .lean() as unknown as IWaitlistEntry[];
  }

  /**
   * A slot freed up (cancellation) — offer it to the first waiting patient.
   * findOneAndUpdate is atomic, so two concurrent cancellations can't offer
   * to the same entry twice.
   */
  static async offerNext(doctorId: string, date: string): Promise<void> {
    const entry = await WaitlistEntry.findOneAndUpdate(
      { doctor: doctorId, date, status: 'waiting' },
      { $set: { status: 'offered', offeredAt: new Date() } },
      { sort: { createdAt: 1 }, new: true }
    ).populate('doctor', 'firstName lastName');

    if (!entry) return; // nobody waiting

    const doctor = entry.doctor as any;
    await NotificationService.createNotification({
      recipient: entry.patient.toString(),
      type: 'appointment_reminder',
      priority: 'high' as any,
      title: 'A slot just opened up! 🎉',
      message: `A slot with Dr. ${doctor.firstName} ${doctor.lastName} on ${entry.date} is now free. Book within 15 minutes to claim it.`,
      data: { waitlistEntryId: entry._id.toString(), doctorId, date },
      actionUrl: '/patient/dashboard',
      actionText: 'Book Now',
    });

    await scheduleWaitlistExpiry(entry._id.toString());
    logger.info('Waitlist slot offered', { entryId: entry._id.toString(), doctorId, date });
  }

  /** 15-minute window passed without a booking — pass the offer down the line. */
  static async expireOffer(entryId: string): Promise<void> {
    const entry = await WaitlistEntry.findOneAndUpdate(
      { _id: entryId, status: 'offered' }, // no-op if they booked (fulfilled)
      { $set: { status: 'expired' } },
      { new: true }
    );
    if (!entry) return;

    await this.offerNext(entry.doctor.toString(), entry.date);
  }

  /** Called on booking: closes out any live entry for this patient/doctor/day. */
  static async markFulfilled(patientId: string, doctorId: string, date: string): Promise<void> {
    await WaitlistEntry.updateMany(
      { patient: patientId, doctor: doctorId, date, status: { $in: ['waiting', 'offered'] } },
      { $set: { status: 'fulfilled' } }
    );
  }
}
