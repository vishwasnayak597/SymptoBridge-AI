import { Types } from 'mongoose';
import User from '../models/User';
import { Appointment } from '../models/Appointment';
import {
  zonedToUtc,
  clinicDateKey,
  clinicTimeLabel,
  clinicDayBounds,
  addDaysToKey,
  weekdayOfKey,
} from '../utils/clinicTime';
import { availabilityForDoctors, availabilityForDoctor, slotInstant } from '../services/SlotService';

describe('clinicTime (Asia/Kolkata)', () => {
  it('reads a slot label as clinic wall-clock time, not UTC', () => {
    // 09:00 in India is 03:30 UTC. The old code stored 09:00 UTC (2:30 pm IST).
    expect(zonedToUtc('2026-09-14', '09:00', 'Asia/Kolkata').toISOString()).toBe('2026-09-14T03:30:00.000Z');
    expect(zonedToUtc('2026-09-14', '18:30', 'Asia/Kolkata').toISOString()).toBe('2026-09-14T13:00:00.000Z');
  });

  it('crosses into the previous UTC day for early-morning clinic times', () => {
    expect(zonedToUtc('2026-09-14', '02:00', 'Asia/Kolkata').toISOString()).toBe('2026-09-13T20:30:00.000Z');
  });

  it('round-trips instants back to clinic date and time labels', () => {
    const instant = new Date('2026-09-13T20:30:00.000Z');
    expect(clinicDateKey(instant, 'Asia/Kolkata')).toBe('2026-09-14');
    expect(clinicTimeLabel(instant, 'Asia/Kolkata')).toBe('02:00');
  });

  it('bounds a clinic day by local midnights', () => {
    const { start, end } = clinicDayBounds('2026-09-14', 'Asia/Kolkata');
    expect(start.toISOString()).toBe('2026-09-13T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-09-14T18:30:00.000Z');
  });

  it('handles a DST zone across the spring-forward transition', () => {
    // New York, 8 Mar 2026: 02:00 jumps to 03:00. EST is UTC-5, EDT is UTC-4.
    expect(zonedToUtc('2026-03-07', '09:00', 'America/New_York').toISOString()).toBe('2026-03-07T14:00:00.000Z');
    expect(zonedToUtc('2026-03-09', '09:00', 'America/New_York').toISOString()).toBe('2026-03-09T13:00:00.000Z');
  });

  it('does calendar arithmetic on date keys', () => {
    expect(addDaysToKey('2026-09-30', 1)).toBe('2026-10-01');
    expect(weekdayOfKey('2026-09-11')).toBe(5); // a Friday
  });
});

describe('availability agrees with bookings made at clinic time', () => {
  function futureDate(daysAhead = 3): string {
    return addDaysToKey(clinicDateKey(new Date()), daysAhead);
  }

  async function doctorAndPatient() {
    const doctor = await User.create({
      email: 'tzdoc@test.com', password: 'SuperSecret123!', firstName: 'Tz', lastName: 'Doc',
      role: 'doctor', specialization: 'Cardiology', licenseNumber: 'LIC-TZ',
    });
    const patient = await User.create({
      email: 'tzpatient@test.com', password: 'SuperSecret123!', firstName: 'Tz', lastName: 'Pat', role: 'patient',
    });
    return {
      doctorId: (doctor._id as Types.ObjectId).toString(),
      patientId: patient._id as Types.ObjectId,
    };
  }

  // Regression: the manual booking form stored "9:00 AM" as 9 am IST (03:30Z) while
  // availability checked 09:00Z, so the booked slot kept showing as free.
  it('marks the 09:00 slot taken when someone booked 9 am IST', async () => {
    const { doctorId, patientId } = await doctorAndPatient();
    const date = futureDate();

    await Appointment.create({
      patient: patientId,
      doctor: new Types.ObjectId(doctorId),
      appointmentDate: new Date(`${date}T03:30:00.000Z`), // 9:00 am IST
      duration: 30, consultationType: 'video', symptoms: 'Checkup',
      specialization: 'Cardiology', fee: 500, status: 'scheduled',
    });

    const map = await availabilityForDoctors([doctorId], date, date);
    expect(map[doctorId][date]).not.toContain('09:00');
    expect(map[doctorId][date]).toContain('09:30');
  });

  it('returns each free slot with the instant to book it at', async () => {
    const { doctorId } = await doctorAndPatient();
    const date = futureDate();

    const day = await availabilityForDoctor(doctorId, date);

    expect(day.timeZone).toBe('Asia/Kolkata');
    const nine = day.slots.find((s) => s.time === '09:00');
    expect(nine?.iso).toBe(slotInstant(date, '09:00').toISOString());
    expect(nine?.iso).toBe(`${date}T03:30:00.000Z`);
  });
});
