import Redis from 'ioredis';
import logger from './logger';

/**
 * Optional shared Redis connection.
 *
 * Everything that depends on Redis (event streams, distributed rate limiting) degrades
 * gracefully when REDIS_URL is not configured: the event bus falls back to an in-process
 * emitter and rate limiting falls back to the in-memory store. This keeps local dev and
 * un-provisioned deploys fully functional.
 */

let client: Redis | null = null;
let attempted = false;

export function getRedis(): Redis | null {
  if (attempted) return client;
  attempted = true;

  const url = process.env.REDIS_URL;
  if (!url) {
    logger.info('REDIS_URL not set — running without Redis (in-memory fallbacks active)');
    return null;
  }

  try {
    client = new Redis(url, {
      maxRetriesPerRequest: 3,
      // Upstash and most managed Redis require TLS on rediss:// URLs; ioredis infers it from the scheme.
      lazyConnect: false,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });
    client.on('connect', () => logger.info('Redis connected'));
    client.on('error', (err) => logger.error('Redis error:', { message: err.message }));
  } catch (err) {
    // A malformed REDIS_URL must never crash boot — degrade to the in-memory fallbacks.
    logger.error('Invalid REDIS_URL — continuing without Redis:', { message: (err as Error).message });
    client = null;
  }

  return client;
}

/** Separate blocking connection for stream consumers (XREAD BLOCK must not share the main client). */
export function createBlockingRedis(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const conn = new Redis(url, { maxRetriesPerRequest: null, retryStrategy: (t) => Math.min(t * 500, 5000) });
    // Without a listener, ioredis logs "Unhandled error event" on every reconnect attempt.
    let reported = false;
    conn.on('error', (err) => {
      if (!reported) {
        logger.error('Redis (consumer) error:', { message: err.message });
        reported = true;
      }
    });
    conn.on('connect', () => { reported = false; });
    return conn;
  } catch (err) {
    logger.error('Invalid REDIS_URL (consumer) — continuing without Redis:', { message: (err as Error).message });
    return null;
  }
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => {});
    client = null;
    attempted = false;
  }
}
