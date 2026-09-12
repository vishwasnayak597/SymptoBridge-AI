import mongoose from 'mongoose';
import { Appointment } from '../models/Appointment';
import { CLINIC_TIMEZONE, clinicDayBounds, zonedToUtc } from '../utils/clinicTime';
import { WaitlistService } from './WaitlistService';

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
 * TIME: a slot label ("09:00") is wall-clock time at the clinic (CLINIC_TIMEZONE), and
 * `slotInstant` is the only way to turn one into a stored instant. This file used to
 * build `T09:00:00.000Z` — 09:00 UTC, i.e. 2:30 pm in India — while the manual booking
 * form built 09:00 in the browser's zone. The two disagreed by 5h30m, so a manual
 * booking never blocked the slot it was booked in. Every availability response now
 * carries each slot's instant, and clients book with that instant instead of
 * reconstructing one from the label.
 */

/** The bookable grid, in clinic wall-clock time. Not per-doctor yet. */
export const TIME_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
  '17:00', '17:30', '18:00', '18:30',
];

const SLOT_MINUTES = 30;
const ACTIVE_STATUSES = ['scheduled', 'confirmed'];

/** doctorId -> 'YYYY-MM-DD' -> free slots ('09:30'), both on the clinic's calendar. */
export type AvailabilityMap = Record<string, Record<string, string[]>>;

/** A bookable slot as the client should use it: label for display, instant for booking. */
export interface SlotView {
  time: string;
  iso: string;
}

interface BusyBlock {
  start: number;
  end: number;
}

/** The instant a clinic slot starts. The single label -> instant conversion. */
export function slotInstant(date: string, time: string): Date {
  return zonedToUtc(date, time, CLINIC_TIMEZONE);
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
  const start = slotInstant(date, slot).getTime();
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

  // Clinic days, not UTC days: the 09:00 IST slot on the 14th is 03:30Z on the 14th,
  // but a 00:30 IST booking on the 14th is 19:00Z on the 13th.
  const rangeStart = clinicDayBounds(days[0]).start;
  const rangeEnd = clinicDayBounds(days[days.length - 1]).end;

  const booked = await Appointment.find({
    doctor: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
    appointmentDate: { $gte: rangeStart, $lt: rangeEnd },
    status: { $in: ACTIVE_STATUSES },
  })
    .select('doctor appointmentDate duration')
    .lean();

  // A slot held for a waitlisted patient is taken for everyone else until the hold
  // lapses — otherwise the offer is just a notification anyone can race.
  const holds = await WaitlistService.activeHolds(ids, rangeStart, rangeEnd);

  // Bucket the booked blocks by doctor so each (doctor, day) check is local work.
  const busyByDoctor = new Map<string, BusyBlock[]>();
  const addBusy = (doctorId: string, block: BusyBlock) => {
    const existing = busyByDoctor.get(doctorId);
    if (existing) existing.push(block);
    else busyByDoctor.set(doctorId, [block]);
  };
  for (const appt of booked) {
    const start = new Date(appt.appointmentDate).getTime();
    addBusy(String(appt.doctor), { start, end: start + ((appt as any).duration || SLOT_MINUTES) * 60000 });
  }
  for (const hold of holds) {
    const start = new Date(hold.offeredSlot as Date).getTime();
    addBusy(String(hold.doctor), { start, end: start + SLOT_MINUTES * 60000 });
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

/** Single doctor, single day — the shape the original availability route returns, plus instants. */
export async function availabilityForDoctor(doctorId: string, date: string) {
  const map = await availabilityForDoctors([doctorId], date, date);
  const availableSlots = map[doctorId]?.[date] ?? [];
  const slots: SlotView[] = availableSlots.map((time) => ({
    time,
    iso: slotInstant(date, time).toISOString(),
  }));
  // The whole day, taken slots included, each with its instant — so a viewer outside
  // India sees booked slots at their own local time too, and the client never needs
  // its own copy of the grid (the form's copy had drifted: it stopped at 17:30).
  const grid = TIME_SLOTS.map((time) => ({
    time,
    iso: slotInstant(date, time).toISOString(),
    available: availableSlots.includes(time),
  }));
  return {
    date,
    doctorId,
    timeZone: CLINIC_TIMEZONE,
    allSlots: TIME_SLOTS,
    availableSlots,
    slots,
    grid,
    bookedSlots: TIME_SLOTS.filter((s) => !availableSlots.includes(s)),
  };
}
