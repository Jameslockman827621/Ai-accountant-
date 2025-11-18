/**
 * Express Middleware for Trace Context Propagation
 */

import { Request, Response, NextFunction } from 'express';
import { context, propagation, trace } from '@opentelemetry/api';

export function tracingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const parentContext = propagation.extract(context.active(), req.headers);

  context.with(parentContext, () => {
    const activeSpan = trace.getSpan(context.active());
    const traceId = activeSpan?.spanContext().traceId;
    if (traceId) {
      process.env.TRACE_ID = traceId;
      res.setHeader('x-trace-id', traceId);
    }

    const responseHeaders: Record<string, string> = {};
    propagation.inject(context.active(), responseHeaders);
    Object.entries(responseHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    next();
  });
}
