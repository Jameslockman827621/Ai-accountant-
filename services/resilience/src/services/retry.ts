import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('resilience-service');

export interface RetryOptions {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
}

const defaultOptions: RetryOptions = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
};

export async function retry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...defaultOptions, ...options };
  let lastError: Error | unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if error is retryable
      if (opts.retryableErrors && error instanceof Error) {
        const isRetryable = opts.retryableErrors.some(pattern =>
          error.message.includes(pattern) || error.name.includes(pattern)
        );

        if (!isRetryable) {
          throw error;
        }
      }

      // Don't retry on last attempt
      if (attempt === opts.maxAttempts) {
        break;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        opts.initialDelay * Math.pow(opts.backoffMultiplier, attempt - 1),
        opts.maxDelay
      );

      logger.warn('Retrying operation', {
        attempt,
        maxAttempts: opts.maxAttempts,
        delay,
        error: error instanceof Error ? error.message : String(error),
      });

      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function retryWithCircuitBreaker<T>(
  fn: () => Promise<T>,
  circuitBreakerName: string,
  retryOptions?: Partial<RetryOptions>
): Promise<T> {
  const { getCircuitBreaker } = await import('./circuitBreaker');
  const circuitBreaker = getCircuitBreaker(circuitBreakerName);

  return circuitBreaker.execute(() => retry(fn, retryOptions));
}
