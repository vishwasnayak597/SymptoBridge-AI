/**
 * Clinic time: the ONE place a slot label becomes an instant.
 *
 * A slot label like "09:00" is wall-clock time at the clinic — clinics open at 9 am
 * local time, not 9 am UTC. Instants are stored in UTC. Every conversion between the
 * two goes through this module, and it runs on the server only: a browser converting
 * labels itself uses ITS timezone, which is how the manual booking form and the
 * availability engine came to disagree by 5h30m about what "09:00" meant.
 *
 * Built on Intl (full ICU ships with Node), so there is no timezone library to keep
 * in sync with tz database updates beyond Node itself.
 */

/** The clinics' timezone. Every doctor on the platform is in India today. */
export const CLINIC_TIMEZONE = process.env.CLINIC_TIMEZONE || 'Asia/Kolkata';

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      // h23, not hour12:false — some ICU builds render midnight as "24" otherwise.
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

/** The wall-clock fields of an instant, as seen in `timeZone`. */
function wallClock(instant: Date, timeZone: string) {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** How far `timeZone` is ahead of UTC at `instant`, in milliseconds. */
function offsetMs(instant: Date, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which it is `time` on `date` in `timeZone`.
 *   zonedToUtc('2026-09-14', '09:00', 'Asia/Kolkata') -> 2026-09-14T03:30:00.000Z
 *
 * Two passes, because the offset depends on the instant we are trying to find: the
 * first guess uses the offset at the naive time, the second corrects it if a DST
 * transition sits between the two. India has no DST, but the platform shouldn't
 * silently break the day a clinic opens somewhere that does.
 */
export function zonedToUtc(date: string, time: string, timeZone = CLINIC_TIMEZONE): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);

  const firstOffset = offsetMs(new Date(naive), timeZone);
  let utc = naive - firstOffset;
  const secondOffset = offsetMs(new Date(utc), timeZone);
  if (secondOffset !== firstOffset) utc = naive - secondOffset;
  return new Date(utc);
}

/** 'YYYY-MM-DD' of `instant` on the clinic's calendar. */
export function clinicDateKey(instant: Date = new Date(), timeZone = CLINIC_TIMEZONE): string {
  const w = wallClock(instant, timeZone);
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

/** 'HH:MM' of `instant` on the clinic's clock. */
export function clinicTimeLabel(instant: Date, timeZone = CLINIC_TIMEZONE): string {
  const w = wallClock(instant, timeZone);
  return `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`;
}

/**
 * "Fri 18 Sep, 5:00 pm IST" — an instant as the clinic reads it. For text that leaves
 * the server (notifications, MCP tool results), where there's no browser to localise.
 */
export function formatClinicDateTime(instant: Date): string {
  const when = instant.toLocaleString('en-IN', {
    timeZone: CLINIC_TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  const zone =
    new Intl.DateTimeFormat('en-IN', { timeZone: CLINIC_TIMEZONE, timeZoneName: 'short' })
      .formatToParts(instant)
      .find((p) => p.type === 'timeZoneName')?.value ?? CLINIC_TIMEZONE;
  return `${when} ${zone}`;
}

/** Today on the clinic's calendar — NOT `toISOString().slice(0, 10)`, which is UTC. */
export function clinicToday(): string {
  return clinicDateKey(new Date());
}

/** Calendar arithmetic on a 'YYYY-MM-DD' key; timezone-free by construction. */
export function addDaysToKey(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Weekday (0 = Sunday) of a calendar date key. */
export function weekdayOfKey(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

/** The instants bounding a whole clinic day: [start, end). */
export function clinicDayBounds(date: string, timeZone = CLINIC_TIMEZONE): { start: Date; end: Date } {
  return {
    start: zonedToUtc(date, '00:00', timeZone),
    end: zonedToUtc(addDaysToKey(date, 1), '00:00', timeZone),
  };
}
