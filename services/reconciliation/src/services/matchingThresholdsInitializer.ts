import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { intelligentMatchingService, MatchingThresholds } from './intelligentMatching';

const logger = createLogger('matching-thresholds-initializer');

export interface DefaultThresholdsConfig {
  autoMatch: number;
  suggestMatch: number;
  signalWeights: {
    amount: number;
    date: number;
    vendor: number;
    ocrConfidence: number;
    description: number;
  };
}

export const DEFAULT_THRESHOLDS: DefaultThresholdsConfig = {
  autoMatch: 0.85,
  suggestMatch: 0.6,
  signalWeights: {
    amount: 0.35,
    date: 0.25,
    vendor: 0.15,
    ocrConfidence: 0.1,
    description: 0.15,
  },
};

export class MatchingThresholdsInitializer {
  /**
   * Initialize default thresholds for a tenant
   */
  async initializeForTenant(
    tenantId: TenantId,
    customThresholds?: Partial<DefaultThresholdsConfig>
  ): Promise<void> {
    const thresholds: MatchingThresholds = {
      autoMatch: customThresholds?.autoMatch ?? DEFAULT_THRESHOLDS.autoMatch,
      suggestMatch: customThresholds?.suggestMatch ?? DEFAULT_THRESHOLDS.suggestMatch,
      signalWeights: {
        ...DEFAULT_THRESHOLDS.signalWeights,
        ...(customThresholds?.signalWeights || {}),
      },
    };

    await intelligentMatchingService.updateThresholds(tenantId, thresholds, 0);

    logger.info('Default thresholds initialized', { tenantId, thresholds });
  }

  /**
   * Initialize thresholds for all existing tenants
   */
  async initializeForAllTenants(): Promise<{ initialized: number; skipped: number }> {
    const tenantsResult = await db.query<{ id: string }>(
      `SELECT id FROM tenants WHERE is_active = true`
    );

    let initialized = 0;
    let skipped = 0;

    for (const tenant of tenantsResult.rows) {
      try {
        // Check if thresholds already exist
        const existingResult = await db.query<{ count: string }>(
          `SELECT COUNT(*) as count
           FROM matching_thresholds
           WHERE tenant_id = $1 AND threshold_type = 'auto_match'`,
          [tenant.id]
        );

        if (parseInt(existingResult.rows[0]?.count || '0', 10) > 0) {
          logger.debug('Thresholds already exist for tenant', { tenantId: tenant.id });
          skipped++;
          continue;
        }

        await this.initializeForTenant(tenant.id as TenantId);
        initialized++;
      } catch (error) {
        logger.error('Failed to initialize thresholds for tenant', {
          tenantId: tenant.id,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        skipped++;
      }
    }

    logger.info('Threshold initialization completed', {
      initialized,
      skipped,
      total: tenantsResult.rows.length,
    });

    return { initialized, skipped };
  }

  /**
   * Update thresholds based on user feedback (learning)
   */
  async learnFromFeedback(
    tenantId: TenantId,
    feedback: Array<{
      matchId: string;
      accepted: boolean;
      confidenceScore: number;
      signals: {
        amount: number;
        date: number;
        vendor: number;
        ocrConfidence: number;
        description: number;
      };
    }>
  ): Promise<void> {
    if (feedback.length === 0) return;

    // Analyze feedback to adjust thresholds
    const accepted = feedback.filter((f) => f.accepted);
    const rejected = feedback.filter((f) => !f.accepted);

    if (accepted.length === 0 && rejected.length === 0) return;

    // Calculate new thresholds based on feedback
    const currentThresholds = await intelligentMatchingService.getThresholds(tenantId);

    // If many high-confidence matches were rejected, lower threshold
    // If many low-confidence matches were accepted, raise threshold
    let autoMatchAdjustment = 0;
    let suggestMatchAdjustment = 0;

    if (rejected.length > 0) {
      const avgRejectedConfidence =
        rejected.reduce((sum, f) => sum + f.confidenceScore, 0) / rejected.length;
      if (avgRejectedConfidence >= currentThresholds.autoMatch) {
        // High-confidence matches were rejected, lower threshold
        autoMatchAdjustment = -0.05;
      }
    }

    if (accepted.length > 0) {
      const avgAcceptedConfidence =
        accepted.reduce((sum, f) => sum + f.confidenceScore, 0) / accepted.length;
      if (avgAcceptedConfidence < currentThresholds.autoMatch) {
        // Low-confidence matches were accepted, raise threshold
        autoMatchAdjustment = 0.05;
      }
    }

    type SignalKey = 'amount' | 'date' | 'vendor' | 'ocrConfidence' | 'description';

    // Adjust signal weights based on which signals were most reliable
    const signalReliability: Record<SignalKey, number> = {
      amount: 0,
      date: 0,
      vendor: 0,
      ocrConfidence: 0,
      description: 0,
    };

    const signalKeys: SignalKey[] = ['amount', 'date', 'vendor', 'ocrConfidence', 'description'];

    for (const item of feedback) {
      if (item.accepted && item.signals) {
        // High signal values in accepted matches = reliable
        signalKeys.forEach((key) => {
          const signalValue = item.signals[key];
          signalReliability[key] += signalValue;
        });
      }
    }

    // Normalize and adjust weights
    const totalReliability = Object.values(signalReliability).reduce((sum, v) => sum + v, 0);
    if (totalReliability > 0) {
      const newWeights = { ...currentThresholds.signalWeights };
      signalKeys.forEach((key) => {
        const reliability = signalReliability[key] / totalReliability;
        const currentWeight = currentThresholds.signalWeights[key];
        // Adjust weight proportionally to reliability
        newWeights[key] = currentWeight * 0.8 + reliability * 0.2;
      });

      // Normalize weights to sum to 1
      const weightSum = Object.values(newWeights).reduce((sum, w) => sum + w, 0);
      (Object.keys(newWeights) as Array<keyof typeof newWeights>).forEach((key) => {
        newWeights[key] /= weightSum;
      });

      await intelligentMatchingService.updateThresholds(
        tenantId,
        {
          autoMatch: Math.max(
            0.5,
            Math.min(0.95, currentThresholds.autoMatch + autoMatchAdjustment)
          ),
          suggestMatch: Math.max(
            0.3,
            Math.min(0.8, currentThresholds.suggestMatch + suggestMatchAdjustment)
          ),
          signalWeights: newWeights,
        },
        feedback.length
      );

      logger.info('Thresholds updated from feedback', {
        tenantId,
        sampleCount: feedback.length,
        adjustments: { autoMatch: autoMatchAdjustment, suggestMatch: suggestMatchAdjustment },
      });
    }
  }
}

export const matchingThresholdsInitializer = new MatchingThresholdsInitializer();
