/**
 * Centralized Logging Service
 * Structured logging with PII masking and OpenSearch integration
 */

import { createLogger as createBaseLogger, Logger } from '@ai-accountant/shared-utils';
import { randomUUID } from 'crypto';

// PII patterns to mask
const PII_PATTERNS = [
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN]' }, // SSN
  { pattern: /\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/g, replacement: '[CARD]' }, // Credit card
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '[EMAIL]' }, // Email
  { pattern: /\b\d{10,}\b/g, replacement: '[PHONE]' }, // Phone numbers
];

/**
 * Mask PII from log messages
 */
function maskPII(message: string): string {
  let masked = message;
  for (const { pattern, replacement } of PII_PATTERNS) {
    masked = masked.replace(pattern, replacement);
  }
  return masked;
}

/**
 * Enhanced logger with trace context and PII masking
 */
export function createLogger(service: string, context?: Record<string, unknown>): Logger {
  const baseLogger = createBaseLogger(service);

  return {
    info: (message: string, meta?: Record<string, unknown>) => {
      baseLogger.info(maskPII(message), {
        ...context,
        ...meta,
        traceId: process.env.TRACE_ID || randomUUID(),
        timestamp: new Date().toISOString(),
      });
    },
    error: (message: string, error?: Error | unknown, meta?: Record<string, unknown>) => {
      baseLogger.error(maskPII(message), error, {
        ...context,
        ...meta,
        traceId: process.env.TRACE_ID || randomUUID(),
        timestamp: new Date().toISOString(),
      });
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
      baseLogger.warn(maskPII(message), {
        ...context,
        ...meta,
        traceId: process.env.TRACE_ID || randomUUID(),
        timestamp: new Date().toISOString(),
      });
    },
    debug: (message: string, meta?: Record<string, unknown>) => {
      baseLogger.debug(maskPII(message), {
        ...context,
        ...meta,
        traceId: process.env.TRACE_ID || randomUUID(),
        timestamp: new Date().toISOString(),
      });
    },
  };
}

/**
 * Log exporter for OpenSearch
 */
export class OpenSearchLogExporter {
  private endpoint: string;
  private index: string;

  constructor(endpoint?: string, index?: string) {
    this.endpoint = endpoint || process.env.OPENSEARCH_ENDPOINT || 'http://localhost:9200';
    this.index = index || process.env.OPENSEARCH_INDEX || 'ai-accountant-logs';
  }

  async exportLog(log: {
    level: string;
    message: string;
    service: string;
    timestamp: string;
    traceId?: string;
    tenantId?: string;
    userId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      const response = await fetch(`${this.endpoint}/${this.index}/_doc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.OPENSEARCH_AUTH
            ? { Authorization: `Basic ${process.env.OPENSEARCH_AUTH}` }
            : {}),
        },
        body: JSON.stringify(log),
      });

      if (!response.ok) {
        console.error('Failed to export log to OpenSearch', await response.text());
      }
    } catch (error) {
      // Fail silently to avoid breaking application
      console.error('Error exporting log to OpenSearch', error);
    }
  }
}
