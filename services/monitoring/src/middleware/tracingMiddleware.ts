import { Request, Response, NextFunction } from 'express';
import { tracingService } from '../services/tracing';

export function tracingMiddleware(serviceName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const traceId = req.headers['x-trace-id'] as string | undefined;
    const parentSpanId = req.headers['x-span-id'] as string | undefined;

    const spanId = tracingService.startSpan(
      serviceName,
      `${req.method} ${req.path}`,
      parentSpanId,
      traceId
    );

    tracingService.addTag(spanId, 'http.method', req.method);
    tracingService.addTag(spanId, 'http.path', req.path);
    tracingService.addTag(spanId, 'http.user_agent', req.get('user-agent') || '');

    res.setHeader('x-trace-id', tracingService['activeSpans'].get(spanId)?.traceId || '');
    res.setHeader('x-span-id', spanId);

    res.on('finish', () => {
      tracingService.addTag(spanId, 'http.status_code', String(res.statusCode));
      tracingService.endSpan(spanId);
    });

    next();
  };
}
