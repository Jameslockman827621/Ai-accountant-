import { Request, Response, NextFunction } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { ValidationError } from '@ai-accountant/shared-utils';

const logger = createLogger('automation-service');

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error('Request error', { error: err });

  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message });
    return;
  }

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
}
