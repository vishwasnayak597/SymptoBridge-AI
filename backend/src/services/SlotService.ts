import mongoose from 'mongoose';
import { Appointment } from '../models/Appointment';

/**
 * Slot availability, computed once for many doctors and many days.
 *
 * The per-doctor-per-day route (`GET /appointments/availability/:doctorId/:date`) can
 * only answer "is Dr. X free on Tuesday". Answering "which cardiologist has anything
 * open this week" through it costs doctors x days round trips — 84 for a dozen doctors
 * over a week — which is why the UI makes patients pick a doctor before they can see a
 * calendar. `availabilityForDoctors` answers the whole question in ONE Mongo query, so
 * both the booking agent and the normal search can lead with open slots.
 *
 * Slot datetimes are built in UTC (`T09:00:00.000Z`), matching how bookings have always
 * been stored. Changing that here would silently shift every existing appointment.
 */

/** The bookable grid. Not per-doctor yet — kept as-is from the original route. */
export const TIME_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
  '17:00', '17:30', '18:00', '18:30',
];

const SLOT_MINUTES = 30;
const ACTIVE_STATUSES = ['scheduled', 'confirmed'];

/** doctorId -> 'YYYY-MM-DD' -> free slots ('09:30'). */
export type AvailabilityMap = Record<string, Record<string, string[]>>;

interface BusyBlock {
  start: number;
  end: number;
}

export function isValidDateString(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00.000Z`));
}

/** Inclusive list of 'YYYY-MM-DD' between two dates, capped so a wide range can't melt the server. */
export function dateRange(from: string, to: string, maxDays = 14): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end && out.length < maxDays) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function slotIsFree(date: string, slot: string, busy: BusyBlock[], now: number): boolean {
  const start = new Date(`${date}T${slot}:00.000Z`).getTime();
  if (start <= now) return false; // never offer a slot in the past
  const end = start + SLOT_MINUTES * 60000;
  return !busy.some((b) => start < b.end && end > b.start);
}

/**
 * Free slots for every (doctor, day) pair in the range — one query for all of them.
 * Days already past are returned as empty rather than omitted, so callers can rely on
 * the shape.
 */
export async function availabilityForDoctors(
  doctorIds: string[],
  from: string,
  to: string,
  maxDays = 14
): Promise<AvailabilityMap> {
  const days = dateRange(from, to, maxDays);
  const ids = doctorIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  const result: AvailabilityMap = {};
  if (ids.length === 0 || days.length === 0) return result;

  const rangeStart = new Date(`${days[0]}T00:00:00.000Z`);
  const rangeEnd = new Date(`${days[days.length - 1]}T23:59:59.999Z`);

  const booked = await Appointment.find({
    doctor: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
    appointmentDate: { $gte: rangeStart, $lte: rangeEnd },
    status: { $in: ACTIVE_STATUSES },
  })
    .select('doctor appointmentDate duration')
    .lean();

  // Bucket the booked blocks by doctor so each (doctor, day) check is local work.
  const busyByDoctor = new Map<string, BusyBlock[]>();
  for (const appt of booked) {
    const key = String(appt.doctor);
    const start = new Date(appt.appointmentDate).getTime();
    const block = { start, end: start + ((appt as any).duration || SLOT_MINUTES) * 60000 };
    const existing = busyByDoctor.get(key);
    if (existing) existing.push(block);
    else busyByDoctor.set(key, [block]);
  }

  const now = Date.now();
  for (const id of ids) {
    const busy = busyByDoctor.get(id) || [];
    result[id] = {};
    for (const day of days) {
      result[id][day] = TIME_SLOTS.filter((slot) => slotIsFree(day, slot, busy, now));
    }
  }
  return result;
}

/** Single doctor, single day — the shape the original availability route returns. */
export async function availabilityForDoctor(doctorId: string, date: string) {
  const map = await availabilityForDoctors([doctorId], date, date);
  const availableSlots = map[doctorId]?.[date] ?? [];
  return {
    date,
    doctorId,
    allSlots: TIME_SLOTS,
    availableSlots,
    bookedSlots: TIME_SLOTS.filter((s) => !availableSlots.includes(s)),
  };
}
