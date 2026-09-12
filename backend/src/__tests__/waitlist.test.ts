import { Types } from 'mongoose';
import User from '../models/User';
import { Appointment } from '../models/Appointment';
import { WaitlistEntry } from '../models/WaitlistEntry';
import { AppointmentService, SlotTakenError } from '../services/AppointmentService';
import { WaitlistService, OfferUnavailableError } from '../services/WaitlistService';
import { availabilityForDoctors, slotInstant } from '../services/SlotService';
import { stopJobWorkers } from '../services/JobQueueService';
import { addDaysToKey, clinicDateKey } from '../utils/clinicTime';

// Offers schedule 15-minute in-process expiry timers without Redis; clear them so
// Jest can exit.
afterAll(async () => {
  await stopJobWorkers();
});

const DATE = addDaysToKey(clinicDateKey(new Date()), 3);
const SLOT = '10:00';

async function scenario() {
  const mk = (email: string, extra: Record<string, unknown> = {}) =>
    User.create({ email, password: 'SuperSecret123!', firstName: email.split('@')[0], lastName: 'Test', ...extra });

  const doctor = await mk('wldoc@test.com', {
    role: 'doctor', specialization: 'Cardiology', licenseNumber: 'LIC-WL', consultationFee: 700,
  });
  const booker = await mk('booker@test.com', { role: 'patient' });
  const first = await mk('first@test.com', { role: 'patient' });
  const second = await mk('second@test.com', { role: 'patient' });
  const stranger = await mk('stranger@test.com', { role: 'patient' });

  const id = (u: any) => (u._id as Types.ObjectId).toString();
  const doctorId = id(doctor);

  const book = (patientId: string, at: Date) =>
    AppointmentService.createAppointment({
      patientId,
      doctorId,
      appointmentDate: at,
      duration: 30,
      consultationType: 'video',
      symptoms: 'Follow-up visit',
      specialization: 'Cardiology',
      fee: 700,
    } as any);

  // The booker holds the slot; two patients queue for the day, first before second.
  const appointment: any = await book(id(booker), slotInstant(DATE, SLOT));
  const firstEntry = await WaitlistService.join(id(first), doctorId, DATE);
  await new Promise((r) => setTimeout(r, 5)); // distinct createdAt for FIFO
  const secondEntry = await WaitlistService.join(id(second), doctorId, DATE);

  return {
    doctorId,
    bookerId: id(booker),
    firstId: id(first),
    secondId: id(second),
    strangerId: id(stranger),
    appointmentId: String(appointment._id),
    firstEntryId: String(firstEntry._id),
    secondEntryId: String(secondEntry._id),
    book,
  };
}

