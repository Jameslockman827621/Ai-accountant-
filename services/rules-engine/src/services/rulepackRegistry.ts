import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { createHash } from 'crypto';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { rulepackGitRepository } from './rulepackGitRepository';

const logger = createLogger('rulepack-registry');

type SemverBump = 'major' | 'minor' | 'patch';

interface RulepackApprovalRecord {
  reviewerId: string;
  status: 'submitted' | 'approved' | 'rejected';
  notes?: string;
  timestamp: string;
}

interface RulepackCanaryPlan {
  tenantIds: string[];
  rolloutPercent: number;
  status: 'planned' | 'active' | 'completed';
  startAt: string;
  endAt?: string;
}

export interface RulepackMetadata extends Record<string, unknown> {
  description?: string;
  authors?: string[];
  sourceControlRef?: string;
  gitSnapshot?: {
    path: string;
    status?: string;
    recordedAt: string;
  };
  approvals?: RulepackApprovalRecord[];
  pendingStatuteReview?: boolean;
  statuteDigests?: Array<{
    authority: string;
    jurisdiction: string;
    topic: string;
    url: string;
    hash: string;
    checkedAt: string;
    previousHash?: string;
  }>;
  regressionQuality?: {
    lastRunId?: string;
    passRate?: number;
    coverage?: number;
    gatingStatus?: 'pass' | 'block';
    lastRunAt?: string;
  };
  canary?: RulepackCanaryPlan;
  notificationPreferences?: Record<string, unknown>;
}

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
  metadata: RulepackMetadata;
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

