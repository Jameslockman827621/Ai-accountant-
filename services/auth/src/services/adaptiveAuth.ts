import { Request } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';

export type AdaptiveRiskLevel = 'low' | 'medium' | 'high' | 'block';

interface AdaptiveRisk {
  level: AdaptiveRiskLevel;
  factors: string[];
}

interface UserRiskContext {
  id: string;
  email: string;
  tenantId?: string;
  mfaEnabled?: boolean;
  lastLoginAt?: Date | null;
}

const logger = createLogger('auth-service');

function evaluateUserAgent(userAgent?: string): { factor?: string; score: number } {
  if (!userAgent) return { score: 2, factor: 'missing_user_agent' };
  if (userAgent.includes('Postman') || userAgent.toLowerCase().includes('curl')) {
    return { score: 3, factor: 'suspicious_client' };
  }
  return { score: 0 };
}

function evaluateIpAddress(ip?: string): { factor?: string; score: number } {
  if (!ip) return { score: 2, factor: 'missing_ip' };
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) {
    return { score: 0 };
  }
  return { score: 1, factor: 'untrusted_network' };
}

export function evaluateAdaptiveRisk(req: Request, user: UserRiskContext): AdaptiveRisk {
  const factors: string[] = [];
  let score = 0;

  const userAgentResult = evaluateUserAgent(req.headers['user-agent']);
  score += userAgentResult.score;
  if (userAgentResult.factor) factors.push(userAgentResult.factor);

  const ipResult = evaluateIpAddress(req.ip || req.headers['x-forwarded-for'] as string);
  score += ipResult.score;
  if (ipResult.factor) factors.push(ipResult.factor);

  if (!user.mfaEnabled) {
    score += 1;
    factors.push('mfa_disabled');
  }

  if (!user.lastLoginAt) {
    score += 2;
    factors.push('first_login');
  }

  const level: AdaptiveRiskLevel = score >= 5 ? 'block' : score >= 3 ? 'high' : score >= 2 ? 'medium' : 'low';
  logger.info('Adaptive auth risk evaluation', {
    userId: user.id,
    email: user.email,
    level,
    score,
    factors,
  });

  return { level, factors };
}
