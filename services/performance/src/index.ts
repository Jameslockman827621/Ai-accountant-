import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('performance-harness');

export interface LoadTestResult {
  requests: number;
  failures: number;
  durationMs: number;
  avgLatencyMs: number;
}

export async function runGatewayLoadTest(
  targetUrl: string,
  concurrency = 10,
  durationMs = 30000
): Promise<LoadTestResult> {
  let requests = 0;
  let failures = 0;
  let totalLatency = 0;
  const stopAt = Date.now() + durationMs;

  async function worker(): Promise<void> {
    while (Date.now() < stopAt) {
      const start = Date.now();
      try {
        const response = await fetch(targetUrl, { method: 'GET' });
        requests += 1;
        if (!response.ok) {
          failures += 1;
        }
      } catch (error) {
        failures += 1;
        logger.warn('Load test request failed', error instanceof Error ? error : new Error(String(error)));
      } finally {
        totalLatency += Date.now() - start;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }).map(() => worker()));

  const avgLatencyMs = requests ? totalLatency / requests : 0;
  const result: LoadTestResult = { requests, failures, durationMs, avgLatencyMs };
  logger.info('Gateway load test complete', result);
  return result;
}
