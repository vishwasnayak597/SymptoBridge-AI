/**
 * Demo data seeder (idempotent).
 *
 *  - Test accounts: patient@test.com / doctor@test.com / admin@test.com  (password Test@1234)
 *  - Doctors across Bangalore, Udupi and Mangalore covering every specialization,
 *    each with GeoJSON coordinates so nearest-doctor search works.
 *  - Rich transactional data for the two test accounts (appointments, records,
 *    prescriptions, reports) so the dashboards look alive.
 *
 * Users are upserted by email; all seeded transactional docs are tagged { seed: true }
 * and cleared before re-inserting, so this is safe to run repeatedly.
 *
 * Usage:  cd backend && node scripts/seed.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set (backend/.env).');
  process.exit(1);
}

const TEST_PASSWORD = 'Test@1234';
const User = mongoose.model('User', new mongoose.Schema({}, { strict: false, timestamps: true }));

// ---- reference data -------------------------------------------------------

const SPECIALIZATIONS = {
  'General Medicine': 500,
  Cardiology: 1200,
  Dermatology: 800,
  Pediatrics: 700,
  Orthopedics: 1000,
  Psychiatry: 900,
  Radiology: 1100,
  Surgery: 1500,
  Gynecology: 800,
  Neurology: 1300,
  Urology: 1000,
  Dentistry: 600,
  Ophthalmology: 900,
  'ENT (Ear, Nose & Throat)': 700,
  Oncology: 1500,
  Gastroenterology: 1200,
};

// GeoJSON coordinates are [longitude, latitude].
const CITIES = {
  Bangalore: { geo: [77.5946, 12.9716], state: 'Karnataka', areas: ['MG Road', 'Indiranagar', 'Koramangala', 'Whitefield', 'Jayanagar'] },
  Udupi: { geo: [74.7421, 13.3409], state: 'Karnataka', areas: ['Car Street', 'Malpe Road', 'Manipal', 'Kunjibettu'] },
  Mangalore: { geo: [74.856, 12.9141], state: 'Karnataka', areas: ['Hampankatta', 'Kadri', 'Bejai', 'Kankanady'] },
};

const FIRST_NAMES = ['Arjun', 'Priya', 'Rahul', 'Deepa', 'Vikram', 'Ananya', 'Suresh', 'Kavya', 'Rohan', 'Meera',
  'Aditya', 'Sneha', 'Karthik', 'Divya', 'Naveen', 'Pooja', 'Sanjay', 'Anita', 'Gopal', 'Lakshmi',
  'Manoj', 'Rekha', 'Vivek', 'Shreya', 'Prakash', 'Nisha', 'Ganesh', 'Swathi', 'Harish', 'Chaitra',
  'Ramesh', 'Vidya', 'Kiran', 'Asha', 'Sandeep', 'Bhavya', 'Mahesh', 'Preethi', 'Nikhil', 'Roshni',
  'Vishal', 'Sahana', 'Girish', 'Nandini', 'Anil', 'Trisha', 'Dinesh', 'Aishwarya'];
const LAST_NAMES = ['Rao', 'Nayak', 'Shetty', 'Kamath', 'Bhat', 'Pai', 'Hegde', 'Kumar', 'Reddy', 'Menon',
  'Iyer', 'Prabhu', 'Acharya', 'Kulkarni', 'Shenoy', 'Bangera', 'Poojary', 'Salian', 'Rai', 'Ballal'];

const now = new Date();
const jitter = () => (Math.random() - 0.5) * 0.05; // ~±2.5 km
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const slug = (s) => s.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
const atTime = (daysFromNow, hour, minute = 0) => {
  const d = new Date(now);
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d;
};
const dayThisMonth = (day, hour) => new Date(now.getFullYear(), now.getMonth(), day, hour, 0, 0, 0);

const weekdayAvailability = [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek, startTime: '09:00', endTime: '17:00', isAvailable: true,
}));

async function upsertUser(data) {
  const password = await bcrypt.hash(TEST_PASSWORD, 12);
  return User.findOneAndUpdate(
    { email: data.email.toLowerCase() },
    { $set: { ...data, email: data.email.toLowerCase(), password } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

function buildDoctor(city, spec, index) {
  const first = FIRST_NAMES[index % FIRST_NAMES.length];
  const last = LAST_NAMES[(index * 3 + 1) % LAST_NAMES.length];
  const cityInfo = CITIES[city];
  const [lng, lat] = cityInfo.geo;
  const area = cityInfo.areas[index % cityInfo.areas.length];
  return {
    email: `${slug(city)}.${slug(spec)}@aidoc.in`,
    firstName: first,
    lastName: last,
    phone: `+9198${rand(10000000, 99999999)}`,
    role: 'doctor',
    isActive: true,
    isEmailVerified: true,
    isVerified: true,
    specialization: spec,
    licenseNumber: `KA-${slug(city).toUpperCase()}-${1000 + index}`,
    experience: rand(4, 28),
    qualifications: ['MBBS', spec === 'General Medicine' ? 'MD (General Medicine)' : `MD (${spec.split(' ')[0]})`],
    consultationFee: SPECIALIZATIONS[spec],
    rating: Math.round((3.8 + Math.random() * 1.2) * 10) / 10,
    reviewCount: rand(15, 220),
    bio: `${spec} specialist practicing in ${city}. Committed to patient-centred, evidence-based care.`,
    availability: weekdayAvailability,
    location: {
      address: `${rand(1, 400)}, ${area}`,
      city,
      state: cityInfo.state,
      zipCode: '',
      coordinates: { latitude: lat, longitude: lng },
      geo: { type: 'Point', coordinates: [lng + jitter(), lat + jitter()] },
    },
  };
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB\n');
  const db = mongoose.connection.db;

  // ---- 1. test accounts ----
  const patient = await upsertUser({
    email: 'patient@test.com', firstName: 'Test', lastName: 'Patient', phone: '+919876543210',
    role: 'patient', isActive: true, isEmailVerified: true,
    dateOfBirth: new Date('1992-04-15'), gender: 'male', bloodGroup: 'O+',
  });
  const doctor = await upsertUser({
    email: 'doctor@test.com', firstName: 'Sarah', lastName: 'Wilson', phone: '+919876543211',
    role: 'doctor', isActive: true, isEmailVerified: true, isVerified: true,
    specialization: 'Cardiology', licenseNumber: 'KA-BLR-0001', experience: 12,
    qualifications: ['MBBS', 'MD (Cardiology)'], consultationFee: 1200, rating: 4.8, reviewCount: 156,
    bio: 'Experienced cardiologist (demo account).', availability: weekdayAvailability,
    location: {
      address: '12 MG Road', city: 'Bangalore', state: 'Karnataka', zipCode: '560001',
      coordinates: { latitude: 12.9716, longitude: 77.5946 },
      geo: { type: 'Point', coordinates: [77.5946 + jitter(), 12.9716 + jitter()] },
    },
  });
  await upsertUser({
    email: 'admin@test.com', firstName: 'Admin', lastName: 'User', phone: '+919876543212',
    role: 'admin', isActive: true, isEmailVerified: true,
    permissions: ['manage_users', 'manage_doctors', 'view_reports'],
  });
  console.log('Test accounts ready (patient@ / doctor@ / admin@test.com)');

  // ---- 2. city doctors across all specializations ----
  const specs = Object.keys(SPECIALIZATIONS);
  const cityDoctors = [];
  let i = 0;
  for (const city of Object.keys(CITIES)) {
    for (const spec of specs) {
      cityDoctors.push(await upsertUser(buildDoctor(city, spec, i)));
      i++;
    }
  }
  console.log(`Seeded ${cityDoctors.length} doctors across ${Object.keys(CITIES).join(', ')} (all ${specs.length} departments each)`);

  // ---- 3. extra patients (so doctor@test.com has several patients) ----
  const extraPatients = [
    { firstName: 'John', lastName: 'Davis', email: 'john.davis@test.com' },
    { firstName: 'Meera', lastName: 'Nair', email: 'meera.nair@test.com' },
    { firstName: 'Carlos', lastName: 'Lopez', email: 'carlos.lopez@test.com' },
    { firstName: 'Aisha', lastName: 'Khan', email: 'aisha.khan@test.com' },
  ];
  const patients = [patient];
  for (const p of extraPatients) {
    patients.push(await upsertUser({ ...p, phone: '+919800000000', role: 'patient', isActive: true, isEmailVerified: true }));
  }

  // ---- 4. clear previously seeded transactional data ----
  console.log('\nClearing previous seeded transactional data...');
  for (const c of ['appointments', 'medicalrecords', 'prescriptions', 'reports']) {
    const res = await db.collection(c).deleteMany({ seed: true });
    if (res.deletedCount) console.log(`  removed ${res.deletedCount} from ${c}`);
  }

  // ---- 5. appointments for doctor@test.com (drives Overview stats) ----
  const mkAppt = (patientDoc, doctorDoc, date, status, type, paymentStatus, rating) => ({
    seed: true,
    patient: patientDoc._id,
    doctor: doctorDoc._id,
    appointmentDate: date,
    duration: 30,
    consultationType: type,
    status,
    symptoms: 'Chest discomfort and fatigue over the past few days.',
    specialization: doctorDoc.specialization || 'General Medicine',
    fee: doctorDoc.consultationFee || 800,
    paymentStatus,
    ...(rating ? { rating: { patientRating: rating, patientReview: 'Very helpful consultation.' } } : {}),
    createdAt: now, updatedAt: now,
  });

  const doctorAppts = [
    mkAppt(patient, doctor, atTime(0, 10), 'confirmed', 'video', 'paid'),
    mkAppt(patients[1], doctor, atTime(0, 14, 30), 'scheduled', 'in-person', 'paid'),
    mkAppt(patients[2], doctor, atTime(1, 11), 'confirmed', 'video', 'paid'),
    mkAppt(patients[3], doctor, atTime(3, 15), 'scheduled', 'phone', 'pending'),
    mkAppt(patient, doctor, dayThisMonth(2, 9), 'completed', 'video', 'paid', 5),
    mkAppt(patients[1], doctor, dayThisMonth(4, 11), 'completed', 'in-person', 'paid', 4),
    mkAppt(patients[2], doctor, dayThisMonth(6, 16), 'completed', 'video', 'paid', 5),
    mkAppt(patients[4], doctor, dayThisMonth(8, 10), 'completed', 'phone', 'paid', 4),
    mkAppt(patients[3], doctor, dayThisMonth(11, 13), 'completed', 'video', 'paid', 5),
  ];

  // ---- 6. patient@test.com also visits a few city doctors (variety) ----
  const pick = (spec, city) =>
    cityDoctors.find((d) => d.specialization === spec && d.location?.city === city);
  const derma = pick('Dermatology', 'Bangalore');
  const ortho = pick('Orthopedics', 'Udupi');
  const patientVisits = [
    ...(derma ? [mkAppt(patient, derma, dayThisMonth(5, 12), 'completed', 'in-person', 'paid', 5)] : []),
    ...(ortho ? [mkAppt(patient, ortho, atTime(2, 10), 'confirmed', 'video', 'paid')] : []),
  ];

  const allAppts = [...doctorAppts, ...patientVisits];
  const apptRes = await db.collection('appointments').insertMany(allAppts);
  const apptIds = Object.values(apptRes.insertedIds);
  console.log(`Inserted ${apptIds.length} appointments`);

  // ---- 7. records / prescriptions / reports for the test patient ----
  const records = [
    {
      seed: true, patient: patient._id, doctor: doctor._id, appointment: apptIds[4],
      type: 'consultation', date: dayThisMonth(2, 9), diagnosis: 'Mild hypertension',
      symptoms: ['Headache', 'Fatigue'], treatment: 'Lifestyle changes, low-sodium diet, review in 4 weeks.',
      notes: 'BP slightly elevated; advised home monitoring.', followUpRequired: true, followUpDate: atTime(20, 10),
      vitals: { bloodPressure: '138/88', heartRate: 78, temperature: 36.7, weight: 74, height: 175 },
      createdAt: now, updatedAt: now,
    },
    {
      seed: true, patient: patient._id, doctor: doctor._id, appointment: apptIds[7] || apptIds[4],
      type: 'follow_up', date: dayThisMonth(8, 10), diagnosis: 'Hypertension - controlled',
      symptoms: ['None'], treatment: 'Continue current management.', notes: 'BP improved.', followUpRequired: false,
      vitals: { bloodPressure: '124/80', heartRate: 72, temperature: 36.6, weight: 73, height: 175 },
      createdAt: now, updatedAt: now,
    },
    ...(derma ? [{
      seed: true, patient: patient._id, doctor: derma._id, type: 'consultation', date: dayThisMonth(5, 12),
      diagnosis: 'Contact dermatitis', symptoms: ['Rash', 'Itching'], treatment: 'Topical steroid cream, avoid irritant.',
      notes: 'Patch on forearm.', followUpRequired: false, createdAt: now, updatedAt: now,
    }] : []),
  ];
  await db.collection('medicalrecords').insertMany(records);

  const stamp = Date.now();
  const prescriptions = [
    {
      seed: true, patient: patient._id, doctor: doctor._id, appointment: apptIds[4],
      prescriptionNumber: `RXSEED${stamp}1`, date: dayThisMonth(2, 9),
      medications: [
        { name: 'Amlodipine', dosage: '5mg', frequency: 'Once daily', duration: '30 days', instructions: 'Take in the morning.' },
        { name: 'Aspirin', dosage: '75mg', frequency: 'Once daily', duration: 'Ongoing', instructions: 'Take with food.' },
      ],
      generalInstructions: 'Monitor blood pressure twice weekly.', validTill: atTime(30, 0), status: 'active',
      createdAt: now, updatedAt: now,
    },
    {
      seed: true, patient: patient._id, doctor: doctor._id, appointment: apptIds[7] || apptIds[4],
      prescriptionNumber: `RXSEED${stamp}2`, date: dayThisMonth(8, 10),
      medications: [{ name: 'Atorvastatin', dosage: '10mg', frequency: 'Once at night', duration: '30 days', instructions: 'Take after dinner.' }],
      generalInstructions: 'Recheck lipid profile in 6 weeks.', validTill: atTime(30, 0), status: 'active',
      createdAt: now, updatedAt: now,
    },
  ];
  await db.collection('prescriptions').insertMany(prescriptions);

  const reports = [
    {
      seed: true, patient: patient._id, uploadedBy: patient._id, doctor: doctor._id,
      title: 'Lipid Profile - Blood Test', type: 'blood_test', description: 'Routine lipid panel.',
      fileName: 'lipid_profile.pdf', filePath: 'uploads/seed/lipid_profile.pdf', fileSize: 1024 * 220,
      mimeType: 'application/pdf', uploadDate: dayThisMonth(3, 12), reportDate: dayThisMonth(3, 0),
      status: 'reviewed', isSharedWithDoctor: true, createdAt: now, updatedAt: now,
    },
    {
      seed: true, patient: patient._id, uploadedBy: patient._id, doctor: doctor._id,
      title: 'ECG Report', type: 'other', description: 'Resting 12-lead ECG.',
      fileName: 'ecg.pdf', filePath: 'uploads/seed/ecg.pdf', fileSize: 1024 * 180,
      mimeType: 'application/pdf', uploadDate: dayThisMonth(2, 10), reportDate: dayThisMonth(2, 0),
      status: 'reviewed', isSharedWithDoctor: true, createdAt: now, updatedAt: now,
    },
  ];
  await db.collection('reports').insertMany(reports);

  console.log(`Inserted ${records.length} records, ${prescriptions.length} prescriptions, ${reports.length} reports for patient@test.com`);
  console.log('\nDone. All seeded accounts use password:', TEST_PASSWORD);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => { console.error('Seed failed:', e); process.exit(1); });
