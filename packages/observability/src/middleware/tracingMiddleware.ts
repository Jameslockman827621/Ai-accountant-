import { Request, Response, NextFunction } from 'express';
import { context, propagation, trace, SpanStatusCode } from '@opentelemetry/api';

export function createTracingMiddleware(serviceName?: string) {
  const tracer = trace.getTracer(serviceName || 'service-tracer');

  return function tracingMiddleware(req: Request, res: Response, next: NextFunction): void {
    const parentContext = propagation.extract(context.active(), req.headers);
    const span = tracer.startSpan(`${req.method} ${req.path}`, undefined, parentContext);
    const ctxWithSpan = trace.setSpan(parentContext, span);

    res.on('finish', () => {
      span.setAttributes({
        'http.method': req.method,
        'http.route': req.path,
        'http.status_code': res.statusCode,
        'service.name': serviceName || process.env.SERVICE_NAME || 'ai-accountant',
      });
      if (res.statusCode >= 500) {
        span.setStatus({ code: SpanStatusCode.ERROR });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }
      span.end();
    });

    context.with(ctxWithSpan, () => {
      const traceId = span.spanContext().traceId;
      if (traceId) {
        process.env.TRACE_ID = traceId;
        res.setHeader('x-trace-id', traceId);
      }

      if (serviceName) {
        res.setHeader('x-service-name', serviceName);
      }

      const responseHeaders: Record<string, string> = {};
      propagation.inject(ctxWithSpan, responseHeaders);
      Object.entries(responseHeaders).forEach(([key, value]) => {
        res.setHeader(key, value);
      });

      (req as any).otelContext = ctxWithSpan;
      (req as any).activeSpan = span;

      next();
    });
  };
}
