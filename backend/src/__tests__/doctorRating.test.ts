/**
 * Doctor rating aggregation.
 *
 * Patients could always rate a completed appointment, but the score was written only
 * onto the Appointment — User.rating / User.reviewCount, which the doctor list and
 * search ranking actually read, were never updated. So ratings were collected and
 * silently discarded, and every doctor rendered as unrated (the UI then papered over
 * it with a hardcoded 4.5). These tests pin the roll-up.
 */
import { Types } from 'mongoose';
import User from '../models/User';
import { Appointment } from '../models/Appointment';
import { AppointmentService } from '../services/AppointmentService';

async function createUsers() {
  const patient = await User.create({
    email: 'p@test.com',
    password: 'SuperSecret123!',
    firstName: 'Pat',
    lastName: 'Lee',
    role: 'patient',
  });
  const doctor = await User.create({
    email: 'd@test.com',
    password: 'SuperSecret123!',
    firstName: 'Dana',
    lastName: 'Wong',
    role: 'doctor',
    specialization: 'Cardiology',
  });
  // Mongoose types `_id` as unknown on the hydrated doc; the existing suite casts too.
  return {
    patient: patient._id as Types.ObjectId,
    doctor: doctor._id as Types.ObjectId,
  };
}

async function completedAppointment(
  patientId: Types.ObjectId,
  doctorId: Types.ObjectId,
  patientRating?: number,
  patientReview?: string
) {
  // The schema requires appointmentDate to be in the future, but a *completed*
  // appointment is necessarily in the past — so create it valid, then move it back
  // via updateOne, which skips document validators. Same approach as appointments.test.ts.
  const appointment = await Appointment.create({
    patient: patientId,
    doctor: doctorId,
    appointmentDate: new Date(Date.now() + 86400000),
    duration: 30,
    consultationType: 'video',
    status: 'scheduled',
    symptoms: 'chest pain',
    specialization: 'Cardiology',
    fee: 1200,
    paymentStatus: 'paid',
  });

  await Appointment.updateOne(
    { _id: appointment._id },
    {
      $set: {
        status: 'completed',
        appointmentDate: new Date(Date.now() - 86400000),
        ...(patientRating ? { rating: { patientRating, patientReview } } : {}),
      },
    }
  );

  return (await Appointment.findById(appointment._id))!;
}

describe('doctor rating aggregation', () => {
  it('leaves a doctor with no ratings as null rather than 0', async () => {
    const { doctor } = await createUsers();
    const result = await AppointmentService.recalculateDoctorRating(doctor);

    expect(result.rating).toBeNull();
    expect(result.reviewCount).toBe(0);

    const fresh = await User.findById(doctor).lean();
    expect(fresh!.rating).toBeNull();
  });

  it('averages patient ratings onto the doctor profile', async () => {
    const { patient, doctor } = await createUsers();
    await completedAppointment(patient, doctor, 5);
    await completedAppointment(patient, doctor, 4);
    await completedAppointment(patient, doctor, 3);

    const result = await AppointmentService.recalculateDoctorRating(doctor);
    expect(result.rating).toBe(4);
    expect(result.reviewCount).toBe(3);

    const fresh = await User.findById(doctor).lean();
    expect(fresh!.rating).toBe(4);
    expect(fresh!.reviewCount).toBe(3);
  });

  it('rounds to one decimal place', async () => {
    const { patient, doctor } = await createUsers();
    await completedAppointment(patient, doctor, 5);
    await completedAppointment(patient, doctor, 4);

    // 4.5 exactly
    expect((await AppointmentService.recalculateDoctorRating(doctor)).rating).toBe(4.5);

    await completedAppointment(patient, doctor, 5);
    // 14/3 = 4.666... -> 4.7
    expect((await AppointmentService.recalculateDoctorRating(doctor)).rating).toBe(4.7);
  });

  it('ignores unrated and non-completed appointments', async () => {
    const { patient, doctor } = await createUsers();
    await completedAppointment(patient, doctor, 5);
    await completedAppointment(patient, doctor); // completed, never rated

    const scheduled = await completedAppointment(patient, doctor, 1);
    await Appointment.updateOne({ _id: scheduled._id }, { $set: { status: 'scheduled' } });

    const result = await AppointmentService.recalculateDoctorRating(doctor);
    expect(result.reviewCount).toBe(1);
    expect(result.rating).toBe(5);
  });

  it('is idempotent — recomputes from source rather than incrementing', async () => {
    const { patient, doctor } = await createUsers();
    await completedAppointment(patient, doctor, 4);

    const first = await AppointmentService.recalculateDoctorRating(doctor);
    const second = await AppointmentService.recalculateDoctorRating(doctor);
    expect(second).toEqual(first);
    expect(second.reviewCount).toBe(1);
  });

  it('does not count one doctor\'s ratings toward another', async () => {
    const { patient, doctor } = await createUsers();
    const other = await User.create({
      email: 'd2@test.com',
      password: 'SuperSecret123!',
      firstName: 'Sam',
      lastName: 'Roy',
      role: 'doctor',
    });
    const otherId = other._id as Types.ObjectId;
    await completedAppointment(patient, doctor, 5);
    await completedAppointment(patient, otherId, 1);

    expect((await AppointmentService.recalculateDoctorRating(doctor)).rating).toBe(5);
    expect((await AppointmentService.recalculateDoctorRating(otherId)).rating).toBe(1);
  });
});

describe('doctor reviews listing', () => {
  it('returns reviews with the reviewer name abbreviated', async () => {
    const { patient, doctor } = await createUsers();
    await completedAppointment(patient, doctor, 5, 'Very thorough, explained everything.');

    const { reviews, total } = await AppointmentService.getDoctorReviews(
      doctor.toString()
    );

    expect(total).toBe(1);
    expect(reviews[0]).toMatchObject({
      rating: 5,
      review: 'Very thorough, explained everything.',
      patientName: 'Pat L.',
    });
    // full surname must not leak — reviews are public
    expect(JSON.stringify(reviews)).not.toContain('Lee');
  });

  it('excludes appointments with no rating', async () => {
    const { patient, doctor } = await createUsers();
    await completedAppointment(patient, doctor);

    const { reviews, total } = await AppointmentService.getDoctorReviews(
      doctor.toString()
    );
    expect(total).toBe(0);
    expect(reviews).toHaveLength(0);
  });
});
