import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('onboarding-connectivity');

export interface DependencyCheckResult {
  name: string;
  success: boolean;
  latencyMs: number;
  attempts: number;
  error?: string;
}

interface DependencyConfig {
  name: string;
  type: 'http' | 'database';
  url?: string;
  timeoutMs?: number;
  retries?: number;
}

interface ConnectivityTelemetry {
  targetService: string;
  durationMs: number;
  success: boolean;
  attempt: number;
  errorMessage?: string;
}

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_RETRIES = 2;
const MONITORING_BASE_URL = process.env.MONITORING_BASE_URL || 'http://localhost:3010';

async function sendConnectivityTelemetry(data: ConnectivityTelemetry): Promise<void> {
  try {
    await fetch(`${MONITORING_BASE_URL}/api/telemetry/connectivity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sourceService: 'onboarding-service',
        ...data,
      }),
    });
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    logger.warn('Failed to send connectivity telemetry', {
      error: normalizedError.message,
      target: data.targetService,
    });
  }
}

async function performHttpCheck(dep: DependencyConfig, attempt: number): Promise<DependencyCheckResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dep.timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(dep.url as string, { signal: controller.signal });
    const duration = Date.now() - start;
    clearTimeout(timeout);

    const success = response.ok;
    const errorMessage = success ? undefined : `HTTP ${response.status}`;

    await sendConnectivityTelemetry({
      targetService: dep.name,
      durationMs: duration,
      success,
      attempt,
      errorMessage,
    });

    return {
      name: dep.name,
      success,
      latencyMs: duration,
      attempts: attempt,
      error: errorMessage,
    };
  } catch (error) {
    const duration = Date.now() - start;
    const normalizedError = error instanceof Error ? error : new Error(String(error));

    await sendConnectivityTelemetry({
      targetService: dep.name,
      durationMs: duration,
      success: false,
      attempt,
      errorMessage: normalizedError.message,
    });

    return {
      name: dep.name,
      success: false,
      latencyMs: duration,
      attempts: attempt,
      error: normalizedError.message,
    };
  }
}

async function performDatabaseCheck(attempt: number): Promise<DependencyCheckResult> {
  const start = Date.now();
  try {
    await db.query('SELECT 1');
    const duration = Date.now() - start;

    await sendConnectivityTelemetry({
      targetService: 'database',
      durationMs: duration,
      success: true,
      attempt,
    });

    return {
      name: 'database',
      success: true,
      latencyMs: duration,
      attempts: attempt,
    };
  } catch (error) {
    const duration = Date.now() - start;
    const normalizedError = error instanceof Error ? error : new Error(String(error));

    await sendConnectivityTelemetry({
      targetService: 'database',
      durationMs: duration,
      success: false,
      attempt,
      errorMessage: normalizedError.message,
    });

    return {
      name: 'database',
      success: false,
      latencyMs: duration,
      attempts: attempt,
      error: normalizedError.message,
    };
  }
}

async function checkDependency(dep: DependencyConfig): Promise<DependencyCheckResult> {
  const retries = dep.retries ?? DEFAULT_RETRIES;
  let attempt = 0;
  let lastResult: DependencyCheckResult | undefined;

  while (attempt < retries) {
    attempt += 1;
    if (dep.type === 'database') {
      lastResult = await performDatabaseCheck(attempt);
    } else {
      lastResult = await performHttpCheck(dep, attempt);
    }

    if (lastResult.success) {
      break;
    }

    // Backoff slightly before retrying
    await new Promise(resolve => setTimeout(resolve, 200 * attempt));
  }

  return (
    lastResult || {
      name: dep.name,
      success: false,
      latencyMs: 0,
      attempts: retries,
      error: 'No attempts executed',
    }
  );
}

export async function runConnectivityChecks(): Promise<{
  dependencies: DependencyCheckResult[];
}> {
  const dependencies: DependencyConfig[] = [
    { name: 'database', type: 'database', retries: 3 },
    {
      name: 'compliance-service',
      type: 'http',
      url: `${process.env.COMPLIANCE_SERVICE_URL || 'http://localhost:3005'}/health`,
    },
    {
      name: 'bank-feed-service',
      type: 'http',
      url: `${process.env.BANK_FEED_SERVICE_URL || 'http://localhost:3020'}/health`,
    },
  ];

  const results: DependencyCheckResult[] = [];

  for (const dep of dependencies) {
    try {
      const result = await checkDependency(dep);
      results.push(result);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      logger.error('Connectivity check failed', {
        dependency: dep.name,
        error: normalizedError.message,
      });
      results.push({
        name: dep.name,
        success: false,
        latencyMs: 0,
        attempts: dep.retries ?? DEFAULT_RETRIES,
        error: normalizedError.message,
      });
    }
  }

  return { dependencies: results };
}
