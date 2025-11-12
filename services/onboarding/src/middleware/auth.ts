import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '@ai-accountant/shared-utils';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('onboarding-service');

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    tenantId: string;
    email: string;
    role: string;
  };
}

export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized - No token provided' });
      return;
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    req.user = {
      userId: decoded.userId,
      tenantId: decoded.tenantId,
      email: decoded.email,
      role: decoded.role,
    };

    next();
  } catch (error) {
    logger.error('Authentication failed', error instanceof Error ? error : new Error(String(error)));
    res.status(401).json({ error: 'Unauthorized - Invalid token' });
  }
}
