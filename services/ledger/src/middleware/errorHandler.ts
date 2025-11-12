import { Request, Response, NextFunction } from 'express';
import { AppError } from '@ai-accountant/shared-utils';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('ledger-service');

export function errorHandler(
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    logger.error(err.message, err, { code: err.code, statusCode: err.statusCode });
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  logger.error('Unhandled error', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
