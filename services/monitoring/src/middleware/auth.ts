import { Request, Response, NextFunction } from 'express';
import { verifyToken, JWTPayload } from '@ai-accountant/shared-utils';
import { UserRole } from '@ai-accountant/shared-types';
import { AuthenticationError } from '@ai-accountant/shared-utils';

export interface AuthRequest extends Request {
  user?: JWTPayload;
}

function getServiceToken(req: Request): string | null {
  const headerToken = req.headers['x-service-token'];
  if (typeof headerToken === 'string') return headerToken;
  if (Array.isArray(headerToken)) return headerToken[0];
  return null;
}

export function authenticate(req: AuthRequest, _res: Response, next: NextFunction): void {
  const serviceToken = getServiceToken(req);
  const expectedServiceToken = process.env.MONITORING_SERVICE_TOKEN || process.env.SERVICE_AUTH_TOKEN;

  if (serviceToken && expectedServiceToken && serviceToken === expectedServiceToken) {
    req.user = {
      userId: 'monitoring-service',
      tenantId: 'system',
      role: UserRole.SUPER_ADMIN,
      email: 'monitoring-service@internal',
    } satisfies JWTPayload;
    return next();
  }

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
