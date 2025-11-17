/**
 * Express Middleware for Trace Context Propagation
 */

import { Request, Response, NextFunction } from 'express';
import { context, propagation } from '@opentelemetry/api';

export function tracingMiddleware(req: Request, res: Response, next: NextFunction) {
  // Extract trace context from headers (W3C Trace Context)
  const parentContext = propagation.extract(context.active(), req.headers);

  // Set trace context
  context.with(parentContext, () => {
    // Store trace ID in environment for logging
    const traceId = context.active().traceId;
    if (traceId) {
      process.env.TRACE_ID = traceId;
    }

    // Inject trace context into response headers
    propagation.inject(context.active(), res.getHeaders());

    next();
  });
}
