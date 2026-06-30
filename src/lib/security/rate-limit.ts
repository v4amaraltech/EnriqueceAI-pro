/**
 * Distributed rate limiter using Upstash Redis.
 * Falls back to in-memory when UPSTASH_REDIS_REST_URL is not configured (local dev).
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import * as Sentry from '@sentry/nextjs';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterMs?: number;
}

// --- Upstash Redis singleton ---
let redis: Redis | null = null;

// getRedis() runs on every checkRateLimit call when Redis is absent (a null
// client isn't cached), so guard the alert to fire once per process — otherwise
// each request would flood Sentry/logs while the misconfiguration persists.
let fallbackReported = false;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (process.env.NODE_ENV === 'production' && !fallbackReported) {
      fallbackReported = true;
      const msg = '[SECURITY] UPSTASH_REDIS_REST_URL/TOKEN not set — rate limiting falls back to in-memory (ineffective on serverless, distributed rate limiting disabled)';
      console.error(msg);
      // Explicit capture so it surfaces as a Sentry event (the SDK does not
      // forward console.* by default) and can drive an alert rule.
      Sentry.captureMessage(msg, 'error');
    }
    return null;
  }
  redis = new Redis({ url, token });
  return redis;
}

// Cache of Ratelimit instances per (limit, windowMs) combo
const limiterCache = new Map<string, Ratelimit>();

function getLimiter(limit: number, windowMs: number): Ratelimit | null {
  const r = getRedis();
  if (!r) return null;

  const cacheKey = `${limit}:${windowMs}`;
  let limiter = limiterCache.get(cacheKey);
  if (!limiter) {
    const windowS = Math.max(Math.ceil(windowMs / 1000), 1);
    limiter = new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(limit, `${windowS} s`),
      prefix: 'rl',
    });
    limiterCache.set(cacheKey, limiter);
  }
  return limiter;
}

// --- In-memory fallback (local dev) ---
const memStore = new Map<string, number[]>();

function checkInMemory(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const cutoff = now - windowMs;

  let timestamps = memStore.get(key);
  if (!timestamps) {
    timestamps = [];
    memStore.set(key, timestamps);
  }

  // Remove expired
  const filtered = timestamps.filter((t) => t > cutoff);
  memStore.set(key, filtered);

  if (filtered.length >= limit) {
    const oldest = filtered[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      limit,
      retryAfterMs: Math.max(oldest + windowMs - now, 0),
    };
  }

  filtered.push(now);
  return { allowed: true, remaining: limit - filtered.length, limit };
}

/**
 * Check and consume a rate limit token.
 * Uses Upstash Redis in production, in-memory fallback in local dev.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const limiter = getLimiter(limit, windowMs);

  if (!limiter) {
    return checkInMemory(key, limit, windowMs);
  }

  try {
    const result = await limiter.limit(key);

    return {
      allowed: result.success,
      remaining: result.remaining,
      limit: result.limit,
      retryAfterMs: result.success ? undefined : Math.max(result.reset - Date.now(), 0),
    };
  } catch (err) {
    // Fail-open: uma falha de infraestrutura do rate-limiter (Upstash indisponível
    // / erro de rede) NÃO pode derrubar a ação que ele protege. Cai para o
    // contador in-memory e segue. Sem isto, qualquer hiccup do Redis virava um
    // erro não tratado na server action (ex.: "Server Components render" no Apollo).
    console.error('[rate-limit] Upstash indisponível — fallback in-memory:', err);
    return checkInMemory(key, limit, windowMs);
  }
}

/**
 * Reset rate limit for a key (e.g., after successful login).
 */
export async function resetRateLimit(key: string): Promise<void> {
  const r = getRedis();
  if (r) {
    // Delete all keys matching this identifier
    const keys = await r.keys(`rl:${key}*`);
    if (keys.length > 0) {
      await r.del(...keys);
    }
  } else {
    memStore.delete(key);
  }
}
