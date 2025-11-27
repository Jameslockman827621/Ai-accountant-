import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('resilience-service');

export type ErrorCategory =
  | 'validation'
  | 'processing'
  | 'integration'
  | 'infrastructure'
  | 'security'
  | 'unknown';

export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  dlq: string;
}

export interface StandardizedErrorPolicy {
  code: string;
  category: ErrorCategory;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  retryPolicy: RetryPolicy;
}

const STANDARD_POLICIES: Record<string, StandardizedErrorPolicy> = {
  E_VALIDATION_001: {
    code: 'E_VALIDATION_001',
    category: 'validation',
    severity: 'low',
    description: 'Input validation failed',
    retryPolicy: {
      maxAttempts: 0,
      initialDelayMs: 0,
      maxDelayMs: 0,
      backoffMultiplier: 1,
      dlq: 'validation_dead_letters',
    },
  },
  E_PROCESSING_001: {
    code: 'E_PROCESSING_001',
    category: 'processing',
    severity: 'medium',
    description: 'Transient processing failure',
    retryPolicy: {
      maxAttempts: 5,
      initialDelayMs: 1000,
      maxDelayMs: 300000,
      backoffMultiplier: 2,
      dlq: 'processing_dead_letters',
    },
  },
  E_INTEGRATION_001: {
    code: 'E_INTEGRATION_001',
    category: 'integration',
    severity: 'high',
    description: 'Downstream dependency unavailable',
    retryPolicy: {
      maxAttempts: 4,
      initialDelayMs: 2000,
      maxDelayMs: 600000,
      backoffMultiplier: 2,
      dlq: 'integration_dead_letters',
    },
  },
  E_INFRA_001: {
    code: 'E_INFRA_001',
    category: 'infrastructure',
    severity: 'critical',
    description: 'Infrastructure outage or limit breach',
    retryPolicy: {
      maxAttempts: 6,
      initialDelayMs: 5000,
      maxDelayMs: 900000,
      backoffMultiplier: 2,
      dlq: 'infrastructure_dead_letters',
    },
  },
};

function fallbackPolicy(category: ErrorCategory): StandardizedErrorPolicy {
  return {
    code: 'E_UNKNOWN',
    category,
    severity: 'medium',
    description: 'Unclassified error',
    retryPolicy: {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 60000,
      backoffMultiplier: 2,
      dlq: 'generic_dead_letters',
    },
  };
}

export function resolveStandardPolicy(
  category: ErrorCategory,
  hintCode?: string
): StandardizedErrorPolicy {
  if (hintCode && STANDARD_POLICIES[hintCode]) {
    return STANDARD_POLICIES[hintCode];
  }

  const match = Object.values(STANDARD_POLICIES).find(policy => policy.category === category);
  return match || fallbackPolicy(category);
}

export function applyStandardCode(errorMessage: string, policy: StandardizedErrorPolicy): string {
  const prefixed = `[${policy.code}] ${errorMessage}`;
  if (!errorMessage.includes(policy.code)) {
    logger.debug('Applying standardized error code', { code: policy.code });
    return prefixed;
  }
  return errorMessage;
}

export function normalizeRetryPolicy(policy?: Partial<RetryPolicy>): RetryPolicy {
  if (!policy) {
    return fallbackPolicy('unknown').retryPolicy;
  }

  return {
    maxAttempts: policy.maxAttempts ?? 3,
    initialDelayMs: policy.initialDelayMs ?? 1000,
    maxDelayMs: policy.maxDelayMs ?? 300000,
    backoffMultiplier: policy.backoffMultiplier ?? 2,
    dlq: policy.dlq ?? 'generic_dead_letters',
  };
}
