import { NextFunction, Response } from 'express';
import { JWTPayload } from '@ai-accountant/shared-utils';
import { AuthRequest, authenticate } from './auth';

export function authenticateServiceOrUser(req: AuthRequest, res: Response, next: NextFunction): void {
  const serviceToken = req.headers['x-service-token'];
  if (serviceToken && serviceToken === process.env.INTERNAL_SERVICE_TOKEN) {
    const tenantId = (req.headers['x-tenant-id'] as string) || (req.body?.tenantId as string) || (req.query.tenantId as string);
    if (tenantId) {
      const serviceUser: JWTPayload = {
        tenantId,
        userId: 'system-service',
        role: 'system',
      };
      req.user = serviceUser;
    }
    next();
    return;
  }

  authenticate(req, res, next);
}
