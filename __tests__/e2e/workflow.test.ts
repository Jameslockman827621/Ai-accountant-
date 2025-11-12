import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { db } from '@ai-accountant/database';
import { createReviewTask, approveTask, getPendingTasks } from '../../services/workflow/src/services/reviewWorkflow';

describe('Workflow E2E Tests', () => {
  let testTenantId: string;
  let testUserId: string;

  beforeAll(async () => {
    // Create test tenant
    const tenantResult = await db.query<{ id: string }>(
      `INSERT INTO tenants (name, country, subscription_tier)
       VALUES ('Test Tenant', 'GB', 'freelancer')
       RETURNING id`
    );
    testTenantId = tenantResult.rows[0]?.id || '';

    // Create test user
    const userResult = await db.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, name, password_hash, role)
       VALUES ($1, 'test@example.com', 'Test User', 'hash', 'client')
       RETURNING id`,
      [testTenantId]
    );
    testUserId = userResult.rows[0]?.id || '';
  });

  afterAll(async () => {
    if (testTenantId) {
      await db.query('DELETE FROM tenants WHERE id = $1', [testTenantId]);
    }
    await db.close();
  });

  describe('Review Workflow', () => {
    it('should create, assign, and approve a review task', async () => {
      // Create review task
      const taskId = await createReviewTask(
        testTenantId,
        'document',
        'test-doc-id',
        'high'
      );

      expect(taskId).toBeDefined();

      // Get pending tasks
      const pendingTasks = await getPendingTasks(testTenantId);
      expect(pendingTasks.length).toBeGreaterThan(0);

      // Approve task
      await approveTask(taskId, testUserId);

      // Verify task is approved
      const tasks = await getPendingTasks(testTenantId);
      const task = tasks.find(t => t.id === taskId);
      expect(task?.status).toBe('approved');
    });
  });
});
