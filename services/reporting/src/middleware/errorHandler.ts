import { Request, Response, NextFunction } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AppError } from '@ai-accountant/shared-utils';

const logger = createLogger('reporting-service');

export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const errorMessage = err instanceof Error ? err.message : String(err);
  const errorStack = err instanceof Error ? err.stack : undefined;
  
  logger.error('Request error', {
    error: errorMessage,
    stack: errorStack,
    path: req.path,
    method: req.method,
  });

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
    return;
  }

  res.status(500).json({
    error: 'Internal server error',
  });
}
