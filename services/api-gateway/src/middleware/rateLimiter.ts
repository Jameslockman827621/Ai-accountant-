import { Request, Response, NextFunction } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';

const logger = createLogger('api-gateway');

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

const rateLimitStore: Map<string, { count: number; resetAt: Date }> = new Map();

/**
 * Advanced rate limiting with per-tenant and per-endpoint limits
 */
export function createRateLimiter(config: RateLimitConfig) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const identifier = getRateLimitIdentifier(req);
    const now = new Date();

    // Get or create rate limit entry
    let entry = rateLimitStore.get(identifier);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: new Date(now.getTime() + config.windowMs) };
      rateLimitStore.set(identifier, entry);
    }

    // Check limit
    if (entry.count >= config.maxRequests) {
      res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil((entry.resetAt.getTime() - now.getTime()) / 1000),
      });
      return;
    }

    // Increment counter
    entry.count++;

    // Set rate limit headers
    res.set({
      'X-RateLimit-Limit': String(config.maxRequests),
      'X-RateLimit-Remaining': String(config.maxRequests - entry.count),
      'X-RateLimit-Reset': String(Math.ceil(entry.resetAt.getTime() / 1000)),
    });

    // Track in database for analytics
    if (req.user?.tenantId) {
      await db.query(
        `INSERT INTO rate_limit_logs (id, tenant_id, endpoint, ip_address, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, NOW())
         ON CONFLICT DO NOTHING`,
        [req.user.tenantId, req.path, req.ip]
      ).catch(err => logger.error('Rate limit logging failed', err));
    }

    next();
  };
}

function getRateLimitIdentifier(req: Request): string {
  // Per-tenant + per-endpoint + per-IP
  const tenantId = (req.user as { tenantId?: string })?.tenantId || 'anonymous';
  const endpoint = req.path;
  const ip = req.ip || 'unknown';
  return `${tenantId}:${endpoint}:${ip}`;
}

/**
 * Per-tenant rate limiting
 */
export function createTenantRateLimiter(maxRequests: number = 1000, windowMs: number = 15 * 60 * 1000) {
  return createRateLimiter({
    windowMs,
    maxRequests,
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
  });
}

/**
 * Per-endpoint rate limiting
 */
export function createEndpointRateLimiter(endpoint: string, maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path === endpoint) {
      createRateLimiter({ windowMs, maxRequests })(req, res, next);
    } else {
      next();
    }
  };
}
