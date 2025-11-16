import { Request, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('payroll-service');

export function errorHandler(err: unknown, _req: Request, res: Response, _next: unknown): void {
  logger.error('Request error', err instanceof Error ? err : new Error(String(err)));

  if (err instanceof Error) {
    res.status(500).json({
      error: err.message || 'Internal server error',
    });
  } else {
    res.status(500).json({
      error: 'Internal server error',
    });
  }
}
