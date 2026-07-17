/**
 * Calendar helpers — both are pure client-side, no Google API/keys involved.
 *
 * - googleCalendarUrl(): Google Calendar's public "render?action=TEMPLATE"
 *   URL scheme pre-fills a create-event screen in the USER's account.
 * - downloadIcs(): generates an RFC-5545 .ics file (the universal calendar
 *   format) and triggers a download; opens in Apple/Outlook/Android calendars.
 */

export interface CalendarEvent {
  title: string;
  description: string;
  startsAt: Date;
  durationMinutes: number;
  location?: string;
}

/** 20260712T113000Z-style UTC timestamp both formats require. */
function toUtcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function googleCalendarUrl(event: CalendarEvent): string {
  const start = toUtcStamp(event.startsAt);
  const end = toUtcStamp(new Date(event.startsAt.getTime() + event.durationMinutes * 60_000));
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${start}/${end}`,
    details: event.description,
    ...(event.location ? { location: event.location } : {}),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function downloadIcs(event: CalendarEvent, filename = 'appointment.ics'): void {
  const start = toUtcStamp(event.startsAt);
  const end = toUtcStamp(new Date(event.startsAt.getTime() + event.durationMinutes * 60_000));
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SymptoBridge AI//EN',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@symptobridge`,
    `DTSTAMP:${toUtcStamp(new Date())}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${event.title.replace(/[,;]/g, ' ')}`,
    `DESCRIPTION:${event.description.replace(/[,;]/g, ' ')}`,
    ...(event.location ? [`LOCATION:${event.location.replace(/[,;]/g, ' ')}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
