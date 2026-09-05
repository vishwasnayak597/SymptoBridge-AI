/**
 * Backfill doctor aggregate ratings from existing appointment ratings.
 *
 * Patients have been able to rate completed appointments for a while, but
 * AppointmentService.addRating only wrote the score onto the Appointment — it never
 * rolled it up to User.rating / User.reviewCount, which is what the doctor list and
 * search ranking actually read. So every rating collected so far is sitting in the
 * appointments collection doing nothing, and every doctor shows as unrated.
 *
 * This recomputes each doctor's aggregate from their completed, rated appointments.
 * Safe to re-run: it recalculates from source rather than incrementing.
 *
 * Run:  npx tsx scripts/backfill-doctor-ratings.ts [--dry-run]
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/User';
import { Appointment } from '../src/models/Appointment';
import { AppointmentService } from '../src/services/AppointmentService';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set — add it to backend/.env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`connected${DRY_RUN ? '  (dry run — nothing will be written)' : ''}\n`);

  // Only doctors who actually have rated appointments need touching.
  const doctorIds: mongoose.Types.ObjectId[] = await Appointment.distinct('doctor', {
    status: 'completed',
    'rating.patientRating': { $gte: 1 },
  });

  console.log(`${doctorIds.length} doctors have at least one rated appointment\n`);

  let updated = 0;
  for (const id of doctorIds) {
    const doctor = await User.findById(id).select('firstName lastName rating reviewCount').lean();
    if (!doctor) continue;

    if (DRY_RUN) {
      const [agg] = await Appointment.aggregate([
        { $match: { doctor: id, status: 'completed', 'rating.patientRating': { $gte: 1 } } },
        { $group: { _id: null, average: { $avg: '$rating.patientRating' }, count: { $sum: 1 } } },
      ]);
      const next = agg ? Math.round(agg.average * 10) / 10 : null;
      console.log(
        `  Dr ${doctor.firstName} ${doctor.lastName}: ` +
          `${doctor.rating ?? '—'} (${doctor.reviewCount ?? 0}) -> ${next} (${agg?.count ?? 0})`
      );
      continue;
    }

    const { rating, reviewCount } = await AppointmentService.recalculateDoctorRating(id);
    updated++;
    console.log(
      `  Dr ${doctor.firstName} ${doctor.lastName}: ${rating} from ${reviewCount} ` +
        `${reviewCount === 1 ? 'review' : 'reviews'}`
    );
  }

  console.log(`\n${DRY_RUN ? 'would update' : 'updated'} ${DRY_RUN ? doctorIds.length : updated} doctors`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
