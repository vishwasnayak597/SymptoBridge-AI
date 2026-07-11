import { Types } from 'mongoose';
import User from '../models/User';
import { Appointment } from '../models/Appointment';
import { AppointmentService } from '../services/AppointmentService';
import { VideoCallService } from '../services/VideoCallService';

async function createUsers() {
  const patientDoc = await User.create({
    email: 'patient@test.com',
    password: 'SuperSecret123!',
    firstName: 'Pat',
    lastName: 'Lee',
    role: 'patient',
  });
  const doctorDoc = await User.create({
    email: 'doctor@test.com',
    password: 'SuperSecret123!',
    firstName: 'Dana',
    lastName: 'Wong',
    role: 'doctor',
    specialization: 'Cardiology',
    licenseNumber: 'LIC-123',
  });
  return {
    patientDoc,
    doctorDoc,
    patientId: patientDoc._id as Types.ObjectId,
    doctorId: doctorDoc._id as Types.ObjectId,
  };
}

function appointmentFixture(patientId: Types.ObjectId, doctorId: Types.ObjectId) {
  return {
    patient: patientId,
    doctor: doctorId,
    appointmentDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    duration: 30,
    consultationType: 'video',
    symptoms: 'Chest pain and shortness of breath',
    specialization: 'Cardiology',
    fee: 1500,
  };
}

describe('User model', () => {
  it('exposes the fullName virtual in JSON output', async () => {
    const { patientDoc } = await createUsers();
    const json = patientDoc.toJSON() as any;
    expect(json.fullName).toBe('Pat Lee');
  });
});

describe('AppointmentService.addRating', () => {
  it('rejects rating an appointment that is not completed', async () => {
    const { patientDoc, doctorDoc, patientId, doctorId } = await createUsers();
    const appointment = await Appointment.create(appointmentFixture(patientId, doctorId));

    await expect(
      AppointmentService.addRating(
        appointment._id.toString(),
        { rating: 5, review: 'great' },
        patientDoc._id.toString()
      )
    ).rejects.toThrow(/completed/i);
  });

  it('stores the patient rating on a completed appointment', async () => {
    const { patientDoc, doctorDoc, patientId, doctorId } = await createUsers();
    const appointment = await Appointment.create(appointmentFixture(patientId, doctorId));
    await Appointment.updateOne({ _id: appointment._id }, { $set: { status: 'completed' } });

    await AppointmentService.addRating(
      appointment._id.toString(),
      { rating: 4, review: 'helpful' },
      patientDoc._id.toString()
    );

    const saved = await Appointment.findById(appointment._id);
    expect(saved!.rating?.patientRating).toBe(4);
    expect(saved!.rating?.patientReview).toBe('helpful');
  });

  it('refuses access for a user who is not on the appointment', async () => {
    const { patientDoc, doctorDoc, patientId, doctorId } = await createUsers();
    const appointment = await Appointment.create(appointmentFixture(patientId, doctorId));
    const stranger = new Types.ObjectId().toString();

    await expect(
      AppointmentService.addRating(appointment._id.toString(), { rating: 1 }, stranger)
    ).rejects.toThrow();
  });
});

describe('VideoCallService.getActiveCallForPatient (ring window)', () => {
  it('rings for a call the doctor started just now', async () => {
    const { patientDoc, doctorDoc, patientId, doctorId } = await createUsers();
    await Appointment.create({
      ...appointmentFixture(patientId, doctorId),
      status: 'confirmed',
      videoCallId: 'call-123',
      videoCallUrl: 'https://example.com/call-123',
    });

    const active = await VideoCallService.getActiveCallForPatient(patientDoc._id.toString());
    expect(active).not.toBeNull();
    expect(active.callId).toBe('call-123');
  });

  it('does NOT ring for a stale call from hours ago (regression: ringing forever)', async () => {
    const { patientDoc, doctorDoc, patientId, doctorId } = await createUsers();
    const appointment = await Appointment.create({
      ...appointmentFixture(patientId, doctorId),
      status: 'confirmed',
      videoCallId: 'call-old',
    });

    // Backdate updatedAt past the 60-minute ring window, bypassing
    // mongoose timestamps via the raw collection.
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await Appointment.collection.updateOne(
      { _id: appointment._id },
      { $set: { updatedAt: twoHoursAgo } }
    );

    const active = await VideoCallService.getActiveCallForPatient(patientDoc._id.toString());
    expect(active).toBeNull();
  });
});
