import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import logger from '../utils/logger';

/**
 * Background jobs (BullMQ) — delayed work with retries and a dead-letter set.
 *
 * Job types:
 *  - appointment-reminder: enqueued at booking time with a delay so it FIRES
 *    at T-24h / T-1h. No cron scanning — the queue wakes the job up itself.
 *  - waitlist-expire: expires a waitlist slot offer so it can pass to the
 *    next patient in line.
 *
 * Reliability semantics: at-least-once. 3 attempts with exponential backoff;
 * exhausted jobs stay in the failed set (the DLQ) for inspection instead of
 * disappearing. Deterministic job ids (reminder:24h:<appointmentId>) make
 * enqueues idempotent and let a cancellation remove its pending jobs.
 *
 * Without REDIS_URL the service degrades to in-process setTimeout scheduling
 * (fine for dev; jobs don't survive a restart — documented trade-off).
 */

const QUEUE_NAME = 'jobs';

export type ReminderWindow = '24h' | '1h';

interface ReminderJobData {
  kind: 'appointment-reminder';
  appointmentId: string;
  window: ReminderWindow;
}

interface WaitlistExpireJobData {
  kind: 'waitlist-expire';
  entryId: string;
}

type JobData = ReminderJobData | WaitlistExpireJobData;

let queue: Queue | null = null;
let worker: Worker | null = null;

// In-process fallback when Redis is absent.
const localTimers = new Map<string, NodeJS.Timeout>();

function makeConnection(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    // BullMQ requires maxRetriesPerRequest: null on its connections.
    const conn = new Redis(url, { maxRetriesPerRequest: null, retryStrategy: (t) => Math.min(t * 500, 5000) });
    conn.on('error', (err) => logger.error('Redis (jobs) error:', { message: err.message }));
    return conn;
  } catch (err) {
    logger.error('Invalid REDIS_URL for job queue — using in-process timers:', { message: (err as Error).message });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Processors
// ---------------------------------------------------------------------------

async function processJob(data: JobData): Promise<void> {
  switch (data.kind) {
    case 'appointment-reminder':
      return processReminder(data);
    case 'waitlist-expire':
      return processWaitlistExpiry(data);
  }
}

async function processReminder({ appointmentId, window }: ReminderJobData): Promise<void> {
  // Dynamic imports avoid circular deps (AppointmentService imports this module).
  const { Appointment } = await import('../models/Appointment');
  const { NotificationService } = await import('./NotificationService');

  const appointment = await Appointment.findById(appointmentId)
    .populate('doctor', 'firstName lastName')
    .populate('patient', 'firstName lastName');

  // The appointment may have been cancelled/completed since scheduling — skip quietly.
  if (!appointment || !['scheduled', 'confirmed'].includes(appointment.status)) return;

  const doctor = appointment.doctor as any;
  const when = window === '24h' ? 'tomorrow' : 'in 1 hour';
  const time = new Date(appointment.appointmentDate).toLocaleString();

  await NotificationService.createNotification({
    recipient: appointment.patient._id.toString(),
    type: 'appointment_reminder',
    title: `Appointment reminder — ${when}`,
    message: `Your ${appointment.consultationType} consultation with Dr. ${doctor.firstName} ${doctor.lastName} is ${when} (${time}).`,
    data: { appointmentId, window },
    actionUrl: '/patient/dashboard',
    actionText: 'View Appointment',
  });

  if (window === '1h') {
    await NotificationService.createNotification({
      recipient: appointment.doctor._id.toString(),
      type: 'appointment_reminder',
      title: 'Upcoming appointment — 1 hour',
      message: `Consultation with ${(appointment.patient as any).firstName} at ${time}.`,
      data: { appointmentId, window },
      actionUrl: '/doctor/dashboard',
      actionText: 'View Schedule',
    });
  }
}

async function processWaitlistExpiry({ entryId }: WaitlistExpireJobData): Promise<void> {
  const { WaitlistService } = await import('./WaitlistService');
  await WaitlistService.expireOffer(entryId);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function startJobWorkers(): void {
  const connection = makeConnection();
  if (!connection) {
    logger.info('Job queue running with in-process timers (no Redis)');
    return;
  }

  queue = new Queue(QUEUE_NAME, { connection });
  worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => processJob(job.data as JobData),
    { connection: makeConnection()!, concurrency: 2 }
  );
  worker.on('failed', (job, err) =>
    logger.error('Job failed', { jobId: job?.id, attempts: job?.attemptsMade, message: err.message })
  );
  logger.info('BullMQ job queue + worker started');
}

export async function stopJobWorkers(): Promise<void> {
  localTimers.forEach((t) => clearTimeout(t));
  localTimers.clear();
  await worker?.close().catch(() => {});
  await queue?.close().catch(() => {});
  worker = null;
  queue = null;
}

// ---------------------------------------------------------------------------
// Enqueue API
// ---------------------------------------------------------------------------

async function enqueue(jobId: string, data: JobData, delayMs: number): Promise<void> {
  if (delayMs < 0) return; // moment already passed (e.g. booking <1h ahead)

  if (queue) {
    await queue.add(data.kind, data, {
      jobId, // deterministic → idempotent enqueue, removable on cancel
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: 100,
      removeOnFail: false, // keep the DLQ for inspection
    });
    return;
  }

  // Fallback: in-process timer (dev / no Redis). Not restart-safe by design.
  if (localTimers.has(jobId)) return;
  const timer = setTimeout(() => {
    localTimers.delete(jobId);
    processJob(data).catch((err) => logger.error('Local job failed', { jobId, message: err.message }));
  }, Math.min(delayMs, 2_147_000_000));
  localTimers.set(jobId, timer);
}

async function removeJob(jobId: string): Promise<void> {
  const timer = localTimers.get(jobId);
  if (timer) {
    clearTimeout(timer);
    localTimers.delete(jobId);
  }
  if (queue) {
    const job = await queue.getJob(jobId).catch(() => null);
    if (job) await job.remove().catch(() => {});
  }
}

/** Schedule the T-24h and T-1h reminders for a new appointment. */
export async function scheduleAppointmentReminders(appointmentId: string, appointmentDate: Date): Promise<void> {
  const now = Date.now();
  const at = appointmentDate.getTime();
  try {
    await enqueue(`reminder:24h:${appointmentId}`,
      { kind: 'appointment-reminder', appointmentId, window: '24h' }, at - 24 * 60 * 60 * 1000 - now);
    await enqueue(`reminder:1h:${appointmentId}`,
      { kind: 'appointment-reminder', appointmentId, window: '1h' }, at - 60 * 60 * 1000 - now);
  } catch (err) {
    // Reminders are best-effort — never fail a booking because scheduling did.
    logger.error('Failed to schedule reminders', { appointmentId, message: (err as Error).message });
  }
}

/** Remove pending reminders when an appointment is cancelled. */
export async function cancelAppointmentReminders(appointmentId: string): Promise<void> {
  await removeJob(`reminder:24h:${appointmentId}`);
  await removeJob(`reminder:1h:${appointmentId}`);
}

/** Schedule a waitlist offer to expire after `ttlMs` (default 15 minutes). */
export async function scheduleWaitlistExpiry(entryId: string, ttlMs = 15 * 60 * 1000): Promise<void> {
  await enqueue(`waitlist:expire:${entryId}`, { kind: 'waitlist-expire', entryId }, ttlMs);
}
