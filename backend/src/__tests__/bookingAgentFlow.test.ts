import { Types } from 'mongoose';
import User from '../models/User';
import { Appointment } from '../models/Appointment';
import { runBookingAgent, confirmProposal } from '../services/BookingAgentService';
import { stopJobWorkers } from '../services/JobQueueService';

// Booking an appointment schedules T-24h/T-1h reminders. With no Redis those are
// in-process setTimeouts, which keep the event loop alive and stop Jest exiting.
afterAll(async () => {
  await stopJobWorkers();
});

/**
 * End-to-end cover for the agent path: natural-language request in, real appointment
 * out — including the write gate, which is the part that must not regress.
 */

function futureDate(daysAhead = 2): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

async function seedDirectory() {
  const patient = await User.create({
    email: 'agentpatient@test.com',
    password: 'SuperSecret123!',
    firstName: 'Pat',
    lastName: 'Lee',
    role: 'patient',
  });
  const cheapCardiologist = await User.create({
    email: 'cheapcardio@test.com',
    password: 'SuperSecret123!',
    firstName: 'Cheap',
    lastName: 'Cardio',
    role: 'doctor',
    specialization: 'Cardiology',
    licenseNumber: 'LIC-A',
    consultationFee: 600,
    rating: 4.5,
    isEmailVerified: true,
    isActive: true,
  });
  const pricyCardiologist = await User.create({
    email: 'pricycardio@test.com',
    password: 'SuperSecret123!',
    firstName: 'Pricy',
    lastName: 'Cardio',
    role: 'doctor',
    specialization: 'Cardiology',
    licenseNumber: 'LIC-B',
    consultationFee: 2500,
    rating: 5,
    isEmailVerified: true,
    isActive: true,
  });
  const dermatologist = await User.create({
    email: 'derm@test.com',
    password: 'SuperSecret123!',
    firstName: 'Skin',
    lastName: 'Doc',
    role: 'doctor',
    specialization: 'Dermatology',
    licenseNumber: 'LIC-C',
    consultationFee: 500,
    rating: 4.8,
    isEmailVerified: true,
    isActive: true,
  });
  return {
    patientId: (patient._id as Types.ObjectId).toString(),
    cheapId: (cheapCardiologist._id as Types.ObjectId).toString(),
    pricyId: (pricyCardiologist._id as Types.ObjectId).toString(),
    dermId: (dermatologist._id as Types.ObjectId).toString(),
  };
}

describe('runBookingAgent', () => {
  it('honours speciality and fee, and proposes only bookable slots', async () => {
    const { patientId, cheapId, pricyId, dermId } = await seedDirectory();

    const result = await runBookingAgent({
      patientId,
      query: 'find a cardiologist this week under ₹800',
    });

    expect(result.constraints.specialization).toBe('Cardiology');
    expect(result.constraints.maxFee).toBe(800);
    expect(result.proposals.length).toBeGreaterThan(0);

    const proposedIds = result.proposals.map((p) => p.doctorId);
    expect(proposedIds).toContain(cheapId);
    expect(proposedIds).not.toContain(pricyId); // over budget
    expect(proposedIds).not.toContain(dermId); // wrong speciality

    for (const proposal of result.proposals) {
      expect(new Date(proposal.slotISO).getTime()).toBeGreaterThan(Date.now());
      expect(proposal.fee).toBeLessThanOrEqual(800);
    }
  });

  it('reports why nothing matched instead of returning an empty result', async () => {
    const { patientId } = await seedDirectory();

    const result = await runBookingAgent({ patientId, query: 'an oncologist under ₹100' });

    expect(result.proposals).toHaveLength(0);
    expect(result.noMatchReason).toBeTruthy();
  });

  it('never proposes a slot that is already booked', async () => {
    const { patientId, cheapId, pricyId } = await seedDirectory();
    const date = futureDate();

    // Fill the cheap cardiologist's entire day.
    const slots = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
      '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30'];
    await Appointment.insertMany(
      slots.map((slot) => ({
        patient: new Types.ObjectId(patientId),
        doctor: new Types.ObjectId(cheapId),
        appointmentDate: new Date(`${date}T${slot}:00.000Z`),
        duration: 30,
        consultationType: 'video',
        symptoms: 'Existing booking',
        specialization: 'Cardiology',
        fee: 600,
        status: 'scheduled',
      }))
    );

    const result = await runBookingAgent({
      patientId,
      query: `cardiologist on ${date}`,
    });

    const cheapProposal = result.proposals.find((p) => p.doctorId === cheapId);
    // Either the doctor is not proposed at all for that day, or the slot offered is
    // on a later day — never one of the taken ones.
    if (cheapProposal && cheapProposal.date === date) {
      expect(slots).not.toContain(cheapProposal.time);
    }
    expect(result.proposals.every((p) => p.doctorId !== pricyId || p.fee === 2500)).toBe(true);
  });

  /**
   * Regression for the live failure: "gastraentologist this week on friday saturday
   * after 5pm" returned General Medicine and Pediatrics doctors at 9:00 AM on a Sunday.
   */
  it('respects a misspelt speciality plus day and time filters', async () => {
    const { patientId } = await seedDirectory();
    await User.create({
      email: 'gastro@test.com',
      password: 'SuperSecret123!',
      firstName: 'Gut',
      lastName: 'Doc',
      role: 'doctor',
      specialization: 'Gastroenterology',
      licenseNumber: 'LIC-G',
      consultationFee: 900,
      rating: 4.2,
      isEmailVerified: true,
      isActive: true,
    });

    const result = await runBookingAgent({
      patientId,
      query: 'gastraentologist this week on friday saturday after 5pm',
    });

    expect(result.constraints.specialization).toBe('Gastroenterology');
    expect(result.proposals.length).toBeGreaterThan(0);

    for (const proposal of result.proposals) {
      expect(proposal.specialization).toBe('Gastroenterology');
      const day = new Date(`${proposal.date}T00:00:00.000Z`).getUTCDay();
      expect([5, 6]).toContain(day); // Friday or Saturday only
      expect(proposal.time >= '17:00').toBe(true); // after 5pm only
    }
  });

  it('drops a constraint the patient dismissed instead of re-deriving it', async () => {
    const { patientId, dermId } = await seedDirectory();

    const withFilter = await runBookingAgent({ patientId, query: 'skin doctor under 400' });
    expect(withFilter.proposals).toHaveLength(0); // the dermatologist charges 500

    const dropped = await runBookingAgent({
      patientId,
      query: 'skin doctor under 400',
      drop: ['maxFee'],
    });
    expect(dropped.constraints.maxFee).toBeUndefined();
    expect(dropped.proposals.map((p) => p.doctorId)).toContain(dermId);
  });

  it('produces a step trace describing what it did', async () => {
    const { patientId } = await seedDirectory();
    const result = await runBookingAgent({ patientId, query: 'cardiologist under ₹800' });

    expect(result.steps.length).toBeGreaterThanOrEqual(2);
    expect(result.steps.some((s) => /calendar/i.test(s.label))).toBe(true);
    expect(result.plannedBy).toBe('rules'); // no GEMINI_API_KEY in tests
  });

  it('summarises the whole run in one line for the fast path', async () => {
    const { patientId } = await seedDirectory();
    const result = await runBookingAgent({
      patientId,
      query: 'cardiologist under ₹800 on friday after 5pm',
    });

    // Names what was searched, how much was open, and the narrowing filters — the
    // four-line trace collapsed into the line the UI actually renders.
    expect(result.summary).toMatch(/^Checked \d+ Cardiology calendars? · \d+ slots? on Fri, after 5pm$/);
  });

  it('summarises the no-match cases too', async () => {
    const { patientId } = await seedDirectory();

    const noDoctors = await runBookingAgent({ patientId, query: 'an oncologist under ₹100' });
    expect(noDoctors.summary).toContain('No Oncology doctors match');

    const noSlots = await runBookingAgent({ patientId, query: 'cardiologist before 8am' });
    expect(noSlots.summary).toMatch(/0 slots before 8am/);
  });
});

