import { CircuitBreaker, RetryHandler } from './circuitBreaker';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('resilience-service');

// Circuit breakers for all external services
export const openAICircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 60000,
  monitoringPeriod: 60000,
});

export const plaidCircuitBreaker = new CircuitBreaker({
  failureThreshold: 3,
  resetTimeout: 30000,
  monitoringPeriod: 30000,
});

export const hmrcCircuitBreaker = new CircuitBreaker({
  failureThreshold: 3,
  resetTimeout: 60000,
  monitoringPeriod: 60000,
});

export const chromaDBCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 30000,
  monitoringPeriod: 30000,
});

export const s3CircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 30000,
  monitoringPeriod: 30000,
});

// Retry handlers
export const retryHandler = new RetryHandler();

// Wrapper for OpenAI calls with circuit breaker and retry
export async function resilientOpenAICall<T>(fn: () => Promise<T>): Promise<T> {
  return openAICircuitBreaker.execute(() =>
    retryHandler.executeWithRetry(fn, 3, 1000)
  );
}

// Wrapper for Plaid calls
export async function resilientPlaidCall<T>(fn: () => Promise<T>): Promise<T> {
  return plaidCircuitBreaker.execute(() =>
    retryHandler.executeWithRetry(fn, 3, 1000)
  );
}

// Wrapper for HMRC calls
export async function resilientHMRCCall<T>(fn: () => Promise<T>): Promise<T> {
  return hmrcCircuitBreaker.execute(() =>
    retryHandler.executeWithRetry(fn, 3, 2000)
  );
}
