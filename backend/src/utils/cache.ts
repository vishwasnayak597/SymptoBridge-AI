import { getRedis } from './redis';
import logger from './logger';

/**
 * Cache-aside over Redis.
 *
 * Read path: try the cache; on a miss run the loader, store the result with a
 * TTL, return it. Write path: whoever mutates the underlying data calls
 * `invalidateCache(prefix)` so readers never see stale results beyond the TTL.
 *
 * Degrades to a straight loader call when Redis is not configured, and a
 * cache FAILURE never fails the request — worst case we just hit Mongo.
 */
export async function getCached<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>
): Promise<T> {
  const redis = getRedis();
  if (!redis) return loader();

  try {
    const hit = await redis.get(key);
    if (hit !== null) return JSON.parse(hit) as T;
  } catch (err) {
    logger.error('Cache read failed — falling through to loader', { key, message: (err as Error).message });
  }

  const value = await loader();

  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    // Best-effort: a failed SET just means the next read misses too.
  }

  return value;
}

/** Delete every key under a prefix (e.g. 'cache:doctors:'). */
export async function invalidateCache(prefix: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    // SCAN, not KEYS: KEYS blocks Redis on large keyspaces.
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  } catch (err) {
    logger.error('Cache invalidation failed', { prefix, message: (err as Error).message });
  }
}

export const CACHE_KEYS = {
  doctors: 'cache:doctors:',
} as const;
