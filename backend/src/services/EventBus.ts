import { EventEmitter } from 'events';
import { getRedis, createBlockingRedis } from '../utils/redis';
import logger from '../utils/logger';

/**
 * Domain event bus.
 *
 * With REDIS_URL configured, events are appended to a Redis Stream (`aidoc:events`) and
 * consumed by named consumer groups — Kafka-style semantics (append-only log, independent
 * consumers, replay, XACK) on infrastructure that is free to run. Without Redis, the bus
 * degrades to an in-process EventEmitter so behavior is identical in local dev.
 *
 * Consumers (each an independent group, so each sees every event):
 *   - audit     -> immutable AuditLog entries in Mongo (compliance trail)
 *   - analytics -> live daily counters in a Redis hash (admin real-time stats)
 *
 * Producers publish fire-and-forget: a bus failure must never fail the user's request.
 */

export interface DomainEvent {
  type: string;                       // e.g. 'appointment.booked'
  actorId?: string;                   // user who caused it
  entityType?: string;                // 'appointment' | 'payment' | ...
  entityId?: string;
  payload?: Record<string, unknown>;
  occurredAt?: string;
}

const STREAM_KEY = 'aidoc:events';
const MAX_STREAM_LENGTH = 10000;      // cap the log so a free Redis never fills up
const GROUPS = ['audit', 'analytics'] as const;

const localBus = new EventEmitter();
localBus.setMaxListeners(50);

let consumersStarted = false;
const stopFns: Array<() => void> = [];

// ---------------------------------------------------------------- publish

export async function publishEvent(event: DomainEvent): Promise<void> {
  const enriched: DomainEvent = { ...event, occurredAt: event.occurredAt || new Date().toISOString() };
  try {
    const redis = getRedis();
    if (redis) {
      await redis.xadd(
        STREAM_KEY,
        'MAXLEN', '~', String(MAX_STREAM_LENGTH),
        '*',
        'event', JSON.stringify(enriched)
      );
    } else {
      // In-process fallback: deliver to the same handlers, synchronously decoupled.
      setImmediate(() => localBus.emit('event', enriched));
    }
  } catch (error) {
    // Fire-and-forget by design: never let the bus break the request path.
    logger.error('EventBus publish failed:', { type: event.type, error: (error as Error).message });
  }
}

// ---------------------------------------------------------------- consumers

async function handleAudit(event: DomainEvent): Promise<void> {
  const { AuditLog } = await import('../models/AuditLog');
  await AuditLog.create({
    eventType: event.type,
    actor: event.actorId || undefined,
    entityType: event.entityType,
    entityId: event.entityId,
    payload: event.payload,
    occurredAt: event.occurredAt ? new Date(event.occurredAt) : new Date(),
  });
}

async function handleAnalytics(event: DomainEvent): Promise<void> {
  const redis = getRedis();
  const day = (event.occurredAt || new Date().toISOString()).slice(0, 10); // YYYY-MM-DD
  if (redis) {
    const key = `aidoc:stats:${day}`;
    await redis.hincrby(key, event.type, 1);
    if (event.type === 'payment.completed' && typeof event.payload?.amount === 'number') {
      await redis.hincrby(key, 'revenue', Math.round(event.payload.amount as number));
    }
    await redis.expire(key, 60 * 60 * 24 * 45); // keep 45 days of daily counters
  }
  // Without Redis there is nowhere durable to count — audit log still records everything.
}

const HANDLERS: Record<(typeof GROUPS)[number], (e: DomainEvent) => Promise<void>> = {
  audit: handleAudit,
  analytics: handleAnalytics,
};

/** Read today's live counters (admin dashboard). */
export async function getLiveStats(day?: string): Promise<Record<string, number>> {
  const redis = getRedis();
  if (!redis) return {};
  const key = `aidoc:stats:${day || new Date().toISOString().slice(0, 10)}`;
  const raw = await redis.hgetall(key);
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Number(v)]));
}

function startStreamConsumer(group: (typeof GROUPS)[number]): void {
  const conn = createBlockingRedis();
  if (!conn) return;
  let running = true;
  stopFns.push(() => { running = false; conn.disconnect(); });

  (async () => {
    // Create the group at the current end of stream; ignore "already exists".
    try {
      await conn.xgroup('CREATE', STREAM_KEY, group, '$', 'MKSTREAM');
    } catch (e) {
      if (!(e as Error).message.includes('BUSYGROUP')) {
        logger.error(`EventBus group create failed (${group}):`, { message: (e as Error).message });
      }
    }

    while (running) {
      try {
        const res = (await conn.xreadgroup(
          'GROUP', group, `${group}-worker`,
          'COUNT', '10', 'BLOCK', '5000',
          'STREAMS', STREAM_KEY, '>'
        )) as Array<[string, Array<[string, string[]]>]> | null;

        if (!res) continue;
        for (const [, entries] of res) {
          for (const [id, fields] of entries) {
            try {
              const idx = fields.indexOf('event');
              const event: DomainEvent = JSON.parse(fields[idx + 1]);
              await HANDLERS[group](event);
              await conn.xack(STREAM_KEY, group, id);
            } catch (err) {
              // Ack poisoned messages after logging: this stream is best-effort telemetry,
              // not payment processing — blocking the group on one bad entry is worse.
              logger.error(`EventBus ${group} handler failed:`, { message: (err as Error).message });
              await conn.xack(STREAM_KEY, group, id).catch(() => {});
            }
          }
        }
      } catch (err) {
        if (running) {
          logger.error(`EventBus ${group} read loop error:`, { message: (err as Error).message });
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
  })();
}

export function startEventConsumers(): void {
  if (consumersStarted) return;
  consumersStarted = true;

  if (getRedis()) {
    for (const group of GROUPS) startStreamConsumer(group);
    logger.info(`EventBus consumers started on Redis Streams (groups: ${GROUPS.join(', ')})`);
  } else {
    // Local fallback: run every handler on each event in-process.
    localBus.on('event', (event: DomainEvent) => {
      for (const group of GROUPS) {
        HANDLERS[group](event).catch((err) =>
          logger.error(`EventBus ${group} (local) failed:`, { message: (err as Error).message })
        );
      }
    });
    logger.info('EventBus consumers started in-process (no Redis)');
  }
}

export function stopEventConsumers(): void {
  for (const stop of stopFns) stop();
  stopFns.length = 0;
  localBus.removeAllListeners('event');
  consumersStarted = false;
}
