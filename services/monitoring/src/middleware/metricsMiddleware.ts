import { Request, Response, NextFunction } from 'express';
import { recordRequest } from '../services/metrics';

export function metricsMiddleware(serviceName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      recordRequest(
        serviceName,
        req.method,
        req.path,
        res.statusCode,
        duration
      );
    });

    next();
  };
}