describe('confirmProposal (the write gate)', () => {
  it('creates a real appointment for the proposed slot', async () => {
    const { patientId } = await seedDirectory();
    const result = await runBookingAgent({ patientId, query: 'cardiologist under ₹800' });
    const proposal = result.proposals[0];

    const appointment: any = await confirmProposal(proposal.proposalId, patientId, {
      symptoms: 'Chest tightness',
    });

    expect(String(appointment.doctor._id || appointment.doctor)).toBe(proposal.doctorId);
    expect(new Date(appointment.appointmentDate).toISOString()).toBe(
      new Date(proposal.slotISO).toISOString()
    );
    expect(appointment.fee).toBe(proposal.fee);

    const stored = await Appointment.findById(appointment._id);
    expect(stored).not.toBeNull();
  });

  it('leaves the new appointment unpaid, for the payment step to settle', async () => {
    const { patientId } = await seedDirectory();
    const result = await runBookingAgent({ patientId, query: 'cardiologist under ₹800' });

    const appointment: any = await confirmProposal(result.proposals[0].proposalId, patientId);

    // Confirming holds the slot; it does not take money. The UI hands straight to
    // PaymentProcessor, and this must never default to 'paid'.
    expect(appointment.paymentStatus).toBe('pending');
    expect(appointment.fee).toBe(result.proposals[0].fee);
  });

  it('consumes the proposal so the same one cannot book twice', async () => {
    const { patientId } = await seedDirectory();
    const result = await runBookingAgent({ patientId, query: 'cardiologist under ₹800' });
    const proposal = result.proposals[0];

    await confirmProposal(proposal.proposalId, patientId);

    await expect(confirmProposal(proposal.proposalId, patientId)).rejects.toThrow(/expired/i);
    expect(await Appointment.countDocuments({})).toBe(1);
  });

  it('refuses a proposal belonging to another patient', async () => {
    const { patientId } = await seedDirectory();
    const other = await User.create({
      email: 'intruder@test.com',
      password: 'SuperSecret123!',
      firstName: 'Not',
      lastName: 'You',
      role: 'patient',
    });
    const result = await runBookingAgent({ patientId, query: 'cardiologist under ₹800' });

    await expect(
      confirmProposal(result.proposals[0].proposalId, (other._id as Types.ObjectId).toString())
    ).rejects.toThrow(/different account/i);
    expect(await Appointment.countDocuments({})).toBe(0);
  });

  it('rejects an invented proposal id', async () => {
    const { patientId } = await seedDirectory();
    await expect(confirmProposal('made-up-id', patientId)).rejects.toThrow(/expired/i);
  });
});
