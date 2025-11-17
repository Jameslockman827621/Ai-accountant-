import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { intentProfileService } from './intentProfile';
import { orchestrator } from './orchestrator';
import { emitOnboardingEvent } from './onboardingEvents';

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

  // Update intent profile based on step data
  if (stepData && !skipped) {
    await updateIntentProfileFromStep(tenantId, userId, stepName, stepData);
  }

  // Record event
  await recordOnboardingEvent(
    tenantId,
    userId,
    skipped ? 'step_skipped' : 'step_completed',
    stepName,
    {
      stepData: stepData || {},
    }
  );

  // Emit event to message queue for downstream processing
  await emitOnboardingEvent('onboarding.step.completed', {
    tenantId,
    userId,
    stepName,
    stepData: stepData || {},
    skipped,
  });

  // Check if onboarding is complete and trigger provisioning
  const progress = await getOnboardingProgress(tenantId);
  if (progress.currentStep === 'complete') {
    await handleOnboardingCompletion(tenantId, userId);
  }
}

/**
 * Update intent profile based on onboarding step data
 */
async function updateIntentProfileFromStep(
  tenantId: TenantId,
  userId: UserId,
  stepName: OnboardingStep,
  stepData: Record<string, unknown>
): Promise<void> {
  try {
    const existingProfile = await intentProfileService.getProfile(tenantId);
    const profileData: any = existingProfile || {};

    switch (stepName) {
      case 'business_profile': {
        await intentProfileService.createOrUpdateProfile({
          tenantId,
          userId,
          entityType: (stepData.businessType as string) || profileData.entity_type,
          businessName: (stepData.businessName as string) || profileData.business_name,
          industry: (stepData.industry as string) || profileData.industry,
          employeesCount: stepData.employees ? parseInt(String(stepData.employees), 10) : profileData.employees_count,
          primaryJurisdiction: (stepData.country as string) || profileData.primary_jurisdiction || 'GB',
          vatNumber: (stepData.vatNumber as string) || profileData.vat_number,
        });
        break;
      }
      case 'tax_scope': {
        await intentProfileService.createOrUpdateProfile({
          tenantId,
          userId,
          entityType: profileData.entity_type || '',
          businessName: profileData.business_name || '',
          primaryJurisdiction: profileData.primary_jurisdiction || 'GB',
          taxObligations: (stepData.taxObligations as string[]) || profileData.tax_obligations || [],
          vatRegistered: Boolean(stepData.vatRegistered ?? profileData.vat_registered),
          payrollEnabled: Boolean(stepData.payrollEnabled ?? profileData.payroll_enabled),
        });
        break;
      }
      case 'filing_preferences': {
        await intentProfileService.createOrUpdateProfile({
          tenantId,
          userId,
          entityType: profileData.entity_type || '',
          businessName: profileData.business_name || '',
          primaryJurisdiction: profileData.primary_jurisdiction || 'GB',
          filingFrequency: (stepData.frequency as 'monthly' | 'quarterly' | 'annually') || profileData.filing_frequency,
        });
        break;
      }
      default:
        // Other steps don't directly update intent profile
        break;
    }
  } catch (error) {
    logger.warn('Failed to update intent profile from step', {
      tenantId,
      stepName,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - intent profile update failure shouldn't block onboarding
  }
}

/**
 * Handle onboarding completion - trigger provisioning
 */
async function handleOnboardingCompletion(tenantId: TenantId, userId: UserId): Promise<void> {
  try {
    logger.info('Onboarding completion detected', { tenantId, userId });

    // Get or create onboarding session
    const sessionResult = await db.query<{ id: string }>(
      'SELECT id FROM onboarding_sessions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1',
      [tenantId]
    );

    let sessionId: string;
    if (sessionResult.rows.length > 0) {
      sessionId = sessionResult.rows[0].id;
    } else {
      // Create new session
      sessionId = await orchestrator.createSession(tenantId, userId);
    }

    // Trigger provisioning (this will transition through states and complete)
    await orchestrator.triggerProvisioning(sessionId);

    // Emit completion event
    await emitOnboardingEvent('onboarding.completed', {
      tenantId,
      userId,
      sessionId,
    });

    logger.info('Onboarding completion handled', { tenantId, userId, sessionId });
  } catch (error) {
    logger.error('Failed to handle onboarding completion', {
      tenantId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - completion handling failure shouldn't block the user
  }
}

export async function getOnboardingStepData(
  tenantId: TenantId,
  stepName: OnboardingStep
): Promise<Record<string, unknown> | null> {
  try {
    // First try onboarding_steps table
    const result = await db.query<{
      step_data: unknown;
    }>(
      'SELECT step_data FROM onboarding_steps WHERE tenant_id = $1 AND step_name = $2',
      [tenantId, stepName]
    );

    if (result.rows.length > 0) {
      return (result.rows[0].step_data as Record<string, unknown>) || null;
    }

    // Fallback to onboarding_step_data table (for draft data)
    const draftResult = await db.query<{
      step_data: unknown;
    }>(
      'SELECT step_data FROM onboarding_step_data WHERE tenant_id = $1 AND step_name = $2 ORDER BY updated_at DESC LIMIT 1',
      [tenantId, stepName]
    );

    if (draftResult.rows.length > 0) {
      return (draftResult.rows[0].step_data as Record<string, unknown>) || null;
    }

    return null;
  } catch (error) {
    logger.error('Failed to get onboarding step data', {
      tenantId,
      stepName,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
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
