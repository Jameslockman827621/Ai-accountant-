/**
 * Express Middleware for Metrics Collection
 */

import { Request, Response, NextFunction } from 'express';
import { recordRequestMetrics } from '../metrics';

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();

  // Record metrics when response finishes
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    recordRequestMetrics(req.method, req.path, res.statusCode, duration);
  });

  next();
}
