import { Request, Response, NextFunction } from 'express';
import { verifyToken, JWTPayload } from '@ai-accountant/shared-utils';
import { AuthenticationError } from '@ai-accountant/shared-utils';

export interface AuthRequest extends Request {
  user?: JWTPayload;
}

export function authenticate(req: AuthRequest, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthenticationError('Missing or invalid authorization header');
  }

  const token = authHeader.substring(7);
  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch (error) {
    throw new AuthenticationError(`Invalid token: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
