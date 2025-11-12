import jwt from 'jsonwebtoken';
import type { UserId, TenantId, UserRole } from '@ai-accountant/shared-types';

export interface JWTPayload {
  userId: UserId;
  tenantId: TenantId;
  role: UserRole;
  email: string;
  iat?: number;
  exp?: number;
}

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export function generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
    issuer: 'ai-accountant',
    audience: 'ai-accountant-api',
  });
}

export function verifyToken(token: string): JWTPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: 'ai-accountant',
      audience: 'ai-accountant-api',
    }) as JWTPayload;
    return decoded;
  } catch (error) {
    throw new Error(`Invalid token: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export function decodeToken(token: string): JWTPayload | null {
  try {
    return jwt.decode(token) as JWTPayload;
  } catch {
    return null;
  }
}
