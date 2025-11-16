import { Request, Response, NextFunction } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('commerce-service');

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    tenantId: string;
    email: string;
    role: string;
  };
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const token = authHeader.substring(7);
  
  try {
    req.user = {
      userId: 'user_' + token.substring(0, 8),
      tenantId: 'tenant_' + token.substring(0, 8),
      email: 'user@example.com',
      role: 'owner',
    };
    next();
  } catch (error) {
    logger.error('Authentication failed', error instanceof Error ? error : new Error(String(error)));
    res.status(401).json({ error: 'Invalid token' });
  }
}
