import { Types } from 'mongoose';
import User from '../models/User';
import { Appointment } from '../models/Appointment';
import { availabilityForDoctors, dateRange, TIME_SLOTS } from '../services/SlotService';
import { parseWithRules } from '../services/BookingAgentService';

/** A future day that is safely not today, so "past slot" filtering never interferes. */
function futureDate(daysAhead = 3): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

async function createDoctors(count: number) {
  const docs = [];
  for (let i = 0; i < count; i++) {
    docs.push(
      await User.create({
        email: `slotdoc${i}@test.com`,
        password: 'SuperSecret123!',
        firstName: 'Doc',
        lastName: `Number${i}`,
        role: 'doctor',
        specialization: 'Cardiology',
        licenseNumber: `LIC-SLOT-${i}`,
        consultationFee: 500 + i * 100,
      })
    );
  }
  return docs.map((d) => (d._id as Types.ObjectId).toString());
}

describe('SlotService.availabilityForDoctors', () => {
  it('returns the full grid for doctors with no bookings', async () => {
    const [doctorId] = await createDoctors(1);
    const date = futureDate();

    const map = await availabilityForDoctors([doctorId], date, date);

    expect(map[doctorId][date]).toEqual(TIME_SLOTS);
  });

  it('removes a slot that is already booked, and only for that doctor', async () => {
    const [busyDoctor, freeDoctor] = await createDoctors(2);
    const patient = await User.create({
      email: 'slotpatient@test.com',
      password: 'SuperSecret123!',
      firstName: 'Pat',
      lastName: 'Lee',
      role: 'patient',
    });
    const date = futureDate();

    await Appointment.create({
      patient: patient._id,
      doctor: new Types.ObjectId(busyDoctor),
      appointmentDate: new Date(`${date}T10:00:00.000Z`),
      duration: 30,
      consultationType: 'video',
      symptoms: 'Chest pain',
      specialization: 'Cardiology',
      fee: 500,
      status: 'scheduled',
    });

    const map = await availabilityForDoctors([busyDoctor, freeDoctor], date, date);

    expect(map[busyDoctor][date]).not.toContain('10:00');
    expect(map[busyDoctor][date]).toContain('10:30');
    // The other doctor's calendar must be untouched — the batch query buckets by doctor.
    expect(map[freeDoctor][date]).toContain('10:00');
  });

  it('covers a multi-day range for several doctors in one call', async () => {
    const doctorIds = await createDoctors(3);
    const from = futureDate(2);
    const to = futureDate(4);

    const map = await availabilityForDoctors(doctorIds, from, to);

    expect(Object.keys(map)).toHaveLength(3);
    for (const id of doctorIds) {
      expect(Object.keys(map[id])).toEqual(dateRange(from, to));
    }
  });

  it('ignores cancelled appointments when computing free slots', async () => {
    const [doctorId] = await createDoctors(1);
    const patient = await User.create({
      email: 'slotpatient2@test.com',
      password: 'SuperSecret123!',
      firstName: 'Pat',
      lastName: 'Lee',
      role: 'patient',
    });
    const date = futureDate();

    await Appointment.create({
      patient: patient._id,
      doctor: new Types.ObjectId(doctorId),
      appointmentDate: new Date(`${date}T11:00:00.000Z`),
      duration: 30,
      consultationType: 'video',
      symptoms: 'Follow up',
      specialization: 'Cardiology',
      fee: 500,
      status: 'cancelled',
    });

    const map = await availabilityForDoctors([doctorId], date, date);

    expect(map[doctorId][date]).toContain('11:00');
  });

  it('rejects invalid ids without throwing', async () => {
    const map = await availabilityForDoctors(['not-an-object-id'], futureDate(), futureDate());
    expect(map).toEqual({});
  });
});

describe('dateRange', () => {
  it('is inclusive of both ends', () => {
    expect(dateRange('2026-01-01', '2026-01-03')).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
  });

  it('caps long ranges so a wide request cannot fan out unbounded', () => {
    expect(dateRange('2026-01-01', '2026-12-31')).toHaveLength(14);
  });
});

describe('parseWithRules', () => {
  it('extracts speciality and fee from a plain request', () => {
    const c = parseWithRules('find a cardiologist this week under ₹800');
    expect(c.specialization).toBe('Cardiology');
    expect(c.maxFee).toBe(800);
  });

  it('reads fee phrasings without a currency symbol', () => {
    expect(parseWithRules('dermatologist below rs 1200').maxFee).toBe(1200);
    expect(parseWithRules('skin doctor, max 650').maxFee).toBe(650);
  });

  it('maps lay terms to specialities', () => {
    expect(parseWithRules('my child has a fever').specialization).toBe('Pediatrics');
    expect(parseWithRules('bad rash on my arm').specialization).toBe('Dermatology');
  });

  it('narrows the window for "today" and flags urgency', () => {
    const c = parseWithRules('earliest possible appointment today');
    expect(c.from).toBe(c.to);
    expect(c.preferSoonest).toBe(true);
  });

  it('reads a minimum rating', () => {
    expect(parseWithRules('paediatrician tomorrow, 4 star or better').minRating).toBe(4);
  });

  it('leaves constraints unset rather than guessing', () => {
    const c = parseWithRules('I need to see someone');
    expect(c.specialization).toBeUndefined();
    expect(c.maxFee).toBeUndefined();
  });
});
