import { Request, Response, NextFunction } from 'express';
import { verifyToken, JWTPayload } from '@ai-accountant/shared-utils';
import { AuthenticationError, AuthorizationError } from '@ai-accountant/shared-utils';
import { UserRole } from '@ai-accountant/shared-types';

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

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AuthenticationError('Authentication required');
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new AuthorizationError(`Required role: ${allowedRoles.join(' or ')}`);
    }

    next();
  };
}

export function requireTenantAccess(req: AuthRequest, _res: Response, next: NextFunction): void {
  if (!req.user) {
    throw new AuthenticationError('Authentication required');
  }

  // Super admins can access any tenant
  if (req.user.role === UserRole.SUPER_ADMIN) {
    next();
    return;
  }

  // Extract tenant ID from params or body
  const requestedTenantId = req.params.tenantId || req.body.tenantId || req.query.tenantId;

  // Users can only access their own tenant
  if (requestedTenantId && requestedTenantId !== req.user.tenantId) {
    throw new AuthorizationError('Access denied to this tenant');
  }

  next();
}
