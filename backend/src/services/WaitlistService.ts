import mongoose from 'mongoose';
import { WaitlistEntry, IWaitlistEntry } from '../models/WaitlistEntry';
import { Appointment } from '../models/Appointment';
import { NotificationService } from './NotificationService';
import { scheduleWaitlistExpiry } from './JobQueueService';
import { SocketService } from './SocketService';
import { publishEvent } from './EventBus';
import { formatClinicDateTime } from '../utils/clinicTime';
import logger from '../utils/logger';

/** How long a freed slot is held for the patient it's offered to. */
export const OFFER_WINDOW_MS = 15 * 60 * 1000;
const SLOT_MS = 30 * 60 * 1000;

/** Thrown when a patient tries to claim an offer that has lapsed or moved on. */
export class OfferUnavailableError extends Error {
  constructor(message = 'This offer has expired or was already used.') {
    super(message);
    this.name = 'OfferUnavailableError';
  }
}

/** "Mon 14 Sep, 5:00 pm IST" — how the slot reads in a notification. */
const describeSlot = formatClinicDateTime;

/**
 * Waitlist with real holds.
 *
 * A cancellation offers the freed slot to the next patient in line, first come first
 * served, and HOLDS that exact slot for them for 15 minutes: availability shows it as
 * taken and createAppointment rejects it for anyone else. The patient claims it in one
 * click. If the window lapses, the same slot passes to the next person; if the slot
 * has meanwhile stopped being bookable, the chain stops instead of offering a slot
 * that no longer exists.
 *
 * Before this, an offer was only a notification: the slot went straight back into
 * public availability, so anyone could take it during the offered patient's window,
 * and the chain kept offering it after it was gone.
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

  /** Leave the list. Leaving during an offer releases the hold to the next patient. */
  static async leave(patientId: string, entryId: string): Promise<void> {
    const entry = await WaitlistEntry.findOneAndUpdate(
      { _id: entryId, patient: patientId, status: { $in: ['waiting', 'offered'] } },
      { $set: { status: 'cancelled' } }
    );
    if (entry?.status === 'offered' && entry.offeredSlot) {
      await this.offerNext(entry.doctor.toString(), entry.date, entry.offeredSlot);
    }
  }

  /**
   * The patient's live entries, with what the UI needs: place in line while waiting,
   * the held slot and its deadline once offered.
   */
  static async listForPatient(patientId: string) {
    const entries = await WaitlistEntry.find({ patient: patientId, status: { $in: ['waiting', 'offered'] } })
      .populate('doctor', 'firstName lastName specialization consultationFee')
      .sort({ date: 1 })
      .lean();

    return Promise.all(
      entries.map(async (entry: any) => {
        const ahead =
          entry.status === 'waiting'
            ? await WaitlistEntry.countDocuments({
                doctor: entry.doctor._id,
                date: entry.date,
                status: 'waiting',
                createdAt: { $lt: entry.createdAt },
              })
            : 0;
        return {
          _id: entry._id,
          date: entry.date,
          status: entry.status,
          doctor: entry.doctor,
          position: entry.status === 'waiting' ? ahead + 1 : null,
          offeredSlot: entry.offeredSlot ?? null,
          offerExpiresAt: entry.offerExpiresAt ?? null,
        };
      })
    );
  }

  /**
   * Offer a freed slot to the first waiting patient and hold it for them.
   * findOneAndUpdate is atomic, so two concurrent cancellations can't offer to the
   * same entry twice. Returns the entry that received the offer, if any.
   */
  static async offerNext(doctorId: string, date: string, slot?: Date): Promise<IWaitlistEntry | null> {
    if (slot && !(await this.slotStillBookable(doctorId, slot))) {
      logger.info('Waitlist chain stopped: slot no longer bookable', { doctorId, slot: slot.toISOString() });
      return null;
    }

    const offerExpiresAt = new Date(Date.now() + OFFER_WINDOW_MS);
    const entry = await WaitlistEntry.findOneAndUpdate(
      { doctor: doctorId, date, status: 'waiting' },
      {
        $set: {
          status: 'offered',
          offeredAt: new Date(),
          ...(slot ? { offeredSlot: slot, offerExpiresAt } : {}),
        },
      },
      { sort: { createdAt: 1 }, new: true }
    ).populate('doctor', 'firstName lastName');

    if (!entry) return null; // nobody waiting

    const doctor = entry.doctor as any;
    const patientId = entry.patient.toString();
    const when = slot ? describeSlot(slot) : entry.date;

    await NotificationService.createNotification({
      recipient: patientId,
      type: 'appointment_reminder',
      priority: 'high' as any,
      title: 'A slot opened up — held for you',
      message: `Dr. ${doctor.firstName} ${doctor.lastName} is free at ${when}. We're holding it for you for 15 minutes.`,
      data: {
        waitlistEntryId: entry._id.toString(),
        doctorId,
        date,
        slot: slot?.toISOString(),
        expiresAt: slot ? offerExpiresAt.toISOString() : undefined,
      },
      actionUrl: '/patient/dashboard/?tab=appointments',
      actionText: 'Claim slot',
    });

    // Live update for an open dashboard, so the claim card appears without a refresh.
    SocketService.emitToUser(patientId, 'waitlist:offer', {
      entryId: entry._id.toString(),
      slot: slot?.toISOString(),
      expiresAt: offerExpiresAt.toISOString(),
    });

    publishEvent({
      type: 'waitlist.offered',
      entityType: 'waitlist_entry',
      entityId: entry._id.toString(),
      payload: { doctorId, date, slot: slot?.toISOString(), patientId, order: 'first-come-first-served' },
    });

    await scheduleWaitlistExpiry(entry._id.toString(), OFFER_WINDOW_MS);
    logger.info('Waitlist slot offered', { entryId: entry._id.toString(), doctorId, date, slot: slot?.toISOString() });
    return entry;
  }

  /** The window lapsed without a claim — pass the same slot down the line. */
  static async expireOffer(entryId: string): Promise<void> {
    const entry = await WaitlistEntry.findOneAndUpdate(
      { _id: entryId, status: 'offered' }, // no-op if they claimed it (fulfilled)
      { $set: { status: 'expired' } },
      { new: true }
    );
    if (!entry) return;

    await this.offerNext(entry.doctor.toString(), entry.date, entry.offeredSlot);
  }

  /**
   * Expire every lapsed offer. The delayed expiry job is an in-process timer when
   * Redis isn't configured, and a restart loses it — without this sweep a restart
   * mid-offer would hold the slot forever and nobody further down the line would
   * ever hear about it. Holds stop blocking the moment `offerExpiresAt` passes
   * regardless; the sweep is what keeps the chain moving.
   */
  static async sweepExpiredOffers(): Promise<number> {
    const lapsed = await WaitlistEntry.find({
      status: 'offered',
      offerExpiresAt: { $lte: new Date() },
    }).select('_id');
    for (const entry of lapsed) {
      await this.expireOffer(entry._id.toString()).catch((err) =>
        logger.error('Waitlist sweep failed for entry', { entryId: entry._id.toString(), message: err.message })
      );
    }
    return lapsed.length;
  }

  /**
   * The offer a patient may claim right now, or an error saying why not. Booking the
   * slot itself goes through AppointmentService.createAppointment, which lets the
   * holder through the hold and marks the entry fulfilled.
   */
  static async getClaimableOffer(entryId: string, patientId: string): Promise<IWaitlistEntry> {
    if (!mongoose.Types.ObjectId.isValid(entryId)) throw new OfferUnavailableError('Offer not found.');
    const entry = await WaitlistEntry.findOne({ _id: entryId, patient: patientId });
    if (!entry) throw new OfferUnavailableError('Offer not found.');
    if (
      entry.status !== 'offered' ||
      !entry.offeredSlot ||
      !entry.offerExpiresAt ||
      entry.offerExpiresAt.getTime() <= Date.now()
    ) {
      throw new OfferUnavailableError();
    }
    return entry;
  }

  /**
   * Called on booking: closes out this patient's live entries for the doctor/day.
   *
   * If one of them was HOLDING a slot the patient didn't take — offered 10:00, booked
   * 15:00 instead — that slot is passed to the next person in line rather than
   * dropped. Closing it silently used to put the slot back into public availability
   * with nobody further down the list ever told.
   *
   * Each entry is closed with its own atomic update, and only the call that actually
   * moves an entry out of 'offered' passes its slot on. If the 15-minute expiry fires
   * at the same moment, exactly one of the two wins — never two holders for one slot.
   */
  static async markFulfilled(patientId: string, doctorId: string, date: string, bookedAt?: Date): Promise<void> {
    const live = await WaitlistEntry.find({
      patient: patientId,
      doctor: doctorId,
      date,
      status: { $in: ['waiting', 'offered'] },
    }).select('_id');

    for (const { _id } of live) {
      const before = await WaitlistEntry.findOneAndUpdate(
        { _id, status: { $in: ['waiting', 'offered'] } },
        { $set: { status: 'fulfilled' } },
        { new: false } // the state we moved it FROM
      );
      const heldOtherSlot =
        before?.status === 'offered' &&
        before.offeredSlot &&
        (!bookedAt || before.offeredSlot.getTime() !== bookedAt.getTime());
      if (heldOtherSlot) {
        await this.offerNext(doctorId, before!.date, before!.offeredSlot);
      }
    }
  }

  /**
   * Live holds for these doctors in a time range, as busy blocks. Read by availability
   * so a held slot shows as taken to everyone.
   */
  static async activeHolds(doctorIds: string[], from: Date, to: Date) {
    return WaitlistEntry.find({
      doctor: { $in: doctorIds.map((id) => new mongoose.Types.ObjectId(id)) },
      status: 'offered',
      offerExpiresAt: { $gt: new Date() },
      offeredSlot: { $gte: new Date(from.getTime() - SLOT_MS), $lt: to },
    })
      .select('doctor patient offeredSlot')
      .lean();
  }

  /** A slot can be offered only if it's in the future and nothing now occupies it. */
  private static async slotStillBookable(doctorId: string, slot: Date): Promise<boolean> {
    if (slot.getTime() <= Date.now()) return false;
    // Anything starting up to 2h before (the longest appointment) could still be
    // running at `slot`; the exact overlap is checked against each one's duration.
    const candidates = await Appointment.find({
      doctor: new mongoose.Types.ObjectId(doctorId),
      status: { $in: ['scheduled', 'confirmed'] },
      appointmentDate: { $gt: new Date(slot.getTime() - 120 * 60 * 1000), $lt: new Date(slot.getTime() + SLOT_MS) },
    }).select('appointmentDate duration');
    return !candidates.some((a) => {
      const start = new Date(a.appointmentDate).getTime();
      const end = start + (a.duration || 30) * 60 * 1000;
      return start < slot.getTime() + SLOT_MS && end > slot.getTime();
    });
  }
}
