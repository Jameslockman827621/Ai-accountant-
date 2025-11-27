import { createLogger } from '@ai-accountant/shared-utils';
import { runGatewayLoadTest, LoadTestResult } from '@ai-accountant/performance';

const logger = createLogger('chaos-load-harness');

export async function executeGatewayLoad(targetUrl: string): Promise<LoadTestResult> {
  logger.info('Starting gateway load test', { targetUrl });
  const result = await runGatewayLoadTest(targetUrl, 15, 45000);
  return result;
}
