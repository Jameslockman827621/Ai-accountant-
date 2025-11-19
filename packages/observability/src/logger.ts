import { createLogger as createBaseLogger } from '@ai-accountant/shared-utils';
import { randomUUID } from 'crypto';

const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN]' },
  { pattern: /\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/g, replacement: '[CARD]' },
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '[EMAIL]' },
  { pattern: /\b\d{10,}\b/g, replacement: '[PHONE]' },
];

function maskPII(message: string): string {
  return PII_PATTERNS.reduce((current, { pattern, replacement }) => current.replace(pattern, replacement), message);
}

export interface ServiceLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  debug: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, error?: Error | unknown, meta?: Record<string, unknown>) => void;
}

export function createServiceLogger(service: string, context?: Record<string, unknown>): ServiceLogger {
  const baseLogger = createBaseLogger(service);

  const enrich = (meta?: Record<string, unknown>) => ({
    ...context,
    ...meta,
    traceId: process.env.TRACE_ID || randomUUID(),
    timestamp: new Date().toISOString(),
  });

  return {
    info: (message: string, meta?: Record<string, unknown>) => {
      baseLogger.info(maskPII(message), enrich(meta));
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
      baseLogger.warn(maskPII(message), enrich(meta));
    },
    debug: (message: string, meta?: Record<string, unknown>) => {
      baseLogger.debug(maskPII(message), enrich(meta));
    },
    error: (message: string, error?: Error | unknown, meta?: Record<string, unknown>) => {
      baseLogger.error(maskPII(message), error, enrich(meta));
    },
  };
}
