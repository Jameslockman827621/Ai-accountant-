import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('chaos-service');

export interface ChaosTestResult {
  id: string;
  testName: string;
  testType: 'connector_outage' | 'queue_delay' | 'db_failover' | 'service_degradation' | 'other';
  startedAt: Date;
  completedAt?: Date;
  durationSeconds?: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  affectedServices?: string[];
  affectedTenants?: TenantId[];
  errorRateBefore?: number;
  errorRateDuring?: number;
  errorRateAfter?: number;
  recoveryTimeSeconds?: number;
  testPassed?: boolean;
  failurePoints?: Record<string, unknown>;
  recoveryActions?: Record<string, unknown>;
  lessonsLearned?: string;
  environment?: string;
  runBy?: string;
  metadata?: Record<string, unknown>;
}

export class ChaosTestService {
  async startTest(
    testName: string,
    testType: ChaosTestResult['testType'],
    options: {
      affectedServices?: string[];
      affectedTenants?: TenantId[];
      environment?: string;
      runBy?: string;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<ChaosTestResult> {
    const id = randomUUID();

    await db.query(
      `INSERT INTO chaos_test_results (
        id, test_name, test_type, started_at, status,
        affected_services, affected_tenants, environment, run_by, metadata
      ) VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        id,
        testName,
        testType,
        'running',
        options.affectedServices || null,
        options.affectedTenants || null,
        options.environment || null,
        options.runBy || null,
        options.metadata ? JSON.stringify(options.metadata) : null,
      ]
    );

    logger.info('Chaos test started', { id, testName, testType });
    return this.getTestResult(id);
  }

  async completeTest(
    id: string,
    status: 'completed' | 'failed' | 'cancelled',
    options: {
      errorRateBefore?: number;
      errorRateDuring?: number;
      errorRateAfter?: number;
      recoveryTimeSeconds?: number;
      testPassed?: boolean;
      failurePoints?: Record<string, unknown>;
      recoveryActions?: Record<string, unknown>;
      lessonsLearned?: string;
    } = {}
  ): Promise<ChaosTestResult> {
    const test = await this.getTestResult(id);
    const completedAt = new Date();
    const durationSeconds = Math.floor((completedAt.getTime() - test.startedAt.getTime()) / 1000);

    await db.query(
      `UPDATE chaos_test_results SET
        completed_at = NOW(),
        duration_seconds = $1,
        status = $2,
        error_rate_before = $3,
        error_rate_during = $4,
        error_rate_after = $5,
        recovery_time_seconds = $6,
        test_passed = $7,
        failure_points = $8::jsonb,
        recovery_actions = $9::jsonb,
        lessons_learned = $10
      WHERE id = $11`,
      [
        durationSeconds,
        status,
        options.errorRateBefore || null,
        options.errorRateDuring || null,
        options.errorRateAfter || null,
        options.recoveryTimeSeconds || null,
        options.testPassed !== undefined ? options.testPassed : null,
        options.failurePoints ? JSON.stringify(options.failurePoints) : null,
        options.recoveryActions ? JSON.stringify(options.recoveryActions) : null,
        options.lessonsLearned || null,
        id,
      ]
    );

    logger.info('Chaos test completed', { id, status, testPassed: options.testPassed });
    return this.getTestResult(id);
  }

  async getTestResult(id: string): Promise<ChaosTestResult> {
    const result = await db.query<{
      id: string;
      test_name: string;
      test_type: string;
      started_at: Date;
      completed_at: Date | null;
      duration_seconds: number | null;
      status: string;
      affected_services: string[] | null;
      affected_tenants: string[] | null;
      error_rate_before: number | null;
      error_rate_during: number | null;
      error_rate_after: number | null;
      recovery_time_seconds: number | null;
      test_passed: boolean | null;
      failure_points: unknown;
      recovery_actions: unknown;
      lessons_learned: string | null;
      environment: string | null;
      run_by: string | null;
      metadata: unknown;
    }>('SELECT * FROM chaos_test_results WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      throw new Error(`Chaos test result not found: ${id}`);
    }

    const row = result.rows[0];
    return {
      id: row.id,
      testName: row.test_name,
      testType: row.test_type as ChaosTestResult['testType'],
      startedAt: row.started_at,
      completedAt: row.completed_at || undefined,
      durationSeconds: row.duration_seconds || undefined,
      status: row.status as ChaosTestResult['status'],
      affectedServices: row.affected_services || undefined,
      affectedTenants: row.affected_tenants as TenantId[] | undefined,
      errorRateBefore: row.error_rate_before || undefined,
      errorRateDuring: row.error_rate_during || undefined,
      errorRateAfter: row.error_rate_after || undefined,
      recoveryTimeSeconds: row.recovery_time_seconds || undefined,
      testPassed: row.test_passed !== null ? row.test_passed : undefined,
      failurePoints: row.failure_points as Record<string, unknown> | undefined,
      recoveryActions: row.recovery_actions as Record<string, unknown> | undefined,
      lessonsLearned: row.lessons_learned || undefined,
      environment: row.environment || undefined,
      runBy: row.run_by || undefined,
      metadata: row.metadata as Record<string, unknown> | undefined,
    };
  }

  async getTestResults(filters: {
    testType?: ChaosTestResult['testType'];
    status?: ChaosTestResult['status'];
    testPassed?: boolean;
    environment?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ results: ChaosTestResult[]; total: number }> {
    let query = 'SELECT * FROM chaos_test_results WHERE 1=1';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.testType) {
      query += ` AND test_type = $${paramIndex++}`;
      params.push(filters.testType);
    }
    if (filters.status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(filters.status);
    }
    if (filters.testPassed !== undefined) {
      query += ` AND test_passed = $${paramIndex++}`;
      params.push(filters.testPassed);
    }
    if (filters.environment) {
      query += ` AND environment = $${paramIndex++}`;
      params.push(filters.environment);
    }

    // Count total
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*)');
    const countResult = await db.query<{ count: string }>(countQuery, params);
    const total = parseInt(countResult.rows[0].count, 10);

    query += ' ORDER BY started_at DESC';
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
      test_name: string;
      test_type: string;
      started_at: Date;
      completed_at: Date | null;
      duration_seconds: number | null;
      status: string;
      affected_services: string[] | null;
      affected_tenants: string[] | null;
      error_rate_before: number | null;
      error_rate_during: number | null;
      error_rate_after: number | null;
      recovery_time_seconds: number | null;
      test_passed: boolean | null;
      failure_points: unknown;
      recovery_actions: unknown;
      lessons_learned: string | null;
      environment: string | null;
      run_by: string | null;
      metadata: unknown;
    }>(query, params);

    return {
      results: result.rows.map((row) => ({
        id: row.id,
        testName: row.test_name,
        testType: row.test_type as ChaosTestResult['testType'],
        startedAt: row.started_at,
        completedAt: row.completed_at || undefined,
        durationSeconds: row.duration_seconds || undefined,
        status: row.status as ChaosTestResult['status'],
        affectedServices: row.affected_services || undefined,
        affectedTenants: row.affected_tenants as TenantId[] | undefined,
        errorRateBefore: row.error_rate_before || undefined,
        errorRateDuring: row.error_rate_during || undefined,
        errorRateAfter: row.error_rate_after || undefined,
        recoveryTimeSeconds: row.recovery_time_seconds || undefined,
        testPassed: row.test_passed !== null ? row.test_passed : undefined,
        failurePoints: row.failure_points as Record<string, unknown> | undefined,
        recoveryActions: row.recovery_actions as Record<string, unknown> | undefined,
        lessonsLearned: row.lessons_learned || undefined,
        environment: row.environment || undefined,
        runBy: row.run_by || undefined,
        metadata: row.metadata as Record<string, unknown> | undefined,
      })),
      total,
    };
  }
}

export const chaosTestService = new ChaosTestService();
