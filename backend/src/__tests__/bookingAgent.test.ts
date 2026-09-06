import { Types } from 'mongoose';
import User from '../models/User';
import { Appointment } from '../models/Appointment';
import { availabilityForDoctors, dateRange, TIME_SLOTS } from '../services/SlotService';
import { parseWithRules, slotMatches, editDistance } from '../services/BookingAgentService';

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

  // Regression: this exact sentence returned General Medicine doctors on a Sunday
  // morning, ignoring the speciality, both named days and the time of day.
  it('handles a misspelt speciality with day and time filters', () => {
    const c = parseWithRules('gastraentologist this week on friday saturday after 5pm');

    expect(c.specialization).toBe('Gastroenterology');
    expect(c.daysOfWeek).toEqual([5, 6]);
    expect(c.afterTime).toBe('17:00');
  });

  it('matches specialities on word-initial stems only', () => {
    // "gastraentologist" contains "ent" — it must not route to an ENT clinic.
    expect(parseWithRules('gastraentologist').specialization).toBe('Gastroenterology');
    expect(parseWithRules('cardialogist').specialization).toBe('Cardiology');
    expect(parseWithRules('ENT doctor').specialization).toBe('ENT (Ear, Nose & Throat)');
    expect(parseWithRules('sore throat').specialization).toBe('ENT (Ear, Nose & Throat)');
  });

  it('reads time-of-day phrasings', () => {
    expect(parseWithRules('doctor after 5pm').afterTime).toBe('17:00');
    expect(parseWithRules('doctor before 11 am').beforeTime).toBe('11:00');
    expect(parseWithRules('morning appointment').beforeTime).toBe('12:00');
    const afternoon = parseWithRules('afternoon appointment');
    expect(afternoon.afterTime).toBe('12:00');
    expect(afternoon.beforeTime).toBe('17:00');
    expect(parseWithRules('evening slot').afterTime).toBe('17:00');
  });

  it('widens the window so a named weekday actually exists in it', () => {
    const c = parseWithRules('dentist today on friday');
    expect(c.daysOfWeek).toEqual([5]);
    const from = new Date(`${c.from}T00:00:00.000Z`);
    const to = new Date(`${c.to}T00:00:00.000Z`);
    let hasFriday = false;
    for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() === 5) hasFriday = true;
    }
    expect(hasFriday).toBe(true);
  });
});

describe('typo tolerance', () => {
  // Patients type what they hear. Every one of these is a real misspelling shape:
  // dropped letter, doubled letter, transposition, phonetic guess.
  const cases: Array<[string, string]> = [
    ['cardologist', 'Cardiology'],
    ['cardiologyst', 'Cardiology'],
    ['nuerologist', 'Neurology'],
    ['neurologest', 'Neurology'],
    ['opthalmologist', 'Ophthalmology'],
    ['ophthamologist', 'Ophthalmology'],
    ['dermetologist', 'Dermatology'],
    ['dermatalogist', 'Dermatology'],
    ['gastraentologist', 'Gastroenterology'],
    ['gastroentrologist', 'Gastroenterology'],
    ['pediatrician', 'Pediatrics'],
    ['pedeatrician', 'Pediatrics'],
    ['psychiatrist', 'Psychiatry'],
    ['psychatrist', 'Psychiatry'],
    ['gynacologist', 'Gynecology'],
    ['orthapedic', 'Orthopedics'],
    ['ortopedic surgeon', 'Orthopedics'],
    ['urologyst', 'Urology'],
    ['stomac pain', 'Gastroenterology'],
    ['kidny problem', 'Urology'],
    ['teath pain', 'Dentistry'],
  ];

  it.each(cases)('reads %s as %s', (query, expected) => {
    expect(parseWithRules(query).specialization).toBe(expected);
  });

  it('records what it corrected so the patient can see it', () => {
    const c = parseWithRules('cardologist tomorrow');
    expect(c.specialization).toBe('Cardiology');
    expect(c.corrections?.[0]).toEqual({ from: 'cardologist', to: 'Cardiology' });
  });

  it('reads misspelled weekdays', () => {
    expect(parseWithRules('doctor on firday').daysOfWeek).toEqual([5]);
    expect(parseWithRules('doctor on saterday').daysOfWeek).toEqual([6]);
    expect(parseWithRules('doctor on wendsday').daysOfWeek).toEqual([3]);
  });

  // The dangerous direction: a wrong guess sends a patient to the wrong speciality,
  // which is worse than admitting we did not understand.
  it('refuses to guess from ordinary words', () => {
    expect(parseWithRules('i dont know what i need').specialization).toBeUndefined();
    expect(parseWithRules('please find me someone soon').specialization).toBeUndefined();
    expect(parseWithRules('appointment this week').specialization).toBeUndefined();
    expect(parseWithRules('any doctor available').specialization).toBeUndefined();
  });

  it('does not let a stomach complaint reach an ENT clinic', () => {
    // "gastraentologist" contains the letters "ent".
    expect(parseWithRules('gastraentologist').specialization).toBe('Gastroenterology');
  });
});

describe('editDistance', () => {
  it('counts a transposition as one edit, not two', () => {
    expect(editDistance('nuero', 'neuro')).toBe(1);
    expect(editDistance('firday', 'friday')).toBe(1);
  });

  it('counts insertions, deletions and substitutions', () => {
    expect(editDistance('card', 'cardi')).toBe(1);
    expect(editDistance('opthalm', 'ophthalm')).toBe(1);
    expect(editDistance('abc', 'abc')).toBe(0);
  });
});

describe('slotMatches', () => {
  // 2026-09-11 is a Friday, 2026-09-13 a Sunday.
  it('rejects a slot on a day that was not asked for', () => {
    const c = { ...parseWithRules('friday saturday'), from: '2026-09-11', to: '2026-09-13' };
    expect(slotMatches('2026-09-11', '17:00', c)).toBe(true);
    expect(slotMatches('2026-09-13', '17:00', c)).toBe(false);
  });

  it('rejects a slot outside the time window', () => {
    const c = parseWithRules('after 5pm');
    expect(slotMatches('2026-09-11', '09:00', c)).toBe(false);
    expect(slotMatches('2026-09-11', '17:00', c)).toBe(true);
    expect(slotMatches('2026-09-11', '18:30', c)).toBe(true);
  });

  it('treats beforeTime as exclusive', () => {
    const c = parseWithRules('before 11am');
    expect(slotMatches('2026-09-11', '10:30', c)).toBe(true);
    expect(slotMatches('2026-09-11', '11:00', c)).toBe(false);
  });

  it('accepts everything when no day or time was named', () => {
    const c = parseWithRules('any cardiologist');
    expect(slotMatches('2026-09-13', '09:00', c)).toBe(true);
  });
});
