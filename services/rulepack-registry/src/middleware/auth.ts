import { Request, Response, NextFunction } from 'express';
import { JWTPayload, verifyToken, AuthenticationError } from '@ai-accountant/shared-utils';

export interface AuthRequest extends Request {
  user?: JWTPayload;
}

export function authenticate(req: AuthRequest, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthenticationError('Missing or invalid authorization header');
  }

  const token = authHeader.slice(7);

  try {
    req.user = verifyToken(token);
    next();
  } catch (error) {
    throw new AuthenticationError(
      `Invalid token: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
