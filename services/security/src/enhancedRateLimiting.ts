/**
 * Enhanced Rate Limiting
 * Supports multiple strategies: token bucket, sliding window, fixed window
 */

import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';

const logger = createLogger('rate-limiting');

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  strategy: 'token_bucket' | 'sliding_window' | 'fixed_window';
  keyGenerator?: (req: unknown) => string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: Date;
  retryAfter?: number; // seconds
}

export class RateLimiter {
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  async checkLimit(identifier: string): Promise<RateLimitResult> {
    switch (this.config.strategy) {
      case 'token_bucket':
        return this.checkTokenBucket(identifier);
      case 'sliding_window':
        return this.checkSlidingWindow(identifier);
      case 'fixed_window':
        return this.checkFixedWindow(identifier);
      default:
        throw new Error(`Unknown rate limit strategy: ${this.config.strategy}`);
    }
  }

  private async checkTokenBucket(identifier: string): Promise<RateLimitResult> {
    const now = Date.now();
    const key = `ratelimit:token:${identifier}`;

    // Get current bucket state
    const result = await db.query<{
      tokens: number;
      last_refill: number;
    }>(
      `SELECT tokens, last_refill
       FROM rate_limits
       WHERE identifier = $1 AND strategy = 'token_bucket'`,
      [key]
    );

    let tokens = this.config.maxRequests;
    let lastRefill = now;

    if (result.rows.length > 0) {
      const row = result.rows[0];
      tokens = row.tokens;
      lastRefill = row.last_refill;

      // Refill tokens based on time passed
      const timePassed = now - lastRefill;
      const tokensToAdd = Math.floor((timePassed / this.config.windowMs) * this.config.maxRequests);
      tokens = Math.min(this.config.maxRequests, tokens + tokensToAdd);
      lastRefill = now;
    }

    const allowed = tokens > 0;
    if (allowed) {
      tokens--;
    }

    // Update or insert
    await db.query(
      `INSERT INTO rate_limits (identifier, strategy, tokens, last_refill, updated_at)
       VALUES ($1, 'token_bucket', $2, $3, NOW())
       ON CONFLICT (identifier, strategy)
       DO UPDATE SET tokens = $2, last_refill = $3, updated_at = NOW()`,
      [key, tokens, lastRefill]
    );

    const resetTime = new Date(now + this.config.windowMs);
    const retryAfter = allowed ? undefined : Math.ceil((this.config.windowMs - (now - lastRefill)) / 1000);

    return {
      allowed,
      remaining: Math.max(0, tokens),
      resetTime,
      retryAfter,
    };
  }

  private async checkSlidingWindow(identifier: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    const key = `ratelimit:sliding:${identifier}`;

    // Count requests in current window
    const result = await db.query<{ count: string | number }>(
      `SELECT COUNT(*) as count
       FROM rate_limit_requests
       WHERE identifier = $1 AND timestamp > $2`,
      [key, new Date(windowStart)]
    );

    const count = typeof result.rows[0]?.count === 'number'
      ? result.rows[0].count
      : parseInt(String(result.rows[0]?.count || '0'), 10);

    const allowed = count < this.config.maxRequests;

    if (allowed) {
      // Record this request
      await db.query(
        `INSERT INTO rate_limit_requests (identifier, timestamp)
         VALUES ($1, NOW())`,
        [key]
      );
    }

    // Clean up old requests
    await db.query(
      `DELETE FROM rate_limit_requests
       WHERE identifier = $1 AND timestamp < $2`,
      [key, new Date(windowStart)]
    );

    const resetTime = new Date(now + this.config.windowMs);
    const retryAfter = allowed ? undefined : Math.ceil(this.config.windowMs / 1000);

    return {
      allowed,
      remaining: Math.max(0, this.config.maxRequests - count - (allowed ? 1 : 0)),
      resetTime,
      retryAfter,
    };
  }

  private async checkFixedWindow(identifier: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = Math.floor(now / this.config.windowMs) * this.config.windowMs;
    const key = `ratelimit:fixed:${identifier}:${windowStart}`;

    // Get or create window counter
    const result = await db.query<{ count: string | number }>(
      `SELECT count FROM rate_limits
       WHERE identifier = $1 AND strategy = 'fixed_window'`,
      [key]
    );

    let count = typeof result.rows[0]?.count === 'number'
      ? result.rows[0].count
      : parseInt(String(result.rows[0]?.count || '0'), 10);

    const allowed = count < this.config.maxRequests;
    if (allowed) {
      count++;
    }

    // Update or insert
    await db.query(
      `INSERT INTO rate_limits (identifier, strategy, count, updated_at)
       VALUES ($1, 'fixed_window', $2, NOW())
       ON CONFLICT (identifier, strategy)
       DO UPDATE SET count = $2, updated_at = NOW()`,
      [key, count]
    );

    const resetTime = new Date(windowStart + this.config.windowMs);
    const retryAfter = allowed ? undefined : Math.ceil((resetTime.getTime() - now) / 1000);

    return {
      allowed,
      remaining: Math.max(0, this.config.maxRequests - count),
      resetTime,
      retryAfter,
    };
  }
}

// Pre-configured rate limiters
export const createRateLimiter = (config: RateLimitConfig): RateLimiter => {
  return new RateLimiter(config);
};

// Common rate limit configurations
export const RATE_LIMITS = {
  // API endpoints
  api: createRateLimiter({
    windowMs: 60000, // 1 minute
    maxRequests: 100,
    strategy: 'sliding_window',
  }),

  // Authentication
  auth: createRateLimiter({
    windowMs: 900000, // 15 minutes
    maxRequests: 5,
    strategy: 'token_bucket',
  }),

  // Document upload
  upload: createRateLimiter({
    windowMs: 3600000, // 1 hour
    maxRequests: 50,
    strategy: 'fixed_window',
  }),

  // OCR processing
  ocr: createRateLimiter({
    windowMs: 60000, // 1 minute
    maxRequests: 10,
    strategy: 'token_bucket',
  }),
};
