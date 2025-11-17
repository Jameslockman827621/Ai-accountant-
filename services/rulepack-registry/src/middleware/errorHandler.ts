import { Request, Response, NextFunction } from 'express';
import { createLogger, ValidationError, AuthenticationError } from '@ai-accountant/shared-utils';

const logger = createLogger('rulepack-registry-error');

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof ValidationError) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (error instanceof AuthenticationError) {
    res.status(401).json({ error: error.message });
    return;
  }

  logger.error('Unhandled error', error instanceof Error ? error : new Error(String(error)));
  res.status(500).json({ error: 'Internal server error' });
}
