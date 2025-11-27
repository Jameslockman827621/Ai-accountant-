import { describe, expect, it, jest } from '@jest/globals';
import fixtures from './validation-fixtures.json';
import { runDeterministicValidation, overrideValidationDecision } from '@ai-accountant/validation-service/services/deterministicPipeline';

jest.mock('@ai-accountant/validation-service/services/validationRunStore', () => ({
  startValidationRun: jest.fn().mockResolvedValue({ runId: 'golden-run' }),
  recordValidationComponent: jest.fn().mockResolvedValue(undefined),
  completeValidationRun: jest.fn().mockResolvedValue(undefined),
  recordValidationDecision: jest.fn(async (input) => ({
    id: `dec-${input.ruleId}`,
    decidedAt: new Date('2024-01-01T00:00:00Z'),
    ...input,
  })),
  recordRejection: jest.fn(async (input) => ({
    id: `rej-${input.domain}`,
    queuedAt: new Date('2024-01-01T00:00:00Z'),
    ...input,
  })),
  recordValidationOverride: jest.fn(async (input) => ({
    id: `ov-${input.decisionId}`,
    decisionId: input.decisionId,
    overriddenBy: input.overriddenBy,
    reason: input.reason,
    previousStatus: 'fail',
    newStatus: input.newStatus,
    createdAt: new Date('2024-01-02T00:00:00Z'),
    runId: 'golden-run',
  })),
  recordAuditEvent: jest.fn(async (input) => ({
    id: `audit-${input.action}`,
    runId: input.runId,
    actor: input.actor,
    action: input.action,
    context: input.context ?? {},
    createdAt: new Date('2024-01-01T00:00:00Z'),
  })),
}));

const goldenFixtures = fixtures.runs;

describe('Deterministic validation golden datasets', () => {
  it.each(goldenFixtures)('keeps rule outputs stable for %s', async (fixture) => {
    const result = await runDeterministicValidation({
      tenantId: 'golden-suite',
      entityType: fixture.entityType,
      entityId: fixture.entityId,
      payload: fixture.payload,
      triggeredBy: 'golden-user',
    });

    expect(result.run.status).toBe(fixture.expectedStatus);

    const decisionIds = result.auditTrail
      .filter((event) => event.action === 'decision_recorded')
      .map((event) => (event.context.decision as any).ruleId);

    fixture.expectedFailures.forEach((ruleId) => {
      expect(decisionIds).toContain(ruleId);
    });

    const rejectionReasons = result.rejections.map((rejection) => rejection.reason);
    expect(rejectionReasons.length).toBeGreaterThan(0);

    const override = await overrideValidationDecision('dec-tax-filing-signed', 'pass', 'controller', 'Manual approval');
    expect(override.previousStatus).toBe('fail');
    expect(override.newStatus).toBe('pass');
  });
});