interface InstallRulepackOptions {
  changeType?: SemverBump;
  autoVersion?: boolean;
  description?: string;
  sourceControlRef?: string;
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
    version: string | undefined,
    rulepackData: Record<string, unknown>,
    metadata: RulepackMetadata = {},
    regressionTests: Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
      expectedOutput: Record<string, unknown>;
    }> = [],
    createdBy: UserId,
    options: InstallRulepackOptions = {}
  ): Promise<string> {
    // Calculate checksum
    const checksum = this.calculateChecksum(rulepackData);

    const targetVersion =
      version && version.trim().length > 0
        ? version.trim()
        : await this.suggestNextVersion(jurisdiction, options.changeType ?? 'minor');
    this.ensureSemanticVersion(targetVersion);

    // Check for duplicate
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM rulepack_registry
       WHERE jurisdiction = $1 AND version = $2`,
      [jurisdiction, targetVersion]
    );

    if (existing.rows.length > 0) {
      throw new Error(`Rulepack ${jurisdiction} v${targetVersion} already exists`);
    }

    const gitSnapshot = await rulepackGitRepository.persistSnapshot(
      jurisdiction,
      targetVersion,
      rulepackData
    );

    const metadataPayload = this.mergeMetadata(metadata, {
      description: options.description ?? metadata.description,
      gitSnapshot: {
        path: gitSnapshot.relativePath,
        status: gitSnapshot.gitStatus,
        recordedAt: new Date().toISOString(),
      },
      sourceControlRef: options.sourceControlRef,
    });

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
          targetVersion,
        checksum,
        JSON.stringify(rulepackData),
          JSON.stringify(metadataPayload),
        JSON.stringify(regressionTests),
        createdBy,
      ]
    );

    const rulepackId = result.rows[0].id;
    logger.info('Rulepack installed', {
      rulepackId,
      jurisdiction,
      version: targetVersion,
      gitSnapshot: metadataPayload.gitSnapshot,
    });

    return rulepackId;
  }

  /**
   * Activate a rulepack (requires approval and passing regression tests)
   */
  async activateRulepack(
    rulepackId: string,
    approvedBy: UserId,
    options?: {
      effectiveFrom?: Date;
      releaseChannel?: 'general' | 'canary';
      allowOverride?: boolean;
    }
  ): Promise<void> {
    // Get rulepack
    const rulepack = await this.getRulepack(rulepackId);
    if (!rulepack) {
      throw new Error('Rulepack not found');
    }

    const releaseChannel = options?.releaseChannel ?? 'general';

    // Check if regression tests have passed
    const latestRun = await this.getLatestRegressionRun(rulepackId);
    const regressionPassRate =
      latestRun && latestRun.totalTests > 0
        ? latestRun.passedTests / latestRun.totalTests
        : 1;

    if (!options?.allowOverride) {
      if (!latestRun || latestRun.status !== 'passed') {
        throw new Error('Rulepack must pass regression tests before activation');
      }

      if (regressionPassRate < 0.99) {
        throw new Error('Regression pass rate below 99% threshold');
      }
    }

    // Deactivate other versions for same jurisdiction
    if (releaseChannel === 'general') {
      await db.query(
        `UPDATE rulepack_registry
           SET is_active = false, status = 'deprecated', updated_at = NOW()
         WHERE jurisdiction = $1 AND id != $2 AND is_active = true`,
        [rulepack.jurisdiction, rulepackId]
      );
    }

    // Activate this version
    await db.query(
      `UPDATE rulepack_registry
         SET is_active = $1,
           status = 'active',
             approved_by = $2,
             approved_at = NOW(),
             effective_from = COALESCE($3, NOW()),
           updated_at = NOW()
         WHERE id = $4`,
      [
        releaseChannel === 'general',
        approvedBy,
        options?.effectiveFrom || new Date(),
        rulepackId,
      ]
    );

    await this.updateMetadata(rulepackId, metadata => {
      const updates: Partial<RulepackMetadata> = {
        regressionQuality: {
          lastRunId: latestRun?.id,
          passRate: regressionPassRate,
          coverage: latestRun?.totalTests,
          gatingStatus: latestRun?.status === 'passed' ? 'pass' : 'block',
          lastRunAt: latestRun?.completedAt?.toISOString(),
        },
      };

      if (releaseChannel === 'general' && metadata.canary) {
        updates.canary = { ...metadata.canary, status: 'completed' };
      }

      if (releaseChannel === 'canary') {
        updates.canary = {
          ...(metadata.canary ?? {
            tenantIds: [],
            rolloutPercent: 100,
            startAt: new Date().toISOString(),
          }),
          status: 'active',
        };
      }

      return this.mergeMetadata(metadata, updates);
    });

    logger.info('Rulepack activated', {
      rulepackId,
      jurisdiction: rulepack.jurisdiction,
      releaseChannel,
    });
  }

  /**
   * Submit rulepack for approval
   */
  async submitRulepackForApproval(
    rulepackId: string,
    requestedBy: UserId,
    checklist: string[] = []
  ): Promise<void> {
    const rulepack = await this.getRulepack(rulepackId);
    if (!rulepack) {
      throw new Error('Rulepack not found');
    }

    if (rulepack.status !== 'draft' && rulepack.status !== 'pending_approval') {
      throw new Error('Only draft rulepacks can be submitted for approval');
    }

    await db.query(
      `UPDATE rulepack_registry
          SET status = 'pending_approval',
              updated_at = NOW()
        WHERE id = $1`,
      [rulepackId]
    );

    await this.updateMetadata(rulepackId, metadata =>
      this.mergeMetadata(metadata, {
        approvals: [
          {
            reviewerId: requestedBy,
            status: 'submitted',
            notes: checklist.length ? `Checklist: ${checklist.join(', ')}` : undefined,
            timestamp: new Date().toISOString(),
          },
        ],
      })
    );

    logger.info('Rulepack submitted for approval', {
      rulepackId,
      jurisdiction: rulepack.jurisdiction,
      requestedBy,
    });
  }

  /**
   * Approve rulepack and optionally trigger activation
   */
  async approveRulepack(
    rulepackId: string,
    approverId: UserId,
    options?: {
      notes?: string;
      effectiveFrom?: Date;
      releaseChannel?: 'general' | 'canary';
      allowOverride?: boolean;
    }
  ): Promise<void> {
    await this.activateRulepack(rulepackId, approverId, {
      effectiveFrom: options?.effectiveFrom,
      releaseChannel: options?.releaseChannel,
      allowOverride: options?.allowOverride,
    });

    await this.updateMetadata(rulepackId, metadata =>
      this.mergeMetadata(metadata, {
        approvals: [
          {
            reviewerId: approverId,
            status: 'approved',
            notes: options?.notes,
            timestamp: new Date().toISOString(),
          },
        ],
      })
    );

    logger.info('Rulepack approved', { rulepackId, approverId });
  }

  /**
   * Plan or update canary rollout
   */
  async scheduleCanaryRollout(
    rulepackId: string,
    tenantIds: TenantId[],
    rolloutPercent: number,
    window?: { startAt?: Date; endAt?: Date }
  ): Promise<void> {
    const boundedPercent = Math.min(Math.max(rolloutPercent, 1), 100);

    await this.updateMetadata(rulepackId, metadata =>
      this.mergeMetadata(metadata, {
        canary: {
          tenantIds,
          rolloutPercent: boundedPercent,
          status: 'planned',
          startAt: (window?.startAt ?? new Date()).toISOString(),
          endAt: window?.endAt?.toISOString(),
        },
      })
    );

    logger.info('Rulepack canary scheduled', {
      rulepackId,
      tenantCount: tenantIds.length,
      rolloutPercent: boundedPercent,
    });
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

    const runId = await this.createRegressionRun(rulepack, runType, executedBy);

    // Run tests asynchronously
    this.executeRegressionTests(runId, rulepack).catch(error => {
      logger.error('Regression tests failed', error instanceof Error ? error : new Error(String(error)));
    });

    return runId;
  }

  async runRegressionTestsBlocking(
    rulepackId: string,
    runType: 'pre_activation' | 'scheduled' | 'manual' = 'manual',
    executedBy?: UserId
  ): Promise<RegressionRun> {
    const rulepack = await this.getRulepack(rulepackId);
    if (!rulepack) {
      throw new Error('Rulepack not found');
    }

    const runId = await this.createRegressionRun(rulepack, runType, executedBy);
    await this.executeRegressionTests(runId, rulepack);
    const run = await this.getRegressionRun(runId);
    if (!run) {
      throw new Error('Regression run not found after execution');
    }
    return run;
  }

  private async createRegressionRun(
    rulepack: Rulepack,
    runType: 'pre_activation' | 'scheduled' | 'manual',
    executedBy?: UserId
  ): Promise<string> {
    const runResult = await db.query<{ id: string }>(
      `INSERT INTO rulepack_regression_runs (
          id, rulepack_id, run_type, status, total_tests, started_at, executed_by
        ) VALUES (
          gen_random_uuid(), $1, $2, 'running', $3, NOW(), $4
        ) RETURNING id`,
      [rulepack.id, runType, rulepack.regressionTests.length, executedBy || null]
    );

    return runResult.rows[0].id;
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

      await this.updateMetadata(rulepack.id, metadata =>
        this.mergeMetadata(metadata, {
          regressionQuality: {
            lastRunId: runId,
            passRate:
              rulepack.regressionTests.length === 0
                ? 1
                : passedTests / rulepack.regressionTests.length,
            coverage: rulepack.regressionTests.length,
            gatingStatus: status === 'passed' ? 'pass' : 'block',
            lastRunAt: new Date().toISOString(),
          },
        })
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

    return this.mapRegressionRow(result.rows[0]);
  }

  async getRegressionRun(runId: string): Promise<RegressionRun | null> {
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
         WHERE id = $1`,
      [runId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRegressionRow(result.rows[0]);
  }

  async getRegressionDashboard(): Promise<{
    totals: { totalRulepacks: number; activeRulepacks: number; recentPassRate: number };
    failingRulepacks: Array<{
      rulepackId: string;
      jurisdiction: string;
      version: string;
      status: string;
      startedAt: Date;
      completedAt: Date | null;
      passRate: number;
    }>;
    recentRuns: Array<RegressionRun & { jurisdiction: string; version: string }>;
  }> {
    const totalsResult = await db.query<{ total: string; active: string }>(
      `SELECT COUNT(*) as total,
              COALESCE(SUM(CASE WHEN is_active THEN 1 ELSE 0 END), 0) as active
         FROM rulepack_registry`
    );

    const totalsRow = totalsResult.rows[0] || { total: '0', active: '0' };

    const recentRunsResult = await db.query<{
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
      jurisdiction: string;
      version: string;
    }>(
      `SELECT rr.*, r.jurisdiction, r.version
         FROM rulepack_regression_runs rr
         JOIN rulepack_registry r ON r.id = rr.rulepack_id
        ORDER BY rr.started_at DESC
        LIMIT 25`
    );

    const recentRuns = recentRunsResult.rows.map(row => ({
      ...this.mapRegressionRow(row),
      jurisdiction: row.jurisdiction,
      version: row.version,
    }));

    const recentPassRate =
      recentRuns.length === 0
        ? 1
        : recentRuns.filter(run => run.status === 'passed').length / recentRuns.length;

    const failingRulepacks = recentRunsResult.rows
      .filter(row => row.status !== 'passed')
      .map(row => ({
        rulepackId: row.rulepack_id,
        jurisdiction: row.jurisdiction,
        version: row.version,
        status: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        passRate:
          row.total_tests === 0 ? 1 : row.passed_tests / Math.max(row.total_tests, 1),
      }));

    return {
      totals: {
        totalRulepacks: parseInt(totalsRow.total || '0', 10),
        activeRulepacks: parseInt(totalsRow.active || '0', 10),
        recentPassRate,
      },
      failingRulepacks,
      recentRuns,
    };
  }

  /**
   * Calculate checksum
   */
  private calculateChecksum(data: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(data)).digest('hex');
  }

  private mapRegressionRow(row: {
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
  }): RegressionRun {
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

  private ensureSemanticVersion(version: string): void {
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      throw new Error('Version must follow semantic versioning (MAJOR.MINOR.PATCH)');
    }
  }

  private async suggestNextVersion(
    jurisdiction: string,
    bump: SemverBump
  ): Promise<string> {
    const result = await db.query<{ version: string }>(
      `SELECT version
         FROM rulepack_registry
        WHERE jurisdiction = $1
        ORDER BY split_part(version, '.', 1)::int DESC,
                 split_part(version, '.', 2)::int DESC,
                 split_part(version, '.', 3)::int DESC
        LIMIT 1`,
      [jurisdiction]
    );

    const current = result.rows[0]?.version || '0.0.0';
    const [majorRaw, minorRaw, patchRaw] = current.split('.');
    let major = parseInt(majorRaw || '0', 10);
    let minor = parseInt(minorRaw || '0', 10);
    let patch = parseInt(patchRaw || '0', 10);

    if (bump === 'major') {
      major += 1;
      minor = 0;
      patch = 0;
    } else if (bump === 'minor') {
      minor += 1;
      patch = 0;
    } else {
      patch += 1;
    }

    return `${major}.${minor}.${patch}`;
  }

  private mergeMetadata(
    base: RulepackMetadata = {},
    updates: Partial<RulepackMetadata> = {}
  ): RulepackMetadata {
    const merged: RulepackMetadata = { ...(base || {}) };

    if (updates.approvals) {
      merged.approvals = [...(base.approvals ?? []), ...updates.approvals];
    }

    if (updates.statuteDigests) {
      merged.statuteDigests = updates.statuteDigests;
    }

    if (updates.canary) {
      merged.canary = updates.canary;
    }

    if (updates.gitSnapshot) {
      merged.gitSnapshot = updates.gitSnapshot;
    }

    if (updates.regressionQuality) {
      merged.regressionQuality = updates.regressionQuality;
    }

    if (updates.pendingStatuteReview !== undefined) {
      merged.pendingStatuteReview = updates.pendingStatuteReview;
    }

    if (updates.description !== undefined) {
      merged.description = updates.description;
    }

    if (updates.authors) {
      merged.authors = updates.authors;
    }

    if (updates.sourceControlRef !== undefined) {
      merged.sourceControlRef = updates.sourceControlRef;
    }

    if (updates.notificationPreferences) {
      merged.notificationPreferences = {
        ...(base.notificationPreferences || {}),
        ...updates.notificationPreferences,
      };
    }

    return merged;
  }

  private parseMetadata(payload: unknown): RulepackMetadata {
    if (payload && typeof payload === 'object') {
      return payload as RulepackMetadata;
    }
    return {};
  }

  private async updateMetadata(
    rulepackId: string,
    updater: (metadata: RulepackMetadata) => RulepackMetadata
  ): Promise<void> {
    const existing = await db.query<{ metadata: unknown }>(
      `SELECT metadata FROM rulepack_registry WHERE id = $1`,
      [rulepackId]
    );

    if (existing.rows.length === 0) {
      throw new Error('Rulepack not found');
    }

    const metadata = this.parseMetadata(existing.rows[0].metadata);
    const updated = updater(metadata);

    await db.query(
      `UPDATE rulepack_registry
          SET metadata = $1::jsonb,
              updated_at = NOW()
        WHERE id = $2`,
      [JSON.stringify(updated), rulepackId]
    );
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
        metadata: this.parseMetadata(row.metadata),
        regressionTests: (row.regression_tests as Rulepack['regressionTests']) || [],
        approvedBy: row.approved_by,
        approvedAt: row.approved_at,
        createdAt: row.created_at,
      };
  }
}

export const rulepackRegistryService = new RulepackRegistryService();
