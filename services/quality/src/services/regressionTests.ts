import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { randomUUID } from 'crypto';

const logger = createLogger('quality-service');

export interface RegressionTestResult {
  id: string;
  testSuite: string;
  testName: string;
  goldenDatasetId?: string;
  status: 'pass' | 'fail' | 'skipped' | 'error';
  executionTimeMs?: number;
  runAt: Date;
  runBy?: string;
  expectedOutput?: unknown;
  actualOutput?: unknown;
  diff?: unknown;
  errorMessage?: string;
  serviceVersion?: string;
  modelVersion?: string;
  environment?: string;
  metadata?: Record<string, unknown>;
}

export class RegressionTestService {
  async recordTestResult(
    testSuite: string,
    testName: string,
    status: RegressionTestResult['status'],
    options: {
      goldenDatasetId?: string;
      executionTimeMs?: number;
      runBy?: string;
      expectedOutput?: unknown;
      actualOutput?: unknown;
      diff?: unknown;
      errorMessage?: string;
      serviceVersion?: string;
      modelVersion?: string;
      environment?: string;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<RegressionTestResult> {
    const id = randomUUID();

    await db.query(
      `INSERT INTO regression_test_results (
        id, test_suite, test_name, golden_dataset_id, status,
        execution_time_ms, run_at, run_by, expected_output, actual_output,
        diff, error_message, service_version, model_version, environment, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16::jsonb)`,
      [
        id,
        testSuite,
        testName,
        options.goldenDatasetId || null,
        status,
        options.executionTimeMs || null,
        new Date(),
        options.runBy || null,
        options.expectedOutput ? JSON.stringify(options.expectedOutput) : null,
        options.actualOutput ? JSON.stringify(options.actualOutput) : null,
        options.diff ? JSON.stringify(options.diff) : null,
        options.errorMessage || null,
        options.serviceVersion || null,
        options.modelVersion || null,
        options.environment || null,
        options.metadata ? JSON.stringify(options.metadata) : null,
      ]
    );

    logger.info('Regression test result recorded', { id, testSuite, testName, status });
    return this.getTestResult(id);
  }

  async getTestResult(id: string): Promise<RegressionTestResult> {
    const result = await db.query<{
      id: string;
      test_suite: string;
      test_name: string;
      golden_dataset_id: string | null;
      status: string;
      execution_time_ms: number | null;
      run_at: Date;
      run_by: string | null;
      expected_output: unknown;
      actual_output: unknown;
      diff: unknown;
      error_message: string | null;
      service_version: string | null;
      model_version: string | null;
      environment: string | null;
      metadata: unknown;
    }>('SELECT * FROM regression_test_results WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      throw new Error(`Regression test result not found: ${id}`);
    }

    const row = result.rows[0];
    return {
      id: row.id,
      testSuite: row.test_suite,
      testName: row.test_name,
      goldenDatasetId: row.golden_dataset_id || undefined,
      status: row.status as RegressionTestResult['status'],
      executionTimeMs: row.execution_time_ms || undefined,
      runAt: row.run_at,
      runBy: row.run_by || undefined,
      expectedOutput: row.expected_output,
      actualOutput: row.actual_output,
      diff: row.diff,
      errorMessage: row.error_message || undefined,
      serviceVersion: row.service_version || undefined,
      modelVersion: row.model_version || undefined,
      environment: row.environment || undefined,
      metadata: row.metadata as Record<string, unknown> | undefined,
    };
  }

  async getTestResults(filters: {
    testSuite?: string;
    status?: RegressionTestResult['status'];
    environment?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ results: RegressionTestResult[]; total: number }> {
    let query = 'SELECT * FROM regression_test_results WHERE 1=1';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.testSuite) {
      query += ` AND test_suite = $${paramIndex++}`;
      params.push(filters.testSuite);
    }
    if (filters.status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(filters.status);
    }
    if (filters.environment) {
      query += ` AND environment = $${paramIndex++}`;
      params.push(filters.environment);
    }

    // Count total
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*)');
    const countResult = await db.query<{ count: string }>(countQuery, params);
    const total = parseInt(countResult.rows[0].count, 10);

    query += ' ORDER BY run_at DESC';
    if (filters.limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(filters.limit);
    }
    if (filters.offset) {
      query += ` OFFSET $${paramIndex++}`;
      params.push(filters.offset);
    }

    const result = await db.query<{
      id: string;
      test_suite: string;
      test_name: string;
      golden_dataset_id: string | null;
      status: string;
      execution_time_ms: number | null;
      run_at: Date;
      run_by: string | null;
      expected_output: unknown;
      actual_output: unknown;
      diff: unknown;
      error_message: string | null;
      service_version: string | null;
      model_version: string | null;
      environment: string | null;
      metadata: unknown;
    }>(query, params);

    return {
      results: result.rows.map((row) => ({
        id: row.id,
        testSuite: row.test_suite,
        testName: row.test_name,
        goldenDatasetId: row.golden_dataset_id || undefined,
        status: row.status as RegressionTestResult['status'],
        executionTimeMs: row.execution_time_ms || undefined,
        runAt: row.run_at,
        runBy: row.run_by || undefined,
        expectedOutput: row.expected_output,
        actualOutput: row.actual_output,
        diff: row.diff,
        errorMessage: row.error_message || undefined,
        serviceVersion: row.service_version || undefined,
        modelVersion: row.model_version || undefined,
        environment: row.environment || undefined,
        metadata: row.metadata as Record<string, unknown> | undefined,
      })),
      total,
    };
  }

  async getTestSuiteSummary(testSuite: string, environment?: string): Promise<{
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    error: number;
    passRate: number;
    averageExecutionTimeMs: number;
  }> {
    let query = `
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pass') as passed,
        COUNT(*) FILTER (WHERE status = 'fail') as failed,
        COUNT(*) FILTER (WHERE status = 'skipped') as skipped,
        COUNT(*) FILTER (WHERE status = 'error') as error,
        AVG(execution_time_ms) as avg_time
      FROM regression_test_results
      WHERE test_suite = $1
    `;
    const params: unknown[] = [testSuite];

    if (environment) {
      query += ' AND environment = $2';
      params.push(environment);
    }

    const result = await db.query<{
      total: string;
      passed: string;
      failed: string;
      skipped: string;
      error: string;
      avg_time: number | null;
    }>(query, params);

    const row = result.rows[0];
    const total = parseInt(row.total, 10);
    const passed = parseInt(row.passed, 10);
    const failed = parseInt(row.failed, 10);
    const skipped = parseInt(row.skipped, 10);
    const error = parseInt(row.error, 10);

    return {
      total,
      passed,
      failed,
      skipped,
      error,
      passRate: total > 0 ? (passed / total) * 100 : 0,
      averageExecutionTimeMs: row.avg_time || 0,
    };
  }
}

export const regressionTestService = new RegressionTestService();
