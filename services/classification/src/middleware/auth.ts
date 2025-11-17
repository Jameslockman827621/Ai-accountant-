import { Request, Response, NextFunction } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('auth-middleware');

export interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    email: string;
    role: string;
  };
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  // In production, would verify JWT token
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const token = authHeader.substring(7);
  
  // For now, extract user from token (would verify JWT in production)
  // This is a placeholder - in production would decode and verify JWT
  try {
    // Simulated user extraction
    req.user = {
      id: 'user-id-from-token',
      tenantId: 'tenant-id-from-token',
      email: 'user@example.com',
      role: 'accountant',
    };
    next();
  } catch (error) {
    logger.error('Authentication failed', error instanceof Error ? error : new Error(String(error)));
    res.status(401).json({ error: 'Invalid token' });
  }
}
