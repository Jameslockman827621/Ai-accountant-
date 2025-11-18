import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('resilience-service');

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  monitoringPeriod: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures: number = 0;
  private lastFailureTime: Date | undefined;
  private successCount: number = 0;
  private options: CircuitBreakerOptions;

  constructor(options: CircuitBreakerOptions = {
    failureThreshold: 5,
    resetTimeout: 60000, // 1 minute
    monitoringPeriod: 60000,
  }) {
    this.options = options;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (this.shouldAttemptReset()) {
        this.state = 'half-open';
        this.successCount = 0;
        logger.info('Circuit breaker entering half-open state');
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= 2) {
        this.state = 'closed';
        logger.info('Circuit breaker closed - service recovered');
      }
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = new Date();

    if (this.failures >= this.options.failureThreshold) {
      this.state = 'open';
      logger.warn('Circuit breaker opened - too many failures', {
        failures: this.failures,
        threshold: this.options.failureThreshold,
      });
    }
  }

  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) return false;
    const timeSinceLastFailure = Date.now() - this.lastFailureTime.getTime();
    return timeSinceLastFailure >= this.options.resetTimeout;
  }

  getState(): CircuitState {
    return this.state;
  }

  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successCount = 0;
    this.lastFailureTime = undefined;
    logger.info('Circuit breaker manually reset');
  }
}

export class RetryHandler {
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    backoffMs: number = 1000
  ): Promise<T> {
    let lastError: Error | unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        if (attempt < maxRetries) {
          const delay = backoffMs * Math.pow(2, attempt);
          logger.warn(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`, {
            error: error instanceof Error ? error.message : String(error),
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }
}

export const retryHandler = new RetryHandler();
