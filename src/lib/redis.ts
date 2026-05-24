import { Redis } from '@upstash/redis';

const hasRedisCreds =
  typeof process.env.UPSTASH_REDIS_REST_URL === 'string' &&
  process.env.UPSTASH_REDIS_REST_URL.length > 0 &&
  typeof process.env.UPSTASH_REDIS_REST_TOKEN === 'string' &&
  process.env.UPSTASH_REDIS_REST_TOKEN.length > 0;

export const redis = hasRedisCreds
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null;

if (!hasRedisCreds) {
  console.warn(
    '⚠️ Upstash Redis credentials missing. Using local in-memory fallback for idempotency.'
  );
}

// Memory fallback to support local development and quick tests without Redis config
const memoryCache = new Map<string, { value: string; expiry: number }>();

export const idempotency = {
  /**
   * Retrieves cached idempotency value.
   */
  async get(key: string): Promise<string | null> {
    const fullKey = `idempotency:${key}`;
    if (redis) {
      try {
        return await redis.get<string>(fullKey);
      } catch (err) {
        console.error('Redis GET error, falling back to memory:', err);
      }
    }

    const cached = memoryCache.get(fullKey);
    if (cached) {
      if (cached.expiry > Date.now()) {
        return cached.value;
      }
      memoryCache.delete(fullKey); // Clean up expired memory cache
    }
    return null;
  },

  /**
   * Sets key to IN_PROGRESS. Returns true if lock was acquired, false if it already exists.
   */
  async setInProgress(key: string, ttlSeconds = 300): Promise<boolean> {
    const fullKey = `idempotency:${key}`;
    if (redis) {
      try {
        const result = await redis.set(fullKey, 'IN_PROGRESS', {
          ex: ttlSeconds,
          nx: true,
        });
        return result === 'OK';
      } catch (err) {
        console.error('Redis SET NX error, falling back to memory:', err);
      }
    }

    const cached = memoryCache.get(fullKey);
    if (cached && cached.expiry > Date.now()) {
      return false; // Lock already held
    }
    memoryCache.set(fullKey, {
      value: 'IN_PROGRESS',
      expiry: Date.now() + ttlSeconds * 1000,
    });
    return true;
  },

  /**
   * Caches completed response with status code and body.
   */
  async setCompleted(key: string, response: any, ttlSeconds = 86400): Promise<void> {
    const fullKey = `idempotency:${key}`;
    const value = JSON.stringify(response);
    if (redis) {
      try {
        await redis.set(fullKey, value, {
          ex: ttlSeconds,
        });
        return;
      } catch (err) {
        console.error('Redis SET Completed error, falling back to memory:', err);
      }
    }
    memoryCache.set(fullKey, {
      value,
      expiry: Date.now() + ttlSeconds * 1000,
    });
  },

  /**
   * Deletes the idempotency key (used on business validation failures where client can retry).
   */
  async delete(key: string): Promise<void> {
    const fullKey = `idempotency:${key}`;
    if (redis) {
      try {
        await redis.del(fullKey);
        return;
      } catch (err) {
        console.error('Redis DEL error, falling back to memory:', err);
      }
    }
    memoryCache.delete(fullKey);
  },
};
