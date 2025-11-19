import { Request, Response, NextFunction } from 'express';
import { recordRequestMetrics } from '../metrics';

export function createMetricsMiddleware(serviceName?: string) {
  return function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
    const startTime = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      recordRequestMetrics(req.method, req.path, res.statusCode, duration, serviceName);
    });

    next();
  };
}
