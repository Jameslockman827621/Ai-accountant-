import { retryHandler } from './circuitBreaker';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('resilience-service');

// Apply retry logic to all external API calls
export async function withRetry<T>(
  fn: () => Promise<T>,
  service: string,
  maxRetries: number = 3
): Promise<T> {
  return retryHandler.executeWithRetry(fn, maxRetries, 1000);
}

// OpenAI API calls with retry
export async function openAICallWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  return withRetry(fn, 'openai', 3);
}

// Plaid API calls with retry
export async function plaidCallWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  return withRetry(fn, 'plaid', 3);
}

// HMRC API calls with retry
export async function hmrcCallWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  return withRetry(fn, 'hmrc', 3);
}

// ChromaDB calls with retry
export async function chromaDBCallWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  return withRetry(fn, 'chromadb', 3);
}

// S3 calls with retry
export async function s3CallWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  return withRetry(fn, 's3', 3);
}

// Database calls with retry
export async function dbCallWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  return withRetry(fn, 'database', 3);
}
