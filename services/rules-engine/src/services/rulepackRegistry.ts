import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { createHash } from 'crypto';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('rulepack-registry');

export interface Rulepack {
  id: string;
  jurisdiction: string;
  jurisdictionCode?: string;
  version: string;
  status: 'draft' | 'pending_approval' | 'active' | 'deprecated' | 'archived';
  isActive: boolean;
  checksum: string;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  rulepackData: Record<string, unknown>;
  metadata: Record<string, unknown>;
  regressionTests: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
    expectedOutput: Record<string, unknown>;
  }>;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
}

export interface RegressionRun {
  id: string;
  rulepackId: string;
  runType: 'pre_activation' | 'scheduled' | 'manual';
  status: 'running' | 'passed' | 'failed' | 'partial';
  totalTests: number;
  passedTests: number;
  failedTests: number;
  testResults: Array<{
    testId: string;
    status: 'passed' | 'failed';
    error?: string;
    duration: number;
  }>;
  startedAt: Date;
  completedAt: Date | null;
  errorMessage: string | null;
}

/**
 * Rulepack Registry Service (Chunk 1)
 * Manages tax rulepack lifecycle, versioning, and activation
 */
export class RulepackRegistryService {
  /**
   * Install/upload a new rulepack
   */
  async installRulepack(
    jurisdiction: string,
    version: string,
    rulepackData: Record<string, unknown>,
    metadata: Record<string, unknown> = {},
    regressionTests: Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
      expectedOutput: Record<string, unknown>;
    }> = [],
    createdBy: UserId
  ): Promise<string> {
    // Calculate checksum
    const checksum = this.calculateChecksum(rulepackData);

    // Check for duplicate
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM rulepack_registry
       WHERE jurisdiction = $1 AND version = $2`,
      [jurisdiction, version]
    );

    if (existing.rows.length > 0) {
      throw new Error(`Rulepack ${jurisdiction} v${version} already exists`);
    }

    const result = await db.query<{ id: string }>(
      `INSERT INTO rulepack_registry (
        id, jurisdiction, jurisdiction_code, version, status, is_active,
        checksum, rulepack_data, metadata, regression_tests, created_by,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, 'draft', false, $4, $5::jsonb, $6::jsonb,
        $7::jsonb, $8, NOW(), NOW()
      ) RETURNING id`,
      [
        jurisdiction,
        metadata.jurisdictionCode || jurisdiction,
        version,
        checksum,
        JSON.stringify(rulepackData),
        JSON.stringify(metadata),
        JSON.stringify(regressionTests),
        createdBy,
      ]
    );

    const rulepackId = result.rows[0].id;
    logger.info('Rulepack installed', { rulepackId, jurisdiction, version });

    return rulepackId;
  }

  /**
   * Activate a rulepack (requires approval and passing regression tests)
   */
  async activateRulepack(
    rulepackId: string,
    approvedBy: UserId,
    effectiveFrom?: Date
  ): Promise<void> {
    // Get rulepack
    const rulepack = await this.getRulepack(rulepackId);
    if (!rulepack) {
      throw new Error('Rulepack not found');
    }

    // Check if regression tests have passed
    const latestRun = await this.getLatestRegressionRun(rulepackId);
    if (!latestRun || latestRun.status !== 'passed') {
      throw new Error('Rulepack must pass regression tests before activation');
    }

    // Deactivate other versions for same jurisdiction
    await db.query(
      `UPDATE rulepack_registry
       SET is_active = false, status = 'deprecated', updated_at = NOW()
       WHERE jurisdiction = $1 AND id != $2 AND is_active = true`,
      [rulepack.jurisdiction, rulepackId]
    );

    // Activate this version
    await db.query(
      `UPDATE rulepack_registry
       SET is_active = true,
           status = 'active',
           approved_by = $1,
           approved_at = NOW(),
           effective_from = COALESCE($2, NOW()),
           updated_at = NOW()
       WHERE id = $3`,
      [approvedBy, effectiveFrom || new Date(), rulepackId]
    );

    logger.info('Rulepack activated', { rulepackId, jurisdiction: rulepack.jurisdiction });
  }

  /**
   * Get active rulepack for jurisdiction
   */
  async getActiveRulepack(jurisdiction: string): Promise<Rulepack | null> {
    const result = await db.query<{
      id: string;
      jurisdiction: string;
      jurisdiction_code: string | null;
      version: string;
      status: string;
      is_active: boolean;
      checksum: string;
      effective_from: Date | null;
      effective_to: Date | null;
      rulepack_data: unknown;
      metadata: unknown;
      regression_tests: unknown;
      approved_by: string | null;
      approved_at: Date | null;
      created_at: Date;
    }>(
      `SELECT * FROM rulepack_registry
       WHERE jurisdiction = $1 AND is_active = true
       ORDER BY effective_from DESC
       LIMIT 1`,
      [jurisdiction]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToRulepack(result.rows[0]);
  }

  /**
   * Get rulepack by ID
   */
  async getRulepack(rulepackId: string): Promise<Rulepack | null> {
    const result = await db.query<{
      id: string;
      jurisdiction: string;
      jurisdiction_code: string | null;
      version: string;
      status: string;
      is_active: boolean;
      checksum: string;
      effective_from: Date | null;
      effective_to: Date | null;
      rulepack_data: unknown;
      metadata: unknown;
      regression_tests: unknown;
      approved_by: string | null;
      approved_at: Date | null;
      created_at: Date;
    }>(
      `SELECT * FROM rulepack_registry WHERE id = $1`,
      [rulepackId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToRulepack(result.rows[0]);
  }

  /**
   * List all rulepacks
   */
  async listRulepacks(jurisdiction?: string): Promise<Rulepack[]> {
    let query = `SELECT * FROM rulepack_registry`;
    const params: unknown[] = [];

    if (jurisdiction) {
      query += ` WHERE jurisdiction = $1`;
      params.push(jurisdiction);
    }

    query += ` ORDER BY jurisdiction, version DESC`;

    const result = await db.query<{
      id: string;
      jurisdiction: string;
      jurisdiction_code: string | null;
      version: string;
      status: string;
      is_active: boolean;
      checksum: string;
      effective_from: Date | null;
      effective_to: Date | null;
      rulepack_data: unknown;
      metadata: unknown;
      regression_tests: unknown;
      approved_by: string | null;
      approved_at: Date | null;
      created_at: Date;
    }>(query, params);

    return result.rows.map(row => this.mapRowToRulepack(row));
  }

  /**
   * Run regression tests for rulepack
   */
  async runRegressionTests(
    rulepackId: string,
    runType: 'pre_activation' | 'scheduled' | 'manual' = 'manual',
    executedBy?: UserId
  ): Promise<string> {
    const rulepack = await this.getRulepack(rulepackId);
    if (!rulepack) {
      throw new Error('Rulepack not found');
    }

    // Create regression run
    const runResult = await db.query<{ id: string }>(
      `INSERT INTO rulepack_regression_runs (
        id, rulepack_id, run_type, status, total_tests, started_at, executed_by
      ) VALUES (
        gen_random_uuid(), $1, $2, 'running', $3, NOW(), $4
      ) RETURNING id`,
      [rulepackId, runType, rulepack.regressionTests.length, executedBy || null]
    );

    const runId = runResult.rows[0].id;

    // Run tests asynchronously
    this.executeRegressionTests(runId, rulepack).catch(error => {
      logger.error('Regression tests failed', error instanceof Error ? error : new Error(String(error)));
    });

    return runId;
  }

  /**
   * Execute regression tests
   */
  private async executeRegressionTests(runId: string, rulepack: Rulepack): Promise<void> {
    const testResults: Array<{
      testId: string;
      status: 'passed' | 'failed';
      error?: string;
      duration: number;
    }> = [];

    let passedTests = 0;
    let failedTests = 0;

    for (const test of rulepack.regressionTests) {
      const startTime = Date.now();
      try {
        // Execute test (in production, would use actual rulepack engine)
        const actualOutput = await this.executeTest(rulepack.rulepackData, test.input);
        const passed = this.compareOutputs(actualOutput, test.expectedOutput);

        const duration = Date.now() - startTime;
        if (passed) {
          passedTests++;
          testResults.push({ testId: test.id, status: 'passed', duration });
        } else {
          failedTests++;
          testResults.push({
            testId: test.id,
            status: 'failed',
            error: 'Output mismatch',
            duration,
          });
        }
      } catch (error) {
        failedTests++;
        testResults.push({
          testId: test.id,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - startTime,
        });
      }
    }

    // Update run status
    const status = failedTests === 0 ? 'passed' : passedTests === 0 ? 'failed' : 'partial';
    await db.query(
      `UPDATE rulepack_regression_runs
       SET status = $1,
           passed_tests = $2,
           failed_tests = $3,
           test_results = $4::jsonb,
           completed_at = NOW()
       WHERE id = $5`,
      [status, passedTests, failedTests, JSON.stringify(testResults), runId]
    );
  }

  /**
   * Execute a single test (mock - would use actual rulepack engine)
   */
  private async executeTest(
    rulepackData: Record<string, unknown>,
    input: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // In production, would execute rulepack rules against input
    // For now, return mock output
    return { calculated: true, ...input };
  }

  /**
   * Compare actual vs expected output
   */
  private compareOutputs(
    actual: Record<string, unknown>,
    expected: Record<string, unknown>
  ): boolean {
    // Simple comparison (in production, would be more sophisticated)
    return JSON.stringify(actual) === JSON.stringify(expected);
  }

  /**
   * Get latest regression run for rulepack
   */
  async getLatestRegressionRun(rulepackId: string): Promise<RegressionRun | null> {
    const result = await db.query<{
      id: string;
      rulepack_id: string;
      run_type: string;
      status: string;
      total_tests: number;
      passed_tests: number;
      failed_tests: number;
      test_results: unknown;
      started_at: Date;
      completed_at: Date | null;
      error_message: string | null;
    }>(
      `SELECT * FROM rulepack_regression_runs
       WHERE rulepack_id = $1
       ORDER BY started_at DESC
       LIMIT 1`,
      [rulepackId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      rulepackId: row.rulepack_id,
      runType: row.run_type as RegressionRun['runType'],
      status: row.status as RegressionRun['status'],
      totalTests: row.total_tests,
      passedTests: row.passed_tests,
      failedTests: row.failed_tests,
      testResults: (row.test_results as RegressionRun['testResults']) || [],
      startedAt: row.started_at,
      completedAt: row.completed_at,
      errorMessage: row.error_message,
    };
  }

  /**
   * Calculate checksum
   */
  private calculateChecksum(data: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(data)).digest('hex');
  }

  /**
   * Map database row to Rulepack
   */
  private mapRowToRulepack(row: {
    id: string;
    jurisdiction: string;
    jurisdiction_code: string | null;
    version: string;
    status: string;
    is_active: boolean;
    checksum: string;
    effective_from: Date | null;
    effective_to: Date | null;
    rulepack_data: unknown;
    metadata: unknown;
    regression_tests: unknown;
    approved_by: string | null;
    approved_at: Date | null;
    created_at: Date;
  }): Rulepack {
    return {
      id: row.id,
      jurisdiction: row.jurisdiction,
      jurisdictionCode: row.jurisdiction_code || undefined,
      version: row.version,
      status: row.status as Rulepack['status'],
      isActive: row.is_active,
      checksum: row.checksum,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      rulepackData: (row.rulepack_data as Record<string, unknown>) || {},
      metadata: (row.metadata as Record<string, unknown>) || {},
      regressionTests: (row.regression_tests as Rulepack['regressionTests']) || [],
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      createdAt: row.created_at,
    };
  }
}

export const rulepackRegistryService = new RulepackRegistryService();
