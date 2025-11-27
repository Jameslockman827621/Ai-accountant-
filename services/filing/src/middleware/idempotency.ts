import { Request, Response, NextFunction } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('filing-idempotency');
const IDEMPOTENCY_TTL_MS = 30 * 60 * 1000; // filings can take longer
const seenRequests: Map<string, { status: number; body: unknown; expiresAt: number }> = new Map();

function cleanupExpired(): void {
  const now = Date.now();
  for (const [key, value] of seenRequests.entries()) {
    if (value.expiresAt < now) {
      seenRequests.delete(key);
    }
  }
}

export function enforceIdempotency(req: Request, res: Response, next: NextFunction): void {
  if (req.method.toUpperCase() === 'GET' || req.method.toUpperCase() === 'OPTIONS') {
    next();
    return;
  }

  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey) {
    res.status(400).json({ error: 'Idempotency-Key header is required for mutating filing endpoints' });
    return;
  }

  cleanupExpired();

  const cacheKey = `${idempotencyKey}:${req.originalUrl}`;
  const existing = seenRequests.get(cacheKey);
  if (existing) {
    res.status(existing.status).json(existing.body);
    return;
  }

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    seenRequests.set(cacheKey, {
      status: res.statusCode,
      body,
      expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
    });
    logger.debug('Stored idempotent filing response', { cacheKey, status: res.statusCode });
    return originalJson(body);
  };

  next();
}
