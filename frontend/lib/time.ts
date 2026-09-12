/**
 * Displaying appointment times.
 *
 * The rule: the server owns the conversion from a clinic slot label ("09:00") to an
 * instant, and sends that instant with every slot. The browser only ever DISPLAYS
 * instants — in the viewer's own timezone — and never builds one from a label. A
 * browser building `new Date("2026-09-14T09:00")` uses its own zone, which is exactly
 * how the booking form ended up 5h30m away from the availability engine.
 */

/** Must match the backend's CLINIC_TIMEZONE. */
export const CLINIC_TIMEZONE = process.env.NEXT_PUBLIC_CLINIC_TIMEZONE || 'Asia/Kolkata';

/** The viewer's timezone, from their device settings — i.e. where they are. */
export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || CLINIC_TIMEZONE;
  } catch {
    return CLINIC_TIMEZONE;
  }
}

/** True when the viewer is somewhere the clinic's clock doesn't apply. */
export function viewerIsOutsideClinicZone(): boolean {
  const offsetAt = (timeZone: string) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date());
    return parts;
  };
  // Compare wall clocks rather than zone names: Asia/Calcutta and Asia/Kolkata are
  // the same clock under two names.
  return offsetAt(viewerTimeZone()) !== offsetAt(CLINIC_TIMEZONE);
}

/** "9:00 AM" in the viewer's timezone. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "9:00 AM" on the clinic's clock, for showing alongside the viewer's time. */
export function formatClinicTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: CLINIC_TIMEZONE,
  });
}

/** "Fri, 11 Sep, 5:00 PM" in the viewer's timezone. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Short timezone name for the viewer, e.g. "IST" or "GMT-4". */
export function viewerZoneAbbrev(): string {
  const part = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName');
  return part?.value || viewerTimeZone();
}

/**
 * A 'YYYY-MM-DD' calendar date as "Mon, Sep 14". `new Date('2026-09-14')` is UTC
 * midnight, which renders as Sep 13 anywhere west of UTC — so format it as a pure
 * calendar date instead of shifting it through the viewer's zone.
 */
export function formatDateKey(key: string): string {
  return new Date(`${key}T12:00:00.000Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** 'YYYY-MM-DD' of an instant on the clinic's calendar. */
export function clinicDateKey(instant: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * The next `count` clinic days, for a date picker. Slots belong to clinic days, so the
 * picker must list clinic days — `toISOString().split('T')[0]` gave the UTC date,
 * which is yesterday between midnight and 5:30 am IST.
 */
export function upcomingClinicDays(count: number): Array<{ value: string; label: string; isToday: boolean }> {
  const today = clinicDateKey();
  const days = [];
  for (let i = 0; i < count; i++) {
    const cursor = new Date(`${today}T12:00:00.000Z`);
    cursor.setUTCDate(cursor.getUTCDate() + i);
    const value = cursor.toISOString().slice(0, 10);
    const label = cursor.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC', // the key is already a calendar date; don't shift it
    });
    days.push({ value, label, isToday: i === 0 });
  }
  return days;
}
