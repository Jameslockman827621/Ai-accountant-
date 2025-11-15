 import { db } from '@ai-accountant/database';
 import { createLogger } from '@ai-accountant/shared-utils';
 import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('onboarding-service');

export type OnboardingStep =
  | 'welcome'
  | 'business_profile'
  | 'tax_scope'
  | 'chart_of_accounts'
  | 'bank_connection'
  | 'historical_import'
  | 'filing_preferences'
  | 'first_document'
  | 'complete';

const ORDERED_STEPS: OnboardingStep[] = [
  'welcome',
  'business_profile',
  'tax_scope',
  'chart_of_accounts',
  'bank_connection',
  'historical_import',
  'filing_preferences',
  'first_document',
  'complete',
];

export interface OnboardingProgress {
  tenantId: TenantId;
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  progress: number; // 0-100
}

export type OnboardingEventType =
  | 'wizard_opened'
  | 'wizard_closed'
  | 'step_viewed'
  | 'step_completed'
  | 'step_skipped'
  | 'journey_reset';

export async function getOnboardingProgress(tenantId: TenantId): Promise<OnboardingProgress> {
  const steps = await db.query<{
    step_name: string;
    completed: boolean;
  }>(
    'SELECT step_name, completed FROM onboarding_steps WHERE tenant_id = $1 ORDER BY created_at',
    [tenantId]
  );

  const completedSteps = steps.rows
    .filter(s => s.completed)
    .map(s => s.step_name as OnboardingStep);

  // Find current step (first incomplete step)
  const currentStep = ORDERED_STEPS.find(step => !completedSteps.includes(step)) || 'complete';

  const progress = Math.round((completedSteps.length / ORDERED_STEPS.length) * 100);

  return {
    tenantId,
    currentStep,
    completedSteps,
    progress,
  };
}

export async function completeOnboardingStep(
  tenantId: TenantId,
  userId: UserId,
  stepName: OnboardingStep,
  stepData?: Record<string, unknown>
): Promise<void> {
  const skipped = Boolean(stepData && (stepData as { skipped?: boolean }).skipped);

  await db.query(
    `INSERT INTO onboarding_steps (id, tenant_id, step_name, step_data, completed, completed_at, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3::jsonb, true, NOW(), NOW(), NOW())
     ON CONFLICT (tenant_id, step_name) DO UPDATE
     SET step_data = $3::jsonb, completed = true, completed_at = NOW(), updated_at = NOW()`,
    [tenantId, stepName, JSON.stringify(stepData || {})]
  );

  logger.info('Onboarding step completed', { tenantId, stepName, skipped });

  await recordOnboardingEvent(
    tenantId,
    userId,
    skipped ? 'step_skipped' : 'step_completed',
    stepName,
    {
      stepData: stepData || {},
    }
  );
}

export async function getOnboardingStepData(
  tenantId: TenantId,
  stepName: OnboardingStep
): Promise<Record<string, unknown> | null> {
  const result = await db.query<{
    step_data: unknown;
  }>(
    'SELECT step_data FROM onboarding_steps WHERE tenant_id = $1 AND step_name = $2',
    [tenantId, stepName]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return (row.step_data as Record<string, unknown>) || null;
}

export async function resetOnboarding(tenantId: TenantId, userId: UserId): Promise<void> {
  await db.query(
    'DELETE FROM onboarding_steps WHERE tenant_id = $1',
    [tenantId]
  );

  logger.info('Onboarding reset', { tenantId });
  await recordOnboardingEvent(tenantId, userId, 'journey_reset');
}

export async function recordOnboardingEvent(
  tenantId: TenantId,
  userId: UserId,
  eventType: OnboardingEventType,
  stepName?: OnboardingStep,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO onboarding_events (id, tenant_id, user_id, step_name, event_type, metadata, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, NOW())`,
      [
        tenantId,
        userId,
        stepName ?? null,
        eventType,
        JSON.stringify(metadata || {}),
      ]
    );
  } catch (error) {
    logger.warn('Failed to record onboarding event', error instanceof Error ? error : new Error(String(error)));
  }
}