describe('waitlist holds', () => {
  it('offers the exact freed slot to the first in line and holds it', async () => {
    const s = await scenario();

    await AppointmentService.cancelAppointment(s.appointmentId, s.bookerId, 'Can no longer attend');

    const offered = await WaitlistEntry.findById(s.firstEntryId);
    expect(offered?.status).toBe('offered');
    expect(offered?.offeredSlot?.toISOString()).toBe(slotInstant(DATE, SLOT).toISOString());
    const windowMs = (offered!.offerExpiresAt!.getTime() - Date.now());
    expect(windowMs).toBeGreaterThan(14 * 60 * 1000);
    expect(windowMs).toBeLessThanOrEqual(15 * 60 * 1000);

    // Second in line is still waiting — offers go one at a time.
    expect((await WaitlistEntry.findById(s.secondEntryId))?.status).toBe('waiting');
  });

  it('shows the held slot as taken to everyone', async () => {
    const s = await scenario();
    await AppointmentService.cancelAppointment(s.appointmentId, s.bookerId);

    const map = await availabilityForDoctors([s.doctorId], DATE, DATE);
    expect(map[s.doctorId][DATE]).not.toContain(SLOT);
    expect(map[s.doctorId][DATE]).toContain('10:30');
  });

  // Regression: before holds, the freed slot went straight back into availability,
  // so anyone could take it during the offered patient's 15 minutes.
  it('refuses the held slot to anyone but the patient it is held for', async () => {
    const s = await scenario();
    await AppointmentService.cancelAppointment(s.appointmentId, s.bookerId);

    await expect(s.book(s.strangerId, slotInstant(DATE, SLOT))).rejects.toBeInstanceOf(SlotTakenError);
    await expect(s.book(s.secondId, slotInstant(DATE, SLOT))).rejects.toBeInstanceOf(SlotTakenError);

    // The holder can book it, and that closes out their entry.
    await expect(s.book(s.firstId, slotInstant(DATE, SLOT))).resolves.toBeDefined();
    expect((await WaitlistEntry.findById(s.firstEntryId))?.status).toBe('fulfilled');
  });

  it('lets only the holder claim, and only inside the window', async () => {
    const s = await scenario();
    await AppointmentService.cancelAppointment(s.appointmentId, s.bookerId);

    await expect(WaitlistService.getClaimableOffer(s.firstEntryId, s.strangerId)).rejects.toBeInstanceOf(
      OfferUnavailableError
    );
    await expect(WaitlistService.getClaimableOffer(s.firstEntryId, s.firstId)).resolves.toBeDefined();

    await WaitlistEntry.updateOne({ _id: s.firstEntryId }, { $set: { offerExpiresAt: new Date(Date.now() - 1000) } });
    await expect(WaitlistService.getClaimableOffer(s.firstEntryId, s.firstId)).rejects.toBeInstanceOf(
      OfferUnavailableError
    );
  });

  it('passes the same slot down the line when the window lapses', async () => {
    const s = await scenario();
    await AppointmentService.cancelAppointment(s.appointmentId, s.bookerId);

    await WaitlistService.expireOffer(s.firstEntryId);

    expect((await WaitlistEntry.findById(s.firstEntryId))?.status).toBe('expired');
    const next = await WaitlistEntry.findById(s.secondEntryId);
    expect(next?.status).toBe('offered');
    expect(next?.offeredSlot?.toISOString()).toBe(slotInstant(DATE, SLOT).toISOString());
  });

  // Regression: the chain used to keep offering a slot after it had been taken.
  it('stops the chain when the slot is no longer bookable', async () => {
    const s = await scenario();
    await AppointmentService.cancelAppointment(s.appointmentId, s.bookerId);

    // Something occupies the slot without going through the hold (e.g. a doctor's
    // manual edit). The next offer must not go out for a slot that's gone.
    await Appointment.create({
      patient: new Types.ObjectId(s.strangerId),
      doctor: new Types.ObjectId(s.doctorId),
      appointmentDate: slotInstant(DATE, SLOT),
      duration: 30, consultationType: 'video', symptoms: 'Walk-in',
      specialization: 'Cardiology', fee: 700, status: 'scheduled',
    });
    await WaitlistService.expireOffer(s.firstEntryId);

    expect((await WaitlistEntry.findById(s.secondEntryId))?.status).toBe('waiting');
  });

  it('keeps the chain moving after a restart via the sweep', async () => {
    const s = await scenario();
    await AppointmentService.cancelAppointment(s.appointmentId, s.bookerId);
    // Simulate the in-process expiry timer being lost: the window has passed, but
    // no job ever fired.
    await WaitlistEntry.updateOne({ _id: s.firstEntryId }, { $set: { offerExpiresAt: new Date(Date.now() - 1000) } });

    const swept = await WaitlistService.sweepExpiredOffers();

    expect(swept).toBe(1);
    expect((await WaitlistEntry.findById(s.secondEntryId))?.status).toBe('offered');
  });

  it('releases the hold to the next patient when the holder leaves the list', async () => {
    const s = await scenario();
    await AppointmentService.cancelAppointment(s.appointmentId, s.bookerId);

    await WaitlistService.leave(s.firstId, s.firstEntryId);

    expect((await WaitlistEntry.findById(s.secondEntryId))?.status).toBe('offered');
  });

  // Regression: booking a different slot closed the entry and silently dropped the
  // hold — the freed slot went back to public availability and the next person in
  // line was never told.
  it('passes a held slot on when the holder books a different time instead', async () => {
    const s = await scenario();
    await AppointmentService.cancelAppointment(s.appointmentId, s.bookerId);

    await s.book(s.firstId, slotInstant(DATE, '15:00'));

    expect((await WaitlistEntry.findById(s.firstEntryId))?.status).toBe('fulfilled');
    const next = await WaitlistEntry.findById(s.secondEntryId);
    expect(next?.status).toBe('offered');
    expect(next?.offeredSlot?.toISOString()).toBe(slotInstant(DATE, SLOT).toISOString());
  });

  it('does not pass the slot on when the holder books the held slot itself', async () => {
    const s = await scenario();
    await AppointmentService.cancelAppointment(s.appointmentId, s.bookerId);

    await s.book(s.firstId, slotInstant(DATE, SLOT));

    expect((await WaitlistEntry.findById(s.secondEntryId))?.status).toBe('waiting');
  });

  it('never gives one slot two holders when expiry and booking race', async () => {
    const s = await scenario();
    await AppointmentService.cancelAppointment(s.appointmentId, s.bookerId);

    // The 15-minute expiry and a booking of another slot land at the same moment.
    await Promise.all([
      WaitlistService.expireOffer(s.firstEntryId),
      s.book(s.firstId, slotInstant(DATE, '15:00')),
    ]);

    const holders = await WaitlistEntry.countDocuments({
      offeredSlot: slotInstant(DATE, SLOT),
      status: 'offered',
    });
    expect(holders).toBe(1);
  });

  it('reports place in line while waiting and the held slot once offered', async () => {
    const s = await scenario();

    const [waiting] = await WaitlistService.listForPatient(s.secondId);
    expect(waiting.position).toBe(2);

    await AppointmentService.cancelAppointment(s.appointmentId, s.bookerId);
    const [offered] = await WaitlistService.listForPatient(s.firstId);
    expect(offered.status).toBe('offered');
    expect(offered.offeredSlot?.toISOString()).toBe(slotInstant(DATE, SLOT).toISOString());
    expect(offered.position).toBeNull();
  });
});
